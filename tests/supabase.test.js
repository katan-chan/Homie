import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSupabase, supabaseFromEnv } from '../backend/supabase.js';
import { createProfiles } from '../backend/profiles.js';
import { createNotesStore } from '../backend/notes-store.js';

// In-memory stand-in with the same interface as createSupabase(); `fail` simulates outages.
function memoryRemote() {
  const documents = new Map(), files = new Map();
  const remote = {
    documents, files, fail: false, failAfterWrite: false,
    async getDocument(name) { if (remote.fail) throw Object.assign(Error('down'), { code: 'storage_unavailable' }); return documents.has(name) ? structuredClone(documents.get(name)) : null; },
    async putDocument(name, value) {
      if (remote.fail) throw Object.assign(Error('down'), { code: 'storage_unavailable' });
      documents.set(name, structuredClone(value));
      if (remote.failAfterWrite) throw Object.assign(Error('lost response'), { code: 'storage_unavailable' });
    },
    async putFile(path, body) { files.set(path, Buffer.from(body)); },
    async getFile(path) { return files.has(path) ? new Response(files.get(path)) : null; },
    async removeFiles(paths) { for (const path of paths) files.delete(path); },
  };
  return remote;
}

test('supabaseFromEnv is off unless both URL and secret key are set', () => {
  assert.equal(supabaseFromEnv({}), null);
  assert.equal(supabaseFromEnv({ SUPABASE_URL: 'https://x.supabase.co' }), null);
  assert.equal(typeof supabaseFromEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' }).getDocument, 'function');
});

test('REST client sends the secret key, upserts with a prefix and maps missing objects to null', async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/rest/v1/documents?key=eq.')) return Response.json(url.includes('missing') ? [] : [{ value: { a: 1 } }]);
    if (url.endsWith('/test-gone.png')) return new Response('{"error":"not_found"}', { status: 400 });
    return new Response(null, { status: 201 });
  };
  const remote = createSupabase({ url: 'https://x.supabase.co/', key: 'sb_secret_test', prefix: 'test-', fetch: fake });
  assert.deepEqual(await remote.getDocument('notes'), { a: 1 });
  assert.equal(await remote.getDocument('missing'), null);
  await remote.putDocument('notes', { b: 2 });
  const upsert = calls.at(-1);
  assert.equal(upsert.init.headers.apikey, 'sb_secret_test');
  assert.match(upsert.init.headers.Prefer, /merge-duplicates/);
  assert.equal(JSON.parse(upsert.init.body).key, 'test-notes');
  assert.equal(await remote.getFile('gone.png'), null);
  assert.match(calls.at(-1).url, /\/storage\/v1\/object\/note-media\/test-gone\.png$/);
  const offline = createSupabase({ url: 'https://x.supabase.co', key: 'k', fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(offline.getDocument('notes'), { code: 'storage_unavailable', status: 503 });
});

test('profiles persist in the remote document and survive a restart; a boot outage is retried', async () => {
  const remote = memoryRemote();
  const first = createProfiles('/nonexistent-homie-dir', remote);
  assert.equal((await first.get('minhle')).displayName, 'Minh Lê');
  await first.update('minhle', { displayName: 'Minh', bio: 'Xin chào' });
  assert.equal(remote.documents.get('profiles').minhle.bio, 'Xin chào');
  remote.fail = true;
  const rebooted = createProfiles('/nonexistent-homie-dir', remote);
  await assert.rejects(rebooted.get('minhle'), /unavailable/);
  remote.fail = false;
  assert.equal((await rebooted.get('minhle')).displayName, 'Minh', 'Next request retries the remote load');
});

test('notes snapshot persists remotely, reloads, and reconciles a write whose response was lost', async t => {
  const remote = memoryRemote(), dataDir = await mkdtemp(join(tmpdir(), 'homie-remote-notes-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let store = await createNotesStore({ dataDir, remote });
  const boardId = randomUUID();
  const command = (type, payload) => ({ operationId: randomUUID(), accountId: 'minhle', boardId, baseRevision: store.privateBoard(boardId)?.revision ?? 0, type, payload });
  await store.applyCommand('minhle', command('board.create', { name: 'Chung' }));
  assert.equal(remote.documents.get('notes').boards.length, 1);
  await store.close(); store = await createNotesStore({ dataDir, remote });
  assert.equal(store.privateBoard(boardId).name, 'Chung', 'Reload reads the remote snapshot');
  remote.failAfterWrite = true;
  const lost = command('board.rename', { name: 'Đổi tên' });
  await assert.rejects(store.applyCommand('minhle', lost), { code: 'durability_uncertain' });
  remote.failAfterWrite = false;
  await store.applyCommand('minhle', lost);
  assert.equal(store.privateBoard(boardId).name, 'Đổi tên', 'Retry with the same operation ID resolves to the committed state');
  remote.fail = true;
  await assert.rejects(store.applyCommand('minhle', command('board.rename', { name: 'X' })), { code: 'storage_unavailable' });
  await store.close();
});
