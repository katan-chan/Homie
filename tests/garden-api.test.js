import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { createBackend, hashPassword } from '../backend/server.js';

const origin = 'http://localhost:8000';
const passwords = { minhle: 'garden-only-minh-fixture', haiyen: 'garden-only-yen-fixture' };
let credentials;
before(async () => {
  credentials = Object.fromEntries(await Promise.all(Object.entries(passwords).map(async ([id, password]) => [id, await hashPassword(password)])));
});

function textUpdate(lines) {
  const doc = new Y.Doc(), body = doc.getXmlFragment('body');
  body.insert(0, lines.map(line => { const p = new Y.XmlElement('paragraph'), t = new Y.XmlText(); t.insert(0, line); p.insert(0, [t]); return p; }));
  const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'); doc.destroy(); return update;
}

test('GET /api/garden: members see only visible planted memories, trash hides them, guests get none', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-garden-http-'));
  const server = createBackend(origin, { credentials, dataDir, remote: null, production: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' };
  const login = async accountId => (await fetch(`${base}/api/auth/login`, { method: 'POST', headers,
    body: JSON.stringify({ accountId, password: passwords[accountId] }) })).headers.get('set-cookie').split(';')[0];
  const cookies = { minhle: await login('minhle'), haiyen: await login('haiyen') };
  const post = async (accountId, path, body) => {
    const response = await fetch(base + path, { method: 'POST', headers: { ...headers, Cookie: cookies[accountId] }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
  };
  const command = (accountId, boardId, type, payload) => post(accountId, '/api/boards/commands',
    { clientId: randomUUID(), command: { operationId: randomUUID(), accountId, boardId, baseRevision: 0, type, payload } });
  const note = async (accountId, boardId, lines, extra) => {
    const id = randomUUID();
    await command(accountId, boardId, 'note.create', { id, columnId: null, x: 0, y: 0, width: 200, height: 200, color: '#ffffff', ...extra });
    await post(accountId, `/api/notes/${id}/text`, { accountId, operationId: randomUUID(), update: textUpdate(lines) });
    return id;
  };
  const garden = async accountId => {
    const response = await fetch(`${base}/api/garden`, { headers: accountId ? { Cookie: cookies[accountId] } : {} });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return (await response.json()).items;
  };

  const [open, journal] = [randomUUID(), randomUUID()];
  await command('minhle', open, 'board.create', { name: 'Vườn nhà mình', visibility: 'public' });
  await command('haiyen', journal, 'board.create', { name: 'Nhật ký của Yến', visibility: 'shared', noteDefault: 'private' });
  const sea = await note('minhle', open, ['Đi biển Vũng Tàu', 'Gió to, cát bay.', 'Về muộn.'], { labels: ['Kỷ niệm'], memoryDate: '2026-10-12', garden: true, gardenFlower: 'poppy', gardenSize: 1.8 });
  const unplanted = await note('minhle', open, ['Chưa trồng'], { labels: ['Kỷ niệm'], memoryDate: '2026-10-01', garden: false });
  const secret = await note('haiyen', journal, ['Bí mật của Yến'], { labels: ['Kỷ niệm'], memoryDate: '2026-09-01', garden: true, visibility: 'haiyen' });
  const shared = await note('haiyen', journal, ['Bữa cơm đầu tiên'], { labels: ['Kỷ niệm'], memoryDate: '2026-11-02', garden: true, visibility: null });
  const trashed = await note('minhle', open, ['Sẽ vào thùng rác'], { labels: ['Kỷ niệm'], memoryDate: '2026-10-05', garden: true });
  await command('minhle', open, 'note.trash', { id: trashed });

  assert.deepEqual(await garden(null), [], 'Guests see no memory flowers, not even public ones');
  const minh = await garden('minhle');
  assert.deepEqual(minh.map(item => item.noteId), [sea, shared], 'Yến’s private page, unplanted and trashed memories stay out');
  assert.deepEqual(minh[0], { noteId: sea, boardId: open, boardName: 'Vườn nhà mình', title: 'Đi biển Vũng Tàu',
    memoryDate: '2026-10-12', gardenFlower: 'poppy', gardenSize: 1.8, authorId: 'minhle', body: 'Gió to, cát bay.\nVề muộn.' });
  assert.deepEqual([minh[1].gardenFlower, minh[1].gardenSize], [null, null], 'No choice yet: the garden shows the default species and size');
  assert.deepEqual((await garden('haiyen')).map(item => item.noteId), [secret, sea, shared]);
  assert.ok(!(await garden('haiyen')).some(item => item.noteId === unplanted));

  // Read-only and exact path.
  const write = await fetch(`${base}/api/garden`, { method: 'POST', headers: { ...headers, Cookie: cookies.minhle }, body: '{}' });
  assert.deepEqual([write.status, (await write.json()).code], [404, 'not_found']);
  assert.equal((await fetch(`${base}/api/garden/x`, { headers: { Cookie: cookies.minhle } })).status, 404);
});
