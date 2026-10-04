// Metadata only. Rich text, durability and authentication transport belong to the store/API.
export const NOTE_ACCOUNTS = Object.freeze(['minhle', 'haiyen']);
const collections = { board: 'boards', column: 'columns', note: 'notes', decoration: 'decorations' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const geometry = ['x', 'y', 'width', 'height'];

export function notesError(code, message = code, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
export function requireAccount(id) {
  if (!NOTE_ACCOUNTS.includes(id)) throw notesError('unauthorized', 'Unknown account', 401);
}
export function requireId(id) {
  if (typeof id !== 'string' || !uuid.test(id)) throw notesError('invalid_id');
}
export function requireKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw notesError('invalid_fields');
}
function number(value, positive = false) {
  if (!Number.isFinite(value) || Math.abs(value) > 1e7 || (positive && value <= 0)) throw notesError('invalid_geometry');
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw notesError('invalid_revision');
}
function name(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw notesError('invalid_name');
  return value.trim();
}
function deleted(value) {
  if (value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)) throw notesError('invalid_tombstone');
}
function checkGeometry(record) {
  for (const key of geometry) number(record[key], key === 'width' || key === 'height');
}
function color(value) {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) throw notesError('invalid_color');
}
// Interactive paper sizes; wire geometry remains validated separately for stored content.
export function clampPaperSize(kind, value) {
  if (!['note', 'column'].includes(kind) || !Number.isFinite(value)) throw notesError('invalid_geometry');
  return Math.min(2400, Math.max(kind === 'note' ? 180 : 240, value));
}
export function emptyNotesState() {
  return { boards: [], columns: [], notes: [], decorations: [] };
}
export function findEntity(state, kind, id) {
  return state[collections[kind]]?.find(entity => entity.id === id) ?? null;
}
function mustFind(state, kind, id, boardId) {
  const entity = findEntity(state, kind, id);
  if (!entity) throw notesError('not_found', `${kind} not found`, 404);
  const ownerBoard = kind === 'board' ? entity.id : entity.boardId;
  if (boardId && ownerBoard !== boardId) throw notesError('wrong_board', 'Cross-board reference', 409);
  return entity;
}
export function isVisible(state, kind, entity) {
  if (!entity || entity.deletedAt !== null) return false;
  if (kind === 'board') return true;
  if (!isVisible(state, 'board', findEntity(state, 'board', entity.boardId))) return false;
  if (kind === 'decoration') return entity.noteId ? isVisible(state, 'note', findEntity(state, 'note', entity.noteId))
    : entity.columnId ? isVisible(state, 'column', findEntity(state, 'column', entity.columnId)) : true;
  return kind !== 'note' || entity.columnId === null || isVisible(state, 'column', findEntity(state, 'column', entity.columnId));
}
function active(state, kind, entity) {
  if (!isVisible(state, kind, entity)) throw notesError('deleted', 'Entity or ancestor is in trash', 409);
}
function checkEntity(kind, value) {
  const fields = {
    board: ['id', 'name', 'revision', 'metadataRevision', 'deletedAt'],
    column: ['id', 'boardId', 'name', ...geometry, 'revision', 'deletedAt'],
    note: ['id', 'boardId', 'columnId', 'authorId', ...geometry, 'color', 'revision', 'deletedAt'],
    // Stickers live on the board in world coordinates; noteId/columnId (at most one) is what they follow when moved or trashed.
    decoration: ['id', 'boardId', 'noteId', 'columnId', 'assetId', ...geometry, 'rotation', 'z', 'revision', 'deletedAt'],
  };
  requireKeys(value, fields[kind]); requireId(value.id); revision(value.revision); deleted(value.deletedAt);
  if (kind === 'board') { name(value.name); revision(value.metadataRevision); }
  else {
    checkGeometry(value);
    requireId(value.boardId);
    if (kind === 'column') name(value.name);
    if (kind === 'note') { if (value.columnId !== null) requireId(value.columnId); requireAccount(value.authorId); color(value.color); }
    if (kind === 'decoration') {
      requireId(value.assetId); number(value.rotation); number(value.z);
      if (value.noteId !== null) requireId(value.noteId);
      if (value.columnId !== null) requireId(value.columnId);
      if (value.noteId !== null && value.columnId !== null) throw notesError('invalid_fields');
      if (!Number.isSafeInteger(value.z)) throw notesError('invalid_geometry');
    }
  }
}
export function validateNotesState(state) {
  const ids = new Set();
  for (const [kind, key] of Object.entries(collections)) {
    if (!Array.isArray(state[key])) throw notesError('invalid_state');
    for (const entity of state[key]) {
      checkEntity(kind, entity);
      if (ids.has(entity.id)) throw notesError('duplicate_id');
      ids.add(entity.id);
      if (kind !== 'board') mustFind(state, 'board', entity.boardId);
      if (kind === 'note' && entity.columnId !== null) mustFind(state, 'column', entity.columnId, entity.boardId);
      if (kind === 'decoration' && entity.noteId !== null) mustFind(state, 'note', entity.noteId, entity.boardId);
      if (kind === 'decoration' && entity.columnId !== null) mustFind(state, 'column', entity.columnId, entity.boardId);
    }
  }
  return state;
}
export function validateCommand(command, userId) {
  requireAccount(userId);
  requireKeys(command, ['operationId', 'accountId', 'boardId', 'baseRevision', 'type', 'payload']);
  if (command.accountId !== userId) throw notesError('account_mismatch', 'Command belongs to another account', 403);
  requireId(command.operationId); requireId(command.boardId); revision(command.baseRevision);
  if (typeof command.type !== 'string') throw notesError('invalid_command');
}
function checkAttachment(state, p, boardId) {
  const noteId = p.noteId ?? null, columnId = p.columnId ?? null;
  if (noteId !== null && columnId !== null) throw notesError('invalid_fields', 'A sticker follows one note or one column');
  if (noteId !== null) active(state, 'note', mustFind(state, 'note', noteId, boardId));
  if (columnId !== null) active(state, 'column', mustFind(state, 'column', columnId, boardId));
}
function unique(state, id) {
  requireId(id);
  if (Object.values(collections).some(key => state[key].some(entity => entity.id === id))) throw notesError('duplicate_id', 'ID already exists', 409);
}
function patch(record, payload, fields) {
  for (const field of fields) if (Object.hasOwn(payload, field)) record[field] = field === 'name' ? name(payload[field]) : payload[field];
}
function metaRevision(kind, record) {
  return record[kind === 'board' ? 'metadataRevision' : 'revision'];
}
function increment(kind, record) {
  record[kind === 'board' ? 'metadataRevision' : 'revision'] += 1;
}
export function projectBoard(state, id, { includeDeleted = false } = {}) {
  const board = findEntity(state, 'board', id);
  if (!board || (!includeDeleted && !isVisible(state, 'board', board))) return null;
  const notes = state.notes.filter(note => note.boardId === id && (includeDeleted || isVisible(state, 'note', note)));
  return structuredClone({ ...board,
    columns: state.columns.filter(column => column.boardId === id && (includeDeleted || isVisible(state, 'column', column))),
    notes,
    decorations: state.decorations.filter(decoration => decoration.boardId === id && (includeDeleted || isVisible(state, 'decoration', decoration))),
  });
}

export function applyMetadataCommand(current, userId, command, { now = new Date().toISOString(), assetExists = () => false } = {}) {
  validateCommand(command, userId);
  const { type, payload: p, boardId } = command;
  const state = structuredClone(current);
  let board = findEntity(state, 'board', boardId), kind, entity;
  if (type !== 'board.create') {
    board = mustFind(state, 'board', boardId);
    if (command.baseRevision > board.revision) throw notesError('invalid_revision');
  } else if (command.baseRevision !== 0) throw notesError('invalid_revision');
  const changes = [];
  const touch = (entityKind, record, change) => {
    const before = structuredClone(record); change(); increment(entityKind, record);
    changes.push({ kind: entityKind, id: record.id, before, after: structuredClone(record) });
  };
  const add = (entityKind, record) => {
    unique(state, record.id); state[collections[entityKind]].push(record);
    changes.push({ kind: entityKind, id: record.id, before: null, after: structuredClone(record) });
    return record;
  };
  const [entityKind, action] = type.split('.');
  if (!collections[entityKind] || type.split('.').length !== 2) throw notesError('invalid_command');
  kind = entityKind;
  if (kind === 'board') {
    if (action === 'create') {
      requireKeys(p, ['name']);
      board = entity = add(kind, { id: boardId, name: name(p.name), revision: 0, metadataRevision: 1, deletedAt: null });
    } else {
      entity = board;
      if (action === 'rename') { requireKeys(p, ['name']); active(state, kind, entity); touch(kind, entity, () => { entity.name = name(p.name); }); }
      else if (action === 'trash' || action === 'restore') { requireKeys(p, []); touch(kind, entity, () => { entity.deletedAt = action === 'trash' ? now : null; }); }
      else throw notesError('invalid_command');
    }
  } else if (action === 'create' || (kind === 'decoration' && action === 'add')) {
    active(state, 'board', board);
    if (kind === 'column') {
      requireKeys(p, ['id', 'name', ...geometry]);
      entity = add(kind, { ...p, name: name(p.name), boardId, revision: 1, deletedAt: null });
    } else if (kind === 'note') {
      requireKeys(p, ['id', 'columnId', ...geometry, 'color']);
      if (p.columnId !== null) active(state, 'column', mustFind(state, 'column', p.columnId, boardId));
      entity = add(kind, { ...p, boardId, authorId: userId, revision: 1, deletedAt: null });
    } else if (kind === 'decoration' && action === 'add') {
      requireKeys(p, ['id', 'assetId', ...geometry, 'rotation', 'z'], ['noteId', 'columnId']);
      checkAttachment(state, p, boardId);
      if (!assetExists(p.assetId)) throw notesError('asset_not_found', 'Asset is not in library', 404);
      entity = add(kind, { noteId: null, columnId: null, ...p, boardId, revision: 1, deletedAt: null });
    } else throw notesError('invalid_command');
  } else {
    requireId(p?.id); entity = mustFind(state, kind, p.id, boardId);
    if (action === 'trash' || action === 'restore' || (kind === 'decoration' && action === 'remove')) {
      if (kind === 'decoration' && action !== 'remove') throw notesError('invalid_command');
      requireKeys(p, ['id']);
      touch(kind, entity, () => { entity.deletedAt = action === 'restore' ? null : now; });
    } else if (action === 'update' || (kind === 'note' && action === 'move')) {
      const allowed = kind === 'column' ? ['name', ...geometry] : kind === 'note'
        ? action === 'move' ? ['columnId', 'x', 'y'] : [...geometry, 'color'] : [...geometry, 'rotation', 'z', 'noteId', 'columnId'];
      requireKeys(p, ['id'], allowed);
      if (Object.keys(p).length === 1) throw notesError('invalid_fields');
      active(state, kind, entity);
      if (kind === 'decoration') checkAttachment(state, { noteId: entity.noteId, columnId: entity.columnId, ...p }, boardId);
      else if (Object.hasOwn(p, 'columnId') && p.columnId !== null) active(state, 'column', mustFind(state, 'column', p.columnId, boardId));
      const dx = (p.x ?? entity.x) - entity.x, dy = (p.y ?? entity.y) - entity.y;
      touch(kind, entity, () => patch(entity, p, allowed));
      // World positions include independently trashed children so restore stays coherent; stickers follow their note or column.
      const shift = (childKind, child) => touch(childKind, child, () => { child.x += dx; child.y += dy; });
      if (kind === 'note' && (dx || dy)) for (const sticker of state.decorations.filter(d => d.noteId === entity.id)) shift('decoration', sticker);
      if (kind === 'column' && (dx || dy)) {
        for (const note of state.notes.filter(note => note.columnId === entity.id)) {
          shift('note', note);
          for (const sticker of state.decorations.filter(d => d.noteId === note.id)) shift('decoration', sticker);
        }
        for (const sticker of state.decorations.filter(d => d.columnId === entity.id)) shift('decoration', sticker);
      }
    } else throw notesError('invalid_command');
  }
  board.revision += 1;
  validateNotesState(state);
  const grouped = action === 'create' || ['column', 'note'].includes(kind) && ['update', 'move'].includes(action)
    && (Object.hasOwn(p, 'x') || Object.hasOwn(p, 'y'));
  const groups = grouped ? [{ kind, id: entity.id, memberIds: groupMembers(state, kind, entity.id) }] : [];
  return { state, changes, groups, entity: { kind, id: entity.id } };
}

function groupMembers(state, kind, id) {
  // Members are what an undo of a create/move must find unchanged, including the stickers that moved along.
  if (kind === 'note') return state.decorations.filter(d => d.noteId === id).map(d => d.id).sort();
  if (kind === 'column') {
    const notes = state.notes.filter(note => note.columnId === id).map(note => note.id);
    return [...notes, ...state.decorations.filter(d => d.columnId === id || notes.includes(d.noteId)).map(d => d.id)].sort();
  }
  const notes = state.notes.filter(note => kind === 'board' ? note.boardId === id : note.columnId === id);
  return [...notes.map(note => note.id), ...(kind === 'board'
    ? state.columns.filter(column => column.boardId === id).map(column => column.id) : [])].sort();
}

export function applyMetadataUndo(current, undo, boardId, now = new Date().toISOString()) {
  const state = structuredClone(current);
  const board = mustFind(state, 'board', boardId);
  for (const group of undo.groups) {
    const actual = groupMembers(state, group.kind, group.id);
    if (JSON.stringify(actual) !== JSON.stringify(group.memberIds)) throw notesError('undo_conflict', 'Group membership changed', 409);
  }
  for (const change of undo.changes) {
    const live = mustFind(state, change.kind, change.id, boardId);
    if (metaRevision(change.kind, live) !== metaRevision(change.kind, change.after)) throw notesError('undo_conflict', 'Entity changed since operation', 409);
    // An undo must never smuggle an active note out of a deleted ancestor.
    if (change.before && change.kind === 'note' && change.before.columnId !== live.columnId) {
      active(state, 'note', live);
      if (change.before.columnId !== null) active(state, 'column', mustFind(state, 'column', change.before.columnId, boardId));
    }
  }
  const changes = undo.changes.map(change => {
    const live = mustFind(state, change.kind, change.id, boardId), before = structuredClone(live);
    const nextRevision = metaRevision(change.kind, live) + 1;
    if (change.before) Object.assign(live, change.before);
    else live.deletedAt = now;
    live[change.kind === 'board' ? 'metadataRevision' : 'revision'] = nextRevision;
    if (change.kind === 'board') live.revision = before.revision;
    return { kind: change.kind, id: change.id, before, after: structuredClone(live) };
  });
  board.revision += 1; validateNotesState(state);
  return { state, changes, groups: structuredClone(undo.groups), entity: undo.entity };
}

export function mutationTargets(state, changes) {
  const targets = new Map();
  const include = (kind, entity) => {
    const note = kind === 'note' ? entity : kind === 'decoration' && entity.noteId ? findEntity(state, 'note', entity.noteId) : null;
    targets.set(`${kind}:${entity.id}`, { kind, id: entity.id, boardId: kind === 'board' ? entity.id : entity.boardId,
      ...(note ? { columnId: note.columnId } : kind === 'decoration' ? { columnId: entity.columnId } : {}),
      ...(kind === 'decoration' ? { noteId: entity.noteId } : {}) });
  };
  for (const change of changes) {
    include(change.kind, change.after);
    if (change.kind === 'note' && change.before?.columnId && change.before.columnId !== change.after.columnId) {
      include('column', mustFind(state, 'column', change.before.columnId));
    }
    if (change.kind === 'board' || change.kind === 'column') {
      for (const note of state.notes.filter(note => change.kind === 'board' ? note.boardId === change.id : note.columnId === change.id)) include('note', note);
    }
  }
  return [...targets.values()];
}
