import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackend } from '../backend/server.js';

const origin = 'http://localhost:8000';
const passwords = { minhle: 'location-only-minh-fixture', haiyen: 'location-only-yen-fixture' };
let credentials;
before(async () => {
  credentials = {};
  for (const [id, password] of Object.entries(passwords)) {
    const salt = Buffer.alloc(16, id === 'minhle' ? 3 : 4);
    const hash = await promisify(scrypt)(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    credentials[id] = `${salt.toString('hex')}:${hash.toString('hex')}`;
  }
});

const MIN = 60000;
const home = { lat: 21.0285, lng: 105.8542 };
const work = { lat: 21.0365, lng: 105.8342 };

function fakeRemote() {
  const docs = new Map();
  return {
    docs,
    async getDocument(name) { return docs.has(name) ? structuredClone(docs.get(name)) : null; },
    async putDocument(name, value) { docs.set(name, structuredClone(value)); },
    async deleteDocument(name) { docs.delete(name); },
  };
}

export async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-location-'));
  const remote = fakeRemote();
  const server = createBackend(origin, { credentials, dataDir, production: false, remote });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const call = async (method, path, payload, cookie) => {
    const response = await fetch(base + path, { method, headers: { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const login = async accountId => {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId, password: passwords[accountId] }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  return { call, remote, minh: await login('minhle'), yen: await login('haiyen') };
}

/** Sends points at minute offsets before now, oldest first. */
async function walk(call, cookie, place, minutesAgo) {
  for (const m of minutesAgo) {
    const r = await call('POST', '/api/location/point', { ...place, accuracy: 15, at: Date.now() - m * MIN }, cookie);
    assert.equal(r.status, 204);
  }
}

test('guests get 401 on every location route', async t => {
  const { call } = await fixture(t);
  for (const [method, path, body] of [['GET', '/api/location'], ['POST', '/api/location/point', { ...home, accuracy: 5, at: Date.now() }],
    ['PUT', '/api/location/sharing', { on: true }], ['PUT', '/api/location/note', { text: 'hi', hours: 1 }], ['DELETE', '/api/location/note'],
    ['GET', '/api/places'], ['GET', '/api/timeline?user=minhle&date=2026-11-02']]) {
    assert.equal((await call(method, path, body)).status, 401, `${method} ${path}`);
  }
});

test('a member shares a point the other sees, and can only write their own', async t => {
  const { call, minh, yen } = await fixture(t);
  assert.equal((await call('PUT', '/api/location/sharing', { on: true }, minh)).status, 200);
  const at = Date.now() - MIN;
  assert.equal((await call('POST', '/api/location/point', { ...home, accuracy: 12, at, user: 'haiyen' }, minh)).status, 204);
  const seen = (await call('GET', '/api/location', undefined, yen)).body;
  assert.deepEqual([seen.people.minhle.lat, seen.people.minhle.lng, seen.people.minhle.at], [home.lat, home.lng, at]);
  assert.equal(seen.people.minhle.sharing.on, true);
  assert.equal(seen.people.minhle.stale, false);
  assert.equal(seen.people.haiyen.lat, undefined, 'the user field in the body is ignored');
  assert.equal(seen.people.haiyen.sharing.on, false);
});

test('bad points are refused and inaccurate ones skipped', async t => {
  const { call, minh, yen } = await fixture(t);
  for (const body of [{ lat: 91, lng: 0, accuracy: 5, at: Date.now() }, { lat: 0, lng: 181, accuracy: 5, at: Date.now() },
    { lat: '1', lng: 0, accuracy: 5, at: Date.now() }, { lat: 0, lng: 0, accuracy: -1, at: Date.now() },
    { lat: 0, lng: 0, accuracy: 5, at: Date.now() + 6 * MIN }, { lat: 0, lng: 0, accuracy: 5 }, []]) {
    const r = await call('POST', '/api/location/point', body, minh);
    assert.deepEqual([r.status, r.body.code], [400, 'invalid_point'], JSON.stringify(body));
  }
  assert.equal((await call('POST', '/api/location/point', { ...home, accuracy: 500, at: Date.now() }, minh)).status, 204);
  assert.equal((await call('GET', '/api/location', undefined, yen)).body.people.minhle.lat, undefined);
});

test('an old point while sharing is stale', async t => {
  const { call, minh, yen } = await fixture(t);
  await call('PUT', '/api/location/sharing', { on: true }, minh);
  await walk(call, minh, home, [11]);
  assert.equal((await call('GET', '/api/location', undefined, yen)).body.people.minhle.stale, true);
});

test('notes: one line up to 60 characters for 1, 4 or 24 hours, then gone', async t => {
  const { call, minh, yen } = await fixture(t);
  assert.equal((await call('PUT', '/api/location/note', { text: 'a'.repeat(61), hours: 1 }, minh)).body.code, 'invalid_note');
  assert.equal((await call('PUT', '/api/location/note', { text: 'hi', hours: 2 }, minh)).body.code, 'invalid_note');
  assert.equal((await call('PUT', '/api/location/note', { text: 'a\nb', hours: 1 }, minh)).body.code, 'invalid_note');
  assert.equal((await call('PUT', '/api/location/note', { text: '   ', hours: 1 }, minh)).body.code, 'invalid_note');
  const saved = await call('PUT', '/api/location/note', { text: ' đang ăn bún chả 🍜 ', hours: 4 }, minh);
  assert.equal(saved.status, 200);
  const note = (await call('GET', '/api/location', undefined, yen)).body.people.minhle.note;
  assert.equal(note.text, 'đang ăn bún chả 🍜');
  assert.ok(Math.abs(note.expiresAt - (Date.now() + 4 * 60 * MIN)) < 5000);
  assert.equal((await call('DELETE', '/api/location/note', undefined, minh)).status, 200);
  assert.equal((await call('GET', '/api/location', undefined, yen)).body.people.minhle.note, null);
});

test('an expired note is not returned', async t => {
  const { call, remote, minh, yen } = await fixture(t);
  await call('PUT', '/api/location/note', { text: 'cũ', hours: 1 }, minh);
  const doc = remote.docs.get('location');
  doc.minhle.note.expiresAt = Date.now() - 1;
  remote.docs.set('location', doc);
  // A fresh backend reads the stored document again.
  const again = await fixture(t);
  again.remote.docs.set('location', doc);
  assert.equal((await again.call('GET', '/api/location', undefined, again.yen)).body.people.minhle.note, null);
});

test('stopping 10 minutes shows the place; stopping sharing records the visit', async t => {
  const { call, remote, minh, yen } = await fixture(t);
  await call('PUT', '/api/location/sharing', { on: true }, minh);
  await walk(call, minh, home, [20, 14, 8]);
  const place = (await call('GET', '/api/location', undefined, yen)).body.people.minhle.place;
  assert.equal(place.name, null);
  assert.ok(place.id);
  assert.equal((await call('PUT', '/api/location/sharing', { on: false, reason: 'battery' }, minh)).status, 200);
  const person = (await call('GET', '/api/location', undefined, yen)).body.people.minhle;
  assert.deepEqual([person.sharing.on, person.sharing.reason, person.place], [false, 'battery', null]);
  const visits = [...remote.docs.entries()].filter(([key]) => key.startsWith('visits-')).flatMap(([, v]) => v.items);
  assert.equal(visits.length, 1);
  assert.deepEqual([visits[0].user, visits[0].placeId], ['minhle', place.id]);
  assert.equal((await call('PUT', '/api/location/sharing', { on: 'yes' }, minh)).status, 400);
});

test('both stopping at the same new spot share one place', async t => {
  const { call, minh, yen } = await fixture(t);
  await Promise.all([walk(call, minh, home, [20, 14, 8]), walk(call, yen, home, [20, 14, 8])]);
  const people = (await call('GET', '/api/location', undefined, yen)).body.people;
  assert.equal(people.minhle.place.id, people.haiyen.place.id);
  assert.equal((await call('GET', '/api/places', undefined, minh)).body.places.length, 1);
});

export { home, work, walk, MIN };
