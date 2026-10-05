import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { scrypt, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackend } from '../backend/server.js';
import { localDate } from '../backend/dates.js';

const origin = 'http://localhost:8000';
const write = { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' };
const fixtures = { minhle: 'test-only-minh-fixture', haiyen: 'test-only-yen-fixture' };
let credentials;
before(async () => {
  credentials = {};
  for (const [id, password] of Object.entries(fixtures)) {
    const salt = Buffer.alloc(16, id === 'minhle' ? 1 : 2);
    const hash = await promisify(scrypt)(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    credentials[id] = `${salt.toString('hex')}:${hash.toString('hex')}`;
  }
});

async function start(t, dataDir) {
  const server = createBackend(origin, { credentials, dataDir, remote: null, production: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookies = {};
  for (const id of Object.keys(fixtures)) {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: write, body: JSON.stringify({ accountId: id, password: fixtures[id] }) });
    cookies[id] = response.headers.get('set-cookie').split(';')[0];
  }
  const call = async (who, path, { method = 'GET', body, headers } = {}) => {
    const response = await fetch(base + path, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { ...(method === 'GET' ? {} : write), ...(who ? { Cookie: cookies[who] } : {}), ...headers },
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  };
  return { call, stop: () => new Promise(resolve => server.close(resolve)) };
}

test('ideas API: auth, shared pick, retries, done, rating, history and persistence', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-ideas-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let { call, stop } = await start(t, dataDir);

  assert.equal((await call(null, '/api/ideas?kind=seminar')).status, 401);
  const forbidden = await call('minhle', '/api/ideas', { method: 'POST', body: {}, headers: { 'X-Requested-With': '' } });
  assert.deepEqual([forbidden.status, forbidden.body.code], [403, 'forbidden']);
  const empty = await call('minhle', '/api/ideas?kind=seminar');
  assert.equal(empty.cache, 'no-store');
  assert.deepEqual(empty.body, { ideas: [], pick: null, eligibleCount: 0, exhausted: { recent: 0, skipped: 0 }, relax: false });

  const requestId = randomUUID();
  const created = await call('minhle', '/api/ideas', { method: 'POST', body: { requestId, kind: 'seminar', title: 'Cách cây quang hợp', minutes: 45 } });
  assert.equal(created.status, 201);
  const retried = await call('minhle', '/api/ideas', { method: 'POST', body: { requestId, kind: 'seminar', title: 'Cách cây quang hợp', minutes: 45 } });
  assert.equal(retried.body.idea.id, created.body.idea.id);
  assert.equal((await call('minhle', '/api/ideas', { method: 'POST', body: { kind: 'seminar', title: 'x' } })).body.code, 'invalid_request_id');
  const idea = created.body.idea;
  assert.equal((await call('haiyen', `/api/ideas/${idea.id}`, { method: 'PUT', body: { version: 1, title: 'Y' } })).status, 403);
  assert.equal((await call('minhle', `/api/ideas/${idea.id}`, { method: 'PUT', body: { version: 9, title: 'Y' } })).body.code, 'version_conflict');
  const moved = await call('haiyen', `/api/ideas/${idea.id}/position`, { method: 'PUT', body: { x: 120, y: 80 } });
  assert.deepEqual([moved.body.idea.x, moved.body.idea.y, moved.body.idea.version], [120, 80, 1]);

  const pickId = randomUUID();
  const picked = await call('haiyen', '/api/ideas/pick', { method: 'POST', body: { kind: 'seminar', requestId: pickId } });
  assert.deepEqual([picked.body.pick.ideaId, picked.body.pick.byId], [idea.id, 'haiyen']);
  const seen = await call('minhle', '/api/ideas?kind=seminar');
  assert.deepEqual(seen.body.pick, picked.body.pick);

  const skipped = await call('minhle', '/api/ideas/skip', { method: 'POST', body: { kind: 'seminar', pickId: picked.body.pick.id } });
  assert.deepEqual([skipped.body.pick, skipped.body.eligibleCount, skipped.body.exhausted.skipped], [null, 0, 1]);
  // A late retry of the first pick does not draw again.
  assert.equal((await call('haiyen', '/api/ideas/pick', { method: 'POST', body: { kind: 'seminar', requestId: pickId } })).body.pick, null);
  assert.equal((await call('haiyen', '/api/ideas/pick', { method: 'POST', body: { kind: 'seminar', requestId: randomUUID() } })).body.code, 'nothing_to_pick');
  assert.equal((await call('haiyen', '/api/ideas/reset-skips', { method: 'POST', body: { kind: 'seminar' } })).body.eligibleCount, 1);

  const again = (await call('minhle', '/api/ideas/pick', { method: 'POST', body: { kind: 'seminar', requestId: randomUUID() } })).body.pick;
  const today = localDate(new Date().toISOString());
  const doneBody = { kind: 'seminar', pickId: again.id, date: today, text: 'Yến vẽ lá đẹp hơn', rating: 4, requestId: randomUUID() };
  const done = await call('minhle', '/api/ideas/done', { method: 'POST', body: doneBody });
  assert.equal(done.status, 201);
  assert.equal((await call('minhle', '/api/ideas/done', { method: 'POST', body: doneBody })).body.session.id, done.body.session.id);
  assert.equal((await call('haiyen', '/api/ideas/done', { method: 'POST', body: { ...doneBody, requestId: randomUUID() } })).body.code, 'pick_changed');
  const after = await call('haiyen', '/api/ideas?kind=seminar');
  assert.deepEqual([after.body.ideas[0].recent, after.body.eligibleCount, after.body.exhausted.recent], [true, 0, 1]);
  assert.equal((await call('haiyen', '/api/ideas/relax', { method: 'POST', body: { kind: 'seminar' } })).body.eligibleCount, 1);

  const rated = await call('haiyen', `/api/ideas/sessions/${done.body.session.id}/rating`, { method: 'PUT', body: { rating: 5 } });
  assert.deepEqual(rated.body.session.ratings, { minhle: 4, haiyen: 5 });

  await stop();
  ({ call, stop } = await start(t, dataDir));
  const history = await call('haiyen', `/api/ideas/sessions?kind=seminar&from=${today}&to=${today}`);
  assert.deepEqual(history.body.items.map(s => [s.title, s.ratings]), [['Cách cây quang hợp', { minhle: 4, haiyen: 5 }]]);
  assert.equal(history.body.nextCursor, null);
  assert.equal((await call('haiyen', '/api/ideas/sessions?from=2026-01-01')).body.code, 'invalid_range');
  assert.equal((await call('haiyen', '/api/ideas/nope')).status, 404);
  await stop();
});
