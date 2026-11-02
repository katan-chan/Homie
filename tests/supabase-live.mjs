// Live check against the real Supabase project: npm run test:supabase (reads .env).
// Everything is written under a unique test- prefix and removed afterwards; real data is never touched.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSupabase } from '../backend/supabase.js';
import { createProfiles } from '../backend/profiles.js';
import { createNotesStore } from '../backend/notes-store.js';
import { createFiles } from '../backend/files.js';
import { createDocStore } from '../backend/doc-store.js';

const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key } = process.env;
if (!url || !key) { console.log('SKIP: set SUPABASE_URL and SUPABASE_SECRET_KEY (e.g. in .env) to run the live Supabase check.'); process.exit(0); }
const prefix = `test-${randomUUID()}-`, remote = createSupabase({ url, key, prefix });
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function cleanup() {
  await fetch(`${url}/rest/v1/documents?key=like.${encodeURIComponent(prefix)}*`, { method: 'DELETE', headers });
  const listed = await (await fetch(`${url}/storage/v1/object/list/note-media`, { method: 'POST', headers, body: JSON.stringify({ prefix: '', limit: 1000, search: prefix }) })).json();
  const names = (Array.isArray(listed) ? listed : []).map(item => item.name).filter(name => name.startsWith(prefix));
  if (names.length) await fetch(`${url}/storage/v1/object/note-media`, { method: 'DELETE', headers, body: JSON.stringify({ prefixes: names }) });
  return names.length;
}

const dataDir = await mkdtemp(join(tmpdir(), 'homie-supabase-live-'));
try {
  assert.equal(await remote.getDocument('missing'), null);
  await remote.putDocument('probe', { text: 'Kỷ niệm' });
  assert.deepEqual(await remote.getDocument('probe'), { text: 'Kỷ niệm' });

  const profiles = createProfiles(dataDir, remote);
  await profiles.update('haiyen', { displayName: 'Hải Yến', bio: 'Thử Supabase' });
  assert.equal((await createProfiles(dataDir, remote).get('haiyen')).bio, 'Thử Supabase', 'profile survives a restart');

  let store = await createNotesStore({ dataDir, remote });
  const boardId = randomUUID();
  await store.applyCommand('minhle', { operationId: randomUUID(), accountId: 'minhle', boardId, baseRevision: 0, type: 'board.create', payload: { name: 'Bảng thử' } });
  await store.close(); store = await createNotesStore({ dataDir, remote });
  assert.equal(store.privateBoard(boardId, 'minhle').name, 'Bảng thử', 'notes survive a restart');
  await store.close();

  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  await remote.putFile('probe.png', bytes, 'image/png');
  assert.deepEqual(Buffer.from(await (await remote.getFile('probe.png')).arrayBuffer()), bytes);
  await remote.removeFiles(['probe.png']);
  assert.equal(await remote.getFile('probe.png'), null);
  const anonymous = await fetch(`${url}/storage/v1/object/public/note-media/${prefix}probe.png`);
  assert.notEqual(anonymous.status, 200, 'bucket is not public');
  console.log('PASS live Supabase: documents, profiles, notes snapshot, private bucket upload/download/remove');

  // Ảnh đại diện: the profile's avatar field survives a restart; a file read through files.js streams and a HEAD-style
  // early destroy does not throw.
  await createProfiles(dataDir, remote).setAvatar('minhle', { version: 1730000000000, mime: 'image/webp' });
  assert.deepEqual((await createProfiles(dataDir, remote).get('minhle')).avatar, { version: 1730000000000, mime: 'image/webp' });
  const files = createFiles({ dataDir, remote });
  await files.put('avatars/minhle-1730000000000.webp', bytes, 'image/webp');
  const opened = await files.open('avatars/minhle-1730000000000.webp');
  const chunks = [];
  for await (const chunk of opened.stream) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), bytes);
  (await files.open('avatars/minhle-1730000000000.webp')).stream.destroy();
  await files.remove(['avatars/minhle-1730000000000.webp']);
  assert.equal(await files.open('avatars/minhle-1730000000000.webp'), null);
  // Vị trí: the location and month-of-visits documents round trip.
  const visits = createDocStore({ key: 'visits-2026-11', dataDir, remote, empty: () => ({ items: [] }) });
  await visits.update(doc => { doc.items.push({ id: 'v1', user: 'minhle', placeId: 'p1', arrivedAt: 1, leftAt: 2 }); });
  assert.equal((await createDocStore({ key: 'visits-2026-11', dataDir, remote, empty: () => ({ items: [] }) }).read()).items.length, 1);
  console.log('PASS live Supabase: avatar field and file stream, location visits document');

  // Full media pipeline in a real browser, with the backend storing everything under the same prefix.
  const code = await new Promise(resolve => spawn(process.execPath, ['tests/browser-note-media.mjs'], { stdio: 'inherit', env: { ...process.env, SUPABASE_PREFIX: prefix } }).on('exit', resolve));
  assert.equal(code, 0, 'browser media test passes with Supabase storage');
  console.log('PASS live Supabase: browser media pipeline (upload, preview, publish, insert, serve)');
} finally {
  const removed = await cleanup().catch(error => { console.error('Cleanup failed for prefix', prefix, error.message); return -1; });
  console.log(`Cleaned up test prefix ${prefix} (${removed} files)`);
  await rm(dataDir, { recursive: true, force: true });
}
