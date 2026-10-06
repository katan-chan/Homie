// Phone notifications for the Android app through Firebase Cloud Messaging (HTTP v1). Device tokens live in the
// 'push' document; FIREBASE_SERVICE_ACCOUNT (JSON or base64 JSON, server only) turns sending on. Without it nothing is sent.
import { createSign } from 'node:crypto';
import { createDocStore } from './doc-store.js';
import { firstLine } from './notes-memories.js';

export const NAME = { minhle: 'Minh', haiyen: 'Yến' };
export const partnerOf = id => id === 'minhle' ? 'haiyen' : 'minhle';
export const TOKEN = /^[\w:.-]{20,4096}$/;
const MAX_DEVICES = 5;
const clip = (text, max = 120) => text.length > max ? `${text.slice(0, max - 1)}…` : text;

export const emptyPush = () => ({ devices: { minhle: [], haiyen: [] } });
export function validatePush(saved) {
  if (!saved || typeof saved.devices !== 'object') throw new Error('Invalid push document');
  return { devices: { minhle: [...saved.devices.minhle ?? []], haiyen: [...saved.devices.haiyen ?? []] } };
}

export function readServiceAccount(raw = process.env.FIREBASE_SERVICE_ACCOUNT) {
  if (!raw) return null;
  const account = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  if (!account.client_email || !account.private_key || !account.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT is incomplete');
  return account;
}

export function createPush({ dataDir, remote = null, account = readServiceAccount(), fetchImpl = globalThis.fetch, log = console.error } = {}) {
  const store = createDocStore({ key: 'push', dataDir, remote, empty: emptyPush, validate: validatePush });
  const pending = new Map();
  let access = null;

  async function accessToken() {
    if (access && access.expires > Date.now() + 60_000) return access.token;
    const now = Math.floor(Date.now() / 1000), part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: account.client_email, aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/firebase.messaging', iat: now, exp: now + 3600 })}`;
    const assertion = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url')}`;
    const response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() });
    if (!response.ok) throw new Error(`Firebase token request failed (${response.status})`);
    const data = await response.json();
    access = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
    return access.token;
  }

  return {
    /** A phone belongs to one account at a time: registering moves it, newest devices first, at most five. */
    register: (accountId, token) => store.update(doc => {
      for (const id of Object.keys(doc.devices)) doc.devices[id] = doc.devices[id].filter(device => device.token !== token);
      doc.devices[accountId] = [{ token, at: new Date().toISOString() }, ...doc.devices[accountId]].slice(0, MAX_DEVICES);
    }),
    unregister: (accountId, token) => store.update(doc => {
      doc.devices[accountId] = doc.devices[accountId].filter(device => device.token !== token);
    }),
    /** Sends to every phone of accountId; a token Firebase no longer knows (404) is dropped. Returns the number sent. */
    async send(accountId, { title, body, data = {}, tag }) {
      if (!account) return 0;
      const tokens = (await store.read()).devices[accountId].map(device => device.token);
      if (!tokens.length) return 0;
      const bearer = await accessToken(), dead = [];
      let sent = 0;
      for (const token of tokens) {
        const response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
          method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { token, notification: { title: clip(title, 80), body: clip(body) },
            data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value ?? '')])),
            android: { priority: 'high', notification: { tag } } } }) });
        if (response.ok) sent++;
        else if (response.status === 404) dead.push(token);
        else log(`push: Firebase answered ${response.status}`);
      }
      if (dead.length) await store.update(doc => { doc.devices[accountId] = doc.devices[accountId].filter(device => !dead.includes(device.token)); });
      return sent;
    },
    /** Runs fn once after ms; a second call with the same key while one waits is ignored. Errors are logged, never thrown. */
    later(key, ms, fn) {
      if (pending.has(key)) return false;
      const timer = setTimeout(() => {
        pending.delete(key);
        Promise.resolve().then(fn).catch(error => log(`push: ${error.message}`));
      }, ms);
      timer.unref?.();
      pending.set(key, timer);
      return true;
    },
    close() {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      return store.close();
    },
  };
}

/** The jar message for a ball the partner can see, or null (private feeling, taken out, missing). */
export function jarMessage(record) {
  if (!record || record.archivedAt || record.visibility !== 'shared') return null;
  const from = NAME[record.ownerId], to = NAME[partnerOf(record.ownerId)];
  const data = { hash: 'jar', kind: record.kind }, tag = `jar-${record.kind}-${record.ownerId}`;
  if (record.kind === 'kiss') return { title: `${from} vừa hôn ${to} 💋`, body: 'Một nụ hôn mới trong bình.', data, tag };
  if (record.kind === 'sorry') return { title: `${from} xin lỗi ${to}`, body: 'Một lời xin lỗi mới trong bình.', data, tag };
  const body = [record.label, record.note].filter(Boolean).join(' · ');
  return { title: `${from} chia sẻ cảm xúc`, body: body || 'Một cảm xúc mới trong bình.', data, tag };
}

/**
 * Watches notes commits: a new note, or a board that just became visible to the partner, is told to the partner after
 * `delay` (so the note has its first line and several notes on one board become one message). Visibility is checked
 * again when sending: a note made private or trashed in the meantime is never mentioned.
 */
export function watchNotes(store, push, { delay = 60_000 } = {}) {
  const visible = new Map();
  for (const id of Object.keys(NAME)) for (const board of store.list(id)) visible.set(`${id}:${board.id}`, true);
  const batches = new Map();

  function flush(key) {
    const batch = batches.get(key);
    batches.delete(key);
    const partner = partnerOf(batch.actor);
    const board = store.publicBoard(batch.boardId, partner);
    if (!board || board.deletedAt) return;
    const notes = board.notes.filter(note => batch.notes.has(note.id) && !note.deletedAt);
    if (!batch.shared && !notes.length) return;
    const who = NAME[batch.actor], name = `“${clip(board.name, 40)}”`;
    const line = notes.map(note => firstLine(note.content)).filter(Boolean).at(-1) ?? '';
    const title = batch.shared ? `${who} chia sẻ bảng ${name}`
      : notes.length === 1 ? `${who} thêm note vào ${name}` : `${who} thêm ${notes.length} note vào ${name}`;
    const body = line || (batch.shared ? 'Mở để xem cùng nhau.' : 'Một note mới.');
    return push.send(partner, { title, body, tag: `board-${board.id}`,
      data: { hash: 'dashboard', boardId: board.id, noteId: notes.at(-1)?.id ?? '' } });
  }

  return store.subscribe(event => {
    if (event.type !== 'metadata' || !NAME[event.accountId]) return;
    const partner = partnerOf(event.accountId), seenKey = `${partner}:${event.boardId}`;
    let shared = false;
    if (event.commandType?.startsWith('board.') || event.commandType === 'command.undo') {
      const now = store.canSee('board', event.boardId, partner);
      shared = now && !visible.get(seenKey) && ['board.create', 'board.share'].includes(event.commandType);
      visible.set(seenKey, now);
    }
    if (!shared && event.commandType !== 'note.create') return;
    const key = `${event.accountId}:${event.boardId}`;
    const batch = batches.get(key) ?? { actor: event.accountId, boardId: event.boardId, notes: new Set(), shared: false };
    if (event.commandType === 'note.create' && event.entityId) batch.notes.add(event.entityId);
    batch.shared ||= shared;
    batches.set(key, batch);
    push.later(`notes:${key}`, delay, () => flush(key));
  });
}
