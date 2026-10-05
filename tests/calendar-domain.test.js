import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyCalendar, validateCalendar, createEvent, updateEvent, archiveEvent, listEvents,
  createCycle, updateCycle, endCycle, archiveCycle, listCycles,
} from '../backend/calendar-domain.js';

const now = '2026-10-06T03:00:00.000Z';
const fails = (fn, status, code) => assert.throws(fn, error => error.status === status && error.code === code);

test('occasions: validation, author-only edits, versions and archive', () => {
  const doc = emptyCalendar();
  const event = createEvent(doc, 'minhle', { title: '  Sinh nhật Yến ', date: '2026-10-20', kind: 'occasion', authorId: 'haiyen' }, { id: 'e1', now });
  assert.deepEqual([event.authorId, event.title, event.version], ['minhle', 'Sinh nhật Yến', 1]);

  for (const input of [{ title: '', date: '2026-10-20', kind: 'occasion' }, { title: 'x'.repeat(121), date: '2026-10-20', kind: 'occasion' },
    { title: 'x', date: '2026-02-30', kind: 'occasion' }, { title: 'x', date: '2026-10-20', kind: 'party' }, { title: 7, date: '2026-10-20', kind: 'occasion' }]) {
    fails(() => createEvent(doc, 'minhle', input, { id: 'bad', now }), 400, 'invalid_body');
  }
  assert.equal(doc.events.length, 1);

  fails(() => updateEvent(doc, 'haiyen', 'e1', { version: 1, title: 'Đổi' }, { now }), 403, 'not_author');
  fails(() => updateEvent(doc, 'minhle', 'e1', { version: 2, title: 'Đổi' }, { now }), 409, 'version_conflict');
  fails(() => updateEvent(doc, 'minhle', 'nope', { version: 1 }, { now }), 404, 'not_found');
  const updated = updateEvent(doc, 'minhle', 'e1', { version: 1, title: 'Sinh nhật', kind: 'anniversary' }, { now });
  assert.deepEqual([updated.title, updated.date, updated.kind, updated.version], ['Sinh nhật', '2026-10-20', 'anniversary', 2]);

  createEvent(doc, 'haiyen', { title: 'Cột mốc', date: '2026-11-01', kind: 'milestone' }, { id: 'e2', now });
  assert.deepEqual(listEvents(doc, '2026-10-01', '2026-10-31').map(e => e.id), ['e1']);
  assert.deepEqual(listEvents(doc, '2026-10-20', '2026-11-01').map(e => e.id), ['e1', 'e2']);

  fails(() => archiveEvent(doc, 'minhle', 'e1', { version: 1 }, { now }), 409, 'version_conflict');
  archiveEvent(doc, 'minhle', 'e1', { version: 2 }, { now });
  assert.deepEqual(listEvents(doc, '2026-10-01', '2026-12-31').map(e => e.id), ['e2']);
  fails(() => updateEvent(doc, 'minhle', 'e1', { version: 3, title: 'x' }, { now }), 404, 'not_found');
});

test('cycles: every operation is 404 for minhle, even for an existing id', () => {
  const doc = emptyCalendar();
  createCycle(doc, 'haiyen', { start: '2026-10-03', note: 'Uống nước ấm.' }, { id: 'c1', now });
  fails(() => createCycle(doc, 'minhle', { start: '2026-10-03' }, { id: 'c2', now }), 404, 'not_found');
  fails(() => listCycles(doc, 'minhle', '2026-10-01', '2026-10-31'), 404, 'not_found');
  fails(() => updateCycle(doc, 'minhle', 'c1', { version: 1, note: '' }, { now }), 404, 'not_found');
  fails(() => endCycle(doc, 'minhle', 'c1', { version: 1 }, { now, today: '2026-10-06' }), 404, 'not_found');
  fails(() => archiveCycle(doc, 'minhle', 'c1', { version: 1 }, { now }), 404, 'not_found');
  fails(() => listCycles(doc, null, '2026-10-01', '2026-10-31'), 404, 'not_found');
  assert.equal(doc.cycles.length, 1);
});

test('cycles: end on or after start, ongoing overlap, end today, versions, archive', () => {
  const doc = emptyCalendar();
  fails(() => createCycle(doc, 'haiyen', { start: '2026-10-05', end: '2026-10-04' }, { id: 'x', now }), 400, 'invalid_range');
  fails(() => createCycle(doc, 'haiyen', { start: '2026-10-05', note: 'x'.repeat(1001) }, { id: 'x', now }), 400, 'invalid_body');
  const same = createCycle(doc, 'haiyen', { start: '2026-09-05', end: '2026-09-05' }, { id: 'c0', now });
  assert.equal(same.end, '2026-09-05');
  const ongoing = createCycle(doc, 'haiyen', { start: '2026-10-03', end: '' }, { id: 'c1', now });
  assert.deepEqual([ongoing.end, ongoing.note], [null, '']);

  assert.deepEqual(listCycles(doc, 'haiyen', '2026-12-01', '2026-12-31').map(c => c.id), ['c1']);
  assert.deepEqual(listCycles(doc, 'haiyen', '2026-09-01', '2026-10-31').map(c => c.id), ['c1', 'c0']);
  assert.deepEqual(listCycles(doc, 'haiyen', '2026-09-06', '2026-10-02').map(c => c.id), []);

  fails(() => updateCycle(doc, 'haiyen', 'c1', { version: 1, end: '2026-10-01' }, { now }), 400, 'invalid_range');
  fails(() => endCycle(doc, 'haiyen', 'c1', { version: 1 }, { now, today: '2026-10-02' }), 400, 'invalid_range');
  fails(() => endCycle(doc, 'haiyen', 'c1', { version: 9 }, { now, today: '2026-10-06' }), 409, 'version_conflict');
  const ended = endCycle(doc, 'haiyen', 'c1', { version: 1 }, { now, today: '2026-10-06' });
  assert.deepEqual([ended.end, ended.version], ['2026-10-06', 2]);
  const edited = updateCycle(doc, 'haiyen', 'c1', { version: 2, note: 'Đỡ rồi' }, { now });
  assert.deepEqual([edited.start, edited.end, edited.note], ['2026-10-03', '2026-10-06', 'Đỡ rồi']);
  archiveCycle(doc, 'haiyen', 'c1', { version: 3 }, { now });
  assert.deepEqual(listCycles(doc, 'haiyen', '2026-09-01', '2026-12-31').map(c => c.id), ['c0']);
});

test('stored document must have event and cycle arrays', () => {
  assert.deepEqual(validateCalendar({ events: [], cycles: [] }), { events: [], cycles: [] });
  for (const bad of [null, {}, { events: [] }, { events: {}, cycles: [] }]) assert.throws(() => validateCalendar(bad));
});
