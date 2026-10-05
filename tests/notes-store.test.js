import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rename, mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as Y from 'yjs';
import { createNotesStore } from '../backend/notes-store.js';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-notes-store-'));
  let store = await createNotesStore({ dataDir });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  const boardId = randomUUID(), noteId = randomUUID();
  const command = (type, payload, accountId = 'minhle') => ({ operationId: randomUUID(), accountId,
    boardId, baseRevision: store.privateBoard(boardId)?.revision ?? 0, type, payload });
  const send = (type, payload, accountId = 'minhle', options) => store.applyCommand(accountId, command(type, payload, accountId), options);
  await send('board.create', { name: 'Chung', visibility: 'public' });
  await send('note.create', { id: noteId, columnId: null, x: 10, y: 20, width: 240, height: 280, color: '#ffeedd' });
  return { get store() { return store; }, dataDir, boardId, noteId, send, command,
    async reopen() { await store.close(); store = await createNotesStore({ dataDir }); return store; } };
}
function textUpdate(text) {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph'), value = new Y.XmlText();
  value.insert(0, text); paragraph.insert(0, [value]); doc.getXmlFragment('body').insert(0, [paragraph]);
  const update = Y.encodeStateAsUpdate(doc); doc.destroy(); return update;
}

test('persists author, dedup and rich text; retries after restart return original result', async t => {
  const f = await fixture(t), operationId = randomUUID();
  const update = textUpdate('Xin chào Hải Yến');
  const command = f.command('note.update', { id: f.noteId, color: '#aabbcc' }, 'haiyen');
  const first = await f.store.applyCommand('haiyen', command);
  assert.deepEqual(await f.store.applyCommand('haiyen', command), first);
  await assert.rejects(f.store.applyCommand('minhle', command), { code: 'account_mismatch' });
  await assert.rejects(f.store.applyCommand('haiyen', { ...command, payload: { id: f.noteId, color: '#ffffff' } }), { code: 'operation_conflict' });
  const textResult = await f.store.applyText('haiyen', f.noteId, update, operationId);
  await f.reopen();
  assert.deepEqual(await f.store.applyCommand('haiyen', command), first);
  assert.deepEqual(await f.store.applyText('haiyen', f.noteId, update, operationId), textResult);
  assert.equal(f.store.publicBoard(f.boardId).notes[0].authorId, 'minhle');
  assert.equal(f.store.publicBoard(f.boardId).notes[0].content.content[0].content[0].text, 'Xin chào Hải Yến');
  const restored = new Y.Doc();
  Y.applyUpdate(restored, Buffer.from(f.store.privateBoard(f.boardId).texts[f.noteId], 'base64'));
  assert.equal(restored.getXmlFragment('body').toString(), '<paragraph>Xin chào Hải Yến</paragraph>');
  restored.destroy();
  const guest = JSON.stringify(f.store.publicBoard(f.boardId));
  for (const privateKey of ['"texts"', '"operations"', '"assets"', '"presence"']) assert.ok(!guest.includes(privateKey));
});

test('editing trash merges retained Yjs without resurrection and metadata revision stays separate', async t => {
  const f = await fixture(t);
  await f.send('note.trash', { id: f.noteId });
  const revision = f.store.privateBoard(f.boardId).notes[0].revision;
  await f.store.applyText('haiyen', f.noteId, textUpdate('Bản sửa offline'), randomUUID());
  assert.equal(f.store.publicBoard(f.boardId).notes.length, 0);
  assert.equal(f.store.privateBoard(f.boardId).notes[0].revision, revision);
  await f.reopen();
  await f.send('note.restore', { id: f.noteId });
  assert.equal(f.store.publicBoard(f.boardId).notes[0].content.content[0].content[0].text, 'Bản sửa offline');
});

test('Yjs rejects metadata roots, unexpected nodes, unsafe attributes and malformed bytes without committing', async t => {
  const f = await fixture(t), before = await readFile(join(f.dataDir, 'notes.json'), 'utf8');
  for (const update of [new Uint8Array([255]), (() => { const d = new Y.Doc(); d.getMap('owner').set('authorId', 'haiyen'); const u = Y.encodeStateAsUpdate(d); d.destroy(); return u; })(), (() => { const d = new Y.Doc(); const el = new Y.XmlElement('script'); d.getXmlFragment('body').insert(0, [el]); const u = Y.encodeStateAsUpdate(d); d.destroy(); return u; })(), (() => { const d = new Y.Doc(); const el = new Y.XmlElement('paragraph'); el.setAttribute('onclick', 'evil()'); d.getXmlFragment('body').insert(0, [el]); const u = Y.encodeStateAsUpdate(d); d.destroy(); return u; })(), ...['1px;background:url(x)', '200px', '9px'].map(fontSize => { const d = new Y.Doc(); const el = new Y.XmlElement('paragraph'), text = new Y.XmlText(); el.insert(0, [text]); d.getXmlFragment('body').insert(0, [el]); text.insert(0, 'x', { textStyle: { fontSize } }); const u = Y.encodeStateAsUpdate(d); d.destroy(); return u; })]) {
    await assert.rejects(f.store.applyText('minhle', f.noteId, update, randomUUID()), { code: 'invalid_text' });
    assert.equal(await readFile(join(f.dataDir, 'notes.json'), 'utf8'), before);
  }
});

test('real rename failure does not ACK, publish, mutate or consume operation; retry recovers queue', async t => {
  const f = await fixture(t), path = join(f.dataDir, 'notes.json'), backup = join(f.dataDir, 'backup');
  const seen = []; const unsubscribe = f.store.subscribe(event => seen.push(event));
  const before = f.store.publicBoard(f.boardId), command = f.command('note.update', { id: f.noteId, x: 100 });
  await rename(path, backup); await mkdir(path);
  await assert.rejects(f.store.applyCommand('minhle', command));
  assert.deepEqual(f.store.publicBoard(f.boardId), before); assert.equal(seen.length, 0);
  assert.equal((await readdir(f.dataDir)).filter(name => name.endsWith('.tmp')).length, 0);
  await rm(path, { recursive: true }); await rename(backup, path);
  await f.store.applyCommand('minhle', command);
  assert.equal(f.store.publicBoard(f.boardId).notes[0].x, 100); assert.equal(seen.length, 1);
  unsubscribe(); unsubscribe();
});

test('corrupt, wrong-version and invalid-reference snapshots fail closed without overwriting', async t => {
  const f = await fixture(t); await f.store.close();
  const path = join(f.dataDir, 'notes.json'), valid = JSON.parse(await readFile(path, 'utf8'));
  const invalidReference = structuredClone(valid); invalidReference.notes[0].columnId = randomUUID();
  const invalidDedup = structuredClone(valid); invalidDedup.operations[0].result.revisions[0].revision = 'invalid';
  const cyclicLineage = structuredClone(valid); cyclicLineage.operations[0].undo.undoOf = cyclicLineage.operations[0].id;
  const futureLineage = structuredClone(valid); futureLineage.operations[0].undo.undoOf = futureLineage.operations[1].id;
  for (const bytes of ['{broken', JSON.stringify({ ...valid, formatVersion: 1 }), JSON.stringify({ ...valid, formatVersion: 999 }),
    JSON.stringify(invalidReference), JSON.stringify(invalidDedup), JSON.stringify(cyclicLineage), JSON.stringify(futureLineage)]) {
    await writeFile(path, bytes);
    await assert.rejects(createNotesStore({ dataDir: f.dataDir }));
    assert.equal(await readFile(path, 'utf8'), bytes);
  }
});

test('conditional own undo preserves peer text; stale group undo and another author are refused', async t => {
  const f = await fixture(t), columnId = randomUUID();
  await f.send('column.create', { id: columnId, name: 'Nhóm', x: 0, y: 0, width: 400, height: 500 });
  await f.send('note.move', { id: f.noteId, columnId });
  const move = f.command('column.update', { id: columnId, x: 50, y: 80 });
  await f.store.applyCommand('minhle', move);
  await f.store.applyText('haiyen', f.noteId, textUpdate('giữ chữ'), randomUUID());
  await assert.rejects(f.send('command.undo', { operationId: move.operationId }, 'haiyen'), { code: 'forbidden' });
  const undo = await f.send('command.undo', { operationId: move.operationId });
  assert.deepEqual([f.store.publicBoard(f.boardId).notes[0].x, f.store.publicBoard(f.boardId).notes[0].y], [10, 20]);
  await f.send('command.undo', { operationId: undo.operationId });
  assert.equal(f.store.publicBoard(f.boardId).notes[0].x, 60);
  await f.send('note.update', { id: f.noteId, width: 300 }, 'haiyen');
  await assert.rejects(f.send('command.undo', { operationId: move.operationId }), { code: 'undo_conflict' });
  assert.equal(f.store.publicBoard(f.boardId).notes[0].x, 60);
});

test('authorization runs in serialized mutation and tokens stay outside command fingerprint', async t => {
  const f = await fixture(t), command = f.command('note.update', { id: f.noteId, x: 100 });
  const seen = []; let allowed = false;
  const authorize = context => { seen.push(context.targets); if (!allowed) throw Object.assign(Error('Lease expired'), { code: 'lease_conflict' }); };
  await assert.rejects(f.store.applyCommand('minhle', command, { authorize }), { code: 'lease_conflict' });
  allowed = true;
  const result = await f.store.applyCommand('minhle', command, { authorize });
  assert.ok(seen[1].some(target => target.kind === 'note' && target.id === f.noteId));
  assert.deepEqual(await f.store.applyCommand('minhle', command, { authorize }), result);
});

test('only registered server assets may decorate; library removal retains references; board stickers outlive note trash but not board trash', async t => {
  const f = await fixture(t), assetId = randomUUID(), id = randomUUID();
  const payload = { id, assetId, x: 1, y: 2, width: 30, height: 40, rotation: 0, z: 1 };
  await assert.rejects(f.send('decoration.add', payload), { code: 'asset_not_found' });
  await f.store.registerAsset('minhle', { id: assetId, name: 'Hoa', mimeType: 'image/gif', fileName: `${assetId}.gif`, posterName: `${assetId}.png`, width: 30, height: 40, bytes: 123, animated: false }, randomUUID());
  await f.send('decoration.add', payload);
  assert.equal(f.store.isAssetPublic(assetId), true);
  await f.store.updateAsset('haiyen', assetId, { removed: true }, randomUUID());
  assert.equal(f.store.library().length, 0); assert.equal(f.store.isAssetPublic(assetId), true);
  assert.equal(f.store.publicBoard(f.boardId).decorations[0].boardId, f.boardId);
  await f.send('note.trash', { id: f.noteId }); assert.equal(f.store.isAssetPublic(assetId), true, 'A sticker is independent of notes');
  await f.send('board.trash', {}); assert.equal(f.store.isAssetPublic(assetId), false);
  await f.send('board.restore', {}); assert.equal(f.store.isAssetPublic(assetId), true);
  await f.reopen(); assert.equal(f.store.asset(assetId).removed, true);
});

test('dedup replays recheck queued authorization without requiring a new geometry lease', async t => {
  const f = await fixture(t), command = f.command('note.update', { id: f.noteId, x: 100 });
  const result = await f.store.applyCommand('minhle', command);
  await assert.rejects(f.store.applyCommand('minhle', command, { authorize(context) {
    assert.equal(context.replay, true); assert.deepEqual(context.targets, []);
    throw Object.assign(Error('Session expired'), { code: 'unauthorized' });
  } }), { code: 'unauthorized' });
  assert.deepEqual(await f.store.applyCommand('minhle', command, { authorize(context) {
    assert.equal(context.replay, true);
  } }), result);
});

test('undo of a created container refuses to hide children added by a peer', async t => {
  const f = await fixture(t), columnId = randomUUID();
  const created = await f.send('column.create', { id: columnId, name: 'Nhóm', x: 0, y: 0, width: 400, height: 500 });
  await f.send('note.move', { id: f.noteId, columnId }, 'haiyen');
  await assert.rejects(f.send('command.undo', { operationId: created.operationId }), { code: 'undo_conflict' });
  assert.equal(f.store.publicBoard(f.boardId).columns.length, 1);
});

test('installed Tiptap schema persists every approved list and formatting type, with concurrent Yjs edits', async t => {
  const [{ getSchema }, { default: Document }, { default: Paragraph }, { default: Text },
    { default: Bold }, { default: Italic }, { default: Underline }, { TextStyle, Color, FontSize },
    { BulletList, OrderedList, ListItem, TaskList, TaskItem }, { prosemirrorJSONToYDoc }] = await Promise.all([
    import('@tiptap/core'), import('@tiptap/extension-document'), import('@tiptap/extension-paragraph'),
    import('@tiptap/extension-text'), import('@tiptap/extension-bold'), import('@tiptap/extension-italic'),
    import('@tiptap/extension-underline'), import('@tiptap/extension-text-style'),
    import('@tiptap/extension-list'), import('@tiptap/y-tiptap'),
  ]);
  const schema = getSchema([Document, Paragraph, Text, Bold, Italic, Underline, TextStyle, Color, FontSize,
    BulletList, OrderedList, ListItem, TaskList, TaskItem]);
  const paragraph = { type: 'paragraph', content: [{ type: 'text', text: 'Việt Nam', marks: [
    { type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'textStyle', attrs: { color: '#ff00ff', fontSize: '28px' } },
  ] }] };
  const content = { type: 'doc', content: [paragraph,
    { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph] }] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [paragraph] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [paragraph] }] },
  ] };
  const a = prosemirrorJSONToYDoc(schema, content, 'body'), b = new Y.Doc();
  t.after(() => { a.destroy(); b.destroy(); });
  const f = await fixture(t), initial = Y.encodeStateAsUpdate(a);
  await f.store.applyText('minhle', f.noteId, initial, randomUUID());
  Y.applyUpdate(b, initial);
  const base = Y.encodeStateVector(a);
  a.getXmlFragment('body').get(0).get(0).insert(0, 'Minh ');
  b.getXmlFragment('body').get(0).get(0).insert(0, 'Yến ');
  await Promise.all([
    f.store.applyText('minhle', f.noteId, Y.encodeStateAsUpdate(a, base), randomUUID()),
    f.store.applyText('haiyen', f.noteId, Y.encodeStateAsUpdate(b, base), randomUUID()),
  ]);
  await f.reopen();
  const json = f.store.publicBoard(f.boardId).notes[0].content;
  assert.deepEqual(json.content.slice(1).map(node => node.type), ['bulletList', 'orderedList', 'taskList']);
  assert.equal(json.content[2].attrs.start, 3); assert.equal(json.content[3].content[0].attrs.checked, true);
  const merged = json.content[0].content.map(node => node.text).join('');
  assert.ok(merged.includes('Minh ')); assert.ok(merged.includes('Yến ')); assert.ok(merged.includes('Việt Nam'));
  assert.deepEqual(json.content[1].content[0].content[0].content[0].marks.map(mark => mark.type).sort(), ['bold', 'italic', 'textStyle', 'underline'].sort());
  assert.deepEqual(json.content[0].content.at(-1).marks.find(mark => mark.type === 'textStyle').attrs, { color: '#ff00ff', fontSize: '28px' });
  schema.nodeFromJSON(json).check();
});

test('authorization checks current state after preceding queued mutation, and close drains accepted work', async t => {
  const f = await fixture(t);
  let start, release;
  const started = new Promise(resolve => { start = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const first = f.store.applyCommand('minhle', f.command('note.update', { id: f.noteId, x: 99 }), {
    async authorize() { start(); await gate; },
  });
  await started;
  let stillValid = true;
  const second = f.store.applyCommand('haiyen', f.command('note.update', { id: f.noteId, x: 101 }, 'haiyen'), {
    authorize() {
      assert.equal(f.store.publicBoard(f.boardId).notes[0].x, 99);
      if (!stillValid) throw Object.assign(Error('Expired while queued'), { code: 'lease_conflict' });
    },
  });
  const rejected = assert.rejects(second, { code: 'lease_conflict' });
  const closing = f.store.close(); stillValid = false; release();
  await first; await rejected; await closing;
  assert.equal(f.store.publicBoard(f.boardId).notes[0].x, 99);
  await assert.rejects(f.send('note.update', { id: f.noteId, x: 200 }), { code: 'store_closed' });
});

test('a directory-sync failure after rename reconciles committed state and resolves the same retry', async t => {
  const fs = (await import('node:fs/promises')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const f = await fixture(t), originalOpen = fs.open, events = [];
  f.store.subscribe(event => events.push(event));
  const command = f.command('note.update', { id: f.noteId, x: 321 });
  let failOnce = true;
  const patched = t.mock.method(fs, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === f.dataDir && failOnce) {
      failOnce = false;
      handle.sync = async () => { throw Object.assign(Error('Injected directory sync failure'), { code: 'EIO' }); };
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.store.applyCommand('minhle', command), { code: 'durability_uncertain' });
    assert.equal(f.store.publicBoard(f.boardId).notes[0].x, 321, 'Live state reconciles the completed rename');
    assert.equal(events.length, 0, 'No successful commit event was emitted before directory sync');
    const disk = JSON.parse(await readFile(join(f.dataDir, 'notes.json'), 'utf8'));
    assert.equal(disk.operations.filter(operation => operation.id === command.operationId).length, 1);
    const result = await f.store.applyCommand('minhle', command);
    assert.equal(result.operationId, command.operationId);
    assert.equal(events.length, 1); assert.equal(events[0].type, 'refresh');
    await f.reopen();
    assert.deepEqual(await f.store.applyCommand('minhle', command), result);
  } finally { patched.mock.restore(); syncBuiltinESMExports(); }
});

for (const grouped of [false, true]) {
  test(`successive own undo/redo preserves history and dedup after restart (${grouped ? 'column group' : 'note'})`, async t => {
    const f = await fixture(t);
    const id = grouped ? randomUUID() : f.noteId, type = grouped ? 'column.update' : 'note.update';
    if (grouped) {
      await f.send('column.create', { id, name: 'Nhóm', x: 0, y: 0, width: 400, height: 500 });
      await f.send('note.move', { id: f.noteId, columnId: id });
    }
    const x = () => f.store.entity(grouped ? 'column' : 'note', id).x;
    const initialX = x(), initialNoteX = f.store.entity('note', f.noteId).x;
    const aCommand = f.command(type, { id, x: initialX + 10 });
    const aResult = await f.store.applyCommand('minhle', aCommand);
    const bCommand = f.command(type, { id, x: initialX + 20 });
    const bResult = await f.store.applyCommand('minhle', bCommand);
    let a = aResult, b = bResult;
    const undo = operation => f.send('command.undo', { operationId: operation.operationId });
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const undoB = await undo(b); assert.equal(x(), initialX + 10);
      await f.reopen();
      const undoA = await undo(a); assert.equal(x(), initialX);
      assert.equal(f.store.entity('note', f.noteId).x, initialNoteX);
      await f.reopen();
      a = await undo(undoA); assert.equal(x(), initialX + 10);
      b = await undo(undoB); assert.equal(x(), initialX + 20);
      assert.equal(f.store.entity('note', f.noteId).x, initialNoteX + 20);
    }
    assert.deepEqual(await f.store.applyCommand('minhle', aCommand), aResult);
    assert.deepEqual(await f.store.applyCommand('minhle', bCommand), bResult);
    const beforePeer = f.store.entity('note', f.noteId).x;
    await f.send('note.update', { id: f.noteId, width: 300 }, 'haiyen');
    await assert.rejects(undo(b), { code: 'undo_conflict' });
    assert.equal(x(), initialX + 20);
    assert.equal(f.store.entity('note', f.noteId).x, beforePeer);
  });
}

test('undo lineage rejects normal lookalike writes and cannot cross a reverted peer change', async t => {
  const f = await fixture(t);
  const a = await f.send('note.update', { id: f.noteId, x: 20 });
  await f.send('note.update', { id: f.noteId, x: 30 });
  await f.send('note.update', { id: f.noteId, x: 20 });
  await assert.rejects(f.send('command.undo', { operationId: a.operationId }), { code: 'undo_conflict' });
  const own = await f.send('note.update', { id: f.noteId, x: 40 });
  const peer = await f.send('note.update', { id: f.noteId, x: 50 }, 'haiyen');
  await f.send('command.undo', { operationId: peer.operationId }, 'haiyen');
  assert.equal(f.store.entity('note', f.noteId).x, 40);
  await assert.rejects(f.send('command.undo', { operationId: own.operationId }), { code: 'undo_conflict' });
});

test('loading rejects a backward undo link that does not describe its saved inverse', async t => {
  const f = await fixture(t);
  await f.send('note.update', { id: f.noteId, x: 10 });
  const b = await f.send('note.update', { id: f.noteId, x: 20 });
  const c = await f.send('note.update', { id: f.noteId, x: 30 });
  await f.store.close();
  const path = join(f.dataDir, 'notes.json'), snapshot = JSON.parse(await readFile(path, 'utf8'));
  snapshot.operations.find(operation => operation.id === c.operationId).undo.undoOf = b.operationId;
  const bytes = JSON.stringify(snapshot);
  await writeFile(path, bytes);
  await assert.rejects(createNotesStore({ dataDir: f.dataDir }), { code: 'storage_unavailable' });
  assert.equal(await readFile(path, 'utf8'), bytes);
});

for (const reuseOldRedo of [false, true]) test(`restarted inverse history preserves every entity kind (${reuseOldRedo ? 'older redo after repeated creation undo' : 'fresh inverses'})`, async t => {
  const f = await fixture(t), assetId = randomUUID();
  await f.store.registerAsset('minhle', { id: assetId, name: 'Hoa', mimeType: 'image/gif', fileName: `${assetId}.gif`, posterName: `${assetId}.png`, width: 30, height: 40, bytes: 123, animated: false }, randomUUID());
  const cases = [
    ['board', randomUUID(), 'board.create', { name: 'New', visibility: 'public' }],
    ['column', randomUUID(), 'column.create', { name: 'New', x: 0, y: 0, width: 400, height: 500 }],
    ['note', randomUUID(), 'note.create', { columnId: null, x: 0, y: 0, width: 200, height: 250, color: '#ffffff' }],
    ['decoration', randomUUID(), 'decoration.add', { assetId, x: 0, y: 0, width: 30, height: 40, rotation: 0, z: 1 }],
  ];
  for (const [kind, id, type, fields] of cases) {
    const boardId = kind === 'board' ? id : f.boardId;
    const send = (commandType, payload) => f.store.applyCommand('minhle', { ...f.command(commandType, payload), boardId,
      baseRevision: f.store.privateBoard(boardId)?.revision ?? 0 });
    const created = await send(type, { ...fields, ...(kind === 'board' ? {} : { id }) });
    const undoCreate = await send('command.undo', { operationId: created.operationId });
    const firstTombstone = f.store.entity(kind, id).deletedAt;
    await f.reopen();
    assert.notEqual(f.store.entity(kind, id).deletedAt, null);
    await send('command.undo', { operationId: undoCreate.operationId });
    await f.reopen(); assert.equal(f.store.entity(kind, id).deletedAt, null);
    if (reuseOldRedo) {
      await new Promise(resolve => setTimeout(resolve, 5));
      await send('command.undo', { operationId: created.operationId });
      assert.notEqual(f.store.entity(kind, id).deletedAt, firstTombstone);
      const redoCommand = { ...f.command('command.undo', { operationId: undoCreate.operationId }), boardId,
        baseRevision: f.store.privateBoard(boardId).revision };
      const redoResult = await f.store.applyCommand('minhle', redoCommand);
      assert.equal(f.store.entity(kind, id).deletedAt, null);
      await f.reopen();
      assert.equal(f.store.entity(kind, id).deletedAt, null);
      assert.deepEqual(await f.store.applyCommand('minhle', redoCommand), redoResult);
    }
    const removed = await send(`${kind}.${kind === 'decoration' ? 'remove' : 'trash'}`, kind === 'board' ? {} : { id });
    const restored = await send('command.undo', { operationId: removed.operationId });
    await f.reopen(); assert.equal(f.store.entity(kind, id).deletedAt, null);
    await send('command.undo', { operationId: restored.operationId });
    await f.reopen(); assert.notEqual(f.store.entity(kind, id).deletedAt, null);
  }
});


test('inverse validation retains tombstone status, timestamp syntax and other metadata checks', async t => {
  const f = await fixture(t), noteId = randomUUID();
  const created = await f.send('note.create', { id: noteId, columnId: null, x: 0, y: 0, width: 200, height: 250, color: '#ffffff' });
  const undone = await f.send('command.undo', { operationId: created.operationId });
  await f.store.close();
  const path = join(f.dataDir, 'notes.json'), original = JSON.parse(await readFile(path, 'utf8'));
  for (const patch of [{ deletedAt: 'invalid timestamp' }, { deletedAt: null }, { color: '#000000' }]) {
    const invalid = structuredClone(original);
    Object.assign(invalid.operations.find(operation => operation.id === undone.operationId).undo.changes[0].after, patch);
    const bytes = JSON.stringify(invalid); await writeFile(path, bytes);
    await assert.rejects(createNotesStore({ dataDir: f.dataDir }), { code: 'storage_unavailable' });
    assert.equal(await readFile(path, 'utf8'), bytes);
  }
});

test('stickers follow the note or column they are attached to; free stickers stay put; trash follows attachment', async t => {
  const f = await fixture(t), assetId = randomUUID(), columnId = randomUUID(), [onNote, onColumn, free] = [randomUUID(), randomUUID(), randomUUID()];
  await f.store.registerAsset('minhle', { id: assetId, name: 'Hoa', mimeType: 'image/gif', fileName: `${assetId}.gif`, posterName: `${assetId}.png`, width: 30, height: 40, bytes: 123, animated: false }, randomUUID());
  await f.send('column.create', { id: columnId, name: 'Cột', x: 1000, y: 0, width: 400, height: 600 });
  const sticker = (id, extra) => f.send('decoration.add', { id, assetId, x: 50, y: 60, width: 30, height: 40, rotation: 0, z: 1, ...extra });
  await sticker(onNote, { noteId: f.noteId }); await sticker(onColumn, { columnId }); await sticker(free, {});
  await assert.rejects(sticker(randomUUID(), { noteId: f.noteId, columnId }), { code: 'invalid_fields' });
  const at = id => { const d = f.store.privateBoard(f.boardId).decorations.find(d => d.id === id); return [d.x, d.y]; };
  await f.send('note.update', { id: f.noteId, x: 110, y: 120 });
  assert.deepEqual([at(onNote), at(onColumn), at(free)], [[150, 160], [50, 60], [50, 60]], 'Only the note sticker moves with the note (+100,+100)');
  await f.send('note.move', { id: f.noteId, columnId, x: 1010, y: 20 });
  assert.deepEqual(at(onNote), [1050, 60], 'Moving the note into a column carries its sticker');
  await f.send('column.update', { id: columnId, x: 1100 });
  assert.deepEqual([at(onNote), at(onColumn), at(free)], [[1150, 60], [150, 60], [50, 60]], 'A column move carries its own and its notes\' stickers');
  await f.send('decoration.update', { id: free, noteId: f.noteId });
  await assert.rejects(f.send('decoration.update', { id: free, noteId: f.noteId, columnId }), { code: 'invalid_fields' });
  const visible = () => f.store.publicBoard(f.boardId).decorations.map(d => d.id).sort();
  await f.send('note.trash', { id: f.noteId });
  assert.deepEqual(visible(), [onColumn], 'Stickers on a trashed note hide with it');
  await f.send('note.restore', { id: f.noteId });
  assert.deepEqual(visible(), [onNote, onColumn, free].sort());
  await f.reopen();
  assert.deepEqual(at(onNote), [1150, 60]);
});

for (const version of [2, 3]) test(`format ${version} stickers migrate to format 4 board stickers that follow their note`, async t => {
  const f = await fixture(t), assetId = randomUUID(), [onNote, outside] = [randomUUID(), randomUUID()];
  await f.store.registerAsset('minhle', { id: assetId, name: 'Hoa', mimeType: 'image/gif', fileName: `${assetId}.gif`, posterName: `${assetId}.png`, width: 30, height: 40, bytes: 123, animated: false }, randomUUID());
  for (const id of [onNote, outside]) await f.send('decoration.add', { id, assetId, x: 0, y: 0, width: 30, height: 40, rotation: 0, z: 1 });
  await f.store.close();
  // Rewrite the saved snapshot into the older shape. The note sits at (10,20) and is 240x280.
  const path = join(f.dataDir, 'notes.json'), saved = JSON.parse(await readFile(path, 'utf8'));
  saved.formatVersion = version;
  saved.boards = saved.boards.map(({ authorId, visibility, ...board }) => board);
  saved.notes = saved.notes.map(({ visibility, labels, ...note }) => note);
  saved.decorations = saved.decorations.map(({ boardId, noteId, columnId, ...d }) => version === 2
    ? { ...d, noteId: f.noteId, x: 5, y: 6 }
    : { ...d, boardId, x: d.id === onNote ? 15 : 900, y: d.id === onNote ? 26 : 900 });
  for (const op of saved.operations) if (op.undo) op.undo = null;
  await writeFile(path, JSON.stringify(saved));
  const store = await f.reopen(), pick = id => store.privateBoard(f.boardId).decorations.find(d => d.id === id);
  assert.deepEqual([pick(onNote).boardId, pick(onNote).noteId, pick(onNote).x, pick(onNote).y], [f.boardId, f.noteId, 15, 26], 'On the note at the same visible spot, attached to it');
  assert.equal(pick(outside).noteId, version === 2 ? f.noteId : null, 'v3 attaches only stickers whose centre lies on a note');
  await f.send('note.update', { id: f.noteId, x: 30 });
  assert.equal(pick(onNote).x, 35, 'The migrated sticker follows its note');
  assert.equal(JSON.parse(await readFile(path, 'utf8')).formatVersion, 6);
});

test('format 4 boards migrate to public boards authored by their creator; notes follow the board without labels', async t => {
  const f = await fixture(t);
  await f.store.close();
  const path = join(f.dataDir, 'notes.json'), saved = JSON.parse(await readFile(path, 'utf8'));
  saved.formatVersion = 4;
  saved.boards = saved.boards.map(({ authorId, visibility, ...board }) => board);
  saved.notes = saved.notes.map(({ visibility, labels, ...note }) => note);
  await writeFile(path, JSON.stringify(saved));
  const store = await f.reopen(), board = store.publicBoard(f.boardId);
  assert.deepEqual([board.authorId, board.visibility, board.notes[0].visibility, board.notes[0].labels], ['minhle', 'public', null, []]);
});

test('format 5 snapshots migrate to format 6 without journal or memory, and keep their undo history', async t => {
  const f = await fixture(t), moved = await f.send('note.update', { id: f.noteId, x: 40 });
  await f.store.close();
  const path = join(f.dataDir, 'notes.json'), saved = JSON.parse(await readFile(path, 'utf8'));
  const strip = ({ noteDefault, memoryDate, garden, gardenFlower, ...record }) => record;
  saved.formatVersion = 5;
  saved.boards = saved.boards.map(strip); saved.notes = saved.notes.map(strip);
  for (const change of saved.operations.flatMap(op => op.undo?.changes ?? [])) {
    change.after = strip(change.after); if (change.before) change.before = strip(change.before);
  }
  await writeFile(path, JSON.stringify(saved));
  const store = await f.reopen(), board = store.privateBoard(f.boardId);
  assert.deepEqual([board.noteDefault, board.notes[0].memoryDate, board.notes[0].garden, board.notes[0].gardenFlower], [null, null, false, null]);
  await f.send('command.undo', { operationId: moved.operationId });
  assert.equal(store.privateBoard(f.boardId).notes[0].x, 10, 'Undo recorded before the migration still works');
  assert.equal(JSON.parse(await readFile(path, 'utf8')).formatVersion, 6);
});

test('format 6 snapshots written before gardenFlower existed load with gardenFlower null', async t => {
  const f = await fixture(t), moved = await f.send('note.update', { id: f.noteId, x: 40 });
  await f.store.close();
  const path = join(f.dataDir, 'notes.json'), saved = JSON.parse(await readFile(path, 'utf8'));
  const strip = ({ gardenFlower, ...record }) => record;
  saved.notes = saved.notes.map(strip);
  for (const change of saved.operations.flatMap(op => op.undo?.changes ?? [])) if (change.kind === 'note') {
    change.after = strip(change.after); if (change.before) change.before = strip(change.before);
  }
  await writeFile(path, JSON.stringify(saved));
  const store = await f.reopen();
  assert.equal(store.privateBoard(f.boardId).notes[0].gardenFlower, null);
  await f.send('command.undo', { operationId: moved.operationId });
  assert.equal(store.privateBoard(f.boardId).notes[0].x, 10, 'Undo still works');
});
