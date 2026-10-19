import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackend } from '../backend/server.js';

const origin = 'http://localhost:8000';
const passwords = { minhle: 'moments-only-minh-fixture', haiyen: 'moments-only-yen-fixture' };
let credentials;
before(async () => {
  credentials = {};
  for (const [id, password] of Object.entries(passwords)) {
    const salt = Buffer.alloc(16, id === 'minhle' ? 7 : 8);
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
const part = buffer => ({ data: buffer.toString('base64') });
const body = (extra = {}) => ({ requestId: randomUUID(), kind: 'snap', caption: 'Trà sữa nè anh', photo: part(webp(1080, 1080)), thumb: part(webp(320, 320, 500)), ...extra });

function fakeRemote() {
  const docs = new Map(), files = new Map(), calls = { put: [], removed: [] };
  return {
    calls, files, failPut: false,
    async getDocument(name) { return docs.has(name) ? structuredClone(docs.get(name)) : null; },
    async putDocument(name, value) { if (name === 'moments' && this.failPut) throw new Error('down'); docs.set(name, structuredClone(value)); },
    async deleteDocument(name) { docs.delete(name); },
    async putFile(path, buffer, type) { calls.put.push([path, type]); files.set(path, Buffer.from(buffer)); },
    async getFile(path) { const b = files.get(path); return b ? new Response(b, { headers: { 'content-length': String(b.length) } }) : null; },
    async removeFiles(paths) { calls.removed.push(...paths); for (const p of paths) files.delete(p); },
  };
}

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-moments-'));
  const server = createBackend(origin, { credentials, dataDir, production: false, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const call = async (method, path, payload, cookie, extra = {}) => {
    const response = await fetch(base + path, { method, headers: { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const type = response.headers.get('content-type') ?? '';
    return { status: response.status, headers: response.headers, body: response.status === 204 ? null : type.startsWith('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  const login = async accountId => {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId, password: passwords[accountId] }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  return { call, dataDir, minh: await login('minhle'), yen: await login('haiyen') };
}

test('moments: members save, list and fetch files; guests get 401', async t => {
  const { call, minh, yen } = await fixture(t);
  const photo = webp(1080, 1080, 3000);
  const saved = await call('POST', '/api/moments', body({ photo: part(photo) }), minh);
  assert.equal(saved.status, 201);
  const { moment } = saved.body;
  assert.deepEqual([moment.ownerId, moment.kind, moment.caption, moment.version], ['minhle', 'snap', 'Trà sữa nè anh', 1]);
  assert.deepEqual(moment.photo, { mime: 'image/webp', width: 1080, height: 1080, bytes: 3000 });
  assert.equal(moment.fileUrl, `/api/moments/${moment.id}/file`);
  assert.equal(moment.thumbUrl, `/api/moments/${moment.id}/thumb`);
  assert.match(moment.localDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(moment.time, /^\d{2}:\d{2}$/);

  const list = await call('GET', '/api/moments', undefined, yen);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.moments.map(m => [m.id, m.ownerId]), [[moment.id, 'minhle']]);
  const ranged = await call('GET', `/api/moments?from=${moment.localDate}&to=${moment.localDate}`, undefined, yen);
  assert.equal(ranged.body.moments.length, 1);
  assert.equal((await call('GET', '/api/moments?from=2000-01-01&to=2000-01-02', undefined, yen)).body.moments.length, 0);

  const file = await call('GET', moment.fileUrl, undefined, yen);
  assert.equal(file.status, 200);
  assert.deepEqual(file.body, photo);
  assert.equal(file.headers.get('content-type'), 'image/webp');
  assert.equal(file.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await call('GET', moment.thumbUrl, undefined, yen)).status, 200);

  assert.equal((await call('GET', '/api/moments')).status, 401);
  assert.equal((await call('GET', moment.fileUrl)).status, 401);
  assert.equal((await call('POST', '/api/moments', body())).status, 401);
  assert.equal((await call('GET', `/api/moments/${randomUUID()}/file`, undefined, yen)).status, 404);
});

test('moments: retried requestId keeps one record', async t => {
  const { call, minh, dataDir } = await fixture(t);
  const request = body();
  const first = await call('POST', '/api/moments', request, minh);
  const again = await call('POST', '/api/moments', request, minh);
  assert.equal(first.status, 201);
  assert.deepEqual(again.body.moment, first.body.moment);
  assert.equal((await call('GET', '/api/moments', undefined, minh)).body.moments.length, 1);
  assert.equal((await readdir(join(dataDir, 'moments'))).length, 2);
});

test('moments: refuses spoofed, oversized and malformed images', async t => {
  const { call, minh } = await fixture(t);
  const refused = async (payload, code, headers) => {
    const response = await call('POST', '/api/moments', payload, minh, headers);
    assert.equal(response.body.code, code, JSON.stringify(response.body));
    return response.status;
  };
  assert.equal(await refused(body({ photo: { mime: 'image/webp', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') } }), 'invalid_image'), 400);
  assert.equal(await refused(body({ photo: part(webp(1080, 1080, 400 * 1024 + 1)) }), 'image_too_large'), 400);
  assert.equal(await refused(body({ thumb: part(webp(320, 320, 40 * 1024 + 1)) }), 'image_too_large'), 400);
  assert.equal(await refused(body({ photo: part(webp(1921, 1000)) }), 'image_too_large'), 400);
  assert.equal(await refused(body({ photo: part(webp(1000, 2401)) }), 'image_too_large'), 400);
  assert.equal(await refused(body({ thumb: part(webp(401, 300, 500)) }), 'image_too_large'), 400);
  assert.equal(await refused(body({ kind: 'video' }), 'invalid_body'), 400);
  assert.equal(await refused(body({ requestId: 'nope' }), 'invalid_body'), 400);
  assert.equal(await refused(body({ caption: 'x'.repeat(41) }), 'invalid_caption'), 400);
  assert.equal(await refused(body({ caption: 'hai\ndòng' }), 'invalid_caption'), 400);
  assert.equal(await refused(body(), 'forbidden', { 'X-Requested-With': '' }), 403);
  // 40 Vietnamese characters with combining-free letters still fit.
  assert.equal((await call('POST', '/api/moments', body({ caption: 'ồ'.repeat(40) }), minh)).status, 201);
  assert.equal((await call('GET', '/api/moments', undefined, minh)).body.moments.length, 1);
});

test('moments: only the owner edits the caption or deletes', async t => {
  const { call, minh, yen, dataDir } = await fixture(t);
  const { moment } = (await call('POST', '/api/moments', body(), minh)).body;
  const path = `/api/moments/${moment.id}`;
  assert.equal((await call('PUT', path, { caption: 'của Yến', version: 1 }, yen)).body.code, 'not_owner');
  assert.equal((await call('DELETE', path, undefined, yen)).status, 403);
  assert.equal((await call('PUT', path, { caption: 'cũ', version: 0 }, minh)).status, 409);
  const edited = await call('PUT', path, { caption: '  Chủ nhật lười  ', version: 1 }, minh);
  assert.equal(edited.status, 200);
  assert.deepEqual([edited.body.moment.caption, edited.body.moment.version], ['Chủ nhật lười', 2]);
  assert.equal((await call('DELETE', path, undefined, minh)).status, 204);
  assert.equal((await call('GET', '/api/moments', undefined, yen)).body.moments.length, 0);
  assert.equal((await call('GET', moment.fileUrl, undefined, yen)).status, 404);
  assert.deepEqual(await readdir(join(dataDir, 'moments')), []);
  assert.equal((await call('DELETE', path, undefined, minh)).status, 404);
});

test('moments: remote storage keeps files in the bucket under moments/', async t => {
  const remote = fakeRemote();
  const { call, minh } = await fixture(t, { remote });
  const { moment } = (await call('POST', '/api/moments', body(), minh)).body;
  assert.deepEqual(remote.calls.put, [[`moments/${moment.id}.webp`, 'image/webp'], [`moments/${moment.id}-thumb.webp`, 'image/webp']]);
  assert.equal((await call('GET', moment.fileUrl, undefined, minh)).status, 200);
  assert.equal((await call('DELETE', `/api/moments/${moment.id}`, undefined, minh)).status, 204);
  assert.deepEqual(remote.calls.removed, [`moments/${moment.id}.webp`, `moments/${moment.id}-thumb.webp`]);

  remote.failPut = true;
  remote.calls.removed.length = 0;
  const failed = await call('POST', '/api/moments', body(), minh);
  assert.equal(failed.status, 503);
  assert.equal(remote.calls.removed.length, 2);
  assert.equal(remote.files.size, 0);
});
