import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackend } from '../backend/server.js';
import { localDate } from '../backend/dates.js';

const origin = 'http://localhost:8000';
const headers = { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' };
const passwords = { minhle: 'psi-only-minh-fixture', haiyen: 'psi-only-yen-fixture' };
let credentials;
before(async () => {
  credentials = {};
  for (const [id, password] of Object.entries(passwords)) {
    const salt = Buffer.alloc(16, id === 'minhle' ? 7 : 8);
    const hash = await promisify(scrypt)(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    credentials[id] = `${salt.toString('hex')}:${hash.toString('hex')}`;
  }
});

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-psi-http-'));
  let server = createBackend(origin, { credentials, dataDir, production: false });
  const start = async () => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };
  let base = await start();
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const call = async (method, path, { cookie, body, extra = {} } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body ? headers : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: body && JSON.stringify(body) });
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
  return { call, login, restart };
}

test('only Minh writes today\'s sheet, both members read it, guests see nothing', async t => {
  const f = await fixture(t);
  const minh = await f.login('minhle'), yen = await f.login('haiyen');
  const today = localDate(new Date().toISOString());

  assert.equal((await f.call('GET', '/api/psi')).status, 401);
  assert.deepEqual((await f.call('GET', '/api/psi', { cookie: yen })).body, { today, sheets: {} });

  const sheet = { likes: '  Mình thích sự tò mò của mình, vì nó giúp mình học.  ', dislikes: '', weaknesses: 'Dễ cáu khi mệt', strengths: 'Kiên nhẫn' };
  assert.equal((await f.call('PUT', '/api/psi/today', { cookie: yen, body: sheet })).status, 403);
  assert.equal((await f.call('PUT', '/api/psi/today', { body: sheet })).status, 401);
  assert.equal((await f.call('PUT', '/api/psi/today', { cookie: minh, body: sheet, extra: { 'X-Requested-With': '' } })).status, 403);

  const saved = await f.call('PUT', '/api/psi/today', { cookie: minh, body: sheet });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.date, today);
  assert.equal(saved.body.sheet.likes, 'Mình thích sự tò mò của mình, vì nó giúp mình học.');
  assert.equal(localDate(saved.body.sheet.savedAt), today);

  // Saving again the same day replaces the sheet instead of adding one.
  await f.call('PUT', '/api/psi/today', { cookie: minh, body: { ...sheet, dislikes: 'Hay im lặng cho qua' } });
  await f.restart();
  const read = await f.call('GET', '/api/psi', { cookie: yen });
  assert.deepEqual(Object.keys(read.body.sheets), [today]);
  assert.equal(read.body.sheets[today].dislikes, 'Hay im lặng cho qua');
});

test('rejects empty, oversized, non-text and unknown fields', async t => {
  const f = await fixture(t);
  const minh = await f.login('minhle');
  const put = body => f.call('PUT', '/api/psi/today', { cookie: minh, body });
  assert.equal((await put({ likes: '  ', dislikes: '', weaknesses: '', strengths: '' })).body.code, 'empty_sheet');
  assert.equal((await put({ likes: 'ừ'.repeat(4001) })).body.code, 'invalid_likes');
  assert.equal((await put({ strengths: 5 })).body.code, 'invalid_strengths');
  assert.equal((await put({ likes: 'a', date: '2020-01-01' })).body.code, 'invalid_body');
  // The longest allowed Vietnamese sheet fits the body limit.
  assert.equal((await put({ likes: 'ừ'.repeat(4000), dislikes: 'ừ'.repeat(4000), weaknesses: 'ừ'.repeat(4000), strengths: 'ừ'.repeat(4000) })).status, 200);
  assert.equal((await f.call('POST', '/api/psi/today', { cookie: minh, body: { likes: 'a' } })).status, 405);
  assert.equal((await f.call('GET', '/api/psi/other', { cookie: minh })).status, 404);
});
