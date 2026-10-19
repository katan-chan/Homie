import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeUnder, fitSize, stripGeometry } from '../js/features/moments/image.js';

test('stripGeometry lays out a column, a row and a 2×2 grid', () => {
  const column = stripGeometry(4, 'column');
  assert.equal(column.width, 600);
  assert.equal(column.height, 24 + 4 * 414 + 3 * 16 + 110);
  assert.deepEqual(column.frames[2], { x: 24, y: 24 + 2 * 430, w: 552, h: 414 });
  assert.equal(column.footY, 24 + 4 * 414 + 3 * 16);

  const grid = stripGeometry(4, 'grid');
  assert.equal(grid.width, 24 * 2 + 2 * 400 + 16);
  assert.equal(grid.height, 24 + 2 * 300 + 16 + 110);
  assert.deepEqual(grid.frames[3], { x: 440, y: 340, w: 400, h: 300 });

  const row = stripGeometry(3, 'row');
  assert.equal(row.width, 24 * 2 + 3 * 400 + 2 * 16);
  assert.deepEqual(row.frames[2], { x: 24 + 2 * 416, y: 24, w: 400, h: 300 });
});

test('stripGeometry falls back to a column when the layout does not fit the count', () => {
  assert.deepEqual(stripGeometry(3, 'grid'), stripGeometry(3, 'column'));
  assert.deepEqual(stripGeometry(1, 'row'), stripGeometry(1, 'column'));
  assert.deepEqual(stripGeometry(1, 'grid'), stripGeometry(1, 'column'));
});

test('fitSize shrinks the long side and never upscales', () => {
  assert.deepEqual(fitSize(4000, 3000, 1440), { width: 1440, height: 1080 });
  assert.deepEqual(fitSize(3000, 4000, 1440), { width: 1080, height: 1440 });
  assert.deepEqual(fitSize(800, 600, 1440), { width: 800, height: 600 });
});

const blob = (type, size) => ({ type, size });

test('encodeUnder searches quality to land under the byte target', async () => {
  const calls = [];
  const encode = async (type, quality) => { calls.push([type, quality]); return blob(type, Math.round(quality * 1e6)); };
  const result = await encodeUnder(encode, 700_000);
  assert.ok(result.size <= 700_000, `size ${result.size}`);
  assert.ok(result.size >= 600_000);
  assert.ok(calls.length <= 6, `${calls.length} encodes`);
  assert.ok(calls.every(([type]) => type === 'image/webp'));
});

test('encodeUnder keeps the first encode when it already fits', async () => {
  let count = 0;
  const result = await encodeUnder(async (type, quality) => { count++; return blob(type, 1000); }, 150_000);
  assert.deepEqual([result.size, count], [1000, 1]);
});

test('encodeUnder switches to JPEG when the browser cannot write WebP', async () => {
  const types = [];
  const encode = async (type, quality) => { types.push(type); return blob(type === 'image/webp' ? 'image/png' : type, 100); };
  const result = await encodeUnder(encode, 150_000);
  assert.equal(result.type, 'image/jpeg');
  assert.deepEqual(types, ['image/webp', 'image/jpeg']);
});

test('encodeUnder returns the lowest-quality try when nothing fits', async () => {
  const qualities = [];
  const result = await encodeUnder(async (type, quality) => { qualities.push(quality); return blob(type, 999_999); }, 10);
  assert.equal(qualities.at(-1), 0.6);
  assert.equal(result.size, 999_999);
  assert.ok(qualities.length <= 6);
});
