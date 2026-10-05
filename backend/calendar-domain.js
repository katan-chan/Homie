// Calendar document (storage key "calendar"): occasions both members see and edit only as author,
// and Hải Yến's cycles. Pure functions over a plain { events, cycles } doc; the API owns sessions,
// requestId replay and persistence. Errors carry { status, code } like http.js httpError.

export const CYCLE_OWNER = 'haiyen';
export const EVENT_KINDS = ['occasion', 'anniversary', 'milestone'];

const fail = (status, code, message = code) => Object.assign(new Error(message), { status, code });
const notFound = () => fail(404, 'not_found', 'Not found');

const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

function text(value, max, field, { required = false } = {}) {
  if (typeof value !== 'string') throw fail(400, 'invalid_body', `${field} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw fail(400, 'invalid_body', `${field} is required`);
  if ([...trimmed].length > max) throw fail(400, 'invalid_body', `${field} is too long`);
  return trimmed;
}

function date(value, field) {
  if (!isDate(value)) throw fail(400, 'invalid_body', `${field} must be YYYY-MM-DD`);
  return value;
}

function checkVersion(record, input) {
  if (input?.version !== record.version) throw fail(409, 'version_conflict', 'Version conflict');
}

export const emptyCalendar = () => ({ events: [], cycles: [] });

/** Accepts a stored calendar document or throws (doc-store answers 503). */
export function validateCalendar(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.events) || !Array.isArray(doc.cycles)) {
    throw new Error('Invalid calendar document');
  }
  return doc;
}

/* ---------- Occasions ---------- */

function eventFields(input, base = {}) {
  const merged = { title: base.title, date: base.date, kind: base.kind, ...pick(input, ['title', 'date', 'kind']) };
  if (!EVENT_KINDS.includes(merged.kind)) throw fail(400, 'invalid_body', 'Unknown kind');
  return { title: text(merged.title, 120, 'title', { required: true }), date: date(merged.date, 'date'), kind: merged.kind };
}

function pick(input, keys) {
  if (!input || typeof input !== 'object') throw fail(400, 'invalid_body', 'Body must be an object');
  return Object.fromEntries(keys.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
}

function liveEvent(doc, id) {
  const event = doc.events.find(item => item.id === id && !item.archivedAt);
  if (!event) throw notFound();
  return event;
}

function ownEvent(doc, actorId, id) {
  const event = liveEvent(doc, id);
  if (event.authorId !== actorId) throw fail(403, 'not_author', 'Only the author can change this occasion');
  return event;
}

export function createEvent(doc, actorId, input, { id, now }) {
  const event = { id, authorId: actorId, ...eventFields(input), createdAt: now, updatedAt: now, version: 1 };
  doc.events.push(event);
  return event;
}

export function updateEvent(doc, actorId, id, input, { now }) {
  const event = ownEvent(doc, actorId, id);
  checkVersion(event, input);
  Object.assign(event, eventFields(input, event), { updatedAt: now, version: event.version + 1 });
  return event;
}

export function archiveEvent(doc, actorId, id, input, { now }) {
  const event = ownEvent(doc, actorId, id);
  checkVersion(event, input);
  Object.assign(event, { archivedAt: now, updatedAt: now, version: event.version + 1 });
  return event;
}

/** Live occasions with from <= date <= to, by date. */
export function listEvents(doc, from, to) {
  return doc.events.filter(e => !e.archivedAt && e.date >= from && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

/* ---------- Cycles (Hải Yến only) ---------- */

/** Every cycle path answers 404 to anyone but the owner, so nothing reveals that cycles exist. */
export function assertCycleOwner(actorId) {
  if (actorId !== CYCLE_OWNER) throw notFound();
}

function cycleFields(input, base = {}) {
  const merged = { start: base.start, end: base.end ?? null, note: base.note ?? '', ...pick(input, ['start', 'end', 'note']) };
  const start = date(merged.start, 'start');
  const end = merged.end === null || merged.end === '' ? null : date(merged.end, 'end');
  if (end && end < start) throw fail(400, 'invalid_range', 'End must not be before start');
  return { start, end, note: text(merged.note, 1000, 'note') };
}

function liveCycle(doc, actorId, id) {
  assertCycleOwner(actorId);
  const cycle = doc.cycles.find(item => item.id === id && !item.archivedAt);
  if (!cycle) throw notFound();
  return cycle;
}

export function createCycle(doc, actorId, input, { id, now }) {
  assertCycleOwner(actorId);
  const cycle = { id, ...cycleFields(input), createdAt: now, updatedAt: now, version: 1 };
  doc.cycles.push(cycle);
  return cycle;
}

export function updateCycle(doc, actorId, id, input, { now }) {
  const cycle = liveCycle(doc, actorId, id);
  checkVersion(cycle, input);
  Object.assign(cycle, cycleFields(input, cycle), { updatedAt: now, version: cycle.version + 1 });
  return cycle;
}

/** Ends a cycle on input.date, defaulting to today (local date). */
export function endCycle(doc, actorId, id, input, { now, today }) {
  const cycle = liveCycle(doc, actorId, id);
  checkVersion(cycle, input);
  const end = input?.date === undefined ? today : date(input.date, 'date');
  if (end < cycle.start) throw fail(400, 'invalid_range', 'End must not be before start');
  Object.assign(cycle, { end, updatedAt: now, version: cycle.version + 1 });
  return cycle;
}

export function archiveCycle(doc, actorId, id, input, { now }) {
  const cycle = liveCycle(doc, actorId, id);
  checkVersion(cycle, input);
  Object.assign(cycle, { archivedAt: now, updatedAt: now, version: cycle.version + 1 });
  return cycle;
}

/** Live cycles overlapping [from, to]; an ongoing cycle (end null) overlaps every range after its start. Newest first. */
export function listCycles(doc, actorId, from, to) {
  assertCycleOwner(actorId);
  return doc.cycles.filter(c => !c.archivedAt && c.start <= to && (c.end ?? '9999-12-31') >= from)
    .sort((a, b) => b.start.localeCompare(a.start));
}
