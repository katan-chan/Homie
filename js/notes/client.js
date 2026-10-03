import { API_BASE_URL } from '../config.js';
import { getUser, getAuthGeneration, authEvents, refreshSession } from '../auth.js';
import { Y, IndexeddbPersistence, Awareness } from '../../assets/vendor/notes.js';
import { applyMetadataCommand, validateCommand, requireId, requireAccount, notesError } from './model.js';

const MAX_TEXT = 262144, MAX_UPLOAD = 50 * 1024 * 1024;
const remote = Symbol('committed'), cache = Symbol('cache');
const clone = value => structuredClone(value);
async function requestIdentity(entry) {
  const value = entry.kind === 'command' ? entry.command : entry.kind === 'text'
    ? { kind: 'text', noteId: entry.noteId, update: entry.update }
    : { kind: 'upload', path: entry.path, name: entry.name, fields: entry.fields, hash: entry.hash, mimeType: entry.file.type };
  const canonical = JSON.stringify(value, (_key, part) => part && typeof part === 'object' && !Array.isArray(part)
    ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]])) : part);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const encode = bytes => {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
};
const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const defaultSession = {
  account: () => getUser()?.id ?? null,
  generation: getAuthGeneration,
  subscribe(fn) { authEvents.addEventListener('change', fn); return () => authEvents.removeEventListener('change', fn); },
};

/** Cookie credentials are transmitted by the browser, never persisted. Empty base means same origin. */
export function createNotesTransport({ baseUrl = API_BASE_URL, fetch: request = globalThis.fetch, EventSource: Stream = globalThis.EventSource } = {}) {
  return {
    async request(path, { method = 'GET', body, rawBody, headers = {}, signal } = {}) {
      const outgoing = { ...headers };
      if (!['GET', 'HEAD'].includes(method)) outgoing['X-Requested-With'] = 'Homie';
      if (body !== undefined) outgoing['Content-Type'] = 'application/json';
      const response = await request(baseUrl + path, { method, credentials: 'include', headers: outgoing,
        signal, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw notesError(data?.code ?? 'request_failed', data?.error ?? 'Không thể kết nối với máy chủ.', response.status);
      return data;
    },
    stream(path, { onEvent, onError, signal }) {
      const source = new Stream(baseUrl + path, { withCredentials: true });
      for (const name of ['snapshot', 'projection', 'projection-refresh', 'refresh', 'text-update', 'presence', 'auth-required', 'boards', 'boards-refresh']) {
        source.addEventListener(name, event => { try { onEvent(name, JSON.parse(event.data)); } catch (error) { onError(error); } });
      }
      source.onerror = onError;
      const close = () => { source.close(); signal?.removeEventListener('abort', close); };
      signal?.addEventListener('abort', close, { once: true });
      if (signal?.aborted) close();
      return close;
    },
  };
}

function transaction(db, stores, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error || Error('IndexedDB write failed'));
    try { action(tx, value => { result = value; }); } catch (error) { tx.abort(); reject(error); }
  });
}
function openDatabase(name, upgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('IndexedDB blocked'));
  });
}

/** Native atomic queue transactions; Yjs note databases use y-indexeddb's updates format. */
export function createNotesStorage() {
  const boards = () => openDatabase('homie-notes-queues-v1', db => db.createObjectStore('boards'));
  return {
    async load(key) {
      const db = await boards();
      try { return await transaction(db, ['boards'], 'readonly', (tx, done) => {
        const read = tx.objectStore('boards').get(key); read.onsuccess = () => done(read.result ?? { queue: [], snapshot: null });
      }); } finally { db.close(); }
    },
    async update(key, change) {
      const db = await boards();
      try { return await transaction(db, ['boards'], 'readwrite', (tx, done) => {
        const store = tx.objectStore('boards'), read = store.get(key);
        read.onsuccess = () => {
          try { const value = change(read.result ?? { queue: [], snapshot: null }); store.put(value, key); done(value); }
          catch { tx.abort(); }
        };
      }); } finally { db.close(); }
    },
    async loadNote(key, doc) {
      // Hydrate through y-indexeddb, then own writes explicitly so quota/transaction completion is observable.
      const loaded = new Y.Doc(); loaded.getXmlFragment('body');
      const persistence = new IndexeddbPersistence(key, loaded);
      try {
        await Promise.race([persistence.whenSynced, persistence._db.then(() => new Promise(() => {}))]);
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(loaded), cache);
      } finally { await persistence.destroy(); loaded.destroy(); }
    },
    async saveNote(key, doc) {
      const bytes = Y.encodeStateAsUpdate(doc);
      const db = await openDatabase(key, database => {
        database.createObjectStore('updates', { autoIncrement: true }); database.createObjectStore('custom');
      });
      try { await transaction(db, ['updates'], 'readwrite', tx => { tx.objectStore('updates').add(bytes); }); }
      finally { db.close(); }
    },
  };
}

/** fn receives {boards,error?}. The stream stays established during boards-refresh GET. */
export function subscribeBoards({ signal, transport = createNotesTransport() } = {}, fn) {
  let closed = false, revision = 0;
  const controller = new AbortController();
  const close = transport.stream('/api/boards/events', { signal: controller.signal, onError: error => {
    if (!closed) fn({ boards: null, error: error?.message ?? 'offline' });
  }, onEvent(name, data) {
    if (closed) return;
    if (name === 'boards') { revision++; fn(clone(data)); }
    if (name === 'boards-refresh') {
      const request = ++revision;
      transport.request('/api/boards', { signal: controller.signal }).then(value => {
        if (!closed && request === revision) fn(value);
      }).catch(error => { if (!closed && request === revision) fn({ boards: null, error: error.message }); });
    }
  } });
  const cleanup = () => { if (closed) return; closed = true; controller.abort(); close(); signal?.removeEventListener('abort', cleanup); };
  signal?.addEventListener('abort', cleanup, { once: true });
  if (signal?.aborted) cleanup();
  return cleanup;
}

/** Open resolves after isolated cache loading. Subscribe for online snapshot/ACK readiness. */
export async function openBoardClient({ boardId, accountId = null, signal, transport = createNotesTransport(),
  storage = createNotesStorage(), session = defaultSession } = {}) {
  requireId(boardId); if (accountId !== null) requireAccount(accountId);
  const scope = `homie-notes:${accountId ?? 'guest'}:${boardId}`;
  const clientId = crypto.randomUUID();
  const listeners = new Set(), documents = new Map(), awareness = new Map(), leases = new Map();
  const acknowledged = new Map(), ownOperations = new Map(), undoStack = [], redoStack = [];
  let closed = false, generation = 0, authGeneration = session.generation(), privateMode = !!accountId && session.account() === accountId;
  let expiredGeneration = null, controller = new AbortController(), stopStream = () => {}, stopAuth = () => {};
  let queue = [], snapshot = null, presence = [], localWrites = Promise.resolve(), sending = null, refreshJob = null, refreshWanted = false;
  let confirmed = false, durability = 'unknown', connection = 'connecting', error = null, leaseState = 'none', latestPresence = null;
  let heartbeat = null;
  const alive = g => !closed && !signal?.aborted && generation === g && authGeneration === session.generation();
  const writable = () => !closed && privateMode && accountId === session.account() && authGeneration === session.generation();
  function check(write = false) {
    if (closed || signal?.aborted) throw notesError('client_closed');
    if (authGeneration !== session.generation() || (privateMode && accountId !== session.account())) authChanged();
    if (write && !writable()) throw notesError('auth_required', 'Account is not authorized', 401);
  }
  function optimistic() {
    if (!snapshot || !privateMode) return snapshot;
    let state = { boards: [{ id: snapshot.id, name: snapshot.name, revision: snapshot.revision,
      metadataRevision: snapshot.metadataRevision, deletedAt: snapshot.deletedAt }],
      columns: clone(snapshot.columns), notes: clone(snapshot.notes), decorations: clone(snapshot.decorations) };
    for (const entry of queue) if (entry.kind === 'command' && entry.command.type !== 'command.undo') {
      try { state = applyMetadataCommand(state, accountId, entry.command, { assetExists: () => true }).state; } catch { /* Server resolves stale/deleted metadata; retained queue is still reviewable. */ }
    }
    return { ...snapshot, ...state.boards[0], columns: state.columns, notes: state.notes, decorations: state.decorations };
  }
  function getState() {
    if (!closed && (authGeneration !== session.generation() || privateMode && session.account() !== accountId)) authChanged();
    const pending = { commands: queue.filter(e => e.kind === 'command').length, text: queue.filter(e => e.kind === 'text').length,
      uploads: queue.filter(e => e.kind === 'upload').length, total: queue.length };
    return { boardId, accountId: privateMode ? accountId : null, clientId, snapshot: clone(optimistic()), connection,
      writable: writable(), pending, durability, error: error ? { code: error.code, message: error.message, status: error.status } : queue.find(e => e.failure)?.failure ?? null,
      leaseState, leases: [...leases.values()].map(({ target, expiresAt }) => ({ target: clone(target), expiresAt })),
      presence: clone(presence), history: { canUndo: !!undoStack.length, canRedo: !!redoStack.length } };
  }
  function notify() { if (!closed) for (const listener of listeners) listener(getState()); }
  function failed(failure, local = false) {
    if (closed || failure.code === 'stale_client') return;
    error = failure; if (local) durability = 'unsaved';
    else if (failure.status === 401) { if (privateMode) expire(); }
    else if (!failure.status || failure.status >= 500) offline();
    notify();
  }
  function offline() { connection = 'offline'; leases.clear(); leaseState = 'lost'; notify(); }
  function write(action) {
    const job = localWrites.then(action); localWrites = job.catch(() => {}); return job;
  }
  async function persist() {
    const entries = clone(queue), g = generation;
    try {
      await storage.update(scope, record => {
        const ids = new Set(entries.map(e => e.operationId));
        const retained = [...entries.filter(e => !acknowledged.has(e.operationId)),
          ...record.queue.filter(e => !ids.has(e.operationId) && !acknowledged.has(e.operationId))];
        return { ...record, queue: retained };
      });
      if (alive(g)) { durability = queue.length ? 'local' : confirmed ? 'saved' : 'unknown'; error = null; notify(); }
    } catch (failure) { if (alive(g)) failed(failure, true); throw failure; }
  }
  async function request(path, options = {}, writeRequest = false) {
    check(writeRequest); const g = generation;
    try {
      const result = await transport.request(path, { ...options, signal: controller.signal });
      if (!alive(g) || (writeRequest && !writable())) throw notesError('stale_client');
      return result;
    } catch (failure) {
      if (!alive(g)) throw notesError('stale_client');
      if (failure.status === 401 && privateMode) expire();
      throw failure;
    }
  }
  async function documentFor(noteId) {
    check(true); requireId(noteId);
    if (documents.has(noteId)) return documents.get(noteId).ready;
    const doc = new Y.Doc(); doc.getXmlFragment('body');
    const key = `${scope}:${noteId}`, g = generation;
    const record = { doc, key, ready: null, listener: null };
    documents.set(noteId, record);
    record.ready = (async () => {
      try {
        const loaded = new Y.Doc(); loaded.getXmlFragment('body');
        try {
          await storage.loadNote(key, loaded);
          if (!alive(g) || !writable()) throw notesError('stale_client');
          Y.applyUpdate(doc, Y.encodeStateAsUpdate(loaded), cache);
        } finally { loaded.destroy(); }
        if (snapshot?.texts?.[noteId]) Y.applyUpdate(doc, decode(snapshot.texts[noteId]), remote);
        for (const entry of queue) if (entry.kind === 'text' && entry.noteId === noteId) Y.applyUpdate(doc, decode(entry.update), cache);
        record.listener = (bytes, origin) => {
          if (origin === remote || origin === cache || !writable() || documents.get(noteId) !== record) return;
          const entry = { kind: 'text', noteId, update: encode(bytes), operationId: crypto.randomUUID() };
          queue.push(entry); durability = 'saving'; notify();
          write(async () => { await persist(); await storage.saveNote(key, doc); }).then(() => flush()).catch(failure => { if (alive(g)) failed(failure, true); });
        };
        doc.on('update', record.listener);
        return doc;
      } catch (failure) { if (documents.get(noteId) === record) documents.delete(noteId); doc.destroy(); throw failure; }
    })();
    return record.ready;
  }
  function clearPrivate() {
    for (const record of documents.values()) { if (record.listener) record.doc.off('update', record.listener); record.doc.destroy(); }
    documents.clear(); for (const value of awareness.values()) value.destroy(); awareness.clear();
    leases.clear(); presence = []; latestPresence = null; leaseState = 'lost';
  }
  function changeMode(next) {
    generation++; controller.abort(); stopStream(); controller = new AbortController(); refreshJob = null;
    clearPrivate(); privateMode = next; snapshot = null; confirmed = false; durability = queue.length ? 'local' : 'unknown'; connection = next ? 'connecting' : 'auth-required'; notify();
    if (!next) startStream();
    else {
      const g = generation;
      storage.load(scope).then(saved => {
        if (!alive(g) || !writable()) return;
        for (const [id, receipt] of Object.entries(saved.receipts ?? {})) acknowledged.set(id, receipt);
        queue = queue.filter(entry => !acknowledged.has(entry.operationId));
        for (const entry of saved.queue) if (!acknowledged.has(entry.operationId) && !queue.some(e => e.operationId === entry.operationId)) queue.push(entry);
        snapshot = saved.snapshot; notify(); startStream();
      }).catch(failure => { if (alive(g)) { failed(failure, true); startStream(); } });
    }
  }
  function authChanged() {
    if (closed) return;
    const nextGeneration = session.generation();
    if (nextGeneration === authGeneration && (!!accountId && session.account() === accountId) === privateMode) return;
    authGeneration = nextGeneration;
    const next = !!accountId && session.account() === accountId && expiredGeneration !== authGeneration;
    changeMode(next);
  }
  function expire() {
    expiredGeneration = session.generation(); changeMode(false);
    if (session === defaultSession) refreshSession().catch(() => {});
  }
  async function mergeBoard(board, g) {
    if (!alive(g)) return;
    if (privateMode && board) {
      if (!snapshot || board.revision >= snapshot.revision) snapshot = clone(board);
      for (const [noteId, encoded] of Object.entries(board.texts ?? {})) {
        const doc = await documentFor(noteId); if (!alive(g)) return;
        Y.applyUpdate(doc, decode(encoded), remote); await storage.saveNote(`${scope}:${noteId}`, doc);
      }
    } else snapshot = board ? clone(board) : null;
    if (!alive(g)) return;
    await storage.update(privateMode ? scope : `homie-notes:guest:${boardId}`, record => ({ ...record,
      snapshot: (!record.snapshot || !snapshot || snapshot.revision >= record.snapshot.revision) ? clone(snapshot) : record.snapshot }));
    if (!alive(g)) return;
    confirmed = true;
    if (durability !== 'unsaved') durability = queue.length ? 'local' : 'saved';
    connection = 'online'; error = null; notify();
  }
  async function refresh() {
    check(); refreshWanted = true;
    if (refreshJob) return refreshJob;
    const g = generation;
    const job = (async () => {
      do {
        refreshWanted = false;
        try {
          const data = await request(`/api/boards/${boardId}${privateMode ? '/collaboration' : ''}`);
          await mergeBoard(data.board, g);
        } catch (failure) {
          if (!alive(g)) return;
          if (!privateMode && failure.status === 404) { snapshot = null; connection = 'online'; notify(); }
          else failed(failure, failure.status !== 401 && !!failure.message?.includes('Quota'));
        }
      } while (refreshWanted && alive(g));
    })();
    refreshJob = job;
    try { await job; } finally { if (refreshJob === job) refreshJob = null; }
  }
  function startStream() {
    if (closed) return;
    const g = generation;
    try { stopStream = transport.stream(`/api/boards/${boardId}/events?clientId=${clientId}`, {
      signal: controller.signal, onError: () => { if (alive(g)) offline(); }, onEvent(name, data) {
        if (!alive(g)) { authChanged(); return; }
        if (data.boardId && data.boardId !== boardId) return;
        if (name === 'auth-required') { if (privateMode) expire(); return; }
        if (name === 'presence' && privateMode) { presence = clone(data.clients); bridgePresence(); notify(); }
        if (name === 'text-update' && privateMode) {
          documentFor(data.noteId).then(async doc => {
            if (!alive(g)) return; Y.applyUpdate(doc, decode(data.update), remote);
            await storage.saveNote(`${scope}:${data.noteId}`, doc); if (alive(g)) notify();
          }).catch(failure => { if (alive(g)) failed(failure, true); });
        }
        if (['snapshot', 'projection', 'projection-refresh', 'refresh'].includes(name)) {
          // The first snapshot proves subscription is established before the mergeable GET.
          refresh().then(() => { if (alive(g) && writable()) flush().catch(failure => failed(failure)); });
        }
      },
    }); } catch (failure) { failed(failure); }
  }
  function targets(entry) {
    const c = entry.command, p = c.payload, fields = ['x', 'y', 'width', 'height', 'rotation', 'z'];
    if (c.type === 'command.undo') return ownOperations.get(p.operationId)?.targets ?? [];
    if (c.type === 'note.move' || ['column.update', 'note.update', 'decoration.update'].includes(c.type) && fields.some(k => Object.hasOwn(p, k))) {
      return [{ kind: c.type.split('.')[0], id: p.id }];
    }
    return [];
  }
  async function acquireLease(target) {
    check(true); requireId(target.id);
    if (!['note', 'column', 'decoration'].includes(target.kind)) throw notesError('invalid_fields');
    if (connection !== 'online') throw notesError('offline', 'Lease requires connection', 409);
    const value = await request(`/api/boards/${boardId}/leases`, { method: 'POST', body: { accountId, clientId, action: 'acquire', target } }, true);
    leases.set(`${target.kind}:${target.id}`, { ...value, target: clone(target) }); leaseState = 'held'; notify(); return clone(value);
  }
  async function renewLease(target) {
    check(true); const held = leases.get(`${target.kind}:${target.id}`); if (!held) throw notesError('lease_required', '', 409);
    const value = await request(`/api/boards/${boardId}/leases`, { method: 'POST', body: { accountId, clientId, action: 'renew', leaseToken: held.leaseToken } }, true);
    leases.set(`${target.kind}:${target.id}`, { ...held, ...value }); return clone(value);
  }
  async function releaseLease(target) {
    check(true); const key = `${target.kind}:${target.id}`, held = leases.get(key); if (!held) return;
    leases.delete(key); leaseState = leases.size ? 'held' : 'none'; notify();
    if (connection === 'online') await request(`/api/boards/${boardId}/leases`, { method: 'POST', body: { accountId, clientId, action: 'release', leaseToken: held.leaseToken } }, true);
  }
  async function flush() {
    check(); if (!writable()) return getState();
    await localWrites; await write(persist);
    const creating = queue.some(e => e.kind === 'command' && e.command.type === 'board.create');
    if (connection !== 'online' && !creating) return getState();
    if (sending) return sending;
    const g = generation;
    const job = (async () => {
      const saved = await storage.load(scope); if (!alive(g)) return getState();
      for (const [id, receipt] of Object.entries(saved.receipts ?? {})) acknowledged.set(id, receipt);
      queue = queue.filter(entry => !acknowledged.has(entry.operationId));
      for (const entry of saved.queue) if (!acknowledged.has(entry.operationId) && !queue.some(e => e.operationId === entry.operationId)) queue.push(entry);
      if (connection !== 'online' && creating) {
        // A nonexistent board has no SSE yet. Verify the live account, create, then subscribe before GET.
        try {
          const current = await request('/api/auth/session', {}, true);
          if (current.user?.id !== accountId) { expire(); return getState(); }
        } catch (failure) { if (alive(g)) failed(failure); return getState(); }
      }
      for (const entry of [...queue]) {
        if (!alive(g) || !writable() || connection !== 'online' && entry.command?.type !== 'board.create') break;
        try {
          const identity = await requestIdentity(entry);
          if (!alive(g) || !writable()) break;
          let result;
          if (entry.kind === 'command') {
            const leaseTokens = [];
            for (const target of targets(entry)) {
              let held = leases.get(`${target.kind}:${target.id}`);
              if (!held || held.expiresAt <= Date.now() + 1000) { await acquireLease(target); held = leases.get(`${target.kind}:${target.id}`); }
              leaseTokens.push(held.leaseToken);
            }
            result = await request('/api/boards/commands', { method: 'POST', body: { command: entry.command, clientId, leaseTokens } }, true);
          } else if (entry.kind === 'text') {
            result = await request(`/api/notes/${entry.noteId}/text`, { method: 'POST', body: { accountId, operationId: entry.operationId, update: entry.update } }, true);
          } else {
            const form = new FormData();
            for (const [key, value] of Object.entries({ ...entry.fields, accountId, operationId: entry.operationId })) form.append(key, value);
            form.append('file', entry.file, entry.name);
            result = await request(entry.path, { method: 'POST', rawBody: form }, true);
          }
          if (!alive(g) || !writable()) break;
          await write(async () => {
            const receipt = { identity, result: clone(result), ...(entry.kind === 'command' ? { baseRevision: entry.command.baseRevision } : {}) };
            await storage.update(scope, record => ({ ...record, queue: record.queue.filter(e => e.operationId !== entry.operationId),
              receipts: { ...record.receipts, [entry.operationId]: receipt } }));
            if (!alive(g)) return;
            acknowledged.set(entry.operationId, receipt); confirmed = true;
            queue = queue.filter(e => e.operationId !== entry.operationId);
            if (entry.kind === 'command' && entry.owner === clientId) {
              const affected = result.revisions.map(({ kind, id }) => ({ kind, id }));
              for (const target of entry.undoTargets ?? []) if (!affected.some(t => t.kind === target.kind && t.id === target.id)) affected.push(target);
              ownOperations.set(entry.operationId, { result, targets: affected.some(t => t.kind === 'board') ? [] : affected });
              if (entry.history === 'undo') { undoStack.pop(); redoStack.push(entry.operationId); }
              else if (entry.history === 'redo') { redoStack.pop(); undoStack.push(entry.operationId); }
              else { undoStack.push(entry.operationId); redoStack.length = 0; }
            }
            durability = queue.length ? 'local' : confirmed ? 'saved' : 'unknown'; error = null; notify();
          });
          if (entry.kind === 'command') {
            if (entry.command.type === 'board.create') await reconnect();
            else await refresh();
          }
        } catch (failure) {
          if (!alive(g)) break;
          if (['lease_conflict', 'lease_required'].includes(failure.code)) { leases.clear(); leaseState = 'blocked'; error = failure; notify(); continue; }
          if (failure.code === 'invalid_text') {
            // Dependencies may be missing. Merge the committed state and prepend a bounded repair; preserve original ID/bytes.
            await refresh(); const doc = await documentFor(entry.noteId);
            const repair = Y.encodeStateAsUpdate(doc, snapshot?.texts?.[entry.noteId] ? Y.encodeStateVectorFromUpdate(decode(snapshot.texts[entry.noteId])) : undefined);
            if (repair.length <= MAX_TEXT && !queue.some(e => e.repairFor === entry.operationId)) {
              queue.unshift({ kind: 'text', noteId: entry.noteId, operationId: crypto.randomUUID(), update: encode(repair), repairFor: entry.operationId }); await write(persist);
            }
          }
          entry.failure = { code: failure.code, status: failure.status, message: failure.message };
          failed(failure);
          if (failure.status >= 400 && failure.status < 500 && failure.status !== 401 && failure.code !== 'invalid_text') continue;
          break;
        }
      }
      return getState();
    })();
    sending = job;
    try { return await job; } finally { if (sending === job) sending = null; }
  }
  async function enqueue(entry) {
    check(true); const g = generation;
    const identity = await requestIdentity(entry);
    if (!alive(g)) throw notesError('stale_client');
    check(true);
    const receipt = acknowledged.get(entry.operationId);
    if (receipt) {
      if (receipt.identity !== identity) throw notesError('operation_conflict', '', 409);
      return clone(receipt.result);
    }
    const duplicate = queue.find(e => e.operationId === entry.operationId);
    if (duplicate && await requestIdentity(duplicate) !== identity) throw notesError('operation_conflict', '', 409);
    if (!alive(g)) throw notesError('stale_client');
    check(true);
    if (!duplicate) queue.push(entry);
    durability = 'saving'; notify(); await write(persist); await flush();
    const accepted = acknowledged.get(entry.operationId);
    if (accepted && accepted.identity !== identity) throw notesError('operation_conflict', '', 409);
    return accepted?.result ?? { operationId: entry.operationId, pending: true };
  }
  async function command(value, history) {
    check(true);
    const original = queue.find(entry => entry.operationId === value.operationId)?.command ?? acknowledged.get(value.operationId);
    const envelope = { operationId: crypto.randomUUID(), accountId, boardId, baseRevision: original?.baseRevision ?? snapshot?.revision ?? 0, ...clone(value) };
    validateCommand(envelope, accountId);
    if (envelope.boardId !== boardId) throw notesError('wrong_board');
    if (envelope.type === 'command.undo' && !ownOperations.has(envelope.payload.operationId)) throw notesError('undo_conflict', 'Operation is not in this tab history', 409);
    const undoTargets = [];
    if (envelope.type === 'note.move') {
      const currentColumn = optimistic()?.notes.find(n => n.id === envelope.payload.id)?.columnId;
      for (const id of [currentColumn, envelope.payload.columnId]) if (id && !undoTargets.some(t => t.id === id)) undoTargets.push({ kind: 'column', id });
    }
    return enqueue({ kind: 'command', operationId: envelope.operationId, command: envelope, owner: clientId, undoTargets, ...(history ? { history } : {}) });
  }
  async function applyText(noteId, bytes) {
    check(true); if (!(bytes instanceof Uint8Array) || bytes.length > MAX_TEXT) throw notesError('invalid_text');
    const doc = await documentFor(noteId); check(true);
    Y.applyUpdate(doc, bytes); await localWrites;
    if (durability === 'unsaved') throw error;
    await flush(); return getState();
  }
  function bridgePresence() {
    for (const [noteId, value] of awareness) {
      const next = new Map();
      for (const peer of presence) for (const editor of peer.editors) if (editor.noteId === noteId && peer.clientId !== clientId) {
        next.set(editor.yClientId, { user: { name: peer.displayName, color: peer.color }, cursor: editor.anchor === null ? null : {
          anchor: Y.relativePositionToJSON(Y.decodeRelativePosition(decode(editor.anchor))), head: Y.relativePositionToJSON(Y.decodeRelativePosition(decode(editor.head))) } });
      }
      const removed = [...value.states.keys()].filter(id => id !== value.doc.clientID && !next.has(id)), added = [], updated = [];
      for (const id of removed) value.states.delete(id);
      for (const [id, state] of next) { (value.states.has(id) ? updated : added).push(id); value.states.set(id, state); value.meta.set(id, { clock: Date.now(), lastUpdated: Date.now() }); }
      if (removed.length || added.length || updated.length) value.emit('change', [{ added, updated, removed }, remote]);
    }
  }
  async function getAwareness(noteId) {
    check(true); const doc = await documentFor(noteId); check(true);
    if (!awareness.has(noteId)) { const value = new Awareness(doc); value.setLocalState(null); awareness.set(noteId, value); bridgePresence(); }
    return awareness.get(noteId);
  }
  async function publishPresence(value, retry = true) {
    check(true); latestPresence = clone(value); await flush(); check(true);
    if (connection !== 'online') return { pending: true };
    const editors = value.editors.map(editor => ({ ...editor,
      anchor: editor.anchor === null ? null : typeof editor.anchor === 'string' ? editor.anchor : encode(Y.encodeRelativePosition(editor.anchor)),
      head: editor.head === null ? null : typeof editor.head === 'string' ? editor.head : encode(Y.encodeRelativePosition(editor.head)) }));
    // Pointer can be published while a caret still references unacknowledged structs.
    for (const editor of editors) if (queue.some(e => e.kind === 'text' && e.noteId === editor.noteId)) editor.anchor = editor.head = null;
    try { return await request(`/api/boards/${boardId}/presence`, { method: 'POST', body: { accountId, clientId, pointer: value.pointer, editors } }, true); }
    catch (failure) {
      if (retry && failure.code === 'invalid_presence') { await refresh(); await flush(); check(true); return publishPresence(latestPresence, false); }
      failed(failure); throw failure;
    }
  }
  async function queueUpload({ path = '/api/assets', file, name = file?.name ?? 'upload', fields = {}, operationId = crypto.randomUUID() }) {
    check(true); const g = generation; requireId(operationId);
    if (!(file instanceof Blob) || file.size > MAX_UPLOAD || !file.size || !/^\/api\//.test(path)
      || Object.values(fields).some(v => typeof v !== 'string') || Object.keys(fields).some(k => ['accountId', 'operationId', 'file'].includes(k))) throw notesError('invalid_upload');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
    if (!alive(g)) throw notesError('stale_client');
    check(true);
    const hash = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return enqueue({ kind: 'upload', operationId, path, file, name, fields: clone(fields), hash });
  }
  async function reconnect() {
    check(); generation++; controller.abort(); stopStream(); controller = new AbortController(); refreshJob = null;
    leases.clear(); leaseState = 'lost'; connection = 'connecting'; startStream(); notify();
  }
  async function close() {
    if (closed) return;
    closed = true; generation++; controller.abort(); stopStream(); stopAuth(); clearInterval(heartbeat);
    signal?.removeEventListener('abort', close); globalThis.removeEventListener?.('online', reconnect); globalThis.removeEventListener?.('offline', offline);
    listeners.clear(); clearPrivate(); await localWrites;
  }
  const client = { clientId, boardId, accountId, getState,
    subscribe(fn) { check(); listeners.add(fn); fn(getState()); return () => listeners.delete(fn); },
    command, applyText, flush, close, reconnect, refresh,
    getPending() { check(true); return clone(queue); },
    async discardPending(operationId) {
      check(true); const entry = queue.find(e => e.operationId === operationId);
      if (!entry) return;
      if (entry.kind === 'text') throw notesError('invalid_fields', 'Retained text drafts cannot be discarded through metadata history');
      const g = generation;
      await write(() => storage.update(scope, record => ({ ...record, queue: record.queue.filter(e => e.operationId !== operationId) })));
      if (alive(g)) { queue = queue.filter(e => e.operationId !== operationId); error = null; durability = queue.length ? 'local' : confirmed ? 'saved' : 'unknown'; notify(); }
    },
    getDocument: documentFor, getAwareness,
    acquireLease, renewLease, releaseLease, publishPresence, queueUpload,
    async undo() { check(true); if (!undoStack.length) return false; return command({ type: 'command.undo', payload: { operationId: undoStack.at(-1) } }, 'undo'); },
    async redo() { check(true); if (!redoStack.length) return false; return command({ type: 'command.undo', payload: { operationId: redoStack.at(-1) } }, 'redo'); },
    async listTrash() { check(true); return (await request('/api/boards/trash', {}, true)).boards; },
    async authenticatedRequest(path, options = {}) { return request(path, options, true); },
  };
  signal?.addEventListener('abort', close, { once: true });
  if (signal?.aborted) { await close(); return client; }
  try {
    const g = generation;
    const saved = await storage.load(privateMode ? scope : `homie-notes:guest:${boardId}`);
    if (!alive(g)) { check(); return client; }
    queue = accountId ? saved.queue : []; snapshot = saved.snapshot;
    if (privateMode) for (const [id, receipt] of Object.entries(saved.receipts ?? {})) acknowledged.set(id, receipt);
    durability = queue.length ? 'local' : confirmed ? 'saved' : 'unknown';
  } catch (failure) { failed(failure, true); }
  stopAuth = session.subscribe(authChanged);
  globalThis.addEventListener?.('online', reconnect); globalThis.addEventListener?.('offline', offline);
  startStream();
  heartbeat = setInterval(() => {
    if (!closed) check();
    if (!writable() || connection !== 'online') return;
    for (const { target } of leases.values()) renewLease(target).catch(failure => { leases.clear(); leaseState = 'lost'; failed(failure); });
    if (latestPresence) publishPresence(latestPresence).catch(() => {});
    if (queue.length) flush().catch(failure => failed(failure));
  }, 3000);
  return client;
}
