import test from 'node:test';
import assert from 'node:assert/strict';
import * as d from '../backend/ideas-domain.js';

let n = 0;
const ctx = (extra = {}) => ({ now: `2026-10-06T0${n % 10}:00:00.000Z`, today: '2026-10-06', id: () => `id-${++n}`, ...extra });
const add = (doc, actor, body) => d.createIdea(doc, actor, { kind: 'activity', category: 'Chơi', ...body }, ctx());
const sample = () => {
  const doc = d.emptyIdeas();
  const ideas = ['A', 'B', 'C'].map((title, i) => add(doc, i % 2 ? 'haiyen' : 'minhle', { title }));
  return { doc, ideas };
};

test('validates ideas: kind, title, desc, category per kind, minutes', () => {
  const doc = d.emptyIdeas();
  const seminar = d.createIdea(doc, 'minhle', { kind: 'seminar', title: '  Vì sao mình quên giấc mơ?  ' }, ctx());
  assert.equal(seminar.category, 'Học - Seminar');
  assert.equal(seminar.title, 'Vì sao mình quên giấc mơ?');
  assert.equal(seminar.minutes, null);
  assert.equal(seminar.version, 1);
  const bad = [
    [{ kind: 'meeting', title: 'x' }, 'invalid_kind'],
    [{ kind: 'activity', title: '   ', category: 'Chơi' }, 'invalid_title'],
    [{ kind: 'activity', title: 'x'.repeat(121), category: 'Chơi' }, 'invalid_title'],
    [{ kind: 'activity', title: 'x', desc: 'x'.repeat(2001), category: 'Chơi' }, 'invalid_desc'],
    [{ kind: 'activity', title: 'x' }, 'invalid_category'],
    [{ kind: 'activity', title: 'x', category: 'Học - Seminar' }, 'invalid_category'],
    [{ kind: 'seminar', title: 'x', category: 'Chơi' }, 'invalid_category'],
    [{ kind: 'activity', title: 'x', category: 'Chơi', minutes: 0 }, 'invalid_minutes'],
    [{ kind: 'activity', title: 'x', category: 'Chơi', minutes: 1441 }, 'invalid_minutes'],
    [{ kind: 'activity', title: 'x', category: 'Chơi', minutes: 2.5 }, 'invalid_minutes'],
  ];
  for (const [body, code] of bad) assert.throws(() => d.createIdea(doc, 'minhle', body, ctx()), { status: 400, code }, code);
  assert.equal(doc.ideas.length, 1);
  assert.equal(add(doc, 'minhle', { title: 'x'.repeat(120), minutes: 1440 }).minutes, 1440);
});

test('new papers land on free slots of the board', () => {
  const { doc, ideas } = sample();
  assert.deepEqual(ideas.map(i => [i.x, i.y]), [[30, 30], [340, 30], [650, 30]]);
  d.moveIdea(doc, ideas[1].id, { x: 900, y: 700 });
  assert.deepEqual([add(doc, 'minhle', { title: 'D' }).x, doc.ideas.at(-1).y], [340, 30]);
});

test('only the author edits or archives, with version checks', () => {
  const { doc, ideas: [a] } = sample();
  assert.throws(() => d.updateIdea(doc, 'haiyen', a.id, { version: 1, title: 'X', category: 'Chơi' }, ctx()), { status: 403, code: 'not_author' });
  assert.throws(() => d.updateIdea(doc, 'minhle', a.id, { version: 2, title: 'X', category: 'Chơi' }, ctx()), { status: 409, code: 'version_conflict' });
  assert.throws(() => d.updateIdea(doc, 'minhle', a.id, { title: 'X', category: 'Chơi' }, ctx()), { status: 400, code: 'invalid_version' });
  const updated = d.updateIdea(doc, 'minhle', a.id, { version: 1, title: 'X', category: 'Khám phá', minutes: 30 }, ctx());
  assert.deepEqual([updated.title, updated.category, updated.minutes, updated.version], ['X', 'Khám phá', 30, 2]);
  assert.throws(() => d.archiveIdea(doc, 'haiyen', a.id, { version: 2 }, ctx()), { status: 403 });
  d.archiveIdea(doc, 'minhle', a.id, { version: 2 }, ctx());
  assert.throws(() => d.updateIdea(doc, 'minhle', a.id, { version: 3, title: 'Y', category: 'Chơi' }, ctx()), { status: 404 });
  assert.throws(() => d.moveIdea(doc, a.id, { x: 1, y: 1 }), { status: 404 });
  assert.equal(d.viewIdeas(doc, { kind: 'activity' }, ctx()).ideas.length, 2);
});

test('moving a paper clamps, rounds and does not bump the version', () => {
  const { doc, ideas: [a] } = sample();
  const moved = d.moveIdea(doc, a.id, { x: -40, y: 99999.6 });
  assert.deepEqual([moved.x, moved.y, moved.version], [0, 4000, 1]);
  assert.throws(() => d.moveIdea(doc, a.id, { x: '5', y: 1 }), { code: 'invalid_position' });
  assert.throws(() => d.moveIdea(doc, a.id, { x: NaN, y: 1 }), { code: 'invalid_position' });
});

test('pick is uniform over eligible ideas via the injected random source and is shared', () => {
  const { doc, ideas } = sample();
  const first = d.pick(doc, 'haiyen', { kind: 'activity' }, ctx({ random: () => 0.99 }));
  assert.deepEqual([first.ideaId, first.byId], [ideas[2].id, 'haiyen']);
  // The other person (or a second device) gets the same current pick back.
  assert.deepEqual(d.pick(doc, 'minhle', { kind: 'activity' }, ctx({ random: () => 0 })), first);
  assert.equal(d.viewIdeas(doc, { kind: 'activity' }, ctx()).pick.id, first.id);
  assert.equal(d.viewIdeas(doc, { kind: 'seminar' }, ctx()).pick, null);
  d.skip(doc, { kind: 'activity', pickId: first.id });
  assert.equal(d.pick(doc, 'minhle', { kind: 'activity' }, ctx({ random: () => 0 })).ideaId, ideas[0].id);
});

test('category filter narrows the pick and its counts', () => {
  const { doc, ideas } = sample();
  const other = add(doc, 'minhle', { title: 'Z', category: 'Tụi mình' });
  assert.equal(d.viewIdeas(doc, { kind: 'activity', category: 'Tụi mình' }, ctx()).eligibleCount, 1);
  assert.equal(d.viewIdeas(doc, { kind: 'activity', category: 'Tụi mình' }, ctx()).ideas.length, ideas.length + 1);
  assert.equal(d.pick(doc, 'minhle', { kind: 'activity', category: 'Tụi mình' }, ctx({ random: () => 0.5 })).ideaId, other.id);
  assert.throws(() => d.viewIdeas(doc, { kind: 'activity', category: 'Bay' }, ctx()), { code: 'invalid_category' });
});

test('skip and done refuse a stale pick', () => {
  const { doc } = sample();
  const picked = d.pick(doc, 'minhle', { kind: 'activity' }, ctx({ random: () => 0 }));
  assert.throws(() => d.skip(doc, { kind: 'activity', pickId: 'old' }), { status: 409, code: 'pick_changed' });
  d.done(doc, 'minhle', { kind: 'activity', pickId: picked.id, date: '2026-10-06' }, ctx());
  // The partner's screen still shows the finished pick: a second Xong does not record twice.
  assert.throws(() => d.done(doc, 'haiyen', { kind: 'activity', pickId: picked.id, date: '2026-10-06' }, ctx()), { status: 409, code: 'pick_changed' });
  assert.equal(doc.sessions.length, 1);
});

test('done records the occurrence, the actor rating only, and starts a new round', () => {
  const { doc, ideas } = sample();
  let p = d.pick(doc, 'minhle', { kind: 'activity' }, ctx({ random: () => 0 }));
  d.skip(doc, { kind: 'activity', pickId: p.id });
  d.relax(doc, { kind: 'activity' });
  p = d.pick(doc, 'haiyen', { kind: 'activity' }, ctx({ random: () => 0 }));
  for (const [body, code] of [[{ date: '2026-10-07' }, 'invalid_date'], [{ date: '2026-02-30' }, 'invalid_date'], [{ date: '2026-10-06', text: 'x'.repeat(1001) }, 'invalid_text'], [{ date: '2026-10-06', rating: 6 }, 'invalid_rating']]) {
    assert.throws(() => d.done(doc, 'haiyen', { kind: 'activity', pickId: p.id, ...body }, ctx()), { status: 400, code });
  }
  const session = d.done(doc, 'haiyen', { kind: 'activity', pickId: p.id, date: '2026-10-05', text: 'Vui', rating: 5 }, ctx());
  assert.deepEqual([session.ideaId, session.byId, session.ratings, session.title, session.archived], [ideas[1].id, 'haiyen', { haiyen: 5 }, 'B', false]);
  assert.deepEqual(doc.rounds.activity, { pick: null, skipped: [], relax: false });
});

test('ideas done in the last 14 local days are not picked unless relaxed; exhausted explains why', () => {
  const doc = d.emptyIdeas();
  const [a, b] = ['A', 'B'].map(title => add(doc, 'minhle', { title }));
  doc.sessions.push({ id: 's-old', kind: 'activity', ideaId: a.id, byId: 'minhle', date: '2026-09-22', text: '', ratings: {}, at: '2026-09-22T01:00:00.000Z' });
  doc.sessions.push({ id: 's-new', kind: 'activity', ideaId: b.id, byId: 'minhle', date: '2026-09-23', text: '', ratings: {}, at: '2026-09-23T01:00:00.000Z' });
  // 2026-09-22 is 14 days before today (eligible again); 2026-09-23 is 13 days before (still recent).
  let view = d.viewIdeas(doc, { kind: 'activity' }, ctx());
  assert.deepEqual(view.ideas.map(i => i.recent), [false, true]);
  assert.equal(view.eligibleCount, 1);
  const p = d.pick(doc, 'minhle', { kind: 'activity' }, ctx({ random: () => 0.9 }));
  assert.equal(p.ideaId, a.id);
  d.skip(doc, { kind: 'activity', pickId: p.id });
  view = d.viewIdeas(doc, { kind: 'activity' }, ctx());
  assert.deepEqual([view.eligibleCount, view.exhausted, view.relax], [0, { recent: 1, skipped: 1 }, false]);
  assert.throws(() => d.pick(doc, 'minhle', { kind: 'activity' }, ctx()), { status: 409, code: 'nothing_to_pick' });
  d.relax(doc, { kind: 'activity' });
  assert.equal(d.viewIdeas(doc, { kind: 'activity' }, ctx()).eligibleCount, 1);
  d.resetSkips(doc, { kind: 'activity' });
  assert.equal(d.viewIdeas(doc, { kind: 'activity' }, ctx()).eligibleCount, 2);
});

test('empty pool has nothing to pick', () => {
  const doc = d.emptyIdeas();
  assert.deepEqual(d.viewIdeas(doc, { kind: 'seminar' }, ctx()), { ideas: [], pick: null, eligibleCount: 0, exhausted: { recent: 0, skipped: 0 }, relax: false });
  assert.throws(() => d.pick(doc, 'minhle', { kind: 'seminar' }, ctx()), { code: 'nothing_to_pick' });
});

test('archiving the current pick clears it; history keeps a neutral reference', () => {
  const { doc, ideas: [a] } = sample();
  let p = d.pick(doc, 'minhle', { kind: 'activity' }, ctx({ random: () => 0 }));
  d.done(doc, 'minhle', { kind: 'activity', pickId: p.id, date: '2026-10-01' }, ctx());
  d.relax(doc, { kind: 'activity' });
  p = d.pick(doc, 'minhle', { kind: 'activity' }, ctx({ random: () => 0 }));
  assert.equal(p.ideaId, a.id);
  d.archiveIdea(doc, 'minhle', a.id, { version: 1 }, ctx());
  assert.equal(doc.rounds.activity.pick, null);
  const [item] = d.listSessions(doc, { kind: 'activity' }).items;
  assert.deepEqual([item.title, item.archived], ['A', true]);
});

test('each person rates only their own enjoyment', () => {
  const { doc } = sample();
  const p = d.pick(doc, 'minhle', { kind: 'activity' }, ctx({ random: () => 0 }));
  const s = d.done(doc, 'minhle', { kind: 'activity', pickId: p.id, date: '2026-10-06', rating: 4 }, ctx());
  d.rateSession(doc, 'haiyen', s.id, { rating: 2 });
  assert.deepEqual(d.rateSession(doc, 'minhle', s.id, { rating: 5 }).ratings, { minhle: 5, haiyen: 2 });
  assert.throws(() => d.rateSession(doc, 'minhle', s.id, { rating: 0 }), { code: 'invalid_rating' });
  assert.throws(() => d.rateSession(doc, 'minhle', 'missing', { rating: 3 }), { status: 404 });
});

test('history pages newest first with a stable cursor, by kind and date range', () => {
  const { doc, ideas: [a] } = sample();
  for (let day = 1; day <= 12; day++) {
    const date = `2026-09-${String(day).padStart(2, '0')}`;
    doc.sessions.push({ id: `s${day}`, kind: day === 12 ? 'seminar' : 'activity', ideaId: a.id, byId: 'minhle', date, text: '', ratings: {}, at: `${date}T01:00:00.000Z` });
  }
  const first = d.listSessions(doc, { kind: 'activity', limit: '5' });
  assert.deepEqual(first.items.map(s => s.id), ['s11', 's10', 's9', 's8', 's7']);
  // A new entry arriving between pages does not shift the next page.
  doc.sessions.push({ id: 's13', kind: 'activity', ideaId: a.id, byId: 'haiyen', date: '2026-09-30', text: '', ratings: {}, at: '2026-09-30T01:00:00.000Z' });
  const second = d.listSessions(doc, { kind: 'activity', limit: '5', cursor: first.nextCursor });
  assert.deepEqual(second.items.map(s => s.id), ['s6', 's5', 's4', 's3', 's2']);
  assert.deepEqual(d.listSessions(doc, { kind: 'activity', limit: '5', cursor: second.nextCursor }), { items: [d.listSessions(doc, { cursor: 's2' }).items[0]], nextCursor: null });
  assert.deepEqual(d.listSessions(doc, { from: '2026-09-11', to: '2026-09-12' }).items.map(s => [s.id, s.kind]), [['s12', 'seminar'], ['s11', 'activity']]);
  assert.throws(() => d.listSessions(doc, { from: '2026-09-11' }), { code: 'invalid_range' });
  assert.throws(() => d.listSessions(doc, { cursor: 'nope' }), { code: 'invalid_cursor' });
  assert.throws(() => d.listSessions(doc, { limit: '0' }), { code: 'invalid_limit' });
  assert.throws(() => d.listSessions(doc, { kind: 'x' }), { code: 'invalid_kind' });
});

test('requestId must be a UUID', () => {
  assert.equal(d.requireRequestId('0b8e2c1e-9f3a-4c1d-8e2b-1a2b3c4d5e6f'), '0b8e2c1e-9f3a-4c1d-8e2b-1a2b3c4d5e6f');
  for (const bad of [undefined, '', 'abc', 42]) assert.throws(() => d.requireRequestId(bad), { code: 'invalid_request_id' });
});
