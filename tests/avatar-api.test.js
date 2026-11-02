import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackend } from '../backend/server.js';

const origin = 'http://localhost:8000';
const passwords = { minhle: 'avatar-only-minh-fixture', haiyen: 'avatar-only-yen-fixture' };
let credentials;
before(async () => {
  credentials = {};
  for (const [id, password] of Object.entries(passwords)) {
    const salt = Buffer.alloc(16, id === 'minhle' ? 5 : 6);
    const hash = await promisify(scrypt)(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    credentials[id] = `${salt.toString('hex')}:${hash.toString('hex')}`;
  }
});

/** A WebP (VP8X header) of the given pixel size, padded to `bytes`; the API only reads the header. */
function webp(width, height, bytes = 2000) {
  const b = Buffer.alloc(Math.max(bytes, 30), 7);
  b.write('RIFF', 0); b.writeUInt32LE(b.length - 8, 4); b.write('WEBP', 8); b.write('VP8X', 12); b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3); b.writeUIntLE(height - 1, 27, 3);
  return b;
}
/** A JPEG with just SOI and an SOF0 segment of the given size, padded to `bytes`. */
function jpeg(width, height, bytes = 2000) {
  const b = Buffer.alloc(Math.max(bytes, 20), 0);
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  b.writeUInt16BE(height, 7); b.writeUInt16BE(width, 9);
  return b;
}
const part = buffer => ({ data: buffer.toString('base64') });

function fakeRemote() {
  const docs = new Map(), files = new Map();
  return {
    files, failProfiles: false,
    async getDocument(name) { return docs.has(name) ? structuredClone(docs.get(name)) : null; },
    async putDocument(name, value) {
      if (name === 'profiles' && this.failProfiles) throw new Error('down');
      docs.set(name, structuredClone(value));
    },
    async deleteDocument(name) { docs.delete(name); },
    async putFile(path, buffer) { files.set(path, Buffer.from(buffer)); },
    async getFile(path) { const b = files.get(path); return b ? new Response(b, { headers: { 'content-length': String(b.length) } }) : null; },
    async removeFiles(paths) { for (const p of paths) files.delete(p); },
  };
}

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-avatar-'));
  const remote = fakeRemote();
  const server = createBackend(origin, { credentials, dataDir, production: false, remote, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const call = async (method, path, payload, cookie, headers = { Origin: origin, 'X-Requested-With': 'Homie' }) => {
    const response = await fetch(base + path, { method, headers: { ...headers, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const type = response.headers.get('content-type') ?? '';
    return { status: response.status, headers: response.headers, body: method === 'HEAD' ? null : type.startsWith('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  const login = async accountId => {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId, password: passwords[accountId] }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  return { call, remote, minh: await login('minhle'), yen: await login('haiyen') };
}

const URL_ = '/api/profiles/minhle/avatar';

test('owner uploads, anyone reads, other member cannot write', async t => {
  const { call, minh, yen } = await fixture(t);
  const image = webp(512, 512, 3000);
  const saved = await call('PUT', URL_, part(image), minh);
  assert.equal(saved.status, 200);
  const { version } = saved.body.profile.avatar;
  assert.deepEqual(saved.body.profile.avatar, { version, mime: 'image/webp' });
  assert.ok(Number.isInteger(version) && version >= 1);

  const read = await call('GET', URL_, undefined, null, {});
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, image);
  assert.equal(read.headers.get('content-type'), 'image/webp');
  assert.equal(read.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(read.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await call('HEAD', URL_, undefined, null, {})).status, 200);

  assert.equal((await call('PUT', URL_, part(image), yen)).status, 403);
  assert.equal((await call('PUT', URL_, part(image))).status, 401);
  assert.equal((await call('PUT', URL_, part(image), minh, { Origin: origin })).status, 403);
  assert.equal((await call('DELETE', URL_, undefined, yen)).status, 403);

  const profile = await call('GET', '/api/profiles/minhle', undefined, null, {});
  assert.deepEqual(profile.body.profile.avatar, { version, mime: 'image/webp' });
});

test('rejects bad images', async t => {
  const { call, minh } = await fixture(t);
  const code = async payload => { const r = await call('PUT', URL_, payload, minh); return [r.status, r.body.code]; };
  assert.deepEqual(await code(part(webp(512, 400))), [400, 'invalid_image']);
  assert.deepEqual(await code(part(webp(600, 600))), [400, 'image_too_large']);
  assert.deepEqual(await code(part(webp(512, 512, 81921))), [400, 'image_too_large']);
  assert.deepEqual(await code(part(webp(32, 32))), [400, 'image_too_small']);
  assert.deepEqual(await code({ data: 'aGVsbG8=' }), [400, 'invalid_image']);
  assert.deepEqual(await code({}), [400, 'invalid_image']);
  assert.deepEqual(await code({ data: 'A'.repeat(120 * 1024) }), [413, 'body_too_large']);
});

test('replace with other format', async t => {
  const { call, remote, minh } = await fixture(t);
  const first = (await call('PUT', URL_, part(webp(512, 512)), minh)).body.profile.avatar.version;
  const next = (await call('PUT', URL_, part(jpeg(256, 256)), minh)).body.profile.avatar;
  assert.equal(next.mime, 'image/jpeg');
  assert.ok(next.version > first);
  const read = await call('GET', `${URL_}?v=${next.version}`, undefined, null, {});
  assert.equal(read.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual([...remote.files.keys()], [`avatars/minhle-${next.version}.jpg`]);
});

test('delete returns to no avatar', async t => {
  const { call, remote, minh } = await fixture(t);
  await call('PUT', URL_, part(webp(512, 512)), minh);
  const removed = await call('DELETE', URL_, undefined, minh);
  assert.equal(removed.status, 200);
  assert.equal('avatar' in removed.body.profile, false);
  assert.equal((await call('GET', URL_, undefined, null, {})).status, 404);
  assert.equal(remote.files.size, 0);
  assert.equal((await call('DELETE', URL_, undefined, minh)).status, 200);
});

test('profile write failure keeps old avatar', async t => {
  const { call, remote, minh } = await fixture(t);
  const first = webp(512, 512, 2500);
  await call('PUT', URL_, part(first), minh);
  remote.failProfiles = true;
  const failed = await call('PUT', URL_, part(webp(512, 512)), minh);
  assert.deepEqual([failed.status, failed.body.code], [503, 'storage_unavailable']);
  assert.equal(remote.files.size, 1, 'only the first picture is stored');
  remote.failProfiles = false;
  assert.deepEqual((await call('GET', URL_, undefined, null, {})).body, first);
});

test('text PUT after avatar keeps avatar', async t => {
  const { call, minh } = await fixture(t);
  const { avatar } = (await call('PUT', URL_, part(webp(512, 512)), minh)).body.profile;
  const text = await call('PUT', '/api/profiles/minhle', { displayName: 'Minh Lê', bio: 'chào' }, minh);
  assert.equal(text.status, 200);
  assert.deepEqual(text.body.profile.avatar, avatar);
});

test('a picture uploaded after a delete gets a new version, so caches never show the old one', async t => {
  const { call, minh } = await fixture(t);
  const first = (await call('PUT', URL_, part(webp(512, 512)), minh)).body.profile.avatar.version;
  await call('DELETE', URL_, undefined, minh);
  const second = (await call('PUT', URL_, part(webp(512, 512)), minh)).body.profile.avatar.version;
  assert.ok(second > first, `${second} > ${first}`);
});
