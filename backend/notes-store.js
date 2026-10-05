import { mkdir, readFile, open, rename, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { emptyNotesState, applyMetadataCommand, applyMetadataUndo, validateNotesState,
  validateCommand, projectBoard, findEntity, isVisible, canSee, canView, mutationTargets, notesError,
  requireAccount, requireId, requireKeys } from '../js/notes/model.js';

export const NOTES_FORMAT_VERSION = 6;
export const MAX_TEXT_UPDATE_BYTES = 256 * 1024;
export const MAX_TEXT_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_NODES = 10000, MAX_TEXT_DEPTH = 32;
const collectionKeys = ['boards', 'columns', 'notes', 'decorations'];
const metadata = state => Object.fromEntries(collectionKeys.map(key => [key, state[key]]));
const clone = value => structuredClone(value);
const textError = () => notesError('invalid_text', 'Invalid or oversized rich text');

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw notesError('invalid_fields');
}
const fingerprint = value => createHash('sha256').update(canonical(value)).digest('hex');
function decodeBase64(value, limit) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(limit / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw textError();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > limit || bytes.toString('base64') !== value) throw textError();
  return bytes;
}
function cssColor(value) {
  return typeof value === 'string' && (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
    || /^rgb\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}\s*\)$/.test(value) && value.match(/\d+/g).every(n => Number(n) <= 255));
}
function cssFontSize(value) {
  return typeof value === 'string' && /^\d{2}px$/.test(value) && parseInt(value) >= 10 && parseInt(value) <= 72;
}
function readRichText(doc) {
  if ([...doc.share.keys()].some(key => key !== 'body')) throw textError();
  const root = doc.getXmlFragment('body');
  // Yjs can retain map values on a shared type even after it is accessed as XML.
  if (root._map.size || doc.store.pendingStructs || doc.store.pendingDs) throw textError();
  let count = 0, characters = 0;
  const blocks = ['paragraph', 'bulletList', 'orderedList', 'taskList'];
  const children = (parent, depth) => {
    if (depth > MAX_TEXT_DEPTH) throw textError();
    return parent.toArray().flatMap(child => {
      if (++count > MAX_TEXT_NODES) throw textError();
      if (child instanceof Y.XmlText) {
        if (child._map.size) throw textError();
        return child.toDelta().map(part => {
          if (typeof part.insert !== 'string') throw textError();
          characters += part.insert.length;
          if (characters > MAX_TEXT_UPDATE_BYTES) throw textError();
          const node = { type: 'text', text: part.insert }, marks = [];
          for (const [type, attrs] of Object.entries(part.attributes ?? {})) {
            if (!['bold', 'italic', 'underline', 'textStyle'].includes(type)) throw textError();
            requireKeys(attrs, [], type === 'textStyle' ? ['color', 'fontSize'] : []);
            if (type === 'textStyle' && attrs.color !== undefined && attrs.color !== null && !cssColor(attrs.color)) throw textError();
            if (type === 'textStyle' && attrs.fontSize !== undefined && attrs.fontSize !== null && !cssFontSize(attrs.fontSize)) throw textError();
            marks.push({ type, ...(Object.keys(attrs).length ? { attrs } : {}) });
          }
          if (marks.length) node.marks = marks;
          return node;
        });
      }
      if (!(child instanceof Y.XmlElement)) throw textError();
      const type = child.nodeName;
      if (![...blocks, 'listItem', 'taskItem'].includes(type)) throw textError();
      const attrs = child.getAttributes();
      requireKeys(attrs, [], type === 'orderedList' ? ['start', 'type'] : type === 'taskItem' ? ['checked'] : []);
      if (type === 'orderedList' && (attrs.start !== undefined && (!Number.isSafeInteger(attrs.start) || attrs.start < 1)
        || attrs.type !== undefined && attrs.type !== null && !['1', 'a', 'A', 'i', 'I'].includes(attrs.type))) throw textError();
      if (type === 'taskItem' && attrs.checked !== undefined && typeof attrs.checked !== 'boolean') throw textError();
      const content = children(child, depth + 1);
      if (type === 'paragraph' && content.some(node => node.type !== 'text')
        || ['bulletList', 'orderedList'].includes(type) && (!content.length || content.some(node => node.type !== 'listItem'))
        || type === 'taskList' && (!content.length || content.some(node => node.type !== 'taskItem'))
        || ['listItem', 'taskItem'].includes(type) && (content[0]?.type !== 'paragraph' || content.some(node => !blocks.includes(node.type)))) throw textError();
      return [{ type, ...(Object.keys(attrs).length ? { attrs } : {}), ...(content.length ? { content } : {}) }];
    });
  };
  const content = children(root, 0);
  if (content.some(node => !blocks.includes(node.type))) throw textError();
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
function checkedText(encoded, update) {
  const doc = new Y.Doc();
  try {
    if (encoded) Y.applyUpdate(doc, decodeBase64(encoded, MAX_TEXT_DOCUMENT_BYTES));
    if (update) Y.applyUpdate(doc, update);
    const content = readRichText(doc);
    const bytes = Y.encodeStateAsUpdate(doc);
    if (bytes.byteLength > MAX_TEXT_DOCUMENT_BYTES) throw textError();
    return { encoded: Buffer.from(bytes).toString('base64'), content };
  } catch { throw textError(); }
  finally { doc.destroy(); }
}
const emptyText = checkedText(null).encoded;

function validateAsset(asset) {
  requireKeys(asset, ['id', 'name', 'mimeType', 'fileName', 'posterName', 'width', 'height', 'bytes', 'animated', 'createdBy', 'removed', 'revision']);
  requireId(asset.id); requireAccount(asset.createdBy);
  if (typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > 120
    || !['image/gif', 'video/webm'].includes(asset.mimeType)
    || typeof asset.animated !== 'boolean' || typeof asset.removed !== 'boolean') throw notesError('invalid_asset');
  for (const key of ['width', 'height', 'bytes', 'revision']) if (!Number.isSafeInteger(asset[key]) || asset[key] <= 0) throw notesError('invalid_asset');
  for (const key of ['fileName', 'posterName']) {
    if (typeof asset[key] !== 'string' || basename(asset[key]) !== asset[key]
      || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(asset[key])) throw notesError('invalid_asset');
  }
}
// Own inverse lineage preserves deletion status, not the time of repeated creation undo.
function sameMetadataState(left, right) {
  const fields = record => {
    const { revision, metadataRevision, deletedAt, ...content } = record;
    return { ...content, deletedAt: deletedAt !== null };
  };
  return canonical(fields(left)) === canonical(fields(right));
}

function validateInverse(undo, target) {
  if (canonical(undo.entity) !== canonical(target.entity) || canonical(undo.groups) !== canonical(target.groups)) throw notesError('invalid_state');
  for (const change of undo.changes) {
    const original = target.changes.find(other => other.kind === change.kind && other.id === change.id);
    const key = change.kind === 'board' ? 'metadataRevision' : 'revision';
    if (!change.before || change.before[key] < original.after[key] || change.after[key] !== change.before[key] + 1
      || change.kind === 'board' && change.after.revision !== change.before.revision) throw notesError('invalid_state');
    const before = original.after;
    // Reversing creation retains the original entity and generates its own tombstone.
    const after = original.before ?? { ...before, deletedAt: change.after.deletedAt };
    if (!original.before && after.deletedAt === null
      || !sameMetadataState(change.before, before)
      || !sameMetadataState(change.after, after)) throw notesError('invalid_state');
  }
}

// Version 2 kept stickers inside notes (note-relative x/y); version 3 put them on the board without an attachment.
// Version 4 stores world coordinates plus the note or column a sticker follows: v2 keeps its note, v3 attaches by
// where the sticker's centre lies (topmost note, else column). Undo records hold older shapes, so they are dropped.
// Version 5 adds who may view: existing boards stay public (their author is whoever ran board.create), notes follow
// their board and start without labels.
// Version 6 adds journals and memories: boards get noteDefault null, notes memoryDate null, garden false and
// gardenFlower null. Undo records gain the same defaults, so history survives this step. gardenFlower joined v6 before
// it shipped, so v6 snapshots written without it get the default too (the step only fills missing fields).
export function migrateNotesSnapshot(saved) {
  if (![2, 3, 4, 5, 6].includes(saved?.formatVersion)) return saved;
  const state = saved.formatVersion >= 4 ? clone(saved) : migrateStickers(saved);
  if (state.formatVersion < 5) {
    state.boards = state.boards.map(board => ({ ...board,
      authorId: state.operations.find(op => op.boardId === board.id)?.accountId ?? 'minhle', visibility: 'public' }));
    state.notes = state.notes.map(note => ({ ...note, visibility: null, labels: [] }));
    for (const op of state.operations) op.undo = null;
  }
  const v6 = (kind, record) => !record ? record : kind === 'board' ? { noteDefault: null, ...record }
    : kind === 'note' ? { memoryDate: null, garden: false, gardenFlower: null, ...record } : record;
  state.boards = state.boards.map(board => v6('board', board));
  state.notes = state.notes.map(note => v6('note', note));
  for (const change of state.operations.flatMap(op => op.undo?.changes ?? [])) {
    change.before = v6(change.kind, change.before); change.after = v6(change.kind, change.after);
  }
  state.formatVersion = 6;
  return state;
}
function migrateStickers(saved) {
  const state = clone(saved), inside = (e, x, y) => e.deletedAt === null && x >= e.x && x <= e.x + e.width && y >= e.y && y <= e.y + e.height;
  state.decorations = state.decorations.map(decoration => {
    if (saved.formatVersion === 2) {
      const { noteId, ...rest } = decoration, note = findEntity(state, 'note', noteId);
      if (!note) throw notesError('invalid_state');
      return { ...rest, boardId: note.boardId, noteId, columnId: null, x: note.x + rest.x, y: note.y + rest.y, revision: rest.revision + 1 };
    }
    const cx = decoration.x + decoration.width / 2, cy = decoration.y + decoration.height / 2;
    const note = state.notes.filter(n => n.boardId === decoration.boardId && inside(n, cx, cy)).at(-1);
    const column = note ? null : state.columns.filter(c => c.boardId === decoration.boardId && inside(c, cx, cy)).at(-1);
    return { ...decoration, noteId: note?.id ?? null, columnId: column?.id ?? null, revision: decoration.revision + 1 };
  });
  return state;
}

function validateSnapshot(state) {
  requireKeys(state, ['formatVersion', 'revision', ...collectionKeys, 'texts', 'operations', 'assets']);
  if (state.formatVersion !== NOTES_FORMAT_VERSION) throw notesError('unsupported_version');
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) throw notesError('invalid_state');
  validateNotesState(state);
  requireKeys(state.texts, state.notes.map(note => note.id));
  for (const encoded of Object.values(state.texts)) checkedText(encoded);
  if (!Array.isArray(state.assets) || !Array.isArray(state.operations)) throw notesError('invalid_state');
  const assets = new Set();
  for (const asset of state.assets) { validateAsset(asset); if (assets.has(asset.id)) throw notesError('duplicate_id'); assets.add(asset.id); }
  for (const decoration of state.decorations) if (!assets.has(decoration.assetId)) throw notesError('asset_not_found');
  const operations = new Set(), priorOperations = new Map();
  for (const op of state.operations) {
    requireKeys(op, ['id', 'accountId', 'boardId', 'fingerprint', 'result', 'undo']);
    requireId(op.id); requireAccount(op.accountId);
    if (op.boardId !== null && !findEntity(state, 'board', op.boardId)) throw notesError('invalid_state');
    if (operations.has(op.id) || typeof op.fingerprint !== 'string' || !/^[\da-f]{64}$/.test(op.fingerprint)) throw notesError('invalid_state');
    operations.add(op.id);
    requireKeys(op.result, ['revision', 'operationId'], ['entity', 'revisions', 'asset']);
    if (op.result.asset !== undefined) {
      validateAsset(op.result.asset);
      if (op.boardId !== null || op.undo !== null || op.result.asset.id !== op.id || op.result.asset.createdBy !== op.accountId || !assets.has(op.result.asset.id)) throw notesError('invalid_state');
    }
    if (!Number.isSafeInteger(op.result.revision) || op.result.revision < 1 || op.result.operationId !== op.id) throw notesError('invalid_state');
    const eventRevision = op.boardId === null ? state.revision : findEntity(state, 'board', op.boardId).revision;
    if (op.result.revision > eventRevision) throw notesError('invalid_state');
    if (op.result.entity) {
      requireKeys(op.result.entity, ['kind', 'id']);
      if (!findEntity(state, op.result.entity.kind, op.result.entity.id)) throw notesError('invalid_state');
    }
    if (op.result.revisions !== undefined) {
      if (!Array.isArray(op.result.revisions) || !op.result.revisions.length) throw notesError('invalid_state');
      for (const entry of op.result.revisions) {
        requireKeys(entry, ['kind', 'id', 'revision']);
        const entity = findEntity(state, entry.kind, entry.id);
        if (!entity || !Number.isSafeInteger(entry.revision) || entry.revision < 1
          || entry.revision > entity[entry.kind === 'board' ? 'metadataRevision' : 'revision']) throw notesError('invalid_state');
      }
    }
    if (op.undo !== null) {
      requireKeys(op.undo, ['changes', 'groups', 'entity', 'undoOf']);
      if (op.undo.undoOf !== null) {
        requireId(op.undo.undoOf);
        const target = priorOperations.get(op.undo.undoOf);
        if (!target?.undo || target.accountId !== op.accountId || target.boardId !== op.boardId
          || !Array.isArray(op.undo.changes) || op.undo.changes.length !== target.undo.changes.length
          || target.undo.changes.some(change => !op.undo.changes.some(other => other.kind === change.kind && other.id === change.id))) throw notesError('invalid_state');
      }
      requireKeys(op.undo.entity, ['kind', 'id']);
      if (!op.result.entity || canonical(op.result.entity) !== canonical(op.undo.entity)
        || !Array.isArray(op.undo.changes) || !op.undo.changes.length || !Array.isArray(op.undo.groups)) throw notesError('invalid_state');
      for (const change of op.undo.changes) {
        requireKeys(change, ['kind', 'id', 'before', 'after']);
        const live = findEntity(state, change.kind, change.id);
        if (!live || change.after?.id !== change.id || change.before !== null && change.before?.id !== change.id) throw notesError('invalid_state');
        const ownerBoard = change.kind === 'board' ? live.id : live.boardId;
        if (ownerBoard !== op.boardId || change.kind === 'note'
          && [change.before, change.after].filter(Boolean).some(note => note.authorId !== live.authorId)) throw notesError('invalid_state');
        // Validate historic records in the present hierarchy (entities are never permanently removed).
        for (const record of [change.before, change.after].filter(Boolean)) {
          const historic = clone(metadata(state));
          const collection = historic[{ board: 'boards', column: 'columns', note: 'notes', decoration: 'decorations' }[change.kind]];
          collection[collection.findIndex(entity => entity.id === change.id)] = record;
          validateNotesState(historic);
        }
      }
      for (const group of op.undo.groups) {
        requireKeys(group, ['kind', 'id', 'memberIds']);
        if (!['board', 'column', 'note'].includes(group.kind) || !findEntity(state, group.kind, group.id)
          || !Array.isArray(group.memberIds) || new Set(group.memberIds).size !== group.memberIds.length
          || group.memberIds.some(id => !collectionKeys.some(key => state[key].some(entity => entity.id === id)))) throw notesError('invalid_state');
      }
      if (op.undo.undoOf !== null) validateInverse(op.undo, priorOperations.get(op.undo.undoOf).undo);
    }
    priorOperations.set(op.id, op);
  }
  return state;
}

// Rebase only states reached by explicit inverses; ordinary equal-valued edits are new states.
function rebaseUndo(state, original) {
  const undo = clone(original.undo), operations = new Map(state.operations.map(operation => [operation.id, operation]));
  for (const change of undo.changes) {
    const key = change.kind === 'board' ? 'metadataRevision' : 'revision';
    const live = findEntity(state, change.kind, change.id);
    if (!sameMetadataState(live, change.after)) throw notesError('undo_conflict', 'Entity metadata changed since operation', 409);
    const expected = change.after[key], current = live[key];
    if (current === expected) continue;
    const versions = new Map();
    for (const operation of state.operations) {
      const entry = operation.undo?.changes.find(other => other.kind === change.kind && other.id === change.id);
      if (!entry) continue;
      if (entry.after[key] > expected && operation.accountId !== original.accountId) {
        throw notesError('undo_conflict', 'Peer metadata changed since operation', 409);
      }
      versions.set(entry.after[key], operation);
    }
    const resolve = revision => {
      // Each inverse points to an earlier operation; the bound also fails closed on corrupt cycles.
      for (let remaining = versions.size; remaining >= 0; remaining -= 1) {
        const operation = versions.get(revision);
        if (!operation?.undo.undoOf) return revision;
        const target = operations.get(operation.undo.undoOf).undo.changes
          .find(other => other.kind === change.kind && other.id === change.id);
        revision = target.before?.[key] ?? 0;
      }
      throw notesError('undo_conflict', 'Invalid undo lineage', 409);
    };
    if (resolve(current) !== resolve(expected)) throw notesError('undo_conflict', 'Entity changed since operation', 409);
    change.after[key] = current;
  }
  return undo;
}

/** remote: optional Supabase storage (backend/supabase.js); otherwise notes.json in dataDir. */
export async function createNotesStore({ dataDir, remote = null }) {
  const path = join(dataDir, 'notes.json');
  const read = async () => {
    if (!remote) return JSON.parse(await readFile(path, 'utf8'));
    const saved = await remote.getDocument('notes');
    if (saved === null) throw Object.assign(new Error('No notes yet'), { code: 'ENOENT' });
    return saved;
  };
  let state;
  try { state = validateSnapshot(migrateNotesSnapshot(await read())); }
  catch (error) {
    if (error.code !== 'ENOENT') throw notesError('storage_unavailable', 'Notes snapshot is invalid or unavailable', 503);
    state = { formatVersion: NOTES_FORMAT_VERSION, revision: 0, ...emptyNotesState(), texts: {}, operations: [], assets: [] };
  }
  let writes = Promise.resolve(), closing = false, needsSync = false, unavailable = false;
  const listeners = new Set();
  async function syncDirectory() {
    if (remote) return;
    const directory = await open(dataDir, 'r');
    try { await directory.sync(); }
    catch (error) { if (!['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error; }
    finally { await directory.close(); }
  }
  async function persist(candidate) {
    // ponytail: rewrites the whole snapshot per commit; fine for two accounts, move to per-board rows if it grows.
    if (remote) {
      try { await remote.putDocument('notes', candidate); return; }
      catch {
        // The upsert may have committed before the network failed: reconcile before any retry can overwrite it.
        try { const saved = validateSnapshot(migrateNotesSnapshot(await read())); if (saved.revision === candidate.revision) { state = saved; needsSync = true; throw notesError('durability_uncertain', 'Commit reached storage; retry the same operation ID', 503); } }
        catch (error) { if (error.code === 'durability_uncertain') throw error; }
        throw notesError('storage_unavailable', 'Notes write failed (remote)', 503);
      }
    }
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    let renamed = false;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(`${JSON.stringify(candidate)}\n`); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, path); renamed = true;
      await syncDirectory();
    } catch (error) {
      if (renamed) {
        // The rename may have committed: reconcile before any retry can overwrite it.
        try { state = validateSnapshot(migrateNotesSnapshot(JSON.parse(await readFile(path, 'utf8')))); needsSync = true; }
        catch { unavailable = true; }
        throw notesError('durability_uncertain', 'Commit reached disk; retry the same operation ID', 503);
      }
      throw notesError('storage_unavailable', `Notes write failed (${error.code || 'I/O'})`, 503);
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  const publish = event => {
    for (const listener of listeners) {
      try { listener(clone(event)); } catch { /* A failed subscriber cannot turn a persisted commit into a failed write. */ }
    }
  };
  function enqueue(action) {
    if (closing) return Promise.reject(notesError('store_closed', 'Notes store is closing', 503));
    // ponytail: a single queue and snapshot are sufficient for two accounts; journal if data/traffic grows.
    const operation = writes.then(async () => {
      if (unavailable) throw notesError('storage_unavailable', 'Snapshot requires recovery', 503);
      if (needsSync) {
        await syncDirectory(); needsSync = false;
        for (const board of state.boards) publish({ type: 'refresh', boardId: board.id, revision: board.revision });
      }
      return action();
    });
    writes = operation.catch(() => {});
    return operation;
  }
  function repeated(userId, operationId, hash) {
    requireAccount(userId); requireId(operationId);
    const found = state.operations.find(operation => operation.id === operationId);
    if (found && (found.accountId !== userId || found.fingerprint !== hash)) throw notesError('operation_conflict', 'Operation ID was used for different content or account', 409);
    return found ? clone(found.result) : null;
  }
  async function checkRetry(userId, operationId, hash, authorize, context) {
    const result = repeated(userId, operationId, hash);
    if (result && authorize) await authorize({ userId, operationId, ...context, replay: true, targets: [] });
    return result;
  }
  async function commit(candidate, userId, operationId, boardId, hash, result, undo, event) {
    candidate.revision = state.revision + 1;
    candidate.operations.push({ id: operationId, accountId: userId, boardId, fingerprint: hash, result, undo });
    await persist(candidate);
    state = candidate;
    if (event) publish(event);
    return clone(result);
  }
  const store = {
    /** viewer: account ID or null (guest); everything below shows only what that viewer may see. */
    list(viewer = null, { includeDeleted = false } = {}) {
      return clone(state.boards.filter(board => canView(board.visibility, viewer) && (includeDeleted || board.deletedAt === null)));
    },
    canSee(kind, id, viewer = null) { return canSee(state, kind, findEntity(state, kind, id), viewer); },
    publicBoard(id, viewer = null) {
      const projection = projectBoard(state, id, { viewer });
      if (projection) for (const note of projection.notes) note.content = checkedText(state.texts[note.id]).content;
      if (projection) projection.media = state.assets.filter(asset => projection.decorations.some(decoration => decoration.assetId === asset.id && isVisible(state, 'decoration', decoration)))
        .map(({ id, mimeType, animated, width, height, name }) => ({ id, mimeType, animated, width, height, name }));
      return projection;
    },
    privateBoard(id, viewer) {
      const projection = projectBoard(state, id, { includeDeleted: true, viewer });
      if (projection) projection.texts = Object.fromEntries(projection.notes.map(note => [note.id, state.texts[note.id]]));
      if (projection) projection.media = state.assets.filter(asset => projection.decorations.some(decoration => decoration.assetId === asset.id && isVisible(state, 'decoration', decoration)))
        .map(({ id, mimeType, animated, width, height, name }) => ({ id, mimeType, animated, width, height, name }));
      return projection;
    },
    entity(kind, id) { return clone(findEntity(state, kind, id)); },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Expected listener');
      if (!closing) listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyCommand(userId, command, { authorize } = {}) {
      // Freeze the request before the async queue so callers cannot change an enqueued command.
      let request;
      try { request = clone(command); validateCommand(request, userId); }
      catch (error) { return Promise.reject(error); }
      return enqueue(async () => {
        const hash = fingerprint(request);
        const retry = await checkRetry(userId, request.operationId, hash, authorize, { boardId: request.boardId, type: request.type });
        if (retry) return retry;
        let mutation, inverseTarget;
        if (request.type === 'command.undo') {
          requireKeys(request.payload, ['operationId']); requireId(request.payload.operationId);
          const original = state.operations.find(operation => operation.id === request.payload.operationId);
          if (!original || !original.undo || original.boardId !== request.boardId) throw notesError('not_found', 'Undo operation not found', 404);
          if (original.accountId !== userId) throw notesError('forbidden', 'Undo belongs to another account', 403);
          if (!canSee(state, 'board', findEntity(state, 'board', request.boardId), userId)) throw notesError('not_found', 'Undo operation not found', 404);
          if (request.baseRevision > findEntity(state, 'board', request.boardId).revision) throw notesError('invalid_revision');
          inverseTarget = original.undo;
          mutation = applyMetadataUndo(metadata(state), rebaseUndo(state, original), request.boardId);
        } else mutation = applyMetadataCommand(metadata(state), userId, request,
          { assetExists: id => state.assets.some(asset => asset.id === id && !asset.removed) });
        if (authorize) await authorize({ userId, boardId: request.boardId, operationId: request.operationId,
          type: request.type, replay: false, targets: mutationTargets(mutation.state, mutation.changes) });
        const candidate = { ...clone(state), ...mutation.state };
        for (const note of candidate.notes) if (!Object.hasOwn(candidate.texts, note.id)) candidate.texts[note.id] = emptyText;
        const revision = findEntity(candidate, 'board', request.boardId).revision;
        const result = { revision, operationId: request.operationId, entity: mutation.entity,
          revisions: mutation.changes.map(change => ({ kind: change.kind, id: change.id,
            revision: change.after[change.kind === 'board' ? 'metadataRevision' : 'revision'] })) };
        const undo = { changes: mutation.changes, groups: mutation.groups, entity: mutation.entity,
          undoOf: request.type === 'command.undo' ? request.payload.operationId : null };
        // Use the loader's inverse check before ACK so persisted history remains reopenable.
        if (inverseTarget) validateInverse(undo, inverseTarget);
        return commit(candidate, userId, request.operationId, request.boardId, hash, result, undo,
          { type: 'metadata', boardId: request.boardId, revision, operationId: request.operationId, commandType: request.type });
      });
    },
    applyText(userId, noteId, update, operationId, { authorize } = {}) {
      let bytes;
      try {
        requireAccount(userId); requireId(noteId); requireId(operationId);
        if (!(update instanceof Uint8Array) || !update.byteLength || update.byteLength > MAX_TEXT_UPDATE_BYTES) throw textError();
        bytes = Uint8Array.from(update);
      } catch (error) { return Promise.reject(error); }
      return enqueue(async () => {
        const hash = fingerprint({ type: 'text', userId, noteId, update: Buffer.from(bytes).toString('base64') });
        const retry = await checkRetry(userId, operationId, hash, authorize, { type: 'text', noteId, boardId: findEntity(state, 'note', noteId)?.boardId });
        if (retry) return retry;
        const note = findEntity(state, 'note', noteId);
        if (!canSee(state, 'note', note, userId)) throw notesError('not_found', 'Note not found', 404);
        if (authorize) await authorize({ userId, boardId: note.boardId, noteId, operationId, type: 'text', replay: false, targets: [] });
        const text = checkedText(state.texts[noteId], bytes), candidate = clone(state);
        candidate.texts[noteId] = text.encoded;
        const board = findEntity(candidate, 'board', note.boardId); board.revision += 1;
        const result = { revision: board.revision, operationId };
        return commit(candidate, userId, operationId, note.boardId, hash, result, null,
          { type: 'text', boardId: note.boardId, noteId, revision: board.revision, operationId, update: Buffer.from(bytes).toString('base64') });
      });
    },
    // Server-only: media pipeline must finalize/sync immutable files before registration.
    assetRegistration(userId, operationId, uploadIdentity, { authorize } = {}) {
      return enqueue(() => checkRetry(userId, operationId, fingerprint({ type: 'asset.upload', userId, uploadIdentity }), authorize, { type: 'asset.register' }));
    },
    registerAsset(userId, asset, operationId, { authorize, uploadIdentity } = {}) {
      let record;
      try {
        requireAccount(userId); requireId(operationId);
        requireKeys(asset, ['id', 'name', 'mimeType', 'fileName', 'posterName', 'width', 'height', 'bytes', 'animated']);
        record = { ...clone(asset), createdBy: userId, removed: false, revision: 1 };
        validateAsset(record);
      } catch (error) { return Promise.reject(error); }
      return enqueue(async () => {
        const hash = fingerprint(uploadIdentity ? { type: 'asset.upload', userId, uploadIdentity } : { type: 'asset.register', userId, asset: record });
        const retry = await checkRetry(userId, operationId, hash, authorize, { type: 'asset.register' });
        if (retry) return retry;
        if (state.assets.some(asset => asset.id === record.id)) throw notesError('duplicate_id', 'Asset already exists', 409);
        if (authorize) await authorize({ userId, type: 'asset.register', operationId, replay: false, targets: [] });
        const candidate = clone(state); candidate.assets.push(record);
        return commit(candidate, userId, operationId, null, hash, { revision: state.revision + 1, operationId, ...(uploadIdentity ? { asset: record } : {}) }, null, null);
      });
    },
    updateAsset(userId, id, patch, operationId, { authorize } = {}) {
      let fields;
      try {
        requireAccount(userId); requireId(id); requireId(operationId); requireKeys(patch, [], ['name', 'removed']);
        if (!Object.keys(patch).length || Object.hasOwn(patch, 'removed') && patch.removed !== true) throw notesError('invalid_asset');
        fields = clone(patch);
      } catch (error) { return Promise.reject(error); }
      return enqueue(async () => {
        const hash = fingerprint({ type: 'asset.update', userId, id, patch: fields });
        const retry = await checkRetry(userId, operationId, hash, authorize, { type: 'asset.update' });
        if (retry) return retry;
        const candidate = clone(state), record = candidate.assets.find(asset => asset.id === id);
        if (!record) throw notesError('asset_not_found', 'Asset not found', 404);
        Object.assign(record, fields); record.revision += 1; validateAsset(record);
        if (authorize) await authorize({ userId, type: 'asset.update', operationId, replay: false, targets: [] });
        return commit(candidate, userId, operationId, null, hash, { revision: state.revision + 1, operationId }, null, null);
      });
    },
    library() { return clone(state.assets.filter(asset => !asset.removed)); },
    asset(id) { return clone(state.assets.find(asset => asset.id === id) ?? null); },
    isAssetPublic(id) { return state.decorations.some(decoration => decoration.assetId === id && isVisible(state, 'decoration', decoration) && canSee(state, 'decoration', decoration, null)); },
    async close() { closing = true; await writes; listeners.clear(); },
  };
  return store;
}
