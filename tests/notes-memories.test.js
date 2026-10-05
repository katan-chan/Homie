import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as Y from 'yjs';
import { createNotesStore } from '../backend/notes-store.js';
import { listMemories } from '../backend/notes-memories.js';

function textUpdate(text) {
  const doc = new Y.Doc(), paragraph = new Y.XmlElement('paragraph'), value = new Y.XmlText();
  value.insert(0, text); paragraph.insert(0, [value]); doc.getXmlFragment('body').insert(0, [paragraph]);
  const update = Y.encodeStateAsUpdate(doc); doc.destroy(); return update;
}

test('listMemories returns only memories the viewer may see, skips trash, filters by date and garden', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-memories-'));
  const store = await createNotesStore({ dataDir });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  const send = (accountId, boardId, type, payload) => store.applyCommand(accountId, { operationId: randomUUID(), accountId,
    boardId, baseRevision: store.privateBoard(boardId, accountId)?.revision ?? 0, type, payload });
  const [open, journal] = [randomUUID(), randomUUID()];
  await send('minhle', open, 'board.create', { name: 'Vườn nhà mình', visibility: 'public' });
  await send('haiyen', journal, 'board.create', { name: 'Nhật ký của Yến', visibility: 'shared', noteDefault: 'private' });
  const note = async (accountId, boardId, extra) => {
    const id = randomUUID();
    await send(accountId, boardId, 'note.create', { id, columnId: null, x: 0, y: 0, width: 200, height: 200, color: '#ffffff', ...extra });
    return id;
  };
  const sea = await note('minhle', open, { labels: ['Kỷ niệm'], memoryDate: '2026-10-12', garden: true });
  await store.applyText('minhle', sea, textUpdate('Đi biển Vũng Tàu'), randomUUID());
  const plain = await note('minhle', open, { labels: ['Ý tưởng'] });
  const secret = await note('haiyen', journal, { labels: ['kỷ niệm'], memoryDate: '2026-09-01', visibility: 'haiyen' });
  const shared = await note('haiyen', journal, { labels: ['Kỷ niệm'], memoryDate: '2026-11-02', garden: true });
  const trashed = await note('minhle', open, { labels: ['Kỷ niệm'], memoryDate: '2026-10-01', garden: true });
  await send('minhle', open, 'note.trash', { id: trashed });
  const ids = (viewer, options) => listMemories(store, viewer, options).map(m => m.noteId);

  assert.deepEqual(ids(null), [sea], 'Guests only see memories on public boards');
  assert.deepEqual(ids('minhle'), [sea, shared], 'A private journal page stays hidden; trash hides the flower');
  assert.deepEqual(ids('haiyen'), [secret, sea, shared]);
  assert.ok(!ids('haiyen').includes(plain));
  assert.deepEqual(listMemories(store, null)[0], { noteId: sea, boardId: open, title: 'Đi biển Vũng Tàu', memoryDate: '2026-10-12', garden: true });
  assert.deepEqual(ids('haiyen', { gardenOnly: true }), [sea, shared]);
  assert.deepEqual(ids('haiyen', { from: '2026-10-01', to: '2026-10-31' }), [sea]);
  assert.deepEqual(ids('haiyen', { from: '2026-10-12' }), [sea, shared], 'Range ends are inclusive');

  await send('minhle', open, 'note.restore', { id: trashed });
  assert.ok(ids('minhle', { gardenOnly: true }).includes(trashed), 'Restoring brings the flower back');
  await send('minhle', open, 'board.trash', {});
  assert.deepEqual(ids('minhle'), [shared], 'A trashed board hides all its memories');
});
