import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNotesStore } from '../backend/notes-store.js';

globalThis.location = { hostname: 'fixture.test' };
const { Y } = await import('../assets/vendor/notes.js');
const { openBoardClient, subscribeBoards } = await import('../js/notes/client.js').catch(() => ({}));
const waitFor = async predicate => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Client did not reach expected state'); };
const newText = text => { const doc = new Y.Doc(); const p = new Y.XmlElement('paragraph'), t = new Y.XmlText(); t.insert(0, text); p.insert(0, [t]); doc.getXmlFragment('body').insert(0, [p]); const update = Y.encodeStateAsUpdate(doc); doc.destroy(); return update; };

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'homie-client-unit-'));
  const store = await createNotesStore({ dataDir: dir });
  const boardId = randomUUID(), noteId = randomUUID();
  const envelope = (type, payload, accountId = 'minhle') => ({ operationId: randomUUID(), accountId, boardId, baseRevision: 0, type, payload });
  await store.applyCommand('minhle', envelope('board.create', { name: 'Chung' }));
  await store.applyCommand('minhle', envelope('note.create', { id: noteId, columnId: null, x: 0, y: 0, width: 240, height: 200, color: '#fff0ee' }));
  let current = 'minhle', generation = 0, connected = true, loseAck = false, quota = false, held = false, presenceInvalid = false;
  const events = new Set(), streams = new Set(), records = new Map(), notes = new Map(), sent = [], order = [];
  const session = { account: () => current, generation: () => generation, subscribe(fn) { events.add(fn); return () => events.delete(fn); } };
  const storage = { async load(key) { return structuredClone(records.get(key) || { queue: [], snapshot: null }); },
    async update(key, fn) { if (quota) throw new Error('QuotaExceededError'); const value = fn(structuredClone(records.get(key) || { queue: [], snapshot: null })); records.set(key, structuredClone(value)); return value; },
    async loadNote(key, doc) { if (notes.has(key)) Y.applyUpdate(doc, notes.get(key), 'cache'); },
    async saveNote(key, doc) { if (quota) throw new Error('QuotaExceededError'); notes.set(key, Y.encodeStateAsUpdate(doc)); } };
  const emit = (name, data) => { for (const s of streams) s.onEvent(name, data); };
  const publishSnapshot = s => s.onEvent('snapshot', { boardId, board: store.publicBoard(boardId), revision: store.privateBoard(boardId).revision, collaboration: true });
  const transport = { stream(path, handlers) { order.push('stream'); streams.add(handlers); if (connected) queueMicrotask(() => { if (streams.has(handlers)) publishSnapshot(handlers); }); else queueMicrotask(handlers.onError); return () => streams.delete(handlers); },
    async request(path, { method = 'GET', body } = {}) {
      order.push(path); if (!connected) throw new TypeError('offline');
      if (method !== 'GET') { sent.push({ path, body: structuredClone(body) }); if (!current) throw Object.assign(Error('unauthorized'), { status: 401, code: 'unauthorized' }); assert.equal(body.accountId || body.command.accountId, current); }
      if (path.endsWith('/collaboration')) return { board: store.privateBoard(boardId) };
      if (path === '/api/boards' || path === '/api/boards/trash') return { boards: store.list({ includeDeleted: path.endsWith('trash') }) };
      if (path.endsWith('/leases')) { if (held) throw Object.assign(Error('peer held'), { code: 'lease_conflict', status: 409 }); return { leaseToken: 'a'.repeat(64), expiresAt: Date.now() + 10000, released: true }; }
      if (path.endsWith('/presence')) { if (presenceInvalid) { presenceInvalid = false; throw Object.assign(Error('invalid'), { code: 'invalid_presence', status: 400 }); } return { expiresAt: Date.now() + 15000 }; }
      if (path === '/api/boards/commands') { const result = await store.applyCommand(current, body.command); if (loseAck) { loseAck = false; throw new TypeError('ACK lost'); } return result; }
      if (path.endsWith('/text')) { const result = await store.applyText(current, noteId, Uint8Array.from(Buffer.from(body.update, 'base64')), body.operationId); if (loseAck) { loseAck = false; throw new TypeError('ACK lost'); } return result; }
      return { board: store.publicBoard(boardId) };
    } };
  const clients = [];
  const open = async (accountId = 'minhle', extra = {}) => { assert.equal(typeof openBoardClient, 'function', 'Task4 must export openBoardClient'); const c = await openBoardClient({ boardId, accountId, transport, storage, session, ...extra }); clients.push(c); if (connected) await waitFor(() => c.getState().connection === 'online'); return c; };
  t.after(async () => { await Promise.all(clients.map(c => c.close())); await store.close(); await rm(dir, { recursive: true, force: true }); });
  return { boardId, noteId, store, envelope, storage, transport, session, sent, order, open, emit,
    disconnect() { connected = false; streams.forEach(s => s.onError()); }, reconnect() { connected = true; streams.forEach(publishSnapshot); },
    auth(account) { current = account; generation++; events.forEach(fn => fn()); }, loseAck() { loseAck = true; }, quota(value) { quota = value; }, held(value) { held = value; }, invalidPresence() { presenceInvalid = true; } };
}

test('stream precedes snapshot and offline edits survive close and same-account ACK', async t => {
  const f = await fixture(t), a = await f.open();
  assert.equal(f.order[0], 'stream');
  f.disconnect(); await a.applyText(f.noteId, newText('Bản nháp')); await a.flush();
  assert.equal(a.getState().durability, 'local'); assert.equal(a.getState().pending.text, 1);
  await a.close(); const b = await f.open();
  const doc = await b.getDocument(f.noteId); assert.match(doc.getXmlFragment('body').toString(), /Bản nháp/);
  f.reconnect(); await waitFor(() => b.getState().pending.total === 0);
  assert.equal(b.getState().durability, 'saved'); assert.match(JSON.stringify(f.store.publicBoard(f.boardId)), /Bản nháp/);
});

test('lost ACK retry retains operation ID and cannot duplicate text', async t => {
  const f = await fixture(t), c = await f.open(); f.loseAck();
  await c.applyText(f.noteId, newText('Một lần')); await c.flush();
  await c.reconnect(); await waitFor(() => c.getState().pending.total === 0);
  const texts = f.sent.filter(s => s.path.endsWith('/text'));
  assert.ok(texts.length >= 2); assert.equal(texts[0].body.operationId, texts[1].body.operationId);
  assert.equal(f.store.publicBoard(f.boardId).notes[0].content.content[0].content[0].text, 'Một lần');
});

test('logout hides private cached tombstones and another account never sends retained queue', async t => {
  const f = await fixture(t), c = await f.open(); f.disconnect();
  await c.command(f.envelope('note.update', { id: f.noteId, color: '#aaaaaa' }));
  f.auth(null); assert.equal(c.getState().writable, false); assert.equal(c.getState().snapshot, null);
  await assert.rejects(c.command(f.envelope('board.rename', { name: 'deny' })), /auth|account/i);
  f.auth('haiyen'); f.reconnect(); const yen = await f.open('haiyen'); await yen.flush();
  assert.equal(f.sent.filter(s => s.path === '/api/boards/commands').length, 0);
  f.auth('minhle'); await c.reconnect(); await waitFor(() => c.getState().pending.total === 0);
  assert.equal(f.store.publicBoard(f.boardId).notes[0].color, '#aaaaaa');
});

test('401 retains drafts while a stale private snapshot cannot repopulate public mode', async t => {
  const f = await fixture(t); let resolveRead;
  const original = f.transport.request; let block = false;
  f.transport.request = (path, options) => block && path.endsWith('/collaboration') ? new Promise(r => { resolveRead = r; }) : original(path, options);
  const c = await f.open(); f.disconnect(); await c.applyText(f.noteId, newText('Giữ')); block = true; f.reconnect();
  await waitFor(() => resolveRead); const stale = f.store.privateBoard(f.boardId); f.auth(null); resolveRead({ board: stale });
  await new Promise(r => setTimeout(r, 15)); assert.equal(c.getState().writable, false); assert.ok(!c.getState().snapshot?.texts); assert.equal(c.getState().pending.text, 1);
});

test('quota failure reports unsaved and retry flush persists the retained edit', async t => {
  const f = await fixture(t), c = await f.open(); f.disconnect(); f.quota(true);
  await assert.rejects(c.applyText(f.noteId, newText('Chưa lưu')), /Quota/);
  assert.equal(c.getState().durability, 'unsaved'); f.quota(false); await c.flush();
  assert.equal(c.getState().durability, 'local'); await c.close();
  const again = await f.open(); assert.match((await again.getDocument(f.noteId)).getXmlFragment('body').toString(), /Chưa lưu/);
});

test('geometry reconnect acquires fresh lease and defers a peer-held target', async t => {
  const f = await fixture(t), c = await f.open(); await c.acquireLease({ kind: 'note', id: f.noteId }); f.disconnect();
  await c.command(f.envelope('note.move', { id: f.noteId, x: 80, y: 20 })); f.held(true); f.reconnect(); await waitFor(() => c.getState().connection === 'online');
  await c.flush(); assert.equal(f.store.publicBoard(f.boardId).notes[0].x, 0); assert.equal(c.getState().pending.commands, 1);
  f.held(false); await c.flush(); assert.equal(f.store.publicBoard(f.boardId).notes[0].x, 80);
  assert.ok(f.sent.filter(s => s.path.endsWith('/leases') && s.body.action === 'acquire').length >= 3);
});

test('remote deletion retains offline text without resurrection or public reseeding', async t => {
  const f = await fixture(t), c = await f.open(); const doc = await c.getDocument(f.noteId); f.disconnect();
  await c.applyText(f.noteId, newText('Bị ẩn')); await f.store.applyCommand('haiyen', f.envelope('note.trash', { id: f.noteId }, 'haiyen'));
  f.reconnect(); await waitFor(() => c.getState().pending.total === 0);
  assert.equal(f.store.publicBoard(f.boardId).notes.length, 0); assert.match(doc.getXmlFragment('body').toString(), /Bị ẩn/);
  assert.ok(f.store.privateBoard(f.boardId).notes[0].deletedAt);
});

test('presence flushes text structs before caret, retries invalid_presence, and logout stops timers', async t => {
  const f = await fixture(t), c = await f.open(); const doc = await c.getDocument(f.noteId); f.disconnect();
  await c.applyText(f.noteId, newText('Con trỏ')); const root = doc.getXmlFragment('body').get(0).get(0);
  const pos = Y.createRelativePositionFromTypeIndex(root, 1);
  f.invalidPresence(); f.reconnect(); await waitFor(() => c.getState().connection === 'online');
  await c.publishPresence({ pointer: { x: 3, y: 4 }, editors: [{ noteId: f.noteId, yClientId: doc.clientID, anchor: pos, head: pos }] });
  const textIndex = f.sent.findIndex(s => s.path.endsWith('/text')), presenceIndex = f.sent.findIndex(s => s.path.endsWith('/presence'));
  assert.ok(textIndex >= 0 && presenceIndex > textIndex); assert.ok(f.sent.filter(s => s.path.endsWith('/presence')).length >= 2);
  f.auth(null); await assert.rejects(c.publishPresence({ pointer: null, editors: [] }), /auth|account/i);
});

test('own-tab undo guards peer operation and redo targets accepted inverse', async t => {
  const f = await fixture(t), c = await f.open(); const peer = await f.store.applyCommand('minhle', f.envelope('board.rename', { name: 'Peer tab' }));
  await assert.rejects(c.command(f.envelope('command.undo', { operationId: peer.operationId })), /history|undo/i);
  await c.command(f.envelope('board.rename', { name: 'Own tab' })); await c.undo(); assert.equal(f.store.publicBoard(f.boardId).name, 'Peer tab');
  await c.redo(); assert.equal(f.store.publicBoard(f.boardId).name, 'Own tab');
});

test('catalog refresh and trash discovery use their public and authenticated contracts', async t => {
  const f = await fixture(t), c = await f.open(); let catalog;
  const cleanup = subscribeBoards({ transport: f.transport }, value => { catalog = value.boards; });
  f.emit('boards-refresh', {}); await waitFor(() => catalog); assert.equal(catalog[0].id, f.boardId); cleanup();
  await c.command(f.envelope('board.trash', {})); assert.equal((await c.listTrash())[0].id, f.boardId);
});

test('401 on a live-account send retains its queue until a new same-account generation', async t => {
  const f = await fixture(t), c = await f.open(); const original = f.transport.request;
  let deny = true;
  f.transport.request = (path, options) => deny && path.endsWith('/text') ? Promise.reject(Object.assign(Error('expired'), {status:401,code:'unauthorized'})) : original(path, options);
  await c.applyText(f.noteId, newText('Phiên cũ')); assert.equal(c.getState().writable, false); assert.equal(c.getState().pending.text, 1);
  deny = false; await c.flush(); assert.equal(c.getState().pending.text, 1);
  f.auth('minhle'); await waitFor(() => c.getState().pending.total === 0); assert.match(JSON.stringify(f.store.publicBoard(f.boardId)), /Phiên cũ/);
});

test('refresh while an older snapshot is in flight fetches the subsequent commit', async t => {
  const f = await fixture(t), c = await f.open(); const original = f.transport.request;
  const older = f.store.privateBoard(f.boardId); let finish, first = true;
  f.transport.request = (path, options) => path.endsWith('/collaboration') && first ? (first=false,new Promise(r => {finish=r;})) : original(path, options);
  f.emit('refresh', {boardId:f.boardId,revision:older.revision}); await waitFor(() => finish);
  await f.store.applyCommand('haiyen', f.envelope('board.rename', {name:'Commit giữa GET'}, 'haiyen'));
  f.emit('refresh', {boardId:f.boardId,revision:older.revision+1}); finish({board:older});
  await waitFor(() => c.getState().snapshot?.name === 'Commit giữa GET');
});

test('document edits remain observable after reconnect and foreign-tab replay is excluded from history', async t => {
  const f = await fixture(t), a = await f.open(); const doc = await a.getDocument(f.noteId); f.disconnect();
  await a.command(f.envelope('board.rename', {name:'Tab A'})); const b = await f.open(); f.reconnect(); await waitFor(() => b.getState().connection === 'online'); await b.flush();
  assert.equal(b.getState().history.canUndo, false);
  await a.reconnect(); await waitFor(() => a.getState().connection === 'online'); f.disconnect();
  const p=new Y.XmlElement('paragraph'), text=new Y.XmlText();text.insert(0,'Sau reconnect');p.insert(0,[text]);doc.getXmlFragment('body').insert(0,[p]);
  await a.flush(); assert.equal(a.getState().pending.text, 1);
});

test('uploads persist as isolated blobs, reject over 50 MiB, and stop at logout', async t => {
  const f=await fixture(t), c=await f.open();f.disconnect();
  await c.queueUpload({path:'/api/assets',file:new Blob(['preview'],{type:'image/png'}),name:'fixture.png'});
  assert.equal(c.getState().pending.uploads,1);
  await assert.rejects(c.queueUpload({file:new Blob([new Uint8Array(50*1024*1024+1)])}), /invalid_upload/);
  f.auth('haiyen');f.reconnect();const yen=await f.open('haiyen');await yen.flush();assert.equal(f.sent.filter(s=>s.path==='/api/assets').length,0);
});


test('a rejected deleted geometry command cannot prevent retained text committing under trash', async t => {
  const f=await fixture(t), c=await f.open();f.disconnect();
  await c.command(f.envelope('note.move',{id:f.noteId,x:40}));await c.applyText(f.noteId,newText('Text dưới trash'));
  await f.store.applyCommand('haiyen',f.envelope('note.trash',{id:f.noteId},'haiyen'));f.reconnect();await waitFor(()=>c.getState().connection==='online');await c.flush();
  assert.equal(c.getState().pending.text,0);assert.equal(c.getState().pending.commands,1);assert.match(JSON.stringify(f.store.privateBoard(f.boardId).texts),/./);
  assert.equal(f.store.publicBoard(f.boardId).notes.length,0);
});

test('post-ACK command retry compares immutable content and survives same-account reload', async t => {
  const f=await fixture(t), c=await f.open();
  const request=f.envelope('board.rename',{name:'First'});const accepted=await c.command(request);
  assert.deepEqual(await c.command(structuredClone(request)),accepted);
  await assert.rejects(c.command({...request,payload:{name:'Different'}}),{code:'operation_conflict'});
  assert.equal(f.store.publicBoard(f.boardId).name,'First');
  await c.close();const reloaded=await f.open();
  assert.deepEqual(await reloaded.command(structuredClone(request)),accepted);
  await assert.rejects(reloaded.command({...request,payload:{name:'Different'}}),{code:'operation_conflict'});
  assert.equal(f.sent.filter(s=>s.path==='/api/boards/commands').length,1);
});

test('matching shorthand ACK retry reuses its original default revision', async t => {
  const f=await fixture(t), c=await f.open();const request={operationId:randomUUID(),type:'board.rename',payload:{name:'Shorthand'}};
  const accepted=await c.command(request);assert.deepEqual(await c.command(request),accepted);
  await assert.rejects(c.command({...request,baseRevision:0}),{code:'operation_conflict'});
});

test('post-ACK upload retry binds digest, path, name, fields and MIME to the originating account', async t => {
  const f=await fixture(t), c=await f.open();const original=f.transport.request;let uploads=0;
  f.transport.request=(path,options)=>options?.rawBody instanceof FormData ? (uploads++,Promise.resolve({operationId:options.rawBody.get('operationId'),accountId:options.rawBody.get('accountId'),assetId:randomUUID()})) : original(path,options);
  const request={operationId:randomUUID(),path:'/api/assets',name:'fixture.png',fields:{rows:'1'},file:new Blob(['first'],{type:'image/png'})};
  const accepted=await c.queueUpload(request);assert.deepEqual(await c.queueUpload({...request,file:new Blob(['first'],{type:'image/png'})}),accepted);
  for(const change of [{file:new Blob(['different'],{type:'image/png'})},{path:'/api/other-assets'},{name:'different.png'},{fields:{rows:'2'}},{file:new Blob(['first'],{type:'image/gif'})}]) {
    await assert.rejects(c.queueUpload({...request,...change}),{code:'operation_conflict'});
  }
  assert.equal(uploads,1);f.auth('haiyen');const yen=await f.open('haiyen');
  assert.equal((await yen.queueUpload(request)).accountId,'haiyen');assert.equal(uploads,2);
});

for(const helper of ['authenticatedRequest','listTrash','acquireLease','renewLease','releaseLease']) {
  test(`${helper} 401 centrally clears private state and retains originating pending drafts`,async t=>{
    const f=await fixture(t), c=await f.open(), original=f.transport.request;f.disconnect();
    await c.applyText(f.noteId,newText('Private draft'));let rejectPending;
    const heldTransport=(path,options)=>path.endsWith('/text')?new Promise((resolve,reject)=>{rejectPending=reject;}):original(path,options);
    f.transport.request=heldTransport;f.reconnect();await waitFor(()=>c.getState().connection==='online'&&rejectPending);
    if(helper==='renewLease'||helper==='releaseLease')await c.acquireLease({kind:'note',id:f.noteId});
    f.transport.request=(path,options)=>path.endsWith('/leases')||path.endsWith('/trash')||path==='/api/helper-private' ? Promise.reject(Object.assign(Error('expired'),{status:401,code:'unauthorized'})):heldTransport(path,options);
    const action=helper==='authenticatedRequest'?()=>c.authenticatedRequest('/api/helper-private'):helper==='listTrash'?()=>c.listTrash():()=>c[helper]({kind:'note',id:f.noteId});
    await assert.rejects(action(),{status:401});assert.equal(c.getState().writable,false);assert.ok(!c.getState().snapshot?.texts);
    assert.equal(c.getState().pending.text,1);assert.throws(()=>c.getPending(),/auth|account/i);
    rejectPending(Error('late transport failure'));
  });
}

test('late 401 from a superseded auth generation cannot expire the new same-account client',async t=>{
  const f=await fixture(t), c=await f.open();const original=f.transport.request;let rejectOld;
  f.transport.request=(path,options)=>path==='/api/helper-private'?new Promise((resolve,reject)=>{rejectOld=reject;}):original(path,options);
  const old=c.authenticatedRequest('/api/helper-private');const rejected=assert.rejects(old,{code:'stale_client'});
  await waitFor(()=>rejectOld);f.auth('minhle');await waitFor(()=>c.getState().connection==='online');
  rejectOld(Object.assign(Error('old expired response'),{status:401,code:'unauthorized'}));await rejected;
  assert.equal(c.getState().writable,true);assert.ok(c.getState().snapshot.texts);
});

test('offline cache-only open with empty queue remains unknown until server confirmation',async t=>{
  const f=await fixture(t), c=await f.open();await c.close();f.disconnect();const offline=await f.open();
  assert.equal(offline.getState().pending.total,0);assert.ok(offline.getState().snapshot);assert.equal(offline.getState().durability,'unknown');
  await offline.flush();assert.equal(offline.getState().durability,'unknown');f.reconnect();await waitFor(()=>offline.getState().connection==='online');
  assert.equal(offline.getState().durability,'saved');
});

test('late presence 401 cannot expire a superseding same-account session through caller error handling',async t=>{
  const f=await fixture(t), c=await f.open(), original=f.transport.request;let rejectOld;
  f.transport.request=(path,options)=>path.endsWith('/presence')?new Promise((resolve,reject)=>{rejectOld=reject;}):original(path,options);
  const old=c.publishPresence({pointer:null,editors:[]}).catch(error=>error);
  await waitFor(()=>rejectOld);f.auth('minhle');await waitFor(()=>c.getState().connection==='online');
  rejectOld(Object.assign(Error('superseded presence response'),{status:401,code:'unauthorized'}));await old;
  assert.equal(c.getState().writable,true);assert.ok(c.getState().snapshot.texts);
});

test('a receipt committed by another client cannot ACK a conflicting queued request',async t=>{
  const f=await fixture(t), a=await f.open(), b=await f.open();const request=f.envelope('board.rename',{name:'First client'});
  await a.command(request);
  await assert.rejects(b.command({...request,payload:{name:'Conflicting other client'}}),{code:'operation_conflict'});
  assert.equal(f.store.publicBoard(f.boardId).name,'First client');assert.equal(f.sent.filter(s=>s.path==='/api/boards/commands').length,1);
});

async function conflictingOfflineCommand(t) {
  const f=await fixture(t), a=await f.open(), b=await f.open();const request=f.envelope('board.rename',{name:'ACKed content'});
  await a.command(request);f.disconnect();
  try { await b.command({...request,payload:{name:'Offline conflicting edit'}}); } catch(error) { assert.equal(error.code,'operation_conflict'); }
  return {f,b,request};
}
function assertRetainedConflict(client) {
  const state=client.getState();assert.equal(state.pending.total,1);assert.equal(state.durability,'local');assert.equal(state.error?.code,'operation_conflict');
  let subscribed;const stop=client.subscribe(next=>{subscribed=next;});stop();
  assert.equal(subscribed.pending.total,1);assert.equal(subscribed.error?.code,'operation_conflict');
}

test('stale same-account offline metadata conflict remains visible after receipt reconnect',async t=>{
  const {f,b}=await conflictingOfflineCommand(t);f.reconnect();await waitFor(()=>b.getState().connection==='online');await b.flush();
  assertRetainedConflict(b);assert.equal(f.store.publicBoard(f.boardId).name,'ACKed content');assert.equal(f.sent.filter(s=>s.path==='/api/boards/commands').length,1);
});

test('same-account mode hydration compares conflicting pending content before retiring a receipt',async t=>{
  const {f,b}=await conflictingOfflineCommand(t);f.auth(null);f.auth('minhle');
  await waitFor(()=>b.getState().connection==='offline'&&b.getState().snapshot);assertRetainedConflict(b);
  f.reconnect();await waitFor(()=>b.getState().connection==='online');await b.flush();assertRetainedConflict(b);
});

test('reload keeps an offline metadata receipt conflict in its originating persisted queue',async t=>{
  const {f,b}=await conflictingOfflineCommand(t);await b.close();const reloaded=await f.open();
  await reloaded.flush();f.reconnect();await waitFor(()=>reloaded.getState().connection==='online');await reloaded.flush();
  assertRetainedConflict(reloaded);assert.equal(f.sent.filter(s=>s.path==='/api/boards/commands').length,1);
});

test('upload receipt conflict survives offline reconnect and reload without a second upload',async t=>{
  const f=await fixture(t), a=await f.open(), b=await f.open(), original=f.transport.request;let uploadPosts=0;
  f.transport.request=(path,options)=>options?.rawBody instanceof FormData ? (uploadPosts++,Promise.resolve({operationId:options.rawBody.get('operationId'),assetId:randomUUID()})):original(path,options);
  const request={operationId:randomUUID(),file:new Blob(['ACKed'],{type:'image/png'}),name:'fixture.png',fields:{rows:'1'}};
  await a.queueUpload(request);f.disconnect();
  try { await b.queueUpload({...request,file:new Blob(['Different'],{type:'image/png'})}); } catch(error) { assert.equal(error.code,'operation_conflict'); }
  await b.close();const reloaded=await f.open();f.reconnect();await waitFor(()=>reloaded.getState().connection==='online');await reloaded.flush();
  assertRetainedConflict(reloaded);assert.equal(reloaded.getState().pending.uploads,1);assert.equal(uploadPosts,1);
});

test('an exact offline duplicate may retire against the identical persisted ACK',async t=>{
  const f=await fixture(t), a=await f.open(), b=await f.open();const request=f.envelope('board.rename',{name:'Exact ACK'}), accepted=await a.command(request);
  f.disconnect();const duplicate=await b.command(structuredClone(request));
  assert.ok(duplicate.pending || duplicate.operationId===accepted.operationId);assert.equal(b.getState().history.canUndo,false);
  await b.close();const reloaded=await f.open();f.reconnect();await waitFor(()=>reloaded.getState().connection==='online');await reloaded.flush();
  assert.equal(reloaded.getState().pending.total,0);assert.equal(reloaded.getState().error,null);assert.equal(reloaded.getState().history.canUndo,false);assert.deepEqual(await reloaded.command(request),accepted);
  assert.equal(f.sent.filter(s=>s.path==='/api/boards/commands').length,1);
});
