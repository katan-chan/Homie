import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackend } from '../backend/server.js';
import { createRecord, emptyJar, setArchived, updateMood, visibleTo } from '../backend/jar-api.js';

const origin = 'http://localhost:8000';
const passwords = { minhle: 'jar-only-minh-fixture', haiyen: 'jar-only-yen-fixture' };
let credentials;
before(async () => {
  credentials = {};
  for (const [id, password] of Object.entries(passwords)) {
    const salt = Buffer.alloc(16, id === 'minhle' ? 5 : 6);
    const hash = await promisify(scrypt)(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    credentials[id] = `${salt.toString('hex')}:${hash.toString('hex')}`;
  }
});

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-jar-'));
  const server = createBackend(origin, { credentials, dataDir, production: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const call = async (method, path, body, cookie, extra = {}) => {
    const response = await fetch(base + path, { method, headers: { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  const login = async accountId => {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId, password: passwords[accountId] }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  return { call, login, dataDir, minh: await login('minhle'), yen: await login('haiyen') };
}

test('kisses and apologies: one tap, shared, retried requestId returns the same ball', async t => {
  const { call, minh, yen } = await fixture(t);
  const requestId = randomUUID();
  const first = await call('POST', '/api/jar', { requestId, kind: 'kiss', label: 'ignored', visibility: 'private' }, minh);
  assert.equal(first.status, 201);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const { record } = first.body;
  assert.equal(record.id, requestId);
  assert.deepEqual([record.kind, record.ownerId, record.visibility, record.version, record.label], ['kiss', 'minhle', 'shared', 1, undefined]);
  assert.match(record.localDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(record.time, /^\d{2}:\d{2}$/);
  const again = await call('POST', '/api/jar', { requestId, kind: 'kiss' }, minh);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.record, record);
  assert.equal((await call('POST', '/api/jar', { requestId, kind: 'kiss' }, yen)).status, 409);
  assert.equal((await call('POST', '/api/jar', { requestId: randomUUID(), kind: 'sorry' }, yen)).status, 201);
  const list = await call('GET', '/api/jar', undefined, yen);
  assert.deepEqual(list.body.items.map(item => [item.kind, item.ownerId]), [['kiss', 'minhle'], ['sorry', 'haiyen']]);
});

test('writes need Origin, X-Requested-With and a session; reads need a session', async t => {
  const { call, minh } = await fixture(t);
  const body = { requestId: randomUUID(), kind: 'kiss' };
  assert.equal((await call('POST', '/api/jar', body, minh, { 'X-Requested-With': '' })).status, 403);
  assert.equal((await call('POST', '/api/jar', body, minh, { Origin: 'http://evil.test' })).status, 403);
  assert.equal((await call('POST', '/api/jar', body)).status, 401);
  const guest = await call('GET', '/api/jar');
  assert.equal(guest.status, 401);
  assert.equal(guest.body.code, 'unauthorized');
  for (const bad of [{ kind: 'kiss' }, { requestId: 'x', kind: 'kiss' }, { requestId: randomUUID(), kind: 'hug' },
    { requestId: randomUUID(), kind: 'mood', valence: 2, energy: 0.5 }, { requestId: randomUUID(), kind: 'mood', valence: 0, energy: Number.NaN },
    { requestId: randomUUID(), kind: 'mood', valence: 0, energy: 0.5, label: 'x'.repeat(81) }, { requestId: randomUUID(), kind: 'mood', valence: 0, energy: 0.5, note: 'x'.repeat(1001) },
    { requestId: randomUUID(), kind: 'mood', valence: 0, energy: 0.5, visibility: 'public' }]) {
    const response = await call('POST', '/api/jar', bad, minh);
    assert.equal(response.status, 400, JSON.stringify(bad));
    assert.ok(response.body.code);
  }
});

test('a private feeling never leaves its owner; only the owner edits, archives and restores', async t => {
  const { call, minh, yen, dataDir } = await fixture(t);
  const { body: { record: mood } } = await call('POST', '/api/jar', { requestId: randomUUID(), kind: 'mood', valence: -0.4, energy: 0.3, label: '  Chán ', note: 'Ngủ không đủ' }, minh);
  assert.deepEqual([mood.visibility, mood.label, mood.valence, mood.energy], ['private', 'Chán', -0.4, 0.3]);
  assert.equal((await call('GET', '/api/jar', undefined, yen)).body.items.length, 0);
  assert.equal((await call('GET', '/api/jar?kind=mood', undefined, minh)).body.items.length, 1);
  // Not the owner: every write answers 404, never 403.
  for (const [method, path, body] of [['PUT', `/api/jar/${mood.id}`, { version: 1, label: 'x' }], ['POST', `/api/jar/${mood.id}/archive`, {}], ['POST', `/api/jar/${mood.id}/restore`, {}]]) {
    assert.equal((await call(method, path, body, yen)).status, 404);
  }
  assert.equal((await call('PUT', `/api/jar/${mood.id}`, { version: 9, visibility: 'shared' }, minh)).status, 409);
  assert.equal((await call('PUT', `/api/jar/${mood.id}`, { visibility: 'shared' }, minh)).status, 400);
  const shared = await call('PUT', `/api/jar/${mood.id}`, { version: 1, visibility: 'shared' }, minh);
  assert.equal(shared.status, 200);
  assert.deepEqual([shared.body.record.version, shared.body.record.label, shared.body.record.visibility], [2, 'Chán', 'shared']);
  assert.equal((await call('GET', '/api/jar', undefined, yen)).body.items[0].note, 'Ngủ không đủ');
  // A shared feeling of the partner is still not editable by Yến.
  assert.equal((await call('PUT', `/api/jar/${mood.id}`, { version: 2, label: 'x' }, yen)).status, 404);
  const archived = await call('POST', `/api/jar/${mood.id}/archive`, {}, minh);
  assert.ok(archived.body.record.archivedAt);
  assert.equal((await call('GET', '/api/jar', undefined, minh)).body.items.length, 0);
  assert.equal((await call('PUT', `/api/jar/${mood.id}`, { version: 3, label: 'x' }, minh)).status, 404);
  const restored = await call('POST', `/api/jar/${mood.id}/restore`, {}, minh);
  assert.equal(restored.body.record.archivedAt, undefined);
  assert.equal((await call('GET', '/api/jar', undefined, yen)).body.items.length, 1);
  const { body: { record: kiss } } = await call('POST', '/api/jar', { requestId: randomUUID(), kind: 'kiss' }, minh);
  assert.equal((await call('PUT', `/api/jar/${kiss.id}`, { version: 1, label: 'x' }, minh)).body.code, 'not_editable');
  assert.equal((await call('POST', '/api/jar/nope/archive', {}, minh)).status, 404);
  assert.equal((await call('POST', '/api/jar/%E0/archive', {}, minh)).status, 404);
  const saved = JSON.parse(await readFile(join(dataDir, 'jar.json'), 'utf8'));
  assert.equal(saved.records.length, 2);
});

test('range filter uses the local date in Asia/Ho_Chi_Minh and rejects bad ranges', async t => {
  const { call, minh } = await fixture(t);
  await call('POST', '/api/jar', { requestId: randomUUID(), kind: 'kiss' }, minh);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  assert.equal((await call('GET', `/api/jar?from=${today}&to=${today}`, undefined, minh)).body.items.length, 1);
  assert.equal((await call('GET', '/api/jar?from=2020-01-01&to=2020-01-31', undefined, minh)).body.items.length, 0);
  assert.equal((await call('GET', '/api/jar?from=2020-01-01', undefined, minh)).status, 400);
  assert.equal((await call('GET', '/api/jar?from=2020-01-01&to=2024-01-01', undefined, minh)).status, 400);
  assert.equal((await call('GET', '/api/jar?kind=hug', undefined, minh)).status, 400);
});

test('pure helpers: visibility, versioned edits, idempotent archive', () => {
  const doc = emptyJar();
  const id = randomUUID();
  const mood = createRecord(doc, 'haiyen', { requestId: id, kind: 'mood', valence: 1, energy: 0, visibility: 'private' }, '2026-10-05T17:30:00.000Z');
  assert.equal(visibleTo(mood, 'haiyen'), true);
  assert.equal(visibleTo(mood, 'minhle'), false);
  assert.throws(() => updateMood(doc, 'haiyen', id, { version: 1, energy: 1.1 }), { status: 400 });
  assert.equal(mood.version, 1, 'a rejected edit changes nothing');
  updateMood(doc, 'haiyen', id, { version: 1, energy: 1 });
  assert.equal(mood.energy, 1);
  setArchived(doc, 'haiyen', id, true, {}, '2026-10-06T00:00:00.000Z');
  setArchived(doc, 'haiyen', id, true, {});
  assert.equal(mood.archivedAt, '2026-10-06T00:00:00.000Z');
  assert.equal(mood.version, 3);
  assert.equal(visibleTo(mood, 'haiyen'), false);
});
