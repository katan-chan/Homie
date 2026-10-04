import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import * as Y from 'yjs';
import { createBackend } from '../backend/server.js';
import { createAuth } from '../backend/auth.js';
import { createProfiles } from '../backend/profiles.js';
import { createNotesStore } from '../backend/notes-store.js';
import { createNotesApi } from '../backend/notes-api.js';

const origin = 'http://localhost:8000';
const headers = { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' };
const passwords = { minhle: 'notes-only-minh-fixture', haiyen: 'notes-only-yen-fixture' };
let credentials;
before(async () => {
  credentials = {};
  for (const [id, password] of Object.entries(passwords)) {
    const salt = Buffer.alloc(16, id === 'minhle' ? 3 : 4);
    const hash = await promisify(scrypt)(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    credentials[id] = `${salt.toString('hex')}:${hash.toString('hex')}`;
  }
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-notes-http-'));
  if (options.corrupt) await writeFile(join(dataDir, 'notes.json'), options.corrupt);
  const server = createBackend(origin, { credentials, dataDir, production: false, ...options });
  assert.equal(server.listening, false);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const streams = [];
  t.after(async () => { streams.forEach(stream => stream.close()); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const request = (path, init = {}) => fetch(base + path, init);
  const post = (path, body, cookie, extra = {}) => request(path, { method: 'POST', headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: JSON.stringify(body) });
  const login = async (accountId = 'minhle', oldCookie) => {
    const response = await post('/api/auth/login', { accountId, password: passwords[accountId] }, oldCookie);
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const boardId = randomUUID(), noteId = randomUUID(), clientId = randomUUID();
  const command = (type, payload, accountId = 'minhle') => ({ operationId: randomUUID(), accountId, boardId, baseRevision: 0, type, payload });
  const send = (cmd, cookie, tokens = [], client = clientId) => post('/api/boards/commands', { command: cmd, clientId: client, leaseTokens: tokens }, cookie);
  const seed = async cookie => {
    assert.equal((await send(command('board.create', { name: 'Chung' }), cookie)).status, 200);
    assert.equal((await send(command('note.create', { id: noteId, columnId: null, x: 10, y: 20, width: 240, height: 280, color: '#ffeedd' }), cookie)).status, 200);
  };
  const lease = async (cookie, accountId = 'minhle', target = { kind: 'note', id: noteId }, client = clientId) => {
    const response = await post(`/api/boards/${boardId}/leases`, { action: 'acquire', accountId, clientId: client, target }, cookie);
    return { response, body: await response.json() };
  };
  const stream = async (path, cookie) => {
    const controller = new AbortController();
    const response = await request(path, { headers: cookie ? { Cookie: cookie } : {}, signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const events = [], waiters = new Set(); let ended = false;
    const done = (async () => {
      let pending = '';
      try {
        for await (const bytes of response.body) {
          pending += Buffer.from(bytes).toString('utf8');
          let boundary;
          while ((boundary = pending.indexOf('\n\n')) >= 0) {
            const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
            const name = /^event: (.+)$/m.exec(frame)?.[1], data = /^data: (.+)$/m.exec(frame)?.[1];
            if (name && data) events.push({ name, data: JSON.parse(data) });
            for (const wake of waiters) wake();
          }
        }
      } catch (error) { if (!controller.signal.aborted) throw error; }
      finally { ended = true; for (const wake of waiters) wake(); }
    })();
    const result = { events, done, get ended() { return ended; }, close: () => controller.abort(),
      async next(name, predicate = () => true) {
        const start = Date.now();
        while (true) {
          const index = events.findIndex(event => event.name === name && predicate(event.data));
          if (index >= 0) return events.splice(index, 1)[0].data;
          if (ended || Date.now() - start > 3000) throw new Error(`Missing SSE ${name}: ${JSON.stringify(events)}`);
          await new Promise(resolve => { const timer = setTimeout(wake, 50); function wake() { clearTimeout(timer); waiters.delete(wake); resolve(); } waiters.add(wake); });
        }
      },
    };
    streams.push(result); return result;
  };
  return { server, request, post, login, boardId, noteId, clientId, command, send, seed, lease, stream, dataDir };
}
function document(text = 'hello') {
  const doc = new Y.Doc(), paragraph = new Y.XmlElement('paragraph'), value = new Y.XmlText();
  value.insert(0, text); paragraph.insert(0, [value]); doc.getXmlFragment('body').insert(0, [paragraph]);
  return doc;
}
const update = doc => Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');

test('public boards have GET HEAD OPTIONS and enforce methods, Origin and mutation authentication', async t => {
  const f = await fixture(t);
  assert.deepEqual(await (await f.request('/api/boards')).json(), { boards: [] });
  assert.equal(await (await f.request('/api/boards', { method: 'HEAD' })).text(), '');
  assert.equal((await f.request('/api/boards', { method: 'OPTIONS' })).status, 204);
  const wrong = await f.request('/api/boards', { method: 'PUT' }); assert.equal(wrong.status, 405); assert.equal(wrong.headers.get('allow'), 'GET, HEAD, OPTIONS');
  assert.equal((await f.request('/api/boards/no/such/path')).status, 404);
  assert.equal((await f.request('/api/boards', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.post('/api/boards/commands', {}, null)).status, 401);
  assert.equal((await f.post('/api/boards/commands', {}, null, { Origin: '' })).status, 403);
  assert.equal((await f.post('/api/boards/commands', {}, null, { 'X-Requested-With': '' })).status, 403);
});

test('both accounts mutate while author and account spoofing reject, including text retries', async t => {
  const f = await fixture(t), minh = await f.login(), yen = await f.login('haiyen'); await f.seed(minh);
  assert.equal((await f.send(f.command('board.rename', { name: 'Yến đổi' }, 'haiyen'), yen)).status, 200);
  assert.equal((await f.send(f.command('note.update', { id: f.noteId, authorId: 'haiyen' }), minh)).status, 400);
  assert.equal((await f.send(f.command('board.rename', { name: 'spoof' }, 'haiyen'), minh)).status, 403);
  const doc = document(), text = { operationId: randomUUID(), accountId: 'minhle', update: update(doc) }; doc.destroy();
  assert.equal((await f.post(`/api/notes/${f.noteId}/text`, text, minh)).status, 200);
  assert.equal((await f.post(`/api/notes/${f.noteId}/text`, text, yen)).status, 403);
  const publicBoard = (await (await f.request(`/api/boards/${f.boardId}`)).json()).board;
  assert.equal(publicBoard.notes[0].authorId, 'minhle'); assert.equal(publicBoard.notes[0].content.content[0].content[0].text, 'hello');
  for (const key of ['texts', 'operations', 'presence', 'assets']) assert.ok(!Object.hasOwn(publicBoard, key));
});

test('lease binds session and tab, protects geometry but permits text and committed retry without a lease', async t => {
  const f = await fixture(t), minh = await f.login(), yen = await f.login('haiyen'); await f.seed(minh);
  const held = await f.lease(minh); assert.equal(held.response.status, 200); assert.ok(held.body.expiresAt > Date.now());
  const move = f.command('note.move', { id: f.noteId, x: 100 });
  assert.equal((await f.send(move, minh)).status, 409);
  assert.equal((await f.send(f.command('note.move', { id: f.noteId, x: 99 }, 'haiyen'), yen, [], randomUUID())).status, 409);
  assert.equal((await f.lease(minh, 'minhle', { kind: 'note', id: f.noteId }, randomUUID())).response.status, 409);
  assert.equal((await f.send(move, minh, [held.body.leaseToken], randomUUID())).status, 409);
  const accepted = await f.send(move, minh, [held.body.leaseToken]); assert.equal(accepted.status, 200); const result = await accepted.json();
  const doc = document('peer text'); assert.equal((await f.post(`/api/notes/${f.noteId}/text`, { operationId: randomUUID(), accountId: 'haiyen', update: update(doc) }, yen)).status, 200); doc.destroy();
  assert.equal((await f.post(`/api/boards/${f.boardId}/leases`, { accountId: 'minhle', clientId: f.clientId, action: 'release', leaseToken: held.body.leaseToken }, minh)).status, 200);
  assert.deepEqual(await (await f.send(move, minh)).json(), result);
  const otherSession = await f.login(); const next = await f.lease(otherSession); assert.equal(next.response.status, 200);
  assert.equal((await f.send(f.command('note.move', { id: f.noteId, x: 200 }), minh, [next.body.leaseToken])).status, 409);
});

test('column group leases conflict in both directions with notes, reparent destinations and descendants', async t => {
  const f = await fixture(t), minh = await f.login(), yen = await f.login('haiyen'); await f.seed(minh);
  const columnId = randomUUID(); assert.equal((await f.send(f.command('column.create', { id: columnId, name: 'Nhóm', x: 0, y: 0, width: 400, height: 600 }), minh)).status, 200);
  const own = await f.lease(minh);
  assert.equal((await f.send(f.command('note.move', { id: f.noteId, columnId }), minh, [own.body.leaseToken])).status, 200);
  assert.equal((await f.lease(yen, 'haiyen', { kind: 'column', id: columnId }, randomUUID())).response.status, 409);
  await f.post(`/api/boards/${f.boardId}/leases`, { accountId: 'minhle', clientId: f.clientId, action: 'release', leaseToken: own.body.leaseToken }, minh);
  const group = await f.lease(yen, 'haiyen', { kind: 'column', id: columnId }, randomUUID()); assert.equal(group.response.status, 200);
  assert.equal((await f.lease(minh)).response.status, 409);
  assert.equal((await f.send(f.command('note.move', { id: f.noteId, columnId: null }), minh)).status, 409);
  assert.equal((await f.send(f.command('board.trash', {}), minh)).status, 409);
});

test('leases renew, expire after ten seconds and revoke immediately at logout', async t => {
  const f = await fixture(t), minh = await f.login(), yen = await f.login('haiyen'); await f.seed(minh);
  const held = await f.lease(minh); assert.equal(held.response.status, 200);
  const renewed = await f.post(`/api/boards/${f.boardId}/leases`, { accountId: 'minhle', clientId: f.clientId, action: 'renew', leaseToken: held.body.leaseToken }, minh);
  assert.equal(renewed.status, 200); const renewedBody = await renewed.json(); assert.ok(renewedBody.expiresAt >= held.body.expiresAt);
  await delay(10100);
  const other = await f.lease(yen, 'haiyen', undefined, randomUUID()); assert.equal(other.response.status, 200);
  await f.post('/api/auth/logout', {}, yen);
  assert.equal((await f.lease(minh)).response.status, 200);
});

test('public catalog stream starts empty and follows only committed board catalog changes', async t => {
  const f = await fixture(t), stream = await f.stream('/api/boards/events'); assert.deepEqual(await stream.next('boards'), { boards: [] });
  const minh = await f.login(); await f.seed(minh);
  assert.equal((await stream.next('boards', data => data.boards.length === 1)).boards[0].name, 'Chung');
  assert.equal((await f.send(f.command('board.rename', { name: 'Mới' }), minh)).status, 200);
  assert.equal((await stream.next('boards', data => data.boards[0]?.name === 'Mới')).boards[0].name, 'Mới');
  assert.equal((await f.send(f.command('board.trash', {}), minh)).status, 200);
  assert.deepEqual(await stream.next('boards', data => !data.boards.length), { boards: [] });
});

test('guest board SSE contains sanitized projections only; authenticated SSE sends committed deltas and private refresh', async t => {
  const f = await fixture(t), minh = await f.login(); await f.seed(minh);
  const guest = await f.stream(`/api/boards/${f.boardId}/events`), member = await f.stream(`/api/boards/${f.boardId}/events?clientId=${f.clientId}`, minh);
  await guest.next('snapshot'); await member.next('snapshot'); await member.next('presence');
  const doc = document('secret retained history'), text = { accountId: 'minhle', operationId: randomUUID(), update: update(doc) }; doc.destroy();
  assert.equal((await f.post(`/api/notes/${f.noteId}/text`, text, minh)).status, 200);
  assert.equal((await member.next('text-update')).update, text.update);
  assert.equal((await guest.next('projection')).board.notes[0].content.content[0].content[0].text, 'secret retained history');
  assert.equal((await f.send(f.command('note.trash', { id: f.noteId }), minh)).status, 200);
  await member.next('refresh'); assert.equal((await guest.next('projection', data => data.board.notes.length === 0)).board.notes.length, 0);
  assert.equal((await f.request(`/api/boards/${f.boardId}/collaboration`)).status, 401);
  assert.equal((await f.request('/api/boards/trash')).status, 401);
  for (const event of guest.events) { assert.ok(!['text-update', 'refresh', 'presence'].includes(event.name)); for (const key of ['texts', 'update', 'presence', 'operations']) assert.ok(!JSON.stringify(event.data).includes(`"${key}"`)); }
});

test('private presence validates caret/pointer schema and derives account, name and color on server', async t => {
  const f = await fixture(t), minh = await f.login(); await f.seed(minh);
  assert.equal((await f.request('/api/profiles/minhle', { method: 'PUT', headers: { ...headers, Cookie: minh }, body: JSON.stringify({ displayName: 'Tên mới', bio: '' }) })).status, 200);
  const stream = await f.stream(`/api/boards/${f.boardId}/events?clientId=${f.clientId}`, minh); await stream.next('snapshot'); await stream.next('presence');
  const doc = document('caret'), text = { accountId: 'minhle', operationId: randomUUID(), update: update(doc) };
  assert.equal((await f.post(`/api/notes/${f.noteId}/text`, text, minh)).status, 200);
  const value = doc.getXmlFragment('body').get(0).get(0), position = Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(value, 2))).toString('base64');
  const body = { accountId: 'minhle', clientId: f.clientId, pointer: { x: 11, y: -22 }, editors: [{ noteId: f.noteId, yClientId: doc.clientID, anchor: position, head: position }] };
  assert.equal((await f.post(`/api/boards/${f.boardId}/presence`, body, minh)).status, 200);
  const presence = (await stream.next('presence', data => data.clients.length > 0)).clients[0];
  assert.equal(presence.accountId, 'minhle'); assert.equal(presence.displayName, 'Tên mới'); assert.equal(presence.color, '#a33f68'); assert.deepEqual(presence.pointer, body.pointer); assert.deepEqual(presence.editors, body.editors);
  for (const bad of [{ ...body, displayName: 'Impostor' }, { ...body, accountId: 'haiyen' }, { ...body, pointer: { x: null, y: 2 } }, { ...body, editors: [{ ...body.editors[0], anchor: 'bad' }] }, { ...body, editors: [{ ...body.editors[0], head: null }] }, { ...body, editors: [{ ...body.editors[0], noteId: randomUUID() }] }]) assert.ok([400, 403, 404].includes((await f.post(`/api/boards/${f.boardId}/presence`, bad, minh)).status));
  assert.equal((await f.post(`/api/boards/${f.boardId}/presence`, body)).status, 401); doc.destroy();
});

test('logout closes original private stream and removes presence/leases without promoting its account', async t => {
  const f = await fixture(t), minh = await f.login(); await f.seed(minh);
  const stream = await f.stream(`/api/boards/${f.boardId}/events?clientId=${f.clientId}`, minh); await stream.next('snapshot'); await stream.next('presence');
  assert.equal((await f.lease(minh)).response.status, 200);
  assert.equal((await f.post(`/api/boards/${f.boardId}/presence`, { accountId: 'minhle', clientId: f.clientId, pointer: { x: 1, y: 2 }, editors: [] }, minh)).status, 200);
  assert.equal((await f.post('/api/auth/logout', {}, minh)).status, 204);
  await stream.next('auth-required'); await stream.done; assert.equal(stream.ended, true);
  const yen = await f.login('haiyen'); assert.equal((await f.lease(yen, 'haiyen', undefined, randomUUID())).response.status, 200);
  const next = await f.stream(`/api/boards/${f.boardId}/events`, yen); await next.next('snapshot'); assert.deepEqual(await next.next('presence'), { clients: [] });
  assert.equal((await f.request(`/api/boards/${f.boardId}/collaboration`, { headers: { Cookie: minh } })).status, 401);
});

test('session expiry closes private SSE and denies all later mutation, presence and lease calls', async t => {
  const f = await fixture(t, { sessionTtlMs: 400 }), minh = await f.login(); await f.seed(minh);
  const stream = await f.stream(`/api/boards/${f.boardId}/events`, minh); await stream.next('snapshot');
  await stream.next('auth-required'); await stream.done;
  assert.equal((await f.send(f.command('board.rename', { name: 'expired' }), minh)).status, 401);
  assert.equal((await f.lease(minh)).response.status, 401);
  assert.equal((await f.post(`/api/boards/${f.boardId}/presence`, {}, minh)).status, 401);
});

test('subscribe then collaboration snapshot covers reconnect gap and merges two concurrent text clients', async t => {
  const f = await fixture(t), minh = await f.login(), yen = await f.login('haiyen'); await f.seed(minh);
  const doc = document('base'); assert.equal((await f.post(`/api/notes/${f.noteId}/text`, { accountId: 'minhle', operationId: randomUUID(), update: update(doc) }, minh)).status, 200);
  const old = (await (await f.request(`/api/boards/${f.boardId}/collaboration`, { headers: { Cookie: minh } })).json()).board;
  doc.getXmlFragment('body').get(0).get(0).insert(4, ' gap');
  assert.equal((await f.post(`/api/notes/${f.noteId}/text`, { accountId: 'minhle', operationId: randomUUID(), update: update(doc) }, minh)).status, 200);
  const stream = await f.stream(`/api/boards/${f.boardId}/events`, minh), snapshot = await stream.next('snapshot'); assert.ok(snapshot.revision > old.revision);
  const fresh = (await (await f.request(`/api/boards/${f.boardId}/collaboration`, { headers: { Cookie: minh } })).json()).board;
  const a = new Y.Doc(), b = new Y.Doc(); Y.applyUpdate(a, Buffer.from(fresh.texts[f.noteId], 'base64')); Y.applyUpdate(b, Buffer.from(fresh.texts[f.noteId], 'base64'));
  const state = Y.encodeStateVector(a); a.getXmlFragment('body').get(0).get(0).insert(0, 'A'); b.getXmlFragment('body').get(0).get(0).insert(0, 'B');
  const responses = await Promise.all([[a, 'minhle', minh], [b, 'haiyen', yen]].map(([client, accountId, cookie]) => f.post(`/api/notes/${f.noteId}/text`, { accountId, operationId: randomUUID(), update: Buffer.from(Y.encodeStateAsUpdate(client, state)).toString('base64') }, cookie)));
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  const first = await stream.next('text-update'), second = await stream.next('text-update'); Y.applyUpdate(a, Buffer.from(first.update, 'base64')); Y.applyUpdate(a, Buffer.from(second.update, 'base64'));
  const latest = (await (await f.request(`/api/boards/${f.boardId}/collaboration`, { headers: { Cookie: minh } })).json()).board, merged = new Y.Doc(); Y.applyUpdate(merged, Buffer.from(latest.texts[f.noteId], 'base64'));
  assert.equal(a.getXmlFragment('body').toString(), merged.getXmlFragment('body').toString()); assert.match(merged.getXmlFragment('body').toString(), /base gap/); assert.match(merged.getXmlFragment('body').toString(), /A/); assert.match(merged.getXmlFragment('body').toString(), /B/);
  [doc, a, b, merged].forEach(value => value.destroy());
});

test('offline text updates retain tombstones and authenticated trash discovery after deletion', async t => {
  const f = await fixture(t), minh = await f.login(); await f.seed(minh);
  assert.equal((await f.send(f.command('board.trash', {}), minh)).status, 200);
  const doc = document('offline retained'); assert.equal((await f.post(`/api/notes/${f.noteId}/text`, { accountId: 'minhle', operationId: randomUUID(), update: update(doc) }, minh)).status, 200); doc.destroy();
  assert.equal((await f.request(`/api/boards/${f.boardId}`)).status, 404);
  const trash = await (await f.request('/api/boards/trash', { headers: { Cookie: minh } })).json(); assert.equal(trash.boards[0].id, f.boardId);
  const privateBoard = (await (await f.request(`/api/boards/${f.boardId}/collaboration`, { headers: { Cookie: minh } })).json()).board; assert.ok(privateBoard.deletedAt); assert.ok(privateBoard.texts[f.noteId]);
});

test('invalid base64, MIME, unknown fields and oversized text bodies fail before acknowledgement', async t => {
  const f = await fixture(t), minh = await f.login(); await f.seed(minh);
  for (const value of ['@@', 'AA', 'AB==', '', 'A'.repeat(349532)]) {
    const response = await f.post(`/api/notes/${f.noteId}/text`, { accountId: 'minhle', operationId: randomUUID(), update: value }, minh); assert.ok([400, 413].includes(response.status));
  }
  assert.equal((await f.post(`/api/notes/${f.noteId}/text`, {}, minh, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.post(`/api/notes/${f.noteId}/text`, { accountId: 'minhle', operationId: randomUUID(), update: 'AA==', offline: true }, minh)).status, 400);
  assert.equal((await f.post(`/api/notes/${f.noteId}/text`, { junk: 'x'.repeat(400000) }, minh)).status, 413);
});

test('persistence failure sends no ACK or SSE event and the identical operation can retry', async t => {
  const f = await fixture(t), minh = await f.login(); await f.seed(minh);
  const stream = await f.stream(`/api/boards/${f.boardId}/events`, minh); await stream.next('snapshot'); await stream.next('presence');
  const command = f.command('board.rename', { name: 'persist later' });
  await rename(join(f.dataDir, 'notes.json'), join(f.dataDir, 'notes.saved')); await mkdir(join(f.dataDir, 'notes.json'));
  const failed = await f.send(command, minh); assert.equal(failed.status, 503); assert.equal((await failed.json()).code, 'storage_unavailable');
  await delay(60); assert.equal(stream.events.length, 0);
  await rm(join(f.dataDir, 'notes.json'), { recursive: true }); await rename(join(f.dataDir, 'notes.saved'), join(f.dataDir, 'notes.json'));
  assert.equal((await f.send(command, minh)).status, 200); assert.equal((await stream.next('projection')).board.name, 'persist later');
});

test('notes initialization failure remains observed and preserves health, authentication and profiles', async t => {
  const f = await fixture(t, { corrupt: '{not valid' });
  assert.equal((await f.request('/api/boards')).status, 503);
  assert.equal((await f.request('/api/boards')).status, 503);
  assert.equal((await f.request('/api/health')).status, 200);
  assert.equal((await f.request('/api/profiles/minhle')).status, 200);
  assert.ok(await f.login()); assert.equal(await readFile(join(f.dataDir, 'notes.json'), 'utf8'), '{not valid');
});

test('raw normalized unknown notes paths return a bounded response', async t => {
  const f = await fixture(t);
  for (const [path, status] of [['/api/boards/not-a-uuid', 400], ['/api/boards/..', 404], ['/api/boards/%2e%2e', 404]]) {
    const request = httpRequest({ host: '127.0.0.1', port: f.server.address().port, path });
    try {
      const response = new Promise((resolve, reject) => {
        request.on('response', res => { res.resume(); resolve(res.statusCode); });
        request.on('error', reject);
      });
      request.setTimeout(500, () => request.destroy(new Error(`No bounded response for ${path}`)));
      request.end();
      assert.equal(await response, status);
    } finally { request.destroy(); }
  }
});

test('shutdown during failed notes initialization closes an incomplete request', async t => {
  const f = await fixture(t, { corrupt: '{bad' });
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  f.server.once('request', () => f.server.close(resolveClosed));
  const request = httpRequest({ host: '127.0.0.1', port: f.server.address().port, method: 'POST', path: '/api/boards/commands',
    headers: { ...headers, Connection: 'keep-alive', 'Content-Length': 10000 } });
  try {
    const response = new Promise((resolve, reject) => {
      request.on('response', res => { res.resume(); resolve({ status: res.statusCode, connection: res.headers.connection }); });
      request.on('error', reject);
    });
    request.setTimeout(1000, () => request.destroy(new Error('Initialization failure did not respond')));
    request.write('{');
    assert.deepEqual(await response, { status: 503, connection: 'close' });
    await Promise.race([closed, delay(1000).then(() => { throw new Error('Failed initialization blocked shutdown'); })]);
    assert.equal(await readFile(join(f.dataDir, 'notes.json'), 'utf8'), '{bad');
  } finally { request.destroy(); f.server.closeAllConnections(); await closed; }
});

test('server shutdown closes active SSE and drains accepted writes without deadlock', async t => {
  const f = await fixture(t), minh = await f.login(); await f.seed(minh);
  const stream = await f.stream(`/api/boards/${f.boardId}/events`, minh); await stream.next('snapshot');
  const writes = Promise.all(Array.from({ length: 8 }, (_, index) => f.send(f.command('board.rename', { name: `pending ${index}` }), minh)));
  await delay(20);
  const closed = new Promise(resolve => f.server.close(resolve));
  await Promise.race([closed, delay(3000).then(() => { throw new Error('shutdown deadlocked'); })]);
  await stream.done; const responses = await writes; assert.ok(responses.every(response => [200, 503].includes(response.status)));
  const persisted = JSON.parse(await readFile(join(f.dataDir, 'notes.json'), 'utf8')); assert.ok(persisted.boards[0].name.startsWith('pending'));
});

async function directFixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-notes-api-queue-'));
  const store = await createNotesStore({ dataDir }), auth = createAuth({ credentials }), profiles = createProfiles(dataDir);
  const api = createNotesApi({ store, auth, allowedOrigins: new Set([origin]), profiles });
  const server = createServer((req, res) => { api.handle(req, res).then(handled => { if (!handled) res.writeHead(404).end(); }).catch(() => res.writeHead(500).end()); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await api.close(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const cookie = id => auth.issue({ headers: {} }, id).split(';')[0];
  const request = (path, init = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, init);
  const post = (path, body, value) => request(path, { method: 'POST', headers: { ...headers, Cookie: value }, body: JSON.stringify(body) });
  const boardId = randomUUID(), noteId = randomUUID(), clientId = randomUUID();
  const command = (type, payload, accountId = 'minhle') => ({ type, payload, boardId, accountId, baseRevision: 0, operationId: randomUUID() });
  await store.applyCommand('minhle', command('board.create', { name: 'Queue' }));
  await store.applyCommand('minhle', command('note.create', { id: noteId, columnId: null, x: 0, y: 0, width: 200, height: 200, color: '#ffffff' }));
  const blockQueue = async () => {
    let release, started; const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
    const doc = document('queued text'); const blocked = store.applyText('minhle', noteId, Buffer.from(update(doc), 'base64'), randomUUID(), { authorize: () => { started(); return gate; } }); doc.destroy();
    await entered; return { release, blocked };
  };
  const observeCommand = () => {
    const apply = store.applyCommand; let accepted;
    const seen = new Promise(resolve => { accepted = resolve; });
    store.applyCommand = (...args) => { const result = apply(...args); accepted(); store.applyCommand = apply; return result; };
    return seen;
  };
  return { store, auth, profiles, request, post, cookie, boardId, noteId, clientId, command, blockQueue, observeCommand };
}

test('metadata undo acquires leases rather than bypassing geometry authorization', async t => {
  const f = await fixture(t), minh = await f.login(); await f.seed(minh);
  const held = await f.lease(minh), move = f.command('note.move', { id: f.noteId, x: 77 });
  assert.equal((await f.send(move, minh, [held.body.leaseToken])).status, 200);
  await f.post(`/api/boards/${f.boardId}/leases`, { action: 'release', accountId: 'minhle', clientId: f.clientId, leaseToken: held.body.leaseToken }, minh);
  const undo = f.command('command.undo', { operationId: move.operationId });
  assert.equal((await f.send(undo, minh)).status, 409);
  const renewed = await f.lease(minh); assert.equal((await f.send(undo, minh, [renewed.body.leaseToken])).status, 200);
  assert.equal((await (await f.request(`/api/boards/${f.boardId}`)).json()).board.notes[0].x, 10);
});

test('queued authorization rechecks original session after revocation, including committed retries', async t => {
  const f = await directFixture(t), minh = f.cookie('minhle');
  const command = f.command('board.rename', { name: 'dedup safe' });
  assert.equal((await f.post('/api/boards/commands', { command, clientId: f.clientId }, minh)).status, 200);
  const gate = await f.blockQueue(), entered = f.observeCommand();
  const request = f.post('/api/boards/commands', { command, clientId: f.clientId }, minh); await entered;
  f.auth.logout({ headers: { cookie: minh } }); gate.release(); await gate.blocked;
  const response = await request; assert.equal(response.status, 401); assert.equal((await response.json()).code, 'unauthorized');
  const nextCookie = f.cookie('minhle'), pending = f.command('board.rename', { name: 'must not persist' });
  const nextGate = await f.blockQueue(), nextEntered = f.observeCommand();
  const next = f.post('/api/boards/commands', { command: pending, clientId: f.clientId }, nextCookie); await nextEntered;
  f.auth.logout({ headers: { cookie: nextCookie } }); nextGate.release(); await nextGate.blocked;
  assert.equal((await next).status, 401); assert.equal(f.store.publicBoard(f.boardId).name, 'dedup safe');
});

test('queued geometry checks the current lease owner immediately before persistence', async t => {
  const f = await directFixture(t), minh = f.cookie('minhle'), yen = f.cookie('haiyen'), target = { kind: 'note', id: f.noteId };
  const heldResponse = await f.post(`/api/boards/${f.boardId}/leases`, { accountId: 'minhle', clientId: f.clientId, action: 'acquire', target }, minh); const held = await heldResponse.json();
  const gate = await f.blockQueue(), entered = f.observeCommand();
  const pending = f.post('/api/boards/commands', { command: f.command('note.move', { id: f.noteId, x: 99 }), clientId: f.clientId, leaseTokens: [held.leaseToken] }, minh); await entered;
  assert.equal((await f.post(`/api/boards/${f.boardId}/leases`, { accountId: 'minhle', clientId: f.clientId, action: 'release', leaseToken: held.leaseToken }, minh)).status, 200);
  assert.equal((await f.post(`/api/boards/${f.boardId}/leases`, { accountId: 'haiyen', clientId: randomUUID(), action: 'acquire', target }, yen)).status, 200);
  gate.release(); await gate.blocked; assert.equal((await pending).status, 409); assert.equal(f.store.publicBoard(f.boardId).notes[0].x, 0);
});

test('decorations conflict with their note and column leases while rotation requires a transport token', async t => {
  const f = await directFixture(t), minh = f.cookie('minhle'), yen = f.cookie('haiyen'), assetId = randomUUID(), decorationId = randomUUID(), columnId = randomUUID();
  await f.store.registerAsset('minhle', { id: assetId, name: 'Fixture', mimeType: 'image/gif', fileName: `${assetId}.gif`, posterName: `${assetId}.png`, width: 30, height: 30, bytes: 100, animated: false }, randomUUID());
  await f.store.applyCommand('minhle', f.command('column.create', { id: columnId, name: 'group', x: 0, y: 0, width: 500, height: 500 }));
  await f.store.applyCommand('minhle', f.command('note.move', { id: f.noteId, columnId }));
  await f.store.applyCommand('minhle', f.command('decoration.add', { id: decorationId, noteId: f.noteId, assetId, x: 0, y: 0, width: 30, height: 30, rotation: 0, z: 1 }));
  const lease = await (await f.post(`/api/boards/${f.boardId}/leases`, { accountId: 'minhle', clientId: f.clientId, action: 'acquire', target: { kind: 'decoration', id: decorationId } }, minh)).json();
  for (const target of [{ kind: 'note', id: f.noteId }, { kind: 'column', id: columnId }]) assert.equal((await f.post(`/api/boards/${f.boardId}/leases`, { accountId: 'haiyen', clientId: randomUUID(), action: 'acquire', target }, yen)).status, 409);
  const command = f.command('decoration.update', { id: decorationId, rotation: 45 });
  assert.equal((await f.post('/api/boards/commands', { command, clientId: f.clientId }, minh)).status, 409);
  assert.equal((await f.post('/api/boards/commands', { command, clientId: f.clientId, leaseTokens: [lease.leaseToken] }, minh)).status, 200);
});

test('presence cannot overwrite another session or tab editor identity', async t => {
  const f = await fixture(t), minh = await f.login(), yen = await f.login('haiyen'); await f.seed(minh);
  const body = { accountId: 'minhle', clientId: f.clientId, pointer: null, editors: [{ noteId: f.noteId, yClientId: 1234, anchor: null, head: null }] };
  assert.equal((await f.post(`/api/boards/${f.boardId}/presence`, body, minh)).status, 200);
  assert.equal((await f.post(`/api/boards/${f.boardId}/presence`, { ...body, clientId: randomUUID(), accountId: 'haiyen' }, yen)).status, 409);
  const sameUuidDifferentSession = await f.login();
  assert.equal((await f.post(`/api/boards/${f.boardId}/presence`, body, sameUuidDifferentSession)).status, 409);
});

test('SSE disconnect releases that client presence and leases, and stream counts are bounded', async t => {
  const f = await fixture(t), minh = await f.login(), yen = await f.login('haiyen'); await f.seed(minh);
  const stream = await f.stream(`/api/boards/${f.boardId}/events?clientId=${f.clientId}`, minh); await stream.next('snapshot');
  assert.equal((await f.lease(minh)).response.status, 200);
  assert.equal((await f.post(`/api/boards/${f.boardId}/presence`, { accountId: 'minhle', clientId: f.clientId, pointer: { x: 1, y: 2 }, editors: [] }, minh)).status, 200);
  stream.close(); await stream.done; await delay(30);
  assert.equal((await f.lease(yen, 'haiyen', undefined, randomUUID())).response.status, 200);
  const member = await f.stream(`/api/boards/${f.boardId}/events`, yen); await member.next('snapshot'); assert.deepEqual(await member.next('presence'), { clients: [] });
  for (let index = 0; index < 16; index++) await (await f.stream(`/api/boards/${f.boardId}/events`, minh)).next('snapshot');
  assert.equal((await f.request(`/api/boards/${f.boardId}/events`, { headers: { Cookie: minh } })).status, 429);
});

test('text body above profile limit succeeds and a stalled SSE reader is disconnected at the queue bound', async t => {
  const f = await fixture(t), minh = await f.login(); await f.seed(minh);
  const doc = document('x'.repeat(200000)), encoded = update(doc); doc.destroy();
  const text = () => ({ accountId: 'minhle', operationId: randomUUID(), update: encoded });
  assert.equal((await f.post(`/api/notes/${f.noteId}/text`, text(), minh)).status, 200);
  const connection = once(f.server, 'connection'), socket = createConnection({ host: '127.0.0.1', port: f.server.address().port }); t.after(() => socket.destroy());
  const [serverSocket] = await connection; let serverClosed = false; serverSocket.on('close', () => { serverClosed = true; });
  try {
    if (socket.connecting) await once(socket, 'connect'); socket.write(`GET /api/boards/${f.boardId}/events HTTP/1.1\r\nHost: localhost\r\n\r\n`);
    const [bytes] = await once(socket, 'data'); assert.match(bytes.toString(), /200 OK/); socket.pause();
    for (let count = 0; count < 100 && !serverClosed; count++) assert.equal((await f.post(`/api/notes/${f.noteId}/text`, text(), minh)).status, 200);
    assert.equal(serverClosed, true, 'server retained an unbounded queue for a stalled reader');
  } finally { socket.destroy(); }
});

test('shutdown cancels an incomplete notes request body without waiting for request timeout', async t => {
  const f = await fixture(t), minh = await f.login();
  const request = httpRequest({ host: '127.0.0.1', port: f.server.address().port, method: 'POST', path: '/api/boards/commands', headers: { ...headers, Cookie: minh, 'Content-Length': 10000 } });
  const response = new Promise((resolve, reject) => { request.on('response', res => { res.resume(); resolve(res.statusCode); }); request.on('error', reject); });
  request.write('{'); await delay(30);
  const closed = new Promise(resolve => f.server.close(resolve));
  await Promise.race([closed, delay(2000).then(() => { throw new Error('incomplete body blocked shutdown'); })]);
  assert.equal(await response, 503); request.destroy();
});

test('malformed presence is a client error', async t => {
  const f = await directFixture(t), minh = f.cookie('minhle');
  for (const body of [null, [], 2, 'bad']) assert.equal((await f.post(`/api/boards/${f.boardId}/presence`, body, minh)).status, 400);
});

test('concurrent presence publishers cannot steal an editor identity', async t => {
  const f = await directFixture(t), minh = f.cookie('minhle');
  const getProfile = f.profiles.get; let arrived = 0, bothEntered, release;
  const entered = new Promise(resolve => { bothEntered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  f.profiles.get = async id => { const profile = await getProfile(id); if (++arrived === 2) bothEntered(); await gate; return profile; };
  const body = clientId => ({ accountId: 'minhle', clientId, pointer: null, editors: [{ noteId: f.noteId, yClientId: 2222, anchor: null, head: null }] });
  const requests = Promise.all([f.clientId, randomUUID()].map(clientId => f.post(`/api/boards/${f.boardId}/presence`, body(clientId), minh)));
  try { await entered; } finally { release(); }
  const responses = await requests; assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
});

test('oversized public snapshot requests a bounded projection refresh and keeps the stream subscribed', async t => {
  const f = await directFixture(t), doc = document('x'.repeat(250000)), bytes = Buffer.from(update(doc), 'base64'); doc.destroy();
  for (let index = 0; index < 17; index++) {
    const noteId = index ? randomUUID() : f.noteId;
    if (index) await f.store.applyCommand('minhle', f.command('note.create', { id: noteId, columnId: null, x: 0, y: 0, width: 200, height: 200, color: '#ffffff' }));
    await f.store.applyText('minhle', noteId, bytes, randomUUID());
  }
  for (const cookie of [null, f.cookie('minhle')]) {
    const controller = new AbortController();
    try {
      const response = await f.request(`/api/boards/${f.boardId}/events`, { headers: cookie ? { Cookie: cookie } : {}, signal: controller.signal });
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      let content = '';
      while (!content.includes('\n\n')) { const chunk = await reader.read(); assert.equal(chunk.done, false); content += Buffer.from(chunk.value).toString(); }
      // The retry frame can arrive separately, so continue until the refresh event arrives.
      while (!content.includes('event: projection-refresh')) { const chunk = await reader.read(); assert.equal(chunk.done, false); content += Buffer.from(chunk.value).toString(); }
      assert.ok(Buffer.byteLength(content) < 4096); assert.ok(!content.includes('texts')); assert.match(content, new RegExp(f.boardId));
      assert.equal((await f.post('/api/boards/commands', { command: f.command('board.rename', { name: 'still subscribed' }), clientId: f.clientId }, cookie ?? f.cookie('minhle'))).status, 200);
      const next = await reader.read(); assert.equal(next.done, false); assert.match(Buffer.from(next.value).toString(), /projection-refresh/);
      if (!cookie) assert.ok(!content.includes('collaboration'));
    } finally { controller.abort(); }
  }
});
