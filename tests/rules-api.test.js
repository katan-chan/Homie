import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackend } from '../backend/server.js';

const origin = 'http://localhost:8000';
const headers = { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' };
const passwords = { minhle: 'rules-only-minh-fixture', haiyen: 'rules-only-yen-fixture' };
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
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-rules-http-'));
  let server = createBackend(origin, { credentials, dataDir, production: false });
  const start = async () => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };
  let base = await start();
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const post = async (path, body, cookie, extra = {}) => {
    const response = await fetch(base + path, { method: 'POST', headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const get = async cookie => {
    const response = await fetch(`${base}/api/rules`, { headers: cookie ? { Cookie: cookie } : {} });
    return { status: response.status, body: await response.json() };
  };
  const login = async accountId => {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ accountId, password: passwords[accountId] }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const restart = async () => {
    await new Promise(resolve => server.close(resolve));
    server = createBackend(origin, { credentials, dataDir, production: false });
    base = await start();
  };
  return { post, get, login, restart, dataDir };
}

test('both members must agree before a rule takes effect; writes are idempotent and version-checked', async t => {
  const f = await fixture(t);
  const minh = await f.login('minhle'), yen = await f.login('haiyen');
  assert.deepEqual(await f.get(minh), { status: 200, body: { rules: [] } });

  const requestId = randomUUID();
  const created = await f.post('/api/rules', { requestId, title: 'Nói ra khi buồn', text: 'Nói trong ngày.' }, minh);
  assert.equal(created.status, 201);
  const rule = created.body.rule;
  assert.deepEqual([rule.activeN, rule.proposedN, rule.agreements[1], rule.version], [null, 1, ['minhle'], 1]);
  // A retried create returns the same rule instead of a duplicate.
  const retried = await f.post('/api/rules', { requestId, title: 'Nói ra khi buồn', text: 'Nói trong ngày.' }, minh);
  assert.equal(retried.body.rule.id, rule.id);
  assert.equal((await f.get(yen)).body.rules.length, 1);

  const stale = await f.post(`/api/rules/${rule.id}/agree`, { requestId: randomUUID(), n: 1, version: 0 }, yen);
  assert.deepEqual([stale.status, stale.body.code], [409, 'version_conflict']);
  const agreed = await f.post(`/api/rules/${rule.id}/agree`, { requestId: randomUUID(), n: 1, version: 1 }, yen);
  assert.deepEqual([agreed.status, agreed.body.rule.activeN, agreed.body.rule.version], [200, 1, 2]);

  const revised = await f.post(`/api/rules/${rule.id}/revisions`, { requestId: randomUUID(), title: 'Nói ra khi buồn', text: 'Bản 2', reason: 'Rõ hơn', version: 2 }, yen);
  assert.deepEqual([revised.body.rule.activeN, revised.body.rule.proposedN], [1, 2]);

  // The account comes from the session, never from the body.
  const forged = await f.post(`/api/rules/${rule.id}/agree`, { requestId: randomUUID(), n: 2, version: 3, accountId: 'minhle', byId: 'minhle' }, yen);
  assert.deepEqual(forged.body.rule.agreements[2], ['haiyen']);
  assert.equal(forged.body.rule.activeN, 1);

  await f.restart();
  // Sessions live in RAM, so log in again after the restart.
  const persisted = (await f.get(await f.login('minhle'))).body.rules[0];
  assert.deepEqual([persisted.activeN, persisted.proposedN, persisted.version], [1, 2, 4]);
  assert.equal(JSON.parse(await readFile(join(f.dataDir, 'rules.json'), 'utf8')).rules.length, 1);
});

test('archive needs one request and the partner\'s confirmation', async t => {
  const f = await fixture(t);
  const minh = await f.login('minhle'), yen = await f.login('haiyen');
  const { rule } = (await f.post('/api/rules', { requestId: randomUUID(), title: 'A', text: 'B' }, minh)).body;
  const path = action => `/api/rules/${rule.id}/${action}`;
  assert.equal((await f.post(path('archive-request'), { requestId: randomUUID(), version: 1 }, minh)).body.rule.archiveRequestBy, 'minhle');
  const self = await f.post(path('archive-confirm'), { requestId: randomUUID(), version: 2 }, minh);
  assert.deepEqual([self.status, self.body.code], [403, 'needs_partner']);
  const done = await f.post(path('archive-confirm'), { requestId: randomUUID(), version: 2 }, yen);
  assert.equal(typeof done.body.rule.archivedAt, 'string');
  const late = await f.post(path('archive-cancel'), { requestId: randomUUID(), version: 3 }, minh);
  assert.deepEqual([late.status, late.body.code], [409, 'archived']);
});

test('guests, bad origins, bad bodies and unknown paths are refused', async t => {
  const f = await fixture(t);
  const minh = await f.login('minhle');
  assert.equal((await f.get()).status, 401);
  assert.equal((await f.post('/api/rules', { requestId: randomUUID(), title: 'A', text: 'B' })).status, 401);
  assert.equal((await f.post('/api/rules', { requestId: randomUUID(), title: 'A', text: 'B' }, minh, { 'X-Requested-With': '' })).status, 403);
  assert.equal((await f.post('/api/rules', { title: 'A', text: 'B' }, minh)).body.code, 'invalid_request_id');
  assert.equal((await f.post('/api/rules', { requestId: randomUUID(), title: '', text: 'B' }, minh)).body.code, 'invalid_title');
  assert.equal((await f.post(`/api/rules/${randomUUID()}/agree`, { requestId: randomUUID(), n: 1, version: 1 }, minh)).status, 404);
  assert.equal((await f.post(`/api/rules/${randomUUID()}/delete`, { requestId: randomUUID() }, minh)).status, 404);
  assert.equal((await f.post('/api/rules/not-a-uuid/agree', { requestId: randomUUID() }, minh)).status, 404);
  assert.deepEqual((await f.get(minh)).body, { rules: [] });
});
