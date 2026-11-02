import test from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR, cropRect, initialCrop, panBy, zoomTo } from '../js/features/avatar/crop.js';

test('cropRect centres a square and clamps it inside the image', () => {
  assert.deepEqual(cropRect(1000, 500, { zoom: 1, cx: 500, cy: 250 }), { sx: 250, sy: 0, side: 500 });
  assert.deepEqual(cropRect(1000, 500, { zoom: 2, cx: 0, cy: 0 }), { sx: 0, sy: 0, side: 250 });
  assert.deepEqual(cropRect(1000, 500, { zoom: 2, cx: 1000, cy: 500 }), { sx: 750, sy: 250, side: 250 });
});

test('initialCrop starts centred at zoom 1', () => {
  assert.deepEqual(initialCrop(800, 1200), { zoom: 1, cx: 400, cy: 600 });
});

test('panBy moves against the drag and stays inside', () => {
  // Drag right 140px on a 280px circle at zoom 1 over 1000×500: side 500 → centre back 250 → clamped at 250.
  assert.equal(panBy(initialCrop(1000, 500), 1000, 500, 140, 0, 280).cx, 250);
  assert.equal(panBy(initialCrop(1000, 500), 1000, 500, -28, 0, 280).cx, 550);
  assert.equal(panBy(initialCrop(1000, 500), 1000, 500, 0, 50, 280).cy, 250);
});

test('zoomTo keeps the zoom inside the allowed range and the crop inside the image', () => {
  assert.equal(zoomTo({ zoom: 1, cx: 0, cy: 0 }, 1000, 500, 9).zoom, AVATAR.maxZoom);
  assert.equal(zoomTo({ zoom: 2, cx: 0, cy: 0 }, 1000, 500, 0.5).zoom, AVATAR.minZoom);
  assert.deepEqual(zoomTo({ zoom: 4, cx: 10, cy: 10 }, 1000, 500, 1), { zoom: 1, cx: 250, cy: 250 });
});

test('AVATAR limits match the server', () => {
  assert.equal(AVATAR.size, 512);
  assert.ok(AVATAR.maxBytes <= 80 * 1024);
});
