import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, scrypt, createVerify } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as Y from 'yjs';
import { createBackend } from '../backend/server.js';
import { createNotesStore } from '../backend/notes-store.js';
import { createPush, watchNotes } from '../backend/push.js';

const origin = 'http://localhost:8000';
const passwords = { minhle: 'push-only-minh-fixture', haiyen: 'push-only-yen-fixture' };
const PHONE = { minhle: 'minh-phone-token-0123456789abcdef', haiyen: 'yen-phone-token-0123456789abcdef' };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { project_id: 'homie-test', client_email: 'push@homie-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let credentials;
before(async () => {
  credentials = {};
  for (const [id, password] of Object.entries(passwords)) {
    const salt = Buffer.alloc(16, id === 'minhle' ? 7 : 8);
    const hash = await promisify(scrypt)(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    credentials[id] = `${salt.toString('hex')}:${hash.toString('hex')}`;
  }
});

/** A fake Firebase: answers the token exchange and records every message; tokens in `gone` answer 404. */
function firebase(gone = new Set()) {
  const messages = [], tokenRequests = [];
  const fetchImpl = async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenRequests.push(new URLSearchParams(init.body));
      return new Response(JSON.stringify({ access_token: 'access-1', expires_in: 3600 }), { status: 200 });
    }
    const { message } = JSON.parse(init.body);
    messages.push({ url, auth: init.headers.Authorization, ...message });
    return new Response('{}', { status: gone.has(message.token) ? 404 : 200 });
  };
  return { fetchImpl, messages, tokenRequests };
}
/** Same sender with every wait cut to 20 ms. */
const fast = push => ({ ...push, later: (key, ms, fn) => push.later(key, 20, fn) });

async function server(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-push-'));
  const fake = firebase();
  const push = fast(createPush({ dataDir, account, fetchImpl: fake.fetchImpl }));
  const backend = createBackend(origin, { credentials, dataDir, production: false, push });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${backend.address().port}`;
  t.after(async () => { await new Promise(resolve => backend.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const call = async (method, path, body, cookie) => {
    const response = await fetch(base + path, { method, headers: { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const login = async accountId => {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId, password: passwords[accountId] }) });
    return response.headers.get('set-cookie').split(';')[0];
  };
  return { call, fake, minh: await login('minhle'), yen: await login('haiyen') };
}

test('a phone registers to one account at a time and only with a session and a valid token', async t => {
  const { call, fake, minh, yen } = await server(t);
  assert.equal((await call('POST', '/api/push/devices', { token: PHONE.haiyen })).status, 401);
  assert.equal((await call('POST', '/api/push/devices', { token: 'short' }, yen)).status, 400);
  assert.equal((await call('POST', '/api/push/devices', { token: PHONE.haiyen, extra: 1 }, yen)).status, 400);
  assert.equal((await call('GET', '/api/push/devices', undefined, yen)).status, 405);
  assert.equal((await call('POST', '/api/push/devices', { token: PHONE.haiyen }, minh)).status, 204);
  // The same phone logs in as Yến: Minh no longer receives on it.
  assert.equal((await call('POST', '/api/push/devices', { token: PHONE.haiyen }, yen)).status, 204);
  await call('POST', '/api/jar', { requestId: randomUUID(), kind: 'kiss' }, yen);
  await sleep(150);
  assert.equal(fake.messages.length, 0, 'Minh has no phone left; Yến never hears about her own kiss');
  await call('POST', '/api/jar', { requestId: randomUUID(), kind: 'kiss' }, minh);
  await sleep(150);
  assert.deepEqual(fake.messages.map(m => m.token), [PHONE.haiyen]);
  assert.equal((await call('DELETE', '/api/push/devices', { token: PHONE.haiyen }, yen)).status, 204);
  await call('POST', '/api/jar', { requestId: randomUUID(), kind: 'sorry' }, minh);
  await sleep(150);
  assert.equal(fake.messages.length, 1, 'A forgotten phone gets nothing');
});

test('jar: the partner hears about kisses, apologies and shared feelings, never undone or private ones', async t => {
  const { call, fake, minh, yen } = await server(t);
  await call('POST', '/api/push/devices', { token: PHONE.haiyen }, yen);
  await call('POST', '/api/push/devices', { token: PHONE.minhle }, minh);
  await call('POST', '/api/jar', { requestId: randomUUID(), kind: 'kiss' }, minh);
  const undone = await call('POST', '/api/jar', { requestId: randomUUID(), kind: 'sorry' }, minh);
  await call('POST', `/api/jar/${undone.body.record.id}/archive`, {}, minh);
  const secret = await call('POST', '/api/jar', { requestId: randomUUID(), kind: 'mood', valence: -0.4, energy: 0.2, label: 'Hơi buồn' }, minh);
  await sleep(150);
  assert.deepEqual(fake.messages.map(m => [m.token, m.notification.title, m.notification.body, m.data.hash, m.data.kind]),
    [[PHONE.haiyen, 'Minh vừa hôn Yến 💋', 'Một nụ hôn mới trong bình.', 'jar', 'kiss']]);
  assert.equal(fake.messages[0].auth, 'Bearer access-1');
  assert.equal(fake.messages[0].url, 'https://fcm.googleapis.com/v1/projects/homie-test/messages:send');
  // Sharing the feeling later tells Yến once.
  await call('PUT', `/api/jar/${secret.body.record.id}`, { version: 1, visibility: 'shared', note: 'Mai đi ăn kem nhé' }, minh);
  await sleep(150);
  assert.deepEqual(fake.messages.slice(1).map(m => [m.token, m.notification.title, m.notification.body]),
    [[PHONE.haiyen, 'Minh chia sẻ cảm xúc', 'Hơi buồn · Mai đi ăn kem nhé']]);
  await call('PUT', `/api/jar/${secret.body.record.id}`, { version: 2, label: 'Đỡ buồn rồi' }, minh);
  await sleep(150);
  assert.equal(fake.messages.length, 2, 'Editing an already shared feeling is not news');
});

function textUpdate(text) {
  const doc = new Y.Doc(), paragraph = new Y.XmlElement('paragraph'), value = new Y.XmlText();
  value.insert(0, text); paragraph.insert(0, [value]); doc.getXmlFragment('body').insert(0, [paragraph]);
  const update = Y.encodeStateAsUpdate(doc); doc.destroy(); return update;
}

test('notes: new notes and newly shared boards reach the partner only when the partner can see them', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-push-notes-'));
  const store = await createNotesStore({ dataDir });
  const sent = [], waits = [];
  const timers = new Map();
  // Same contract as createPush().later: one waiting run per key.
  const push = { send: async (to, message) => { sent.push({ to, ...message }); },
    later: (key, ms, fn) => { waits.push(ms); if (!timers.has(key)) timers.set(key, setTimeout(() => { timers.delete(key); fn(); }, 150)); } };
  const unwatch = watchNotes(store, push);
  t.after(async () => { unwatch(); await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  const send = (accountId, boardId, type, payload) => store.applyCommand(accountId, { operationId: randomUUID(), accountId,
    boardId, baseRevision: store.privateBoard(boardId, accountId)?.revision ?? 0, type, payload });
  const note = async (accountId, boardId, text, extra = {}) => {
    const id = randomUUID();
    await send(accountId, boardId, 'note.create', { id, columnId: null, x: 0, y: 0, width: 200, height: 200, color: '#ffffff', ...extra });
    if (text) await store.applyText(accountId, id, textUpdate(text), randomUUID());
    return id;
  };
  const [trip, mine, journal] = [randomUUID(), randomUUID(), randomUUID()];

  await send('minhle', trip, 'board.create', { name: 'Đà Lạt', visibility: 'shared' });
  await note('minhle', trip, 'Đặt homestay');
  const last = await note('minhle', trip, 'Mua vé xe');
  await sleep(400);
  assert.deepEqual(sent.map(m => [m.to, m.title, m.body, m.data.hash, m.data.boardId, m.data.noteId]),
    [['haiyen', 'Minh chia sẻ bảng “Đà Lạt”', 'Mua vé xe', 'dashboard', trip, last]], 'One message for the board and its first notes');
  assert.equal(waits[0], 60_000, 'Notes wait a minute so the first line is written');

  sent.length = 0;
  const one = await note('minhle', trip, 'Mang áo ấm');
  await sleep(400);
  assert.deepEqual(sent.map(m => [m.to, m.title, m.body, m.data.noteId, m.tag]), [['haiyen', 'Minh thêm note vào “Đà Lạt”', 'Mang áo ấm', one, `board-${trip}`]]);

  sent.length = 0;
  await send('minhle', mine, 'board.create', { name: 'Của Minh', visibility: 'minhle' });
  await note('minhle', mine, 'Bí mật');
  await send('haiyen', journal, 'board.create', { name: 'Nhật ký', visibility: 'shared', noteDefault: 'private' });
  await sleep(400);
  assert.deepEqual(sent.map(m => [m.to, m.title]), [['minhle', 'Yến chia sẻ bảng “Nhật ký”']], 'Yến’s shared journal reaches Minh; Minh’s own board does not');
  sent.length = 0;
  await note('haiyen', journal, 'Trang riêng', { visibility: 'haiyen' });
  const trashed = await note('minhle', trip, 'Viết nhầm');
  await send('minhle', trip, 'note.trash', { id: trashed });
  await sleep(400);
  assert.deepEqual(sent, [], 'Private boards, private journal pages and trashed notes stay quiet');

  await send('minhle', mine, 'board.share', { visibility: 'shared' });
  await sleep(400);
  assert.deepEqual(sent.map(m => [m.to, m.title, m.body]), [['haiyen', 'Minh chia sẻ bảng “Của Minh”', 'Mở để xem cùng nhau.']]);
  sent.length = 0;
  await send('minhle', mine, 'board.share', { visibility: 'public' });
  await sleep(400);
  assert.deepEqual(sent, [], 'Shared to public: Yến could already see it');
});

test('sending: signed token exchange, string data, dead tokens dropped, nothing without a service account', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-push-send-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const fake = firebase(new Set(['old-phone-token-0123456789abcdef']));
  const push = createPush({ dataDir, account, fetchImpl: fake.fetchImpl });
  await push.register('haiyen', 'old-phone-token-0123456789abcdef');
  await push.register('haiyen', PHONE.haiyen);
  assert.equal(await push.send('haiyen', { title: 'T', body: 'B', data: { hash: 'jar', count: 2 }, tag: 'x' }), 1);
  assert.equal(await push.send('haiyen', { title: 'T', body: 'B' }), 1, 'The dead token is gone; the access token is reused');
  assert.equal(fake.tokenRequests.length, 1);
  const assertion = fake.tokenRequests[0].get('assertion').split('.');
  assert.equal(fake.tokenRequests[0].get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.ok(createVerify('RSA-SHA256').update(`${assertion[0]}.${assertion[1]}`).verify(publicKey, assertion[2], 'base64url'));
  assert.equal(JSON.parse(Buffer.from(assertion[1], 'base64url')).scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.deepEqual(fake.messages[1].data, { hash: 'jar', count: '2' });
  assert.deepEqual(fake.messages.map(m => m.token), [PHONE.haiyen, 'old-phone-token-0123456789abcdef', PHONE.haiyen], 'Newest phone first');
  await push.close();

  const quiet = firebase();
  const off = createPush({ dataDir, account: null, fetchImpl: quiet.fetchImpl });
  assert.equal(await off.send('haiyen', { title: 'T', body: 'B' }), 0);
  assert.equal(quiet.messages.length + quiet.tokenRequests.length, 0);
  await off.close();
});
