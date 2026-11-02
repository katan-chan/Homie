// Vị trí: each member's phone posts a point about every 2 minutes; both members see the latest point, sharing state and
// a short note that expires. Points are never stored: each one replaces the last and only moves the current stop
// (backend/stops.js), which turns into visits at shared places. Members only; nothing here is public.
import { randomUUID } from 'node:crypto';
import { handleErrors, httpError, readJson, requireMember, requireWrite, sendJson } from './http.js';
import { createDocStore } from './doc-store.js';
import { isDate, localDate } from './dates.js';
import { accountIds } from './profiles.js';
import { STOP, advance, end } from './stops.js';

export const LIMITS = Object.freeze({ placeName: 40, note: 60, futureMs: 5 * 60000, accuracy: 200, staleMs: 10 * 60000 });
const HOURS = [1, 4, 24];
const REASONS = ['user', 'battery', 'auth', 'permission'];
const DAY_MS = 86400000;
const ROUTE_URL = 'https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World/solve';

export const route = path => /^\/api\/(location|places|timeline)(?:\/|$)/.test(path);
const round5 = n => Math.round(n * 1e5) / 1e5;

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

function placeInput(input, { withPosition }) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const badPosition = withPosition && (!finite(input?.lat) || !finite(input?.lng) || Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180);
  if (!name || /[\r\n]/.test(name) || [...name].length > LIMITS.placeName || badPosition) {
    throw invalid('invalid_place', `A place needs a one-line name of 1–${LIMITS.placeName} characters`);
  }
  return withPosition ? { name, lat: input.lat, lng: input.lng } : { name };
}

/** Shortest road route between two places from Esri, or null (no key, quota, network): the client then draws a line. */
async function esriRoute(a, b) {
  const token = process.env.ESRI_ROUTE_KEY;
  if (!token) return null;
  try {
    // Fixed cost names, so the totals are Total_TravelTime (minutes) and Total_Kilometers whatever the defaults are.
    const query = new URLSearchParams({ f: 'json', token, stops: `${a.lng},${a.lat};${b.lng},${b.lat}`, outSR: '4326', returnRoutes: 'true',
      impedanceAttributeName: 'TravelTime', accumulateAttributeNames: 'Kilometers' });
    const response = await fetch(`${ROUTE_URL}?${query}`, { signal: AbortSignal.timeout(10000) });
    const feature = response.ok ? (await response.json()).routes?.features?.[0] : null;
    const path = feature?.geometry?.paths?.[0];
    if (!Array.isArray(path) || !path.length) return null;
    return {
      path: path.map(([x, y]) => [round5(y), round5(x)]),
      minutes: Math.round(feature.attributes?.Total_TravelTime ?? 0),
      km: Math.round((feature.attributes?.Total_Kilometers ?? 0) * 100) / 100,
    };
  } catch {
    return null;
  }
}

function note(input, now) {
  const text = typeof input?.text === 'string' ? input.text.trim() : '';
  if (!text || /[\r\n]/.test(text) || [...text].length > LIMITS.note || !HOURS.includes(input.hours)) {
    throw invalid('invalid_note', `A note is one line of 1–${LIMITS.note} characters for 1, 4 or 24 hours`);
  }
  return { text, expiresAt: now + input.hours * 3600000 };
}

/** 'YYYY-MM' (Vietnam time) of every month from arrivedAt to leftAt. */
export function monthsOf(arrivedAt, leftAt) {
  const keys = new Set();
  for (let day = arrivedAt; day < leftAt + DAY_MS; day += DAY_MS) keys.add(localDate(Math.min(day, leftAt)).slice(0, 7));
  return [...keys];
}

export function create({ auth, allowedOrigins, dataDir, remote }) {
  const location = createDocStore({ key: 'location', dataDir, remote, empty: emptyLocation, validate: validLocation });
  const places = createDocStore({ key: 'places', dataDir, remote, empty: emptyItems, validate: validItems });
  const routes = createDocStore({ key: 'routes', dataDir, remote, empty: () => ({ routes: {} }), validate: doc => { if (!isObject(doc?.routes)) throw new Error('Invalid routes'); return doc; } });
  const months = new Map();
  const visits = month => {
    if (!months.has(month)) months.set(month, createDocStore({ key: `visits-${month}`, dataDir, remote, empty: emptyItems, validate: validItems }));
    return months.get(month);
  };
  // A visit is filed under every month it touches, so a day's timeline only reads its own month and the one before.
  const record = async (user, visit) => {
    const item = { id: randomUUID(), user, ...visit };
    for (const key of monthsOf(visit.arrivedAt, visit.leftAt)) await visits(key).update(doc => { doc.items.push(item); });
  };
  // ponytail: one queue for every point and sharing change, so two phones never create the same place twice; fine for two people.
  let queue = Promise.resolve();
  const serial = fn => { const run = queue.then(fn); queue = run.catch(() => {}); return run; };

  function view(doc, placeList, now) {
    const names = new Map(placeList.map(p => [p.id, p]));
    return Object.fromEntries(accountIds.map(id => {
      const { point: p, sharing, note: n, stop } = doc[id];
      // A stop the phone went quiet on is not shown as where the person is now.
      const current = stop?.placeId && now - stop.lastAt <= STOP.gapMs;
      const place = current && !names.get(stop.placeId)?.ignored ? names.get(stop.placeId) : null;
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
      // The phone's "on" may have been lost (cold start, bad network); a point proves sharing is on.
      if (!me.sharing.on) me.sharing = { on: true, since: p.at };
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

  /** Cached road route between two places, oriented from a to b; asks Esri once per pair and never caches a failure. */
  async function routeBetween(a, b) {
    const key = [a.id, b.id].sort().join('|');
    let cached = (await routes.read()).routes[key];
    if (!cached) {
      const found = await esriRoute(a, b);
      if (!found) return null;
      cached = { from: a.id, ...found, at: Date.now() };
      // A route that could not be saved is still shown; it is asked again next time.
      await routes.update(doc => { doc.routes[key] = cached; }).catch(() => {});
    }
    const { from, at, ...route } = cached;
    return from === a.id ? route : { ...route, path: [...route.path].reverse() };
  }

  async function timeline(url, now) {
    const user = url.searchParams.get('user'), date = url.searchParams.get('date');
    if (!accountIds.includes(user) || !isDate(date)) throw invalid('invalid_query', 'user and date (YYYY-MM-DD) are required');
    const start = Date.parse(`${date}T00:00:00+07:00`), finish = start + DAY_MS;
    // A visit that began late on the last day of last month still reaches into this day.
    const keys = [...new Set([localDate(start).slice(0, 7), localDate(start - DAY_MS).slice(0, 7)])];
    const [placeDoc, doc, ...monthDocs] = await Promise.all([places.read(), location.read(), ...keys.map(key => visits(key).read())]);
    const stop = doc[user].stop;
    const open = stop?.placeId ? [{ placeId: stop.placeId, arrivedAt: stop.since, leftAt: now - stop.lastAt > STOP.gapMs ? stop.lastAt : null }] : [];
    const byId = new Map(placeDoc.items.map(p => [p.id, p]));
    const filed = new Map(monthDocs.flatMap(m => m.items.filter(v => v.user === user)).map(v => [v.id, v]));
    const stops = [...filed.values(), ...open]
      .filter(v => v.arrivedAt < finish && (v.leftAt ?? now) > start && byId.has(v.placeId) && !byId.get(v.placeId).ignored)
      .sort((a, b) => a.arrivedAt - b.arrivedAt)
      .map(v => { const p = byId.get(v.placeId); return { placeId: p.id, name: p.name, lat: p.lat, lng: p.lng, arrivedAt: v.arrivedAt, leftAt: v.leftAt }; });
    const pairs = stops.slice(1).map((s, i) => [stops[i], s]).filter(([a, b]) => a.placeId !== b.placeId);
    // All legs at once: each uncached one may wait on Esri for up to 10 s.
    const legs = await Promise.all(pairs.map(async ([a, b]) =>
      ({ from: a.placeId, to: b.placeId, route: await routeBetween(byId.get(a.placeId), byId.get(b.placeId)) })));
    return { user, date, stops, legs };
  }

  const changePlace = (id, change) => serial(() => places.update(doc => {
    const place = doc.items.find(p => p.id === id && !p.ignored);
    if (!place) throw httpError(404, 'not_found', 'Not found');
    change(place);
    return place;
  }));

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost'), path = url.pathname;
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
    if (path === '/api/places' && method === 'POST') {
      const user = requireWrite(req, { auth, allowedOrigins });
      const input = placeInput(await readJson(req), { withPosition: true });
      const place = { id: randomUUID(), ...input, radius: 100, createdBy: user, createdAt: now };
      await serial(() => places.update(doc => { doc.items.push(place); }));
      return sendJson(res, 201, { place });
    }
    const placeId = /^\/api\/places\/([^/]+)$/.exec(path)?.[1];
    if (placeId && method === 'PUT') {
      requireWrite(req, { auth, allowedOrigins });
      const { name } = placeInput(await readJson(req), { withPosition: false });
      return sendJson(res, 200, { place: await changePlace(placeId, place => { place.name = name; }) });
    }
    if (placeId && method === 'DELETE') {
      requireWrite(req, { auth, allowedOrigins });
      // Deleting means "never record this spot": the row stays, ignored, so stops there are not turned into a new place.
      return sendJson(res, 200, { place: await changePlace(placeId, place => { place.ignored = true; }) });
    }
    if (path === '/api/timeline' && method === 'GET') { requireMember(req, auth); return sendJson(res, 200, await timeline(url, now)); }
    requireMember(req, auth);
    throw httpError(404, 'not_found', 'Not found');
  }

  return {
    // An early refusal leaves the body unread; drain it so the connection can answer.
    handle: (req, res) => handleErrors(res, () => handle(req, res).catch(error => { req.resume(); throw error; })),
    close: () => Promise.all([location.close(), places.close(), routes.close(), ...[...months.values()].map(store => store.close())]),
  };
}
