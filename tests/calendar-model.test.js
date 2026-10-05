import test from 'node:test';
import assert from 'node:assert/strict';
import { localDate, todayLocal, shiftMonth, monthGrid, vnDate, monthTitle, aggregateDays, dayLabel } from '../js/features/calendar/model.js';

test('local dates follow Asia/Ho_Chi_Minh midnight (UTC+7)', () => {
  assert.equal(localDate('2026-09-30T16:59:59.999Z'), '2026-09-30');
  assert.equal(localDate('2026-09-30T17:00:00.000Z'), '2026-10-01');
  assert.equal(todayLocal(new Date('2026-12-31T17:30:00Z')), '2027-01-01');
});

test('month grid is six Monday-first weeks across month and year edges', () => {
  const october = monthGrid('2026-10');
  assert.equal(october.length, 42);
  assert.deepEqual([october[0], october[3], october[41]], ['2026-09-28', '2026-10-01', '2026-11-08']);
  assert.equal(monthGrid('2026-06')[0], '2026-06-01'); // month starting on a Monday has no leading days
  assert.equal(monthGrid('2026-03')[0], '2026-02-23'); // starts on Sunday: six leading days
  assert.ok(monthGrid('2028-02').includes('2028-02-29'));
  assert.deepEqual([shiftMonth('2026-12', 1), shiftMonth('2026-01', -1), shiftMonth('2026-10', 0)], ['2027-01', '2025-12', '2026-10']);
  assert.deepEqual([vnDate('2026-10-06'), monthTitle('2026-10')], ['6/10/2026', 'Tháng 10, 2026']);
});

const jar = [
  { id: 'k1', kind: 'kiss', ownerId: 'minhle', occurredAt: '2026-09-30T17:05:00Z', visibility: 'shared' },
  { id: 'k2', kind: 'kiss', ownerId: 'haiyen', occurredAt: '2026-10-01T02:00:00Z', localDate: '2026-10-01', visibility: 'shared' },
  { id: 'k3', kind: 'kiss', ownerId: 'haiyen', occurredAt: '2026-10-01T03:00:00Z', localDate: '2026-10-01', visibility: 'shared', archivedAt: '2026-10-01T04:00:00Z' },
  { id: 's1', kind: 'sorry', ownerId: 'minhle', occurredAt: '2026-09-30T16:59:00Z', visibility: 'shared' },
  { id: 'm1', kind: 'mood', ownerId: 'minhle', occurredAt: '2026-10-01T01:00:00Z', valence: 0.8, label: 'Vui', visibility: 'private' },
  { id: 'm2', kind: 'mood', ownerId: 'minhle', occurredAt: '2026-10-01T02:00:00Z', valence: 0.2, visibility: 'private' },
  { id: 'm3', kind: 'mood', ownerId: 'haiyen', occurredAt: '2026-10-01T03:00:00Z', valence: -0.5, label: 'Mệt', visibility: 'private' },
  { id: 'm4', kind: 'mood', ownerId: 'haiyen', occurredAt: '2026-10-01T04:00:00Z', valence: 0.5, label: 'Ấm áp', visibility: 'shared' },
];

test('days count kisses and apologies by local day; partner private moods never colour a dot', () => {
  const day = aggregateDays({ viewerId: 'minhle', today: '2026-10-06', from: '2026-09-28', to: '2026-11-08', jar });
  assert.deepEqual([day('2026-10-01').kiss, day('2026-10-01').sorry, day('2026-09-30').sorry], [2, 0, 1]);
  assert.ok(Math.abs(day('2026-10-01').mood.minhle - 0.5) < 1e-9);
  assert.equal(day('2026-10-01').mood.haiyen, 0.5); // only her shared mood
  assert.deepEqual(day('2026-10-01').moods, { minhle: ['Vui', 'cảm xúc'], haiyen: ['Ấm áp'] });

  const hers = aggregateDays({ viewerId: 'haiyen', today: '2026-10-06', from: '2026-09-28', to: '2026-11-08', jar });
  assert.equal(hers('2026-10-01').mood.haiyen, 0);
  assert.equal(hers('2026-10-01').mood.minhle, null);
  assert.equal(dayLabel('2026-10-02', hers('2026-10-02')), '2/10/2026: không có mục');
});

test('events, memories, activities land on their dates; archived events do not', () => {
  const day = aggregateDays({ viewerId: 'minhle', today: '2026-10-06', from: '2026-09-28', to: '2026-11-08',
    events: [{ id: 'e1', date: '2026-10-20', title: 'Sinh nhật' }, { id: 'e2', date: '2026-10-20', title: 'Cũ', archivedAt: now() }],
    memories: [{ noteId: 'n1', boardId: 'b1', title: 'Biển mây', memoryDate: '2026-10-20' }],
    activities: [{ id: 'a1', kind: 'seminar', title: 'Quang hợp', date: '2026-10-20' }] });
  const d = day('2026-10-20');
  assert.deepEqual([d.events.map(e => e.id), d.memories.length, d.activities.length], [['e1'], 1, 1]);
  assert.equal(dayLabel('2026-10-20', d), '20/10/2026: 1 dịp, 1 kỷ niệm, 1 hoạt động');
});

test('cycle shading is Hải Yến only, inclusive, clipped to the range and to today while ongoing', () => {
  const cycles = [{ id: 'c1', start: '2026-09-26', end: '2026-10-02' }, { id: 'c2', start: '2026-10-04', end: null },
    { id: 'c3', start: '2026-10-10', end: '2026-10-12', archivedAt: now() }];
  const range = { today: '2026-10-06', from: '2026-09-28', to: '2026-11-08', cycles };
  const hers = aggregateDays({ viewerId: 'haiyen', ...range });
  const shaded = monthGrid('2026-10').filter(date => hers(date).cycle);
  assert.deepEqual(shaded, ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05', '2026-10-06']);
  assert.match(dayLabel('2026-10-04', hers('2026-10-04')), /trong kỳ/);

  const his = aggregateDays({ viewerId: 'minhle', ...range });
  assert.equal(monthGrid('2026-10').some(date => his(date).cycle), false);
});

function now() { return '2026-10-06T00:00:00Z'; }
