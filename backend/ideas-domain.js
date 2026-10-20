// Seminar topics and shared activities (part C): pure state transitions over the `ideas` document.
// Each kind ('seminar' | 'activity') has one shared round: the current pick. Picking draws from the ideas that are
// in the pool (`inPool`, absent means in); picking, skipping and Xong never take an idea out of it. Callers pass
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

const freshRound = () => ({ pick: null });
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
function versionedIdea(doc, id, version) {
  const idea = activeIdea(doc, id);
  checkVersion(idea, version);
  return idea;
}
function ownIdea(doc, actor, id, version) {
  const idea = activeIdea(doc, id);
  if (idea.authorId !== actor) throw fail(403, 'not_author', 'Only the author can archive this idea');
  checkVersion(idea, version);
  return idea;
}

const poolOf = (doc, kind, cat = null) => doc.ideas.filter(idea => idea.kind === kind && !idea.archivedAt && (!cat || idea.category === cat));
// Done in the last RECENT_DAYS local days, today included; a future date also counts as recent.
const recentIds = (doc, today) => {
  const after = addDays(today, -RECENT_DAYS);
  return new Set(doc.sessions.filter(s => s.date > after).map(s => s.ideaId));
};
const inPool = idea => idea.inPool !== false;
const eligibleOf = (doc, kind, cat) => poolOf(doc, kind, filterCategory(kind, cat)).filter(inPool);

/** GET /api/ideas: every idea of one kind (all categories, with inPool and recent), the shared pick and how many can be picked. */
export function viewIdeas(doc, { kind, category: cat } = {}, { today }) {
  requireKind(kind);
  const recent = recentIds(doc, today);
  return {
    ideas: poolOf(doc, kind).map(idea => ({ ...idea, inPool: inPool(idea), recent: recent.has(idea.id) })),
    pick: doc.rounds[kind].pick, eligibleCount: eligibleOf(doc, kind, cat).length,
  };
}

export function createIdea(doc, actor, body, { now, id = randomUUID }) {
  const kind = requireKind(body.kind), fields = ideaFields(kind, body), taken = poolOf(doc, kind);
  // First free slot on a 3-column grid, so a new paper never lands on top of another.
  const slot = k => ({ x: 30 + (k % 3) * 310, y: 30 + Math.floor(k / 3) * 290 });
  let k = 0;
  while (taken.some(idea => Math.abs(idea.x - slot(k).x) < 220 && Math.abs(idea.y - slot(k).y) < 220)) k++;
  const idea = { id: id(), kind, authorId: actor, ...fields, ...slot(k), inPool: true, color: PAPER[doc.ideas.length % PAPER.length], createdAt: now, updatedAt: now, version: 1 };
  doc.ideas.push(idea);
  return idea;
}

/** Either member may edit any idea; archiving stays with the author. */
export function updateIdea(doc, ideaId, body, { now }) {
  const idea = versionedIdea(doc, ideaId, body.version);
  Object.assign(idea, ideaFields(idea.kind, body), { updatedAt: now, version: idea.version + 1 });
  return idea;
}

/** Archived ideas leave the pool and the round; their history stays. */
export function archiveIdea(doc, actor, ideaId, body, { now }) {
  const idea = ownIdea(doc, actor, ideaId, body.version);
  Object.assign(idea, { archivedAt: now, updatedAt: now, version: idea.version + 1 });
  const round = doc.rounds[idea.kind];
  if (round.pick?.ideaId === idea.id) round.pick = null;
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

/** Either member may put any idea into the pool or take it out. Like moving, it does not bump the version. */
export function setInPool(doc, ideaId, body) {
  const idea = activeIdea(doc, ideaId);
  if (typeof body.inPool !== 'boolean') throw fail(400, 'invalid_in_pool');
  idea.inPool = body.inPool;
  return idea;
}

/** Uniform pick among ideas in the pool. An existing shared pick is returned instead, so both devices agree. */
export function pick(doc, actor, body, { now, random = Math.random, id = randomUUID }) {
  const kind = requireKind(body.kind), round = doc.rounds[kind];
  if (round.pick) return round.pick;
  const eligible = eligibleOf(doc, kind, body.category);
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

/** Clears the pick; the idea stays in the pool and may come up again. */
export function skip(doc, body) {
  currentPick(doc, body).pick = null;
}

/** Records the occurrence and clears the pick; the idea stays in the pool. */
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
