import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackend, hashPassword } from '../backend/server.js';

const origin = 'http://localhost:8000';
const passwords = { minhle: 'calendar-only-minh-fixture', haiyen: 'calendar-only-yen-fixture' };
let credentials;
before(async () => {
  credentials = Object.fromEntries(await Promise.all(Object.entries(passwords).map(async ([id, password]) => [id, await hashPassword(password)])));
});

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-calendar-http-'));
  const server = createBackend(origin, { credentials, dataDir, remote: null, production: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, cookie, body, headers = { Origin: origin, 'X-Requested-With': 'Homie' }) => {
    const response = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', ...headers }),
      ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  };
  const login = async accountId => {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, password: passwords[accountId] }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  return { call, minh: await login('minhle'), yen: await login('haiyen') };
}

test('occasions: members only, requestId replay, author-only edits, versions, archive', async t => {
  const { call, minh, yen } = await fixture(t);
  const range = '/api/calendar?from=2026-10-01&to=2026-10-31';
  assert.equal((await call('GET', range)).status, 401);
  assert.deepEqual((await call('GET', range, minh)).body, { events: [], memories: [] });
  assert.equal((await call('GET', '/api/calendar?from=2026-10-31&to=2026-10-01', minh)).body.code, 'invalid_range');

  const requestId = randomUUID();
  const input = { requestId, title: 'Sinh nhật Yến', date: '2026-10-20', kind: 'occasion', authorId: 'haiyen' };
  assert.equal((await call('POST', '/api/calendar/events', minh, input, { Origin: origin })).status, 403, 'X-Requested-With is required');
  const first = await call('POST', '/api/calendar/events', minh, input);
  assert.equal(first.status, 201);
  assert.equal(first.cache, 'no-store');
  assert.equal(first.body.event.authorId, 'minhle', 'Author comes from the session');
  const retry = await call('POST', '/api/calendar/events', minh, input);
  assert.deepEqual(retry.body.event, first.body.event, 'Same requestId returns the first record');
  assert.equal((await call('POST', '/api/calendar/events', minh, { ...input, requestId: 'nope' })).status, 400);
  assert.equal((await call('GET', range, yen)).body.events.length, 1, 'Both members see occasions');

  const id = first.body.event.id;
  assert.equal((await call('PUT', `/api/calendar/events/${id}`, yen, { version: 1, title: 'x' })).body.code, 'not_author');
  assert.equal((await call('PUT', `/api/calendar/events/${id}`, minh, { version: 7, title: 'x' })).body.code, 'version_conflict');
  const edited = await call('PUT', `/api/calendar/events/${id}`, minh, { version: 1, title: 'Sinh nhật', date: '2026-10-21' });
  assert.deepEqual([edited.status, edited.body.event.date, edited.body.event.version], [200, '2026-10-21', 2]);
  assert.equal((await call('POST', `/api/calendar/events/${id}/archive`, minh, { version: 2 })).status, 200);
  assert.deepEqual((await call('GET', range, yen)).body.events, []);
  assert.equal((await call('GET', '/api/calendar/unknown', minh)).status, 404);
});

test('cycles: Hải Yến only; minhle gets 404 on every route and the calendar never mentions cycles', async t => {
  const { call, minh, yen } = await fixture(t);
  const created = await call('POST', '/api/cycles', yen, { requestId: randomUUID(), start: '2026-10-03', end: null, note: 'Uống nước ấm.' });
  assert.equal(created.status, 201);
  const { id } = created.body.cycle;
  assert.deepEqual((await call('GET', '/api/cycles?from=2026-10-01&to=2026-10-31', yen)).body.cycles.map(c => c.id), [id]);

  const denied = [
    ['GET', '/api/cycles?from=2026-10-01&to=2026-10-31'], ['GET', '/api/cycles'], ['GET', `/api/cycles/${id}`],
    ['POST', '/api/cycles', { requestId: randomUUID(), start: '2026-10-03' }], ['POST', '/api/cycles', {}],
    ['PUT', `/api/cycles/${id}`, { version: 1, note: '' }], ['PUT', '/api/cycles/missing', { version: 1 }],
    ['POST', `/api/cycles/${id}/end`, { version: 1 }], ['POST', `/api/cycles/${id}/archive`, { version: 1 }],
  ];
  for (const [method, path, body] of denied) {
    const result = await call(method, path, minh, body);
    assert.deepEqual([result.status, result.body], [404, { error: 'Not found', code: 'not_found' }], `${method} ${path}`);
  }
  assert.equal((await call('GET', '/api/cycles?from=2026-10-01&to=2026-10-31')).status, 401, 'Guests are not members');
  const calendar = await call('GET', '/api/calendar?from=2026-10-01&to=2026-10-31', minh);
  assert.deepEqual(Object.keys(calendar.body).sort(), ['events', 'memories']);
  assert.doesNotMatch(JSON.stringify(calendar.body), /cycle|nước ấm/i);

  assert.equal((await call('PUT', `/api/cycles/${id}`, yen, { version: 1, end: '2026-10-01' })).body.code, 'invalid_range', 'End before start');
  const ended = await call('POST', `/api/cycles/${id}/end`, yen, { version: 1, date: '2026-10-07' });
  assert.deepEqual([ended.status, ended.body.cycle.end], [200, '2026-10-07']);
  assert.equal((await call('POST', `/api/cycles/${id}/archive`, yen, { version: 1 })).body.code, 'version_conflict');
  assert.equal((await call('POST', `/api/cycles/${id}/archive`, yen, { version: 2 })).status, 200);
  assert.deepEqual((await call('GET', '/api/cycles?from=2026-10-01&to=2026-10-31', yen)).body.cycles, []);
});
