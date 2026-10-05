import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocStore, recalled, rememberRequest } from '../backend/doc-store.js';

function memoryRemote() {
  const documents = new Map();
  const remote = {
    documents, fail: false, failAfterWrite: false, writes: 0,
    async getDocument(name) { if (remote.fail) throw Object.assign(Error('down'), { code: 'storage_unavailable' }); return documents.has(name) ? structuredClone(documents.get(name)) : null; },
    async putDocument(name, value) {
      if (remote.fail) throw Object.assign(Error('down'), { code: 'storage_unavailable' });
      remote.writes++;
      documents.set(name, structuredClone(value));
      if (remote.failAfterWrite) throw Object.assign(Error('lost response'), { code: 'storage_unavailable' });
    },
  };
  return remote;
}
const empty = () => ({ items: [] });
// A create that a retry with the same requestId must not duplicate.
const create = (requestId, title) => doc => {
  const known = recalled(doc, requestId);
  if (known) return known;
  const record = { id: `item-${doc.items.length + 1}`, title };
  doc.items.push(record);
  rememberRequest(doc, requestId, record);
  return record;
};

test('local store writes atomically, survives reload and keeps the old document when a mutator throws', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-doc-store-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = createDocStore({ key: 'jar', dataDir, empty });
  assert.deepEqual(await store.read(), { items: [] });
  assert.deepEqual(await store.update(create('r1', 'Hôn')), { id: 'item-1', title: 'Hôn' });
  await assert.rejects(store.update(doc => { doc.items.push('half'); throw new Error('invalid'); }), /invalid/);
  const copy = await store.read();
  copy.items.push('not saved');
  assert.equal((await store.read()).items.length, 1, 'read returns a copy');
  assert.deepEqual(await readdir(dataDir), ['jar.json'], 'no temporary files remain');
  await store.close();
  await assert.rejects(store.update(() => {}), { status: 503, code: 'store_closed' });
  const reloaded = createDocStore({ key: 'jar', dataDir, empty });
  assert.equal((await reloaded.read()).items[0].title, 'Hôn');
  assert.equal(JSON.parse(await readFile(join(dataDir, 'jar.json'), 'utf8')).requests[0].id, 'r1');
});

test('updates run one after another in call order', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-doc-store-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = createDocStore({ key: 'order', dataDir, empty });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => store.update(async doc => {
    const before = doc.items.length;
    await new Promise(resolve => setTimeout(resolve, (20 - i) % 3));
    doc.items.push(i);
    return before;
  })));
  assert.deepEqual(results, Array.from({ length: 20 }, (_, i) => i));
  assert.deepEqual((await store.read()).items, Array.from({ length: 20 }, (_, i) => i));
});

test('remote store retries a failed load and a requestId retry after a lost response does not duplicate', async () => {
  const remote = memoryRemote();
  remote.fail = true;
  const store = createDocStore({ key: 'ideas', dataDir: '/nonexistent-homie-dir', remote, empty });
  await assert.rejects(store.read(), { status: 503, code: 'storage_unavailable' });
  remote.fail = false;
  assert.deepEqual(await store.read(), { items: [] }, 'next call retries the load');
  remote.failAfterWrite = true;
  await assert.rejects(store.update(create('r1', 'Seminar')), { status: 503 });
  remote.failAfterWrite = false;
  assert.deepEqual(await store.update(create('r1', 'Seminar')), { id: 'item-1', title: 'Seminar' });
  assert.equal(remote.documents.get('ideas').items.length, 1, 'the landed write is reloaded, not repeated');
  assert.equal((await store.update(create('r2', 'Khác'))).id, 'item-2');
});

test('validate migrates stored documents and an invalid document is unavailable, not reset', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-doc-store-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const validate = saved => { if (!Array.isArray(saved.items)) throw new Error('bad'); return { ...saved, version: 2 }; };
  await writeFile(join(dataDir, 'rules.json'), '{"items":[1]}');
  assert.deepEqual(await createDocStore({ key: 'rules', dataDir, empty, validate }).read(), { items: [1], version: 2 });
  await writeFile(join(dataDir, 'rules.json'), '{"items":"broken"}');
  await assert.rejects(createDocStore({ key: 'rules', dataDir, empty, validate }).read(), { status: 503, code: 'storage_unavailable' });
  assert.equal(await readFile(join(dataDir, 'rules.json'), 'utf8'), '{"items":"broken"}');
});

test('rememberRequest keeps the newest 500 requestIds and stores a copy', () => {
  const doc = {};
  const value = { n: 0 };
  rememberRequest(doc, 'first', value);
  value.n = 99;
  assert.deepEqual(recalled(doc, 'first'), { n: 0 });
  for (let i = 1; i <= 500; i++) rememberRequest(doc, `r${i}`, i);
  assert.equal(doc.requests.length, 500);
  assert.equal(recalled(doc, 'first'), undefined);
  assert.equal(recalled(doc, 'r1'), 1);
  assert.equal(recalled(doc, 'r500'), 500);
});
