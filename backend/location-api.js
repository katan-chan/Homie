// Vị trí: each member's phone posts a point about every 2 minutes; both members see the latest point, sharing state and
// a short note that expires. Points are never stored: each one replaces the last and only moves the current stop
// (backend/stops.js), which turns into visits at shared places. Members only; nothing here is public.
import { randomUUID } from 'node:crypto';
import { handleErrors, httpError, readJson, requireMember, requireWrite, sendJson } from './http.js';
import { createDocStore } from './doc-store.js';
import { localDate } from './dates.js';
import { accountIds } from './profiles.js';
import { advance, end } from './stops.js';

export const LIMITS = Object.freeze({ note: 60, futureMs: 5 * 60000, accuracy: 200, staleMs: 10 * 60000 });
const HOURS = [1, 4, 24];
const REASONS = ['user', 'battery', 'auth', 'permission'];

export const route = path => /^\/api\/(location|places|timeline)(?:\/|$)/.test(path);

const person = () => ({ point: null, sharing: { on: false }, note: null, stop: null });
export const emptyLocation = () => Object.fromEntries(accountIds.map(id => [id, person()]));
const emptyItems = () => ({ items: [] });
const validItems = doc => { if (!doc || !Array.isArray(doc.items)) throw new Error('Invalid document'); return doc; };
function validLocation(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('Invalid location document');
  return Object.fromEntries(accountIds.map(id => [id, { ...person(), ...doc[id] }]));
}

const invalid = (code, message) => httpError(400, code, message);
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);

function point(input, now) {
  if (!isObject(input) || !finite(input.lat) || !finite(input.lng) || !finite(input.accuracy) || !finite(input.at)
    || Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180 || input.accuracy < 0 || input.at > now + LIMITS.futureMs) {
    throw invalid('invalid_point', 'lat, lng, accuracy and at must be valid numbers');
  }
  return { lat: input.lat, lng: input.lng, accuracy: input.accuracy, at: input.at };
}

function note(input, now) {
  const text = typeof input?.text === 'string' ? input.text.trim() : '';
  if (!text || /[\r\n]/.test(text) || [...text].length > LIMITS.note || !HOURS.includes(input.hours)) {
    throw invalid('invalid_note', `A note is one line of 1–${LIMITS.note} characters for 1, 4 or 24 hours`);
  }
  return { text, expiresAt: now + input.hours * 3600000 };
}

export function create({ auth, allowedOrigins, dataDir, remote }) {
  const location = createDocStore({ key: 'location', dataDir, remote, empty: emptyLocation, validate: validLocation });
  const places = createDocStore({ key: 'places', dataDir, remote, empty: emptyItems, validate: validItems });
  const months = new Map();
  const visits = month => {
    if (!months.has(month)) months.set(month, createDocStore({ key: `visits-${month}`, dataDir, remote, empty: emptyItems, validate: validItems }));
    return months.get(month);
  };
  const record = (user, visit) => visits(localDate(visit.arrivedAt).slice(0, 7))
    .update(doc => { doc.items.push({ id: randomUUID(), user, ...visit }); });
  // ponytail: one queue for every point and sharing change, so two phones never create the same place twice; fine for two people.
  let queue = Promise.resolve();
  const serial = fn => { const run = queue.then(fn); queue = run.catch(() => {}); return run; };

  function view(doc, placeList, now) {
    const names = new Map(placeList.map(p => [p.id, p]));
    return Object.fromEntries(accountIds.map(id => {
      const { point: p, sharing, note: n, stop } = doc[id];
      const place = stop?.placeId ? names.get(stop.placeId) : null;
      return [id, {
        ...(p ?? {}), sharing,
        note: n && n.expiresAt > now ? n : null,
        stale: Boolean(sharing.on && p && now - p.at > LIMITS.staleMs),
        place: place ? { id: place.id, name: place.name } : null,
      }];
    }));
  }

  const addPoint = (user, p) => serial(async () => {
    const placeList = (await places.read()).items;
    const result = await location.update(doc => {
      const me = doc[user];
      const next = advance(me.stop, p, placeList);
      if (!me.point || p.at > me.point.at) me.point = p;
      me.stop = next.stop;
      return next;
    });
    if (result.place) await places.update(doc => { doc.items.push({ ...result.place, createdBy: user }); });
    if (result.closed) await record(user, result.closed);
  });

  const setSharing = (user, input, now) => serial(async () => {
    if (!isObject(input) || typeof input.on !== 'boolean' || (input.reason !== undefined && !REASONS.includes(input.reason))) {
      throw invalid('invalid_sharing', 'on must be true or false');
    }
    const closed = await location.update(doc => {
      const me = doc[user];
      if (input.on) { me.sharing = { on: true, since: now }; return null; }
      const visit = end(me.stop);
      me.sharing = { on: false, stoppedAt: now, reason: input.reason ?? 'user' };
      me.stop = null;
      return visit;
    });
    if (closed) await record(user, closed);
  });

  async function handle(req, res) {
    const path = new URL(req.url, 'http://localhost').pathname;
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const now = Date.now();
    const respond = async status => {
      const [doc, placeDoc] = await Promise.all([location.read(), places.read()]);
      return sendJson(res, status, { people: view(doc, placeDoc.items, now), now });
    };

    if (path === '/api/location' && method === 'GET') { requireMember(req, auth); return respond(200); }
    if (path === '/api/location/point' && method === 'POST') {
      const user = requireWrite(req, { auth, allowedOrigins });
      const p = point(await readJson(req), now);
      if (p.accuracy <= LIMITS.accuracy) await addPoint(user, p);
      return sendJson(res, 204);
    }
    if (path === '/api/location/sharing' && method === 'PUT') {
      const user = requireWrite(req, { auth, allowedOrigins });
      await setSharing(user, await readJson(req), now);
      return respond(200);
    }
    if (path === '/api/location/note' && (method === 'PUT' || method === 'DELETE')) {
      const user = requireWrite(req, { auth, allowedOrigins });
      const next = method === 'PUT' ? note(await readJson(req), now) : null;
      await location.update(doc => { doc[user].note = next; });
      return respond(200);
    }
    if (path === '/api/places' && method === 'GET') {
      requireMember(req, auth);
      return sendJson(res, 200, { places: (await places.read()).items.filter(p => !p.ignored) });
    }
    requireMember(req, auth);
    throw httpError(404, 'not_found', 'Not found');
  }

  return {
    // An early refusal leaves the body unread; drain it so the connection can answer.
    handle: (req, res) => handleErrors(res, () => handle(req, res).catch(error => { req.resume(); throw error; })),
    close: () => Promise.all([location.close(), places.close(), ...[...months.values()].map(store => store.close())]),
  };
}
