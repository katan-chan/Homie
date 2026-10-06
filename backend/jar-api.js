// Hũ (part A): kisses, apologies and feelings in one JSON document under key 'jar'.
import { handleErrors, httpError, readJson, requireMember, requireWrite, sendJson } from './http.js';
import { createDocStore } from './doc-store.js';
import { localDate, localTime, parseRange } from './dates.js';
import { jarMessage, partnerOf } from './push.js';

export const KINDS = ['kiss', 'sorry', 'mood'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const emptyJar = () => ({ records: [], requests: [] });
export function validateJar(saved) {
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.records)) throw new Error('Invalid jar document');
  return { ...saved, requests: Array.isArray(saved.requests) ? saved.requests : [] };
}

/** Kisses and apologies are always shared; a private feeling exists only for its owner. Archived balls are out of the jar. */
export const visibleTo = (record, viewerId) => !record.archivedAt && (record.visibility === 'shared' || record.ownerId === viewerId);

/** Adds the display-zone date and time the UI and the calendar group by. */
export const shape = record => ({ ...record, localDate: localDate(record.occurredAt), time: localTime(record.occurredAt) });

const invalid = (code, message) => httpError(400, code, message);
const notFound = () => httpError(404, 'not_found', 'Not found');

function moodFields(body, base) {
  const out = {};
  const number = (key, min, max) => {
    if (body[key] === undefined && base) return;
    if (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < min || body[key] > max) throw invalid('invalid_mood', `${key} out of range`);
    out[key] = body[key];
  };
  const text = (key, max) => {
    if (body[key] === undefined) { if (!base) out[key] = ''; return; }
    if (typeof body[key] !== 'string') throw invalid('invalid_mood', `${key} must be text`);
    const value = key === 'label' ? body[key].trim() : body[key];
    if (value.length > max) throw invalid('invalid_mood', `${key} too long`);
    out[key] = value;
  };
  number('valence', -1, 1);
  number('energy', 0, 1);
  text('label', 80);
  text('note', 1000);
  if (body.visibility !== undefined || !base) {
    const visibility = body.visibility ?? 'private';
    if (!['private', 'shared'].includes(visibility)) throw invalid('invalid_visibility', 'visibility must be private or shared');
    out.visibility = visibility;
  }
  return out;
}

/** Creates a ball owned by ownerId. The requestId becomes the id, so a retry returns the original record. */
export function createRecord(doc, ownerId, body, now = new Date().toISOString()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('invalid_body', 'Expected an object');
  if (typeof body.requestId !== 'string' || !UUID.test(body.requestId)) throw invalid('invalid_request_id', 'requestId must be a UUID');
  const id = body.requestId.toLowerCase();
  const existing = doc.records.find(record => record.id === id);
  if (existing) {
    if (existing.ownerId !== ownerId || existing.kind !== body.kind) throw httpError(409, 'request_conflict', 'requestId already used');
    return existing;
  }
  if (!KINDS.includes(body.kind)) throw invalid('invalid_kind', 'kind must be kiss, sorry or mood');
  const record = { id, kind: body.kind, ownerId, occurredAt: now, visibility: 'shared', version: 1 };
  if (body.kind === 'mood') Object.assign(record, moodFields(body, null));
  doc.records.push(record);
  return record;
}

function ownRecord(doc, viewerId, id) {
  const record = doc.records.find(item => item.id === id);
  // Someone else's ball, shared or not, answers like a missing one.
  if (!record || record.ownerId !== viewerId) throw notFound();
  return record;
}
function checkVersion(record, version, required) {
  if (version === undefined && !required) return;
  if (!Number.isInteger(version)) throw invalid('invalid_version', 'version must be an integer');
  if (version !== record.version) throw httpError(409, 'version_conflict', 'The record changed elsewhere');
}

/** Only the owner edits a feeling: valence, energy, label, note, visibility; each optional. */
export function updateMood(doc, viewerId, id, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('invalid_body', 'Expected an object');
  const record = ownRecord(doc, viewerId, id);
  if (record.archivedAt) throw notFound();
  if (record.kind !== 'mood') throw invalid('not_editable', 'Only feelings can be edited');
  checkVersion(record, body.version, true);
  Object.assign(record, moodFields(body, record), { version: record.version + 1 });
  return record;
}

/** Owner takes a ball out (archived) or puts it back. Idempotent; version is optional so Undo never conflicts. */
export function setArchived(doc, viewerId, id, archived, body = {}, now = new Date().toISOString()) {
  const record = ownRecord(doc, viewerId, id);
  checkVersion(record, body?.version, false);
  if (Boolean(record.archivedAt) === archived) return record;
  if (archived) record.archivedAt = now; else delete record.archivedAt;
  record.version++;
  return record;
}

export const route = path => /^\/api\/jar(?:\/|$)/.test(path);

export function create({ auth, allowedOrigins, dataDir, remote, push = null, notifyDelay = 8000 }) {
  const store = createDocStore({ key: 'jar', dataDir, remote, empty: emptyJar, validate: validateJar });
  // The partner hears about a ball after the Undo window, and only if it is still in the jar and shared then.
  const notify = id => push?.later(`jar:${id}`, notifyDelay, async () => {
    const record = (await store.read()).records.find(item => item.id === id);
    const message = jarMessage(record);
    if (message) await push.send(partnerOf(record.ownerId), message);
  });
  const write = req => requireWrite(req, { auth, allowedOrigins });
  const reply = (res, status, record) => sendJson(res, status, { record: shape(record) });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://jar');
    let parts;
    try { parts = url.pathname.split('/').slice(3).map(decodeURIComponent); } catch { throw notFound(); }
    if (url.pathname === '/api/jar' || url.pathname === '/api/jar/') {
      if (req.method === 'GET') {
        const viewer = requireMember(req, auth);
        const from = url.searchParams.get('from'), to = url.searchParams.get('to'), kind = url.searchParams.get('kind');
        // No range means "Mọi lúc"; a range is checked like every other feature.
        const range = from === null && to === null ? null : parseRange(from, to);
        if (kind !== null && !KINDS.includes(kind)) throw invalid('invalid_kind', 'Unknown kind');
        const doc = await store.read();
        const items = doc.records.filter(record => visibleTo(record, viewer) && (!kind || record.kind === kind)).map(shape)
          .filter(item => !range || (item.localDate >= range.from && item.localDate <= range.to))
          .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
        return sendJson(res, 200, { items });
      }
      if (req.method === 'POST') {
        const owner = write(req);
        const body = await readJson(req);
        let created = false;
        const record = await store.update(doc => {
          const before = doc.records.length;
          const result = createRecord(doc, owner, body);
          created = doc.records.length > before;
          return result;
        });
        if (created) notify(record.id);
        return reply(res, created ? 201 : 200, record);
      }
      throw httpError(405, 'method_not_allowed', 'Method not allowed');
    }
    const [id, action] = parts;
    if (parts.length === 1 && req.method === 'PUT') {
      const viewer = write(req);
      const body = await readJson(req);
      let wasShared = true;
      const record = await store.update(doc => {
        wasShared = doc.records.find(item => item.id === id)?.visibility === 'shared';
        return updateMood(doc, viewer, id, body);
      });
      if (!wasShared && record.visibility === 'shared') notify(record.id);
      return reply(res, 200, record);
    }
    if (parts.length === 2 && ['archive', 'restore'].includes(action) && req.method === 'POST') {
      const viewer = write(req);
      const body = await readJson(req);
      return reply(res, 200, await store.update(doc => setArchived(doc, viewer, id, action === 'archive', body)));
    }
    throw notFound();
  }

  return {
    handle: (req, res) => handleErrors(res, () => handle(req, res)),
    close: () => store.close(),
  };
}
