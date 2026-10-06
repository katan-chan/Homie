import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackend } from '../backend/server.js';

const origin = 'http://localhost:8000';
const mutationHeaders = { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' };
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

async function setup(t, options = {}) {
  const dataDir = options.dataDir ?? await mkdtemp(join(tmpdir(), 'homie-backend-test-'));
  const server = createBackend(origin, { credentials, dataDir, production: false, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (!options.dataDir) await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, dataDir, request: (path, init = {}) => fetch(base + path, init) };
}
async function login(request, accountId = 'minhle', password = fixtures[accountId], cookie) {
  return request('/api/auth/login', { method: 'POST', headers: { ...mutationHeaders, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ accountId, password }) });
}
const cookieOf = response => response.headers.get('set-cookie')?.split(';')[0];

test('health remains public and has correct methods and CORS', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/health')).status, 200);
  assert.equal(await (await request('/api/health', { method: 'HEAD' })).text(), '');
  const forbidden = await request('/api/health', { headers: { Origin: 'https://other.example' } });
  assert.equal(forbidden.status, 403);
  const preflight = await request('/api/auth/login', { method: 'OPTIONS', headers: { Origin: origin } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  assert.match(preflight.headers.get('access-control-allow-methods'), /PUT/);
  assert.match(preflight.headers.get('access-control-allow-headers'), /X-Requested-With/i);
  assert.equal((await request('/api/health', { method: 'POST' })).status, 405);
  assert.equal((await request('/missing')).status, 404);
});

test('both accounts login with distinct fixture passwords and safe session cookies', async t => {
  const { request } = await setup(t);
  for (const [id, displayName] of [['minhle', 'Minh Lê'], ['haiyen', 'Hải Yến']]) {
    const result = await login(request, id);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { user: { id, displayName, bio: '' } });
    assert.match(result.headers.get('set-cookie'), /HttpOnly/);
    assert.match(result.headers.get('set-cookie'), /SameSite=Lax/);
    assert.match(result.headers.get('set-cookie'), /Path=\//);
    const session = await request('/api/auth/session', { headers: { Cookie: cookieOf(result) } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).user.id, id);
  }
});

test('wrong and unknown credentials return the same generic 401', async t => {
  const { request } = await setup(t);
  const wrong = await login(request, 'minhle', 'incorrect-fixture');
  const unknown = await login(request, 'unknown', 'incorrect-fixture');
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await wrong.json(), await unknown.json());
  assert.equal((await request('/api/auth/session')).status, 401);
  for (const accountId of ['constructor', '__proto__', 'toString']) {
    const response = await login(request, accountId, 'incorrect-fixture');
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Invalid account or password' });
  }
});

test('login, logout and profile mutations require Origin and CSRF header', async t => {
  const { request } = await setup(t);
  for (const headers of [{ 'Content-Type': 'application/json' }, { Origin: origin, 'Content-Type': 'application/json' }, { ...mutationHeaders, Origin: 'https://other.example' }]) {
    const result = await request('/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ accountId: 'minhle', password: fixtures.minhle }) });
    assert.equal(result.status, 403);
  }
  assert.equal((await request('/api/auth/logout', { method: 'POST' })).status, 403);
  assert.equal((await request('/api/profiles/minhle', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});

test('new login rotates the old session and logout revokes it', async t => {
  const { request } = await setup(t);
  const first = cookieOf(await login(request));
  const secondResponse = await login(request, 'minhle', fixtures.minhle, first);
  const second = cookieOf(secondResponse);
  assert.notEqual(first, second);
  assert.equal((await request('/api/auth/session', { headers: { Cookie: first } })).status, 401);
  assert.equal((await request('/api/auth/logout', { method: 'POST', headers: { ...mutationHeaders, Cookie: second } })).status, 204);
  assert.equal((await request('/api/auth/session', { headers: { Cookie: second } })).status, 401);
});

test('sessions expire and production cookies are Secure', async t => {
  const { request } = await setup(t, { sessionTtlMs: 25, production: true });
  const result = await login(request);
  assert.equal(result.status, 200);
  assert.match(result.headers.get('set-cookie'), /Secure/);
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal((await request('/api/auth/session', { headers: { Cookie: cookieOf(result) } })).status, 401);
  assert.throws(() => createBackend(origin, { production: false, sameSite: 'None' }), /Secure/i);
});

test('a session in use slides forward; an unused one still expires', async t => {
  const { request } = await setup(t, { sessionTtlMs: 600 });
  const cookie = cookieOf(await login(request));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  await wait(400);
  assert.equal((await request('/api/auth/session', { headers: { Cookie: cookie } })).status, 200, 'Used after 400 ms: extended to 600 ms from now');
  await wait(400);
  assert.equal((await request('/api/auth/session', { headers: { Cookie: cookie } })).status, 200, 'Past the original 600 ms, still in');
  await wait(700);
  assert.equal((await request('/api/auth/session', { headers: { Cookie: cookie } })).status, 401, 'Left alone longer than the ttl');
});

test('profiles are public but only their authenticated owners can write', async t => {
  const { request } = await setup(t);
  for (const id of ['minhle', 'haiyen']) {
    const response = await request(`/api/profiles/${id}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).profile.id, id);
  }
  assert.equal((await request('/api/profiles/unknown')).status, 404);
  const body = JSON.stringify({ displayName: '  Minh mới  ', bio: '  Xin chào  ' });
  assert.equal((await request('/api/profiles/minhle', { method: 'PUT', headers: mutationHeaders, body })).status, 401);
  const cookie = cookieOf(await login(request));
  assert.equal((await request('/api/profiles/haiyen', { method: 'PUT', headers: { ...mutationHeaders, Cookie: cookie }, body })).status, 403);
  const updated = await request('/api/profiles/minhle', { method: 'PUT', headers: { ...mutationHeaders, Cookie: cookie }, body });
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { profile: { id: 'minhle', displayName: 'Minh mới', bio: 'Xin chào' } });
  assert.equal((await (await request('/api/profiles/minhle')).json()).profile.bio, 'Xin chào');
});

test('profile validation rejects impersonation, unknown fields and invalid text', async t => {
  const { request } = await setup(t);
  const cookie = cookieOf(await login(request));
  const base = { displayName: 'Minh', bio: '' };
  const invalid = [{ ...base, id: 'haiyen' }, { ...base, userId: 'haiyen' }, { ...base, role: 'admin' }, { ...base, avatar: 'x' }, { ...base, surprise: 1 }, { ...base, displayName: ' ' }, { ...base, displayName: 'x'.repeat(81) }, { ...base, bio: 'x'.repeat(501) }, { ...base, bio: 1 }, { displayName: 'Minh' }, null, []];
  for (const body of invalid) {
    const response = await request('/api/profiles/minhle', { method: 'PUT', headers: { ...mutationHeaders, Cookie: cookie }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
  }
});

test('body parsing rejects wrong MIME, malformed JSON and oversized requests', async t => {
  const { request } = await setup(t);
  for (const [headers, body, expected] of [[{ ...mutationHeaders, 'Content-Type': 'text/plain' }, '{}', 415], [mutationHeaders, '{', 400], [mutationHeaders, 'x'.repeat(8193), 413], [mutationHeaders, JSON.stringify({ accountId: 'minhle', password: fixtures.minhle, role: 'admin' }), 400]]) {
    assert.equal((await request('/api/auth/login', { method: 'POST', headers, body })).status, expected);
  }
  const logout = await request('/api/auth/logout', { method: 'POST', headers: { ...mutationHeaders, 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(logout.status, 415);
});

test('serialized concurrent writes preserve both owners profiles', async t => {
  const { request, dataDir } = await setup(t);
  const minh = cookieOf(await login(request));
  const yen = cookieOf(await login(request, 'haiyen'));
  const responses = await Promise.all([
    request('/api/profiles/minhle', { method: 'PUT', headers: { ...mutationHeaders, Cookie: minh }, body: JSON.stringify({ displayName: 'Minh', bio: 'one' }) }),
    request('/api/profiles/haiyen', { method: 'PUT', headers: { ...mutationHeaders, Cookie: yen }, body: JSON.stringify({ displayName: 'Yến', bio: 'two' }) }),
  ]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  const stored = JSON.parse(await readFile(join(dataDir, 'profiles.json'), 'utf8'));
  assert.equal(stored.minhle.bio, 'one');
  assert.equal(stored.haiyen.bio, 'two');
});

test('profiles and sessions persist across server restart; only a hash of the session token is stored', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-persist-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const first = await setup(t, { dataDir });
  const cookie = cookieOf(await login(first.request));
  const body = JSON.stringify({ displayName: 'Tên mới', bio: 'Saved biography' });
  assert.equal((await first.request('/api/profiles/minhle', { method: 'PUT', headers: { ...mutationHeaders, Cookie: cookie }, body })).status, 200);
  const saved = await readFile(join(dataDir, 'profiles.json'), 'utf8');
  assert.ok(!saved.includes('password') && !saved.includes(credentials.minhle));
  const second = await setup(t, { dataDir });
  assert.deepEqual(await (await second.request('/api/profiles/minhle')).json(), { profile: { id: 'minhle', displayName: 'Tên mới', bio: 'Saved biography' } });
  const resumed = await second.request('/api/auth/session', { headers: { Cookie: cookie } });
  assert.equal(resumed.status, 200, 'A restart (or Render waking up) keeps people logged in');
  assert.match(resumed.headers.get('set-cookie'), /Max-Age=7776000/, 'Opening the app renews the 90-day cookie');
  const sessions = await readFile(join(dataDir, 'sessions.json'), 'utf8');
  assert.ok(!sessions.includes(cookie.split('=')[1]), 'The raw token never reaches storage');
  assert.equal((await second.request('/api/auth/logout', { method: 'POST', headers: { ...mutationHeaders, Cookie: cookie } })).status, 204);
  const third = await setup(t, { dataDir });
  assert.equal((await third.request('/api/auth/session', { headers: { Cookie: cookie } })).status, 401, 'Logout is durable too');
});

test('invalid persisted profiles fail closed and are not overwritten', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-corrupt-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await writeFile(join(dataDir, 'profiles.json'), '{invalid');
  const { request } = await setup(t, { dataDir });
  assert.equal((await request('/api/profiles/minhle')).status, 500);
  assert.equal((await login(request)).status, 500);
  assert.equal(await readFile(join(dataDir, 'profiles.json'), 'utf8'), '{invalid');
});

test('missing or malformed password hashes disable login', async t => {
  for (const configuration of [{}, { minhle: 'invalid', haiyen: credentials.haiyen }]) {
    const { request } = await setup(t, { credentials: configuration });
    assert.equal((await login(request)).status, 503);
    assert.equal((await request('/api/profiles/haiyen')).status, 200);
  }
});

test('repeated login attempts are throttled before unbounded password work', async t => {
  const { request } = await setup(t);
  let throttled = false;
  for (let i = 0; i < 12; i++) {
    const result = await login(request, 'minhle', 'incorrect-fixture');
    if (result.status === 429) {
      assert.ok(result.headers.get('retry-after'));
      throttled = true;
      break;
    }
    assert.equal(result.status, 401);
  }
  assert.equal(throttled, true);
});
