import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { validateMediaMetadata } from './note-media.js';
import * as Y from 'yjs';
import { MAX_TEXT_UPDATE_BYTES } from './notes-store.js';
import { notesError, requireId, requireKeys } from '../js/notes/model.js';

const LEASE_MS = 10000, PRESENCE_MS = 15000, HEARTBEAT_MS = 3000;
const MAX_BODY = 16384, MAX_TEXT_BODY = 360448, MAX_FRAME = 4 * 1024 * 1024;
const MAX_QUEUE = 8 * 1024 * 1024, MAX_QUEUED_EVENTS = 128;
const colors = { minhle: '#a33f68', haiyen: '#446da8' };

export function notesRoute(path) {
  if (path === '/api/note-assets') return { name: 'assets', methods: ['GET', 'HEAD', 'POST'] };
  const preview = /^\/api\/note-assets\/previews\/([^/]+)\/(file|poster)$/.exec(path);
  if (preview) return { name: 'asset-preview', id: preview[1], part: preview[2], methods: ['GET', 'HEAD'] };
  const asset = /^\/api\/note-assets\/([^/]+)(?:\/(file|poster))?$/.exec(path);
  if (asset) return { name: asset[2] ? 'asset-file' : 'asset-update', id: asset[1], part: asset[2], methods: asset[2] ? ['GET', 'HEAD'] : ['PUT'] };
  if (path === '/api/boards') return { name: 'list', methods: ['GET', 'HEAD'] };
  if (path === '/api/boards/events') return { name: 'catalog', methods: ['GET', 'HEAD'] };
  if (path === '/api/boards/trash') return { name: 'trash', methods: ['GET', 'HEAD'] };
  if (path === '/api/boards/commands') return { name: 'command', methods: ['POST'] };
  const board = /^\/api\/boards\/([^/]+)(?:\/(events|collaboration|leases|presence))?$/.exec(path);
  if (board) return { name: board[2] ?? 'board', id: board[1], methods: ['leases', 'presence'].includes(board[2]) ? ['POST'] : ['GET', 'HEAD'] };
  const text = /^\/api\/notes\/([^/]+)\/text$/.exec(path);
  return text ? { name: 'text', id: text[1], methods: ['POST'] } : null;
}

function base64(value, maximum, code = 'invalid_text') {
  if (typeof value !== 'string' || !value.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw notesError(code);
  if (value.length > Math.ceil(maximum / 3) * 4) throw notesError('body_too_large', 'Encoded update is too large', 413);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maximum) throw notesError('body_too_large', 'Update is too large', 413);
  if (bytes.toString('base64') !== value) throw notesError(code);
  return bytes;
}

export function createNotesApi({ store, auth, allowedOrigins, profiles, media }) {
  const allowed = new Set(allowedOrigins), streams = new Set(), leases = new Map(), presence = new Map(), bodies = new Set();
  let closing = false, closePromise;
  const send = (res, status, body) => {
    if (res.destroyed || res.writableEnded) return;
    if (closing) res.setHeader('Connection', 'close');
    res.writeHead(status).end(body === undefined ? undefined : JSON.stringify(body));
  };
  function sessionRequired(session) {
    if (!auth.isSession(session)) throw notesError('unauthorized', 'Authentication required', 401);
  }
  function account(body, session) {
    sessionRequired(session);
    if (body.accountId !== session.id) throw notesError('account_mismatch', 'Account does not match session', 403);
  }
  const owner = (record, session, clientId) => record.session.token === session.token && record.clientId === clientId;
  function descriptor(kind, id, boardId, viewer) {
    if (!['column', 'note', 'decoration'].includes(kind)) throw notesError('invalid_fields');
    requireId(id);
    const entity = store.entity(kind, id);
    if (!entity || viewer !== undefined && !store.canSee(kind, id, viewer)) throw notesError('not_found', 'Object not found', 404);
    // A sticker carries what it follows: its note (and that note's column) or its column.
    const note = kind === 'note' ? entity : kind === 'decoration' && entity.noteId ? store.entity('note', entity.noteId) : null;
    const result = { kind, id, boardId: entity.boardId, ...(note ? { columnId: note.columnId } : kind === 'decoration' ? { columnId: entity.columnId } : {}),
      ...(kind === 'decoration' ? { noteId: entity.noteId } : {}) };
    if (result.boardId !== boardId) throw notesError('wrong_board', 'Object belongs to another board', 409);
    return result;
  }
  function conflicts(a, b) {
    if (a.boardId !== b.boardId) return false;
    if (a.kind === 'board' || b.kind === 'board') return true;
    if (a.kind === b.kind && a.id === b.id) return true;
    if (a.kind === 'column') return b.columnId === a.id;
    if (b.kind === 'column') return a.columnId === b.id;
    // A note overlaps the stickers that follow it; unattached stickers and distinct notes never overlap.
    if (a.kind === 'note' && b.kind === 'decoration') return b.noteId === a.id;
    if (b.kind === 'note' && a.kind === 'decoration') return a.noteId === b.id;
    return false;
  }
  function releaseClient(session, clientId, boardId) {
    for (const [token, lease] of leases) if (owner(lease, session, clientId) && (!boardId || lease.target.boardId === boardId)) leases.delete(token);
    let changed = false;
    for (const [key, record] of presence) if (owner(record, session, clientId) && (!boardId || record.boardId === boardId)) { presence.delete(key); changed = true; }
    if (changed) publishPresence(boardId);
  }
  function prune() {
    const now = Date.now(), changed = new Set();
    for (const [token, lease] of leases) if (lease.expiresAt <= now || !auth.isSession(lease.session)) leases.delete(token);
    for (const [key, record] of presence) if (record.expiresAt <= now || !auth.isSession(record.session)) { presence.delete(key); changed.add(record.boardId); }
    for (const boardId of changed) publishPresence(boardId);
  }
  function authorize(session, clientId, leaseTokens, command) {
    return context => {
      sessionRequired(session);
      if (closing) throw notesError('store_closed', 'Notes API is closing', 503);
      if (context.replay || context.type === 'text') return;
      prune();
      if (['board.rename', 'board.share', 'board.update'].includes(context.type)) return;
      for (const lease of leases.values()) {
        const target = descriptor(lease.target.kind, lease.target.id, lease.target.boardId);
        if (!owner(lease, session, clientId) && context.targets.some(changed => conflicts(changed, target))) throw notesError('lease_conflict', 'Object is held by another client', 409);
      }
      const geometry = command.type === 'note.move' || ['column.update', 'note.update', 'decoration.update'].includes(command.type)
        && ['x', 'y', 'width', 'height', 'rotation', 'z'].some(field => Object.hasOwn(command.payload, field));
      const undo = command.type === 'command.undo' && !context.targets.some(target => target.kind === 'board');
      if (!geometry && !undo) return;
      const targets = undo ? context.targets : context.targets.filter(target => target.kind === command.type.split('.')[0] && target.id === command.payload.id);
      for (const target of targets) {
        const held = leaseTokens.some(token => {
          const lease = leases.get(token);
          if (!lease || !owner(lease, session, clientId) || lease.target.boardId !== context.boardId) return false;
          const leaseTarget = descriptor(lease.target.kind, lease.target.id, context.boardId);
          return leaseTarget.kind === target.kind && leaseTarget.id === target.id || leaseTarget.kind === 'column' && target.columnId === leaseTarget.id
            || leaseTarget.kind === 'note' && target.kind === 'decoration' && target.noteId === leaseTarget.id;
        });
        if (!held) throw notesError('lease_required', 'Acquire the geometry lease before changing this object', 409);
      }
    };
  }
  function readJson(req, limit) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) { req.resume(); throw notesError('unsupported_media_type', 'Content-Type must be application/json', 415); }
    return new Promise((resolve, reject) => {
      let size = 0, finished = false; const chunks = [];
      const finish = (error, value) => {
        if (finished) return; finished = true; bodies.delete(cancel);
        req.removeListener('data', data); req.removeListener('end', end); req.removeListener('error', failed); req.removeListener('aborted', failed);
        if (error) { req.resume(); reject(error); } else resolve(value);
      };
      const cancel = () => finish(notesError('store_closed', 'Notes API is closing', 503));
      const failed = () => finish(notesError('invalid_body', 'Request aborted'));
      const data = chunk => { size += chunk.length; if (size > limit) finish(notesError('body_too_large', 'Request body too large', 413)); else chunks.push(chunk); };
      const end = () => { try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(notesError('invalid_body', 'Invalid JSON')); } };
      bodies.add(cancel); req.on('data', data); req.on('end', end); req.on('error', failed); req.on('aborted', failed);
      if (Number(req.headers['content-length'] ?? 0) > limit) finish(notesError('body_too_large', 'Request body too large', 413));
    });
  }
  function publicPresence(boardId, viewer) {
    return { clients: [...presence.values()].filter(record => record.boardId === boardId && record.expiresAt > Date.now() && auth.isSession(record.session))
      .map(({ session, boardId: ignored, ...record }) => ({ ...record, editors: record.editors.filter(editor => store.canSee('note', editor.noteId, viewer)), accountId: session.id })) };
  }
  function publishPresence(boardId) {
    for (const stream of streams) if (stream.session && stream.boardId && (!boardId || stream.boardId === boardId)) stream.event('presence', publicPresence(stream.boardId, stream.viewer), true);
  }
  function openStream(req, res, route, session, url) {
    if (streams.size >= 128 || session && [...streams].filter(stream => stream.session?.token === session.token).length >= 16) throw notesError('stream_limit', 'Too many streams', 429);
    const boardId = route.name === 'catalog' ? null : route.id, clientId = url.searchParams.get('clientId');
    if (clientId !== null) requireId(clientId);
    const viewer = session?.id ?? null;
    if (boardId && !(session ? store.privateBoard(boardId, viewer) : store.publicBoard(boardId))) throw notesError('not_found', 'Board not found', 404);
    if (req.method === 'HEAD') { res.setHeader('Content-Type', 'text/event-stream; charset=utf-8'); return send(res, 200); }
    const queue = []; let blocked = false, queuedBytes = 0, stopped = false;
    // account: whose view this stream shows (the catalog too); session: who receives private board events.
    const stream = { boardId, clientId, viewer, account: session, session: route.name === 'catalog' ? null : session, event, close, expire };
    function close() {
      if (stopped) return; stopped = true; streams.delete(stream); clearInterval(heartbeat); clearTimeout(expiry);
      res.removeListener('drain', drain); res.removeListener('close', close); queue.length = 0;
      if (stream.session && clientId && ![...streams].some(other => other.session?.token === stream.session.token && other.clientId === clientId && other.boardId === boardId)) releaseClient(stream.session, clientId, boardId);
      res.end();
    }
    function expire() {
      if (stopped) return;
      queue.length = 0; queuedBytes = 0;
      // This terminal notice carries no private data and never promotes the stream to a new session.
      if (res.writableLength < MAX_QUEUE) res.write('event: auth-required\ndata: {"code":"unauthorized"}\n\n');
      close();
    }
    function valid() {
      if (stopped) return false;
      if (stream.account && !auth.isSession(stream.account)) { expire(); return false; }
      return true;
    }
    function write(frame) {
      if (!valid()) return;
      const bytes = Buffer.byteLength(frame);
      if (bytes > MAX_FRAME || queuedBytes + res.writableLength + bytes > MAX_QUEUE || queue.length >= MAX_QUEUED_EVENTS) { res.destroy(); close(); return; }
      if (blocked) { queue.push(frame); queuedBytes += bytes; } else blocked = !res.write(frame);
    }
    function event(name, body, privateEvent = false, revision) {
      if (privateEvent && !stream.session) return;
      const frame = `${revision === undefined ? '' : `id: ${revision}\n`}event: ${name}\ndata: ${JSON.stringify(body)}\n\n`;
      if (Buffer.byteLength(frame) > MAX_FRAME) {
        if (name === 'boards') return event('boards-refresh', {});
        if (name === 'snapshot' || name === 'projection') return event('projection-refresh', { boardId, revision: body.revision,
          ...(stream.session ? { collaboration: true } : {}) }, false, revision);
      }
      write(frame);
    }
    function drain() {
      blocked = false;
      while (queue.length && !blocked && valid()) { const frame = queue.shift(); queuedBytes -= Buffer.byteLength(frame); blocked = !res.write(frame); }
    }
    const heartbeat = setInterval(() => write(': heartbeat\n\n'), HEARTBEAT_MS); heartbeat.unref();
    const expiry = stream.account ? setTimeout(expire, Math.max(0, stream.account.expiresAt - Date.now())) : null; expiry?.unref();
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8'); res.setHeader('X-Accel-Buffering', 'no');
    res.writeHead(200); res.on('drain', drain); res.on('close', close);
    // Register before reading the snapshot. Reconnects always refresh; no unbounded event history is retained.
    streams.add(stream); write('retry: 1000\n\n');
    if (!boardId) event('boards', { boards: store.list(viewer) });
    else {
      const board = store.publicBoard(boardId, viewer), revision = store.entity('board', boardId).revision;
      event('snapshot', { boardId, board, revision, ...(stream.session ? { collaboration: true } : {}) }, false, revision);
      if (stream.session) event('presence', publicPresence(boardId, viewer), true);
    }
  }
  const unsubscribe = store.subscribe(event => {
    if (closing) return;
    for (const stream of streams) {
      if (!stream.boardId) {
        if (event.type === 'refresh' || event.commandType?.startsWith('board.') || event.commandType === 'command.undo') stream.event('boards', { boards: store.list(stream.viewer) });
      } else if (stream.boardId === event.boardId) {
        if (event.type === 'text' && stream.session) { if (store.canSee('note', event.noteId, stream.viewer)) stream.event('text-update', event, true, event.revision); }
        else stream.event('projection', { boardId: event.boardId, board: store.publicBoard(event.boardId, stream.viewer), revision: event.revision }, false, event.revision);
        if (stream.session && event.type !== 'text') stream.event('refresh', { boardId: event.boardId, revision: event.revision,
          ...(event.operationId ? { operationId: event.operationId, commandType: event.commandType } : {}) }, true, event.revision);
      }
    }
  });
  const unsubscribeAuth = auth.subscribeRevocation(token => {
    const changed = new Set();
    for (const [key, lease] of leases) if (lease.session.token === token) leases.delete(key);
    for (const [key, record] of presence) if (record.session.token === token) { presence.delete(key); changed.add(record.boardId); }
    for (const stream of streams) if (stream.account?.token === token) stream.expire();
    for (const boardId of changed) publishPresence(boardId);
  });
  const timer = setInterval(prune, 1000); timer.unref();

  function validatePresence(body, boardId, session) {
    requireKeys(body, ['accountId', 'clientId', 'pointer', 'editors']); requireId(body.clientId);
    const board = store.publicBoard(boardId, session.id);
    if (!board) throw notesError('not_found', 'Active board not found', 404);
    if (body.pointer !== null) {
      requireKeys(body.pointer, ['x', 'y']);
      if (![body.pointer.x, body.pointer.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e7)) throw notesError('invalid_presence');
    }
    if (!Array.isArray(body.editors) || body.editors.length > 16) throw notesError('invalid_presence');
    const seen = new Set();
    for (const editor of body.editors) {
      requireKeys(editor, ['noteId', 'yClientId', 'anchor', 'head']); requireId(editor.noteId);
      if (!Number.isSafeInteger(editor.yClientId) || editor.yClientId < 0 || editor.yClientId > 0xffffffff || seen.has(editor.noteId)) throw notesError('invalid_presence');
      if ((editor.anchor === null) !== (editor.head === null)) throw notesError('invalid_presence');
      seen.add(editor.noteId);
      for (const record of presence.values()) {
        if (record.boardId === boardId && !owner(record, session, body.clientId) && record.expiresAt > Date.now()
          && record.editors.some(other => other.noteId === editor.noteId && other.yClientId === editor.yClientId)) throw notesError('presence_conflict', 'Editor client identity is already in use', 409);
      }
      if (!board.notes.some(note => note.id === editor.noteId)) throw notesError('not_found', 'Active note not found', 404);
      const doc = new Y.Doc();
      try {
        doc.getXmlFragment('body');
        Y.applyUpdate(doc, Buffer.from(store.privateBoard(boardId, session.id).texts[editor.noteId], 'base64'));
        for (const encoded of [editor.anchor, editor.head]) {
          if (encoded === null) continue;
          const bytes = base64(encoded, 1024, 'invalid_presence'), relative = Y.decodeRelativePosition(bytes);
          if (!Buffer.from(Y.encodeRelativePosition(relative)).equals(bytes)) throw notesError('invalid_presence');
          const absolute = Y.createAbsolutePositionFromRelativePosition(relative, doc);
          if (!absolute) throw notesError('invalid_presence', 'Caret must reference committed note content');
          let root = absolute.type; while (root.parent) root = root.parent;
          if (root !== doc.getXmlFragment('body')) throw notesError('invalid_presence');
        }
      } catch (error) { if (error.status) throw error; throw notesError('invalid_presence'); }
      finally { doc.destroy(); }
    }
  }
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost'), route = notesRoute(url.pathname);
    if (!route) return false;
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Vary', 'Origin');
    try {
      const origin = req.headers.origin;
      if (origin && !allowed.has(origin)) throw notesError('forbidden', 'Origin not allowed', 403);
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Access-Control-Allow-Methods', [...route.methods, 'OPTIONS'].join(', ')); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, X-Note-Metadata'); }
      if (req.method === 'OPTIONS') { send(res, 204); return true; }
      if (!route.methods.includes(req.method)) { res.setHeader('Allow', [...route.methods, 'OPTIONS'].join(', ')); throw notesError('method_not_allowed', 'Method not allowed', 405); }
      if (closing) throw notesError('store_closed', 'Notes API is closing', 503);
      if (route.id) requireId(route.id);
      const session = auth.session(req);
      if (req.method === 'POST' || req.method === 'PUT') {
        if (!origin || !allowed.has(origin) || req.headers['x-requested-with'] !== 'Homie') throw notesError('forbidden', 'Mutation requires allowed Origin and X-Requested-With', 403);
        sessionRequired(session);
      }
      if (route.name.startsWith('asset')) {
        if (!media) throw notesError('media_unavailable', 'Media converter unavailable', 503);
        if (route.name === 'asset-file' || route.name === 'asset-preview') {
          if (route.name === 'asset-preview') sessionRequired(session);
          const file = route.name === 'asset-preview' ? media.resolvePreview(route.id, session.token, route.part === 'poster')
            : session ? media.resolveAsset(route.id, route.part === 'poster') : media.resolvePublicAsset(route.id, route.part === 'poster');
          if (!file) throw notesError('not_found', 'Asset not found', 404);
          if (file.remoteKey) {
            const remoteFile = await media.fetchRemote(file.remoteKey);
            if (!remoteFile) throw notesError('not_found', 'Asset file not found', 404);
            if (session) { try { sessionRequired(session); } catch (error) { await remoteFile.body?.cancel(); throw error; } }
            res.setHeader('Content-Type', file.mimeType); res.setHeader('X-Content-Type-Options', 'nosniff');
            const length = remoteFile.headers.get('content-length'); if (length) res.setHeader('Content-Length', length);
            if (req.method === 'HEAD') { await remoteFile.body?.cancel(); send(res, 200); }
            else { res.writeHead(200); await pipeline(Readable.fromWeb(remoteFile.body), res); }
            return true;
          }
          let handle;
          try { handle = await open(file.path, 'r'); }
          catch { throw notesError('not_found', 'Asset file not found', 404); }
          try {
            if (session) sessionRequired(session);
            res.setHeader('Content-Type', file.mimeType); res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Length', (await handle.stat()).size);
            if (req.method === 'HEAD') send(res, 200);
            else { res.writeHead(200); await pipeline(handle.createReadStream({ autoClose: false }), res); }
          } finally { await handle.close(); }
        } else {
          sessionRequired(session);
          const authorize = () => { sessionRequired(session); if(closing) throw notesError('store_closed','Notes API is closing',503); };
          if (req.method === 'GET' || req.method === 'HEAD') send(res,200,req.method === 'HEAD' ? undefined : {assets:media.list()});
          else if (route.name === 'asset-update') {
            const body = await readJson(req,MAX_BODY); account(body,session);
            requireKeys(body,['accountId','operationId','action'],body.action === 'rename' ? ['name'] : []); requireId(body.operationId);
            if(body.action === 'rename' && typeof body.name === 'string') send(res,200,await media.rename(route.id,body.name,{accountId:session.id,operationId:body.operationId,authorize}));
            else if(body.action === 'remove') send(res,200,await media.remove(route.id,{accountId:session.id,operationId:body.operationId,authorize}));
            else throw notesError('invalid_media');
          } else {
            if (!/^application\/octet-stream(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {req.resume();throw notesError('unsupported_media_type','Upload raw binary',415);}
            const encoded = req.headers['x-note-metadata'];
            let metadata;
            try { if(typeof encoded !== 'string' || encoded.length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error(); metadata=JSON.parse(Buffer.from(encoded,'base64').toString('utf8')); }
            catch {req.resume();throw notesError('invalid_media','Invalid upload metadata');}
            validateMediaMetadata(metadata); account(metadata,session);
            if(Object.hasOwn(metadata,'preview'))throw notesError('invalid_media');
            const controller=new AbortController(),cancel=()=>controller.abort(notesError('media_aborted','Upload aborted',400));
            bodies.add(cancel);req.once('aborted',cancel);const disconnected=()=>{if(!res.writableEnded)cancel();};res.once('close',disconnected);
            try {send(res,200,await media.ingest({stream:req,metadata:{...metadata,preview:url.searchParams.get('preview')==='1'},sessionToken:session.token,signal:controller.signal,authorize}));}
            finally {bodies.delete(cancel);req.removeListener('aborted',cancel);res.removeListener('close',disconnected);req.resume();}
          }
        }
      } else if (route.name === 'list') send(res, 200, { boards: store.list(session?.id ?? null) });
      else if (route.name === 'trash') { sessionRequired(session); send(res, 200, { boards: store.list(session.id, { includeDeleted: true }).filter(board => board.deletedAt !== null) }); }
      else if (route.name === 'board' || route.name === 'collaboration') {
        if (route.name === 'collaboration') sessionRequired(session);
        const board = route.name === 'board' ? store.publicBoard(route.id, session?.id ?? null) : store.privateBoard(route.id, session.id);
        if (!board) throw notesError('not_found', 'Board not found', 404);
        if (route.name === 'collaboration') sessionRequired(session);
        send(res, 200, { board });
      } else if (route.name === 'catalog' || route.name === 'events') openStream(req, res, route, session, url);
      else {
        const body = await readJson(req, route.name === 'text' ? MAX_TEXT_BODY : route.name === 'presence' ? 8192 : MAX_BODY);
        sessionRequired(session);
        if (route.name === 'command') {
          requireKeys(body, ['command', 'clientId'], ['leaseTokens']); requireId(body.clientId);
          requireKeys(body.command, ['operationId', 'accountId', 'boardId', 'baseRevision', 'type', 'payload']); account(body.command, session);
          const tokens = body.leaseTokens ?? [];
          if (!Array.isArray(tokens) || tokens.length > 64 || tokens.some(token => typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))) throw notesError('invalid_fields');
          send(res, 200, await store.applyCommand(session.id, body.command, { authorize: authorize(session, body.clientId, tokens, body.command) }));
        } else if (route.name === 'text') {
          requireKeys(body, ['accountId', 'operationId', 'update']); account(body, session);
          send(res, 200, await store.applyText(session.id, route.id, base64(body.update, MAX_TEXT_UPDATE_BYTES), body.operationId, { authorize: authorize(session) }));
        } else if (route.name === 'leases') {
          requireKeys(body, ['accountId', 'clientId', 'action'], ['target', 'leaseToken']); account(body, session); requireId(body.clientId); prune();
          if (!store.privateBoard(route.id, session.id)) throw notesError('not_found', 'Board not found', 404);
          if (body.action === 'acquire') {
            requireKeys(body, ['accountId', 'clientId', 'action', 'target']); requireKeys(body.target, ['kind', 'id']);
            const target = descriptor(body.target.kind, body.target.id, route.id, session.id);
            for (const lease of leases.values()) if (!owner(lease, session, body.clientId) && conflicts(target, descriptor(lease.target.kind, lease.target.id, lease.target.boardId))) throw notesError('lease_conflict', 'Object is held by another client', 409);
            const existing = [...leases.entries()].find(([, lease]) => owner(lease, session, body.clientId) && lease.target.kind === target.kind && lease.target.id === target.id);
            if (!existing && (leases.size >= 256 || [...leases.values()].filter(lease => owner(lease, session, body.clientId)).length >= 64)) throw notesError('lease_limit', 'Too many leases', 429);
            const leaseToken = existing?.[0] ?? randomBytes(32).toString('hex'), expiresAt = Date.now() + LEASE_MS;
            leases.set(leaseToken, { session, clientId: body.clientId, target, expiresAt }); send(res, 200, { leaseToken, expiresAt });
          } else if (['renew', 'release'].includes(body.action)) {
            requireKeys(body, ['accountId', 'clientId', 'action', 'leaseToken']);
            const lease = leases.get(body.leaseToken);
            if (!lease || !owner(lease, session, body.clientId) || lease.target.boardId !== route.id) throw notesError('lease_conflict', 'Lease expired or belongs to another client', 409);
            if (body.action === 'release') { leases.delete(body.leaseToken); send(res, 200, { released: true }); }
            else { lease.expiresAt = Date.now() + LEASE_MS; send(res, 200, { leaseToken: body.leaseToken, expiresAt: lease.expiresAt }); }
          } else throw notesError('invalid_fields');
        } else if (route.name === 'presence') {
          requireKeys(body, ['accountId', 'clientId', 'pointer', 'editors']); account(body, session);
          const profile = await profiles.get(session.id); sessionRequired(session);
          if (closing) throw notesError('store_closed', 'Notes API is closing', 503);
          validatePresence(body, route.id, session);
          const key = `${session.token}:${body.clientId}:${route.id}`;
          if (!presence.has(key) && presence.size >= 128) throw notesError('presence_limit', 'Too many presence clients', 429);
          presence.set(key, { session, boardId: route.id, clientId: body.clientId, pointer: body.pointer, editors: body.editors, displayName: profile.displayName, color: colors[session.id], expiresAt: Date.now() + PRESENCE_MS });
          publishPresence(route.id); send(res, 200, { expiresAt: presence.get(key).expiresAt });
        }
      }
    } catch (error) { send(res, error.status ?? 500, { error: error.status ? error.message : 'Internal server error', code: error.status ? error.code : 'internal_error' }); }
    return true;
  }
  function close() {
    if (closePromise) return closePromise;
    closing = true; clearInterval(timer); unsubscribe(); unsubscribeAuth();
    for (const cancel of bodies) cancel();
    for (const stream of streams) stream.close();
    presence.clear(); leases.clear();
    closePromise = Promise.resolve(media?.close()).then(() => store.close()); return closePromise;
  }
  return { handle, close };
}
