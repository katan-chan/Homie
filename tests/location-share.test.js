import test from 'node:test';
import assert from 'node:assert/strict';
import { batteryTips, startBlock } from '../js/features/location/share.js';

const ok = { location: 'granted', notifications: 'granted' };
const phone = { sdk: 34, battery: 80, charging: false };

test('sharing starts only with location, notifications (Android 13+) and enough battery', () => {
  assert.equal(startBlock(ok, phone), null);
  assert.match(startBlock({ ...ok, location: 'denied' }, phone), /quyền vị trí/);
  assert.match(startBlock({ ...ok, notifications: 'denied' }, phone), /quyền thông báo/);
  assert.equal(startBlock({ ...ok, notifications: 'denied' }, { ...phone, sdk: 32 }), null, 'no notification permission before Android 13');
  assert.match(startBlock(ok, { ...phone, battery: 19 }), /Pin dưới 20%/);
  assert.equal(startBlock(ok, { ...phone, battery: 19, charging: true }), null);
});

test('battery tips name the phone brand', () => {
  assert.match(batteryTips('Xiaomi'), /Tự khởi chạy/);
  assert.match(batteryTips('POCO'), /Tự khởi chạy/);
  assert.match(batteryTips('samsung'), /Ứng dụng ngủ/);
  assert.match(batteryTips('Google'), /không hạn chế/);
});
