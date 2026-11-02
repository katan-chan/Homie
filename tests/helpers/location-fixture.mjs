// Shared by the location API tests: a temp backend with both members logged in, and points sent minutes apart.
import { before } from 'node:test';
import assert from 'node:assert/strict';
import { scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackend } from '../../backend/server.js';

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

export const MIN = 60000;
export const home = { lat: 21.0285, lng: 105.8542 };
export const work = { lat: 21.0365, lng: 105.8342 };

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
export async function walk(call, cookie, place, minutesAgo) {
  for (const m of minutesAgo) {
    const r = await call('POST', '/api/location/point', { ...place, accuracy: 15, at: Date.now() - m * MIN }, cookie);
    assert.equal(r.status, 204);
  }
}

