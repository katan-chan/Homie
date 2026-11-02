import test from 'node:test';
import assert from 'node:assert/strict';
import { ago, clock, duration, personLine } from '../js/features/location/format.js';

const MIN = 60000;
// 2 Nov 2026, 15:30 Vietnam time.
const now = Date.UTC(2026, 10, 2, 8, 30);

test('clock shows Vietnam time', () => {
  assert.equal(clock(Date.UTC(2026, 10, 2, 1, 5)), '08:05');
});

test('ago', () => {
  assert.equal(ago(now - 20000, now), 'Vừa xong');
  assert.equal(ago(now - 5 * MIN, now), '5 phút trước');
  assert.equal(ago(now - 59 * MIN, now), '59 phút trước');
  assert.equal(ago(now - 3 * 60 * MIN, now), '3 giờ trước');
  assert.equal(ago(Date.UTC(2026, 10, 1, 14, 0), now), 'hôm qua lúc 21:00');
  assert.equal(ago(Date.UTC(2026, 9, 28, 2, 0), now), '28/10 lúc 09:00');
});

test('duration', () => {
  assert.equal(duration(25 * MIN), '25 phút');
  assert.equal(duration(60 * MIN), '1 giờ');
  assert.equal(duration(135 * MIN), '2 giờ 15 phút');
  assert.equal(duration(20000), '1 phút');
});

test('personLine says when sharing is off, lost or fresh', () => {
  assert.equal(personLine({ sharing: { on: false }, stale: false }, now), 'Chưa chia sẻ vị trí');
  assert.equal(personLine({ at: now - 50 * MIN, sharing: { on: false, stoppedAt: now - 40 * MIN, reason: 'user' }, stale: false }, now), 'Đã tắt lúc 14:50');
  assert.equal(personLine({ at: now - 50 * MIN, sharing: { on: false, stoppedAt: now - 40 * MIN, reason: 'battery' }, stale: false }, now), 'Đã tắt lúc 14:50 vì pin yếu');
  assert.equal(personLine({ at: now - 15 * MIN, sharing: { on: true }, stale: true }, now), 'Mất tín hiệu từ 15:15');
  assert.equal(personLine({ at: now - 2 * MIN, sharing: { on: true }, stale: false }, now), '2 phút trước');
});
