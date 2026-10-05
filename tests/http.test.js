import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleErrors, httpError, readJson, requireMember, requireWrite, sendJson } from '../backend/http.js';
import { createBackend } from '../backend/server.js';

const origin = 'http://localhost:8000';
const body = (text, headers = { 'content-type': 'application/json' }) => Object.assign(Readable.from([Buffer.from(text)]), { headers });
const auth = { userId: req => req.user ?? null };
function response() {
  const res = { headers: {}, destroyed: false, writableEnded: false };
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.writeHead = status => { res.status = status; return res; };
  res.end = text => { res.body = text === undefined ? undefined : JSON.parse(text); res.writableEnded = true; };
  return res;
}

test('readJson parses JSON and rejects wrong type, oversized and broken bodies', async () => {
  assert.deepEqual(await readJson(body('{"a":1}')), { a: 1 });
  await assert.rejects(readJson(body('{}', { 'content-type': 'text/plain' })), { status: 415, code: 'unsupported_media_type' });
  await assert.rejects(readJson(body('x'.repeat(40))), { status: 400, code: 'invalid_body' });
  await assert.rejects(readJson(body(`"${'x'.repeat(100)}"`), { limit: 50 }), { status: 413, code: 'body_too_large' });
  await assert.rejects(readJson(body('{}', { 'content-type': 'application/json', 'content-length': '99999' })), { status: 413 });
});

test('sendJson never caches; handleErrors turns errors into { error, code }', async () => {
  const ok = response();
  sendJson(ok, 201, { done: true });
  assert.equal(ok.status, 201);
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.deepEqual(ok.body, { done: true });
  const known = response();
  await handleErrors(known, () => { throw httpError(409, 'version_conflict', 'Stale version'); });
  assert.deepEqual([known.status, known.body], [409, { error: 'Stale version', code: 'version_conflict' }]);
  const unknown = response();
  await handleErrors(unknown, async () => { throw new Error('private note text'); });
  assert.deepEqual([unknown.status, unknown.body], [500, { error: 'Internal server error', code: 'internal_error' }]);
  assert.equal(await handleErrors(response(), () => 'value'), 'value');
});

test('requireMember and requireWrite check session, Origin and X-Requested-With', () => {
  const headers = { origin, 'x-requested-with': 'Homie' };
  assert.equal(requireMember({ user: 'haiyen', headers }, auth), 'haiyen');
  assert.throws(() => requireMember({ headers }, auth), { status: 401, code: 'unauthorized' });
  assert.throws(() => requireMember({ user: 'guest', headers }, auth), { status: 401 });
  const options = { auth, allowedOrigins: new Set([origin]) };
  assert.equal(requireWrite({ user: 'minhle', headers }, options), 'minhle');
  assert.throws(() => requireWrite({ user: 'minhle', headers: { origin } }, options), { status: 403, code: 'forbidden' });
  assert.throws(() => requireWrite({ user: 'minhle', headers: { ...headers, origin: 'https://other.example' } }, options), { status: 403 });
  assert.throws(() => requireWrite({ headers }, options), { status: 401 });
});

test('server dispatches owned feature prefixes to their modules', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-features-test-'));
  const server = createBackend(origin, { credentials: {}, dataDir, remote: null, production: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/api/jar', '/api/calendar?from=2026-10-01', '/api/cycles/x', '/api/ideas/pick', '/api/rules', '/api/garden']) {
    const result = await fetch(base + path);
    assert.equal(result.status, 404, path);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await result.json(), { error: 'Not implemented', code: 'not_implemented' }, path);
  }
  const posted = await fetch(`${base}/api/jar`, { method: 'POST', headers: { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await posted.json()).code, 'not_implemented');
  assert.equal((await fetch(`${base}/api/jar`, { method: 'OPTIONS', headers: { Origin: origin } })).status, 204);
  assert.equal((await fetch(`${base}/api/jar`, { headers: { Origin: 'https://other.example' } })).status, 403, 'Origin allowlist still runs first');
  const other = await fetch(`${base}/api/jarx`);
  assert.deepEqual([other.status, await other.json()], [404, { error: 'Not found' }], 'Prefix match stops at a path boundary');
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test('feature modules are created once with deps, can read the notes store and close with the server', async t => {
  const { features } = await import('../backend/features.js');
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-features-test-'));
  let created = 0, closed = 0, failNext = true;
  const probe = {
    route: path => path === '/api/probe',
    async create(deps) {
      if (failNext) { failNext = false; throw new Error('boot failure'); }
      created++;
      assert.deepEqual(Object.keys(deps).sort(), ['allowedOrigins', 'auth', 'dataDir', 'notesStore', 'remote']);
      assert.equal(deps.dataDir, dataDir);
      return {
        handle: async (req, res) => { const store = await deps.notesStore(); sendJson(res, 200, { canSee: typeof store.canSee }); },
        close() { closed++; },
      };
    },
  };
  features.push(probe);
  t.after(() => features.splice(features.indexOf(probe), 1));
  const server = createBackend(origin, { credentials: {}, dataDir, remote: null, production: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const failed = await fetch(`${base}/api/probe`);
  assert.deepEqual([failed.status, (await failed.json()).code], [503, 'storage_unavailable']);
  for (let i = 0; i < 2; i++) assert.deepEqual(await (await fetch(`${base}/api/probe`)).json(), { canSee: 'function' });
  assert.equal((await fetch(`${base}/api/boards`)).status, 200, 'Notes API shares the store the feature started');
  assert.equal(created, 1, 'A failed create is retried, then the module is reused');
  await new Promise(resolve => server.close(resolve));
  assert.equal(closed, 1);
  await rm(dataDir, { recursive: true, force: true });
});
