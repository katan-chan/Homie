// Seminar topics and shared activities (part C): pure state transitions over the `ideas` document.
// Each kind ('seminar' | 'activity') has one shared round: the current pick, the ideas skipped this round,
// and `relax` (recently done ideas may be picked until the next Xong). Callers pass
// ctx = { now: ISO instant, today: local 'YYYY-MM-DD', random?: () => [0, 1), id?: () => string }.
import { randomUUID } from 'node:crypto';
import { httpError as fail } from './http.js';
import { addDays, isDate, parseRange } from './dates.js';

export const KINDS = ['seminar', 'activity'];
export const SEMINAR_CATEGORY = 'Học - Seminar';
export const ACTIVITY_CATEGORIES = ['Trò chuyện', 'Sáng tạo', 'Khám phá', 'Chơi', 'Tự làm', 'Tụi mình', 'Nhảm nhí'];
export const RECENT_DAYS = 14;
const PAPER = ['#fff0b8', '#f9dbe5', '#deead9', '#dce9f5', '#e8ddf1', '#fffaf0'];
const MAX_XY = 4000, PAGE = 10, MAX_PAGE = 100;

const freshRound = () => ({ pick: null, skipped: [], relax: false });
export const emptyIdeas = () => ({ ideas: [], sessions: [], rounds: { seminar: freshRound(), activity: freshRound() }, requests: [] });
export function validateIdeas(doc) {
  if (!Array.isArray(doc?.ideas) || !Array.isArray(doc.sessions) || !KINDS.every(kind => doc.rounds?.[kind])) throw new Error('Invalid ideas document');
  return doc;
}

export function requireKind(kind) {
  if (!KINDS.includes(kind)) throw fail(400, 'invalid_kind', 'Unknown kind');
  return kind;
}
export function requireRequestId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw fail(400, 'invalid_request_id', 'requestId must be a UUID');
  return value;
}
function text(value, max, code, required = false) {
  value ??= '';
  if (typeof value !== 'string') throw fail(400, code);
  const result = required ? value.trim() : value;
  if ((required && !result) || [...result].length > max) throw fail(400, code);
  return result;
}
function category(kind, value) {
  if (kind === 'seminar') {
    if (value != null && value !== SEMINAR_CATEGORY) throw fail(400, 'invalid_category');
    return SEMINAR_CATEGORY;
  }
  if (!ACTIVITY_CATEGORIES.includes(value)) throw fail(400, 'invalid_category');
  return value;
}
// An optional category narrows the pool for picking (the activity page's chips).
function filterCategory(kind, value) {
  return value == null || value === '' ? null : category(kind, value);
}
function minutes(value) {
  if (value == null || value === '') return null;
  if (!Number.isInteger(value) || value < 1 || value > 1440) throw fail(400, 'invalid_minutes');
  return value;
}
function rating(value) {
  if (!Number.isInteger(value) || value < 1 || value > 5) throw fail(400, 'invalid_rating');
  return value;
}
function checkVersion(record, version) {
  if (!Number.isInteger(version)) throw fail(400, 'invalid_version');
  if (record.version !== version) throw fail(409, 'version_conflict', 'Version conflict');
}
function ideaFields(kind, body) {
  return {
    title: text(body.title, 120, 'invalid_title', true),
    desc: text(body.desc, 2000, 'invalid_desc'),
    category: category(kind, body.category),
    minutes: minutes(body.minutes),
  };
}
function activeIdea(doc, id) {
  const idea = doc.ideas.find(item => item.id === id && !item.archivedAt);
  if (!idea) throw fail(404, 'not_found', 'Not found');
  return idea;
}
function ownIdea(doc, actor, id, version) {
  const idea = activeIdea(doc, id);
  if (idea.authorId !== actor) throw fail(403, 'not_author', 'Only the author can change this idea');
  checkVersion(idea, version);
  return idea;
}

const poolOf = (doc, kind, cat = null) => doc.ideas.filter(idea => idea.kind === kind && !idea.archivedAt && (!cat || idea.category === cat));
// Done in the last RECENT_DAYS local days, today included; a future date also counts as recent.
const recentIds = (doc, today) => {
  const after = addDays(today, -RECENT_DAYS);
  return new Set(doc.sessions.filter(s => s.date > after).map(s => s.ideaId));
};
function standing(doc, kind, cat, today) {
  const round = doc.rounds[kind], recent = recentIds(doc, today), skipped = new Set(round.skipped), pool = poolOf(doc, kind, cat);
  return {
    recent,
    eligible: pool.filter(idea => (round.relax || !recent.has(idea.id)) && !skipped.has(idea.id)),
    exhausted: { recent: pool.filter(idea => recent.has(idea.id)).length, skipped: pool.filter(idea => skipped.has(idea.id)).length },
  };
}

/** GET /api/ideas: the pool of one kind (all categories), the shared pick and why nothing may be pickable. */
export function viewIdeas(doc, { kind, category: cat } = {}, { today }) {
  requireKind(kind);
  const { recent, eligible, exhausted } = standing(doc, kind, filterCategory(kind, cat), today);
  const round = doc.rounds[kind];
  return {
    ideas: poolOf(doc, kind).map(idea => ({ ...idea, recent: recent.has(idea.id) })),
    pick: round.pick, eligibleCount: eligible.length, exhausted, relax: round.relax,
  };
}

export function createIdea(doc, actor, body, { now, id = randomUUID }) {
  const kind = requireKind(body.kind), fields = ideaFields(kind, body), taken = poolOf(doc, kind);
  // First free slot on a 3-column grid, so a new paper never lands on top of another.
  const slot = k => ({ x: 30 + (k % 3) * 310, y: 30 + Math.floor(k / 3) * 290 });
  let k = 0;
  while (taken.some(idea => Math.abs(idea.x - slot(k).x) < 220 && Math.abs(idea.y - slot(k).y) < 220)) k++;
  const idea = { id: id(), kind, authorId: actor, ...fields, ...slot(k), color: PAPER[doc.ideas.length % PAPER.length], createdAt: now, updatedAt: now, version: 1 };
  doc.ideas.push(idea);
  return idea;
}

export function updateIdea(doc, actor, ideaId, body, { now }) {
  const idea = ownIdea(doc, actor, ideaId, body.version);
  Object.assign(idea, ideaFields(idea.kind, body), { updatedAt: now, version: idea.version + 1 });
  return idea;
}

/** Archived ideas leave the pool and the round; their history stays. */
export function archiveIdea(doc, actor, ideaId, body, { now }) {
  const idea = ownIdea(doc, actor, ideaId, body.version);
  Object.assign(idea, { archivedAt: now, updatedAt: now, version: idea.version + 1 });
  const round = doc.rounds[idea.kind];
  if (round.pick?.ideaId === idea.id) round.pick = null;
  round.skipped = round.skipped.filter(id => id !== idea.id);
  return idea;
}

/** Either member may move any paper. Moving does not bump the version, so it never conflicts with an edit. */
export function moveIdea(doc, ideaId, body) {
  const idea = activeIdea(doc, ideaId);
  const coordinate = value => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw fail(400, 'invalid_position');
    return Math.round(Math.min(MAX_XY, Math.max(0, value)));
  };
  Object.assign(idea, { x: coordinate(body.x), y: coordinate(body.y) });
  return idea;
}

/** Uniform pick among eligible ideas. An existing shared pick is returned instead, so both devices agree. */
export function pick(doc, actor, body, { now, today, random = Math.random, id = randomUUID }) {
  const kind = requireKind(body.kind), round = doc.rounds[kind];
  if (round.pick) return round.pick;
  const { eligible } = standing(doc, kind, filterCategory(kind, body.category), today);
  if (!eligible.length) throw fail(409, 'nothing_to_pick', 'Nothing left to pick');
  const chosen = eligible[Math.min(eligible.length - 1, Math.floor(random() * eligible.length))];
  round.pick = { id: id(), ideaId: chosen.id, byId: actor, at: now };
  return round.pick;
}

// skip/done name the pick the person saw: a stale screen cannot skip or finish a newer pick.
function currentPick(doc, body) {
  const round = doc.rounds[requireKind(body.kind)];
  if (!round.pick || round.pick.id !== body.pickId) throw fail(409, 'pick_changed', 'The current pick has changed');
  return round;
}

export function skip(doc, body) {
  const round = currentPick(doc, body);
  round.skipped.push(round.pick.ideaId);
  round.pick = null;
}

export function resetSkips(doc, body) {
  doc.rounds[requireKind(body.kind)].skipped = [];
}

export function relax(doc, body) {
  doc.rounds[requireKind(body.kind)].relax = true;
}

/** Records the occurrence and starts a new round (skips and relax end with it). */
export function done(doc, actor, body, { now, today, id = randomUUID }) {
  const round = currentPick(doc, body);
  if (!isDate(body.date) || body.date > today) throw fail(400, 'invalid_date');
  const session = {
    id: id(), kind: body.kind, ideaId: round.pick.ideaId, byId: actor, date: body.date,
    text: text(body.text, 1000, 'invalid_text'), ratings: body.rating == null || body.rating === '' ? {} : { [actor]: rating(body.rating) }, at: now,
  };
  doc.sessions.push(session);
  doc.rounds[body.kind] = freshRound();
  return withIdea(doc, session);
}

/** Each person rates only their own enjoyment. */
export function rateSession(doc, actor, sessionId, body) {
  const session = doc.sessions.find(item => item.id === sessionId);
  if (!session) throw fail(404, 'not_found', 'Not found');
  session.ratings[actor] = rating(body.rating);
  return withIdea(doc, session);
}

// History keeps a neutral reference to archived ideas.
function withIdea(doc, session) {
  const idea = doc.ideas.find(item => item.id === session.ideaId);
  return { ...session, title: idea?.title ?? '', archived: !idea || Boolean(idea.archivedAt) };
}

/** Newest first. cursor is the last id of the previous page, so new entries never shift later pages. */
export function listSessions(doc, { kind, from, to, cursor, limit } = {}) {
  if (kind != null && kind !== '') requireKind(kind);
  const ranged = from != null || to != null;
  if (ranged) parseRange(from, to);
  const size = limit == null || limit === '' ? PAGE : Number(limit);
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE) throw fail(400, 'invalid_limit');
  const all = doc.sessions
    .filter(s => (!kind || s.kind === kind) && (!ranged || (s.date >= from && s.date <= to)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  let start = 0;
  if (cursor != null && cursor !== '') {
    start = all.findIndex(s => s.id === cursor) + 1;
    if (!start) throw fail(400, 'invalid_cursor');
  }
  const items = all.slice(start, start + size);
  return { items: items.map(s => withIdea(doc, s)), nextCursor: start + size < all.length ? items.at(-1).id : null };
}
