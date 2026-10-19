import test from 'node:test';
import assert from 'node:assert/strict';
import { imageInfo } from '../backend/image-info.js';

function jpeg(width, height) {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.alloc(19);
  sof.set([0xff, 0xc0, 0x00, 0x11, 0x08]);
  sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

function webp(tag, fill) {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0); b.writeUInt32LE(32, 4); b.write('WEBP', 8); b.write(tag, 12); b.writeUInt32LE(20, 16);
  fill(b);
  return b;
}

test('imageInfo reads JPEG SOF', () => {
  assert.deepEqual(imageInfo(jpeg(400, 300)), { mime: 'image/jpeg', width: 400, height: 300 });
});

test('imageInfo reads all three WebP chunk kinds', () => {
  const lossy = webp('VP8 ', b => { b.set([0x9d, 0x01, 0x2a], 23); b.writeUInt16LE(640, 26); b.writeUInt16LE(480, 28); });
  const lossless = webp('VP8L', b => { b[20] = 0x2f; b.writeUInt32LE((17 - 1) | ((9 - 1) << 14), 21); });
  const extended = webp('VP8X', b => { b.writeUIntLE(1080 - 1, 24, 3); b.writeUIntLE(1920 - 1, 27, 3); });
  assert.deepEqual(imageInfo(lossy), { mime: 'image/webp', width: 640, height: 480 });
  assert.deepEqual(imageInfo(lossless), { mime: 'image/webp', width: 17, height: 9 });
  assert.deepEqual(imageInfo(extended), { mime: 'image/webp', width: 1080, height: 1920 });
});

test('imageInfo refuses other bytes', () => {
  assert.equal(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(imageInfo(Buffer.alloc(0)), null);
  assert.equal(imageInfo(Buffer.from([0xff, 0xd8, 0xff])), null);
  assert.equal(imageInfo(webp('VP8 ', () => {}).subarray(0, 24)), null);
});
