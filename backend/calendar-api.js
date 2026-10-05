// /api/calendar (occasions + memories) and /api/cycles (Hải Yến only; 404 for anyone else) over the "calendar" document.
import { randomUUID } from 'node:crypto';
import { handleErrors, httpError, readJson, requireMember, requireWrite, sendJson } from './http.js';
import { createDocStore, recalled, rememberRequest } from './doc-store.js';
import { localDate, parseRange } from './dates.js';
import { listMemories } from './notes-memories.js';
import {
  emptyCalendar, validateCalendar, createEvent, updateEvent, archiveEvent, listEvents,
  assertCycleOwner, createCycle, updateCycle, endCycle, archiveCycle, listCycles,
} from './calendar-domain.js';

export const route = path => /^\/api\/(?:calendar|cycles)(?:\/|$)/.test(path);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => httpError(404, 'not_found', 'Not found');

export function create({ auth, allowedOrigins, dataDir, remote, notesStore }) {
  const store = createDocStore({ key: 'calendar', dataDir, remote, empty: emptyCalendar, validate: validateCalendar });

  async function write(req, mutate) {
    const actorId = requireWrite(req, { auth, allowedOrigins });
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'invalid_body', 'Body must be an object');
    const now = new Date().toISOString();
    return store.update(doc => mutate(doc, actorId, body, { now, today: localDate(now) }));
  }

  /** Creates once per requestId: a retry returns the first record. */
  const created = make => (doc, actorId, body, clock) => {
    if (typeof body.requestId !== 'string' || !UUID.test(body.requestId)) throw httpError(400, 'invalid_body', 'requestId must be a UUID');
    const key = `${actorId}:${body.requestId}`;
    const earlier = recalled(doc, key);
    if (earlier) return earlier;
    const record = make(doc, actorId, body, { ...clock, id: randomUUID() });
    rememberRequest(doc, key, record);
    return record;
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').slice(2); // ['calendar' | 'cycles', ...]
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const range = () => parseRange(url.searchParams.get('from'), url.searchParams.get('to'));

    if (parts[0] === 'calendar') {
      if (method === 'GET' && parts.length === 1) {
        const viewerId = requireMember(req, auth);
        const { from, to } = range();
        const [doc, memories] = await Promise.all([store.read(), notesStore().then(notes => listMemories(notes, viewerId, { from, to }))]);
        return sendJson(res, 200, { events: listEvents(doc, from, to), memories });
      }
      if (parts[1] === 'events') {
        const [, , id, action] = parts;
        if (method === 'POST' && parts.length === 2) {
          return sendJson(res, 201, { event: await write(req, created(createEvent)) });
        }
        if (method === 'PUT' && id && parts.length === 3) {
          return sendJson(res, 200, { event: await write(req, (doc, actor, body, clock) => updateEvent(doc, actor, id, body, clock)) });
        }
        if (method === 'POST' && id && action === 'archive' && parts.length === 4) {
          return sendJson(res, 200, { event: await write(req, (doc, actor, body, clock) => archiveEvent(doc, actor, id, body, clock)) });
        }
      }
      throw notFound();
    }

    // /api/cycles: identity first so nobody but the owner learns which paths or ids exist.
    const [, id, action] = parts;
    if (method === 'GET') {
      assertCycleOwner(requireMember(req, auth));
      if (parts.length !== 1) throw notFound();
      const { from, to } = range();
      return sendJson(res, 200, { cycles: listCycles(await store.read(), 'haiyen', from, to) });
    }
    assertCycleOwner(requireWrite(req, { auth, allowedOrigins }));
    const steps = { end: endCycle, archive: archiveCycle };
    if (method === 'POST' && parts.length === 1) return sendJson(res, 201, { cycle: await write(req, created(createCycle)) });
    if (method === 'PUT' && id && parts.length === 2) {
      return sendJson(res, 200, { cycle: await write(req, (doc, actor, body, clock) => updateCycle(doc, actor, id, body, clock)) });
    }
    if (method === 'POST' && id && steps[action] && parts.length === 3) {
      return sendJson(res, 200, { cycle: await write(req, (doc, actor, body, clock) => steps[action](doc, actor, id, body, clock)) });
    }
    throw notFound();
  }

  return {
    // An early refusal leaves the body unread; drain it so the connection can answer.
    handle: (req, res) => handleErrors(res, () => handle(req, res).catch(error => { req.resume(); throw error; })),
    close: () => store.close(),
  };
}
