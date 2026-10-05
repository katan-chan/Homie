import test from 'node:test';
import assert from 'node:assert/strict';
import { ZONE, addDays, isDate, localDate, localTime, parseRange } from '../backend/dates.js';

test('local date and time follow Asia/Ho_Chi_Minh (UTC+7) across midnight', () => {
  assert.equal(ZONE, 'Asia/Ho_Chi_Minh');
  assert.equal(localDate('2026-10-05T16:59:59.999Z'), '2026-10-05');
  assert.equal(localTime('2026-10-05T16:59:59.999Z'), '23:59');
  assert.equal(localDate('2026-10-05T17:00:00Z'), '2026-10-06');
  assert.equal(localTime('2026-10-05T17:00:00Z'), '00:00');
  assert.equal(localDate('2026-12-31T17:30:00Z'), '2027-01-01');
  assert.equal(localTime('2026-10-06T05:07:00Z'), '12:07');
});

test('addDays crosses months, leap days and years', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-10-06', -14), '2026-09-22');
  assert.throws(() => addDays('2026-02-30', 1), RangeError);
  assert.equal(isDate('2026-02-28'), true);
  assert.equal(isDate('2026-2-28'), false);
});

test('parseRange accepts an inclusive range up to maxDays and rejects the rest with 400', () => {
  assert.deepEqual(parseRange('2026-10-01', '2026-10-31'), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(parseRange('2026-10-06', '2026-10-06'), { from: '2026-10-06', to: '2026-10-06' });
  assert.deepEqual(parseRange('2026-01-01', addDays('2026-01-01', 399)).from, '2026-01-01');
  for (const [from, to, options] of [
    ['2026-01-01', addDays('2026-01-01', 400)],
    ['2026-10-02', '2026-10-01'],
    ['2026-10-1', '2026-10-31'],
    ['2026-02-30', '2026-03-01'],
    [undefined, '2026-10-01'],
    ['2026-10-01', '2026-10-08', { maxDays: 7 }],
  ]) assert.throws(() => parseRange(from, to, options), { status: 400, code: 'invalid_range' }, `${from}..${to}`);
});
