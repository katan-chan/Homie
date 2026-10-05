import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyNotesState, applyMetadataCommand, projectBoard, validateNotesState, clampPaperSize } from '../js/notes/model.js';

const boardId = randomUUID(), columnId = randomUUID(), otherColumnId = randomUUID(), noteId = randomUUID();
function apply(state, type, payload, accountId = 'minhle', board = boardId) {
  return applyMetadataCommand(state, accountId, { operationId: randomUUID(), accountId,
    boardId: board, baseRevision: state.boards.find(b => b.id === board)?.revision ?? 0,
    type, payload }, { now: '2026-10-02T00:00:00.000Z' }).state;
}
function fixture() {
  let state = apply(emptyNotesState(), 'board.create', { name: 'Bảng chung', visibility: 'public' });
  state = apply(state, 'column.create', { id: columnId, name: 'Cột', x: 10, y: 20, width: 400, height: 600 });
  return apply(state, 'note.create', { id: noteId, columnId, x: 35, y: 50, width: 200, height: 240, color: '#ffeedd' });
}

test('server assigns immutable author; model is immutable and validates all input keys', () => {
  const state = fixture();
  assert.equal(state.notes[0].authorId, 'minhle');
  const next = apply(state, 'note.update', { id: noteId, color: '#ffffff' }, 'haiyen');
  assert.equal(next.notes[0].authorId, 'minhle');
  assert.equal(state.notes[0].color, '#ffeedd');
  for (const payload of [{ id: noteId, authorId: 'haiyen' }, { id: noteId, x: NaN }, { id: noteId, width: 0 }]) {
    assert.throws(() => apply(state, 'note.update', payload));
  }
  assert.throws(() => apply(state, 'note.create', { id: randomUUID(), authorId: 'haiyen', columnId: null, x: 0, y: 0, width: 100, height: 100, color: '#ffffff' }));
  assert.throws(() => apply(state, 'board.rename', { name: 'x' }, 'outsider'));
});

test('reparent preserves world coordinates and column move updates all children atomically', () => {
  let state = fixture();
  state = apply(state, 'column.create', { id: otherColumnId, name: 'Hai', x: 900, y: 500, width: 400, height: 600 });
  state = apply(state, 'note.move', { id: noteId, columnId: otherColumnId });
  assert.deepEqual([state.notes[0].x, state.notes[0].y], [35, 50]);
  state = apply(state, 'column.update', { id: otherColumnId, x: 910, y: 530 });
  assert.deepEqual([state.notes[0].x, state.notes[0].y], [45, 80]);
  assert.equal(state.notes[0].revision, 3);
  assert.equal(state.columns[1].revision, 2);
});

test('own tombstones survive parent trash/restore and descendants cannot escape trash', () => {
  let state = fixture();
  state = apply(state, 'note.trash', { id: noteId });
  state = apply(state, 'column.trash', { id: columnId });
  assert.equal(projectBoard(state, boardId).notes.length, 0);
  state = apply(state, 'column.restore', { id: columnId });
  assert.equal(projectBoard(state, boardId).notes.length, 0);
  state = apply(state, 'column.trash', { id: columnId });
  state = apply(state, 'note.restore', { id: noteId });
  assert.equal(projectBoard(state, boardId).notes.length, 0);
  assert.throws(() => apply(state, 'note.move', { id: noteId, columnId: null }), { code: 'deleted' });
  state = apply(state, 'column.restore', { id: columnId });
  assert.equal(projectBoard(state, boardId).notes.length, 1);
  state = apply(state, 'board.trash', {});
  assert.equal(projectBoard(state, boardId), null);
  assert.equal(projectBoard(state, boardId, { includeDeleted: true }).notes.length, 1);
  state = apply(state, 'board.restore', {});
  assert.equal(projectBoard(state, boardId).notes.length, 1);
});

test('hierarchy validation rejects missing/cross-board parents, duplicate IDs and invalid snapshots', () => {
  let state = fixture();
  const anotherBoard = randomUUID(), foreignColumn = randomUUID();
  state = apply(state, 'board.create', { name: 'Other', visibility: 'public' }, 'minhle', anotherBoard);
  state = apply(state, 'column.create', { id: foreignColumn, name: 'x', x: 0, y: 0, width: 100, height: 100 }, 'minhle', anotherBoard);
  for (const invalid of [randomUUID(), foreignColumn]) {
    assert.throws(() => apply(state, 'note.move', { id: noteId, columnId: invalid }));
  }
  assert.throws(() => apply(state, 'column.create', { id: noteId, name: 'x', x: 0, y: 0, width: 100, height: 100 }));
  const broken = structuredClone(state);
  broken.notes[0].columnId = foreignColumn;
  assert.throws(() => validateNotesState(broken));
});

test('interactive paper dimensions stay usable and reject nonfinite size input', () => {
  assert.equal(clampPaperSize('note', 1), 5);
  assert.equal(clampPaperSize('column', -100), 240);
  assert.equal(clampPaperSize('note', 9000), 2400);
  assert.equal(clampPaperSize('column', 480), 480);
  for (const value of [NaN, Infinity, '240']) assert.throws(() => clampPaperSize('note', value), { code: 'invalid_geometry' });
});

test('journal boards and memories: noteDefault, memoryDate and garden only on a "Kỷ niệm" note', () => {
  let state = fixture();
  assert.deepEqual([state.boards[0].noteDefault, state.notes[0].memoryDate, state.notes[0].garden], [null, null, false]);
  assert.throws(() => apply(state, 'board.update', { noteDefault: 'private' }, 'haiyen'), { code: 'forbidden' });
  assert.throws(() => apply(state, 'board.update', { noteDefault: 'shared' }), { code: 'invalid_note_default' });
  state = apply(state, 'board.update', { noteDefault: 'private' });
  assert.equal(state.boards[0].noteDefault, 'private');
  const journal = randomUUID();
  state = apply(state, 'board.create', { name: 'Nhật ký', visibility: 'shared', noteDefault: 'private' }, 'haiyen', journal);
  assert.equal(state.boards.find(b => b.id === journal).noteDefault, 'private');
  assert.throws(() => apply(state, 'note.update', { id: noteId, garden: true }), { code: 'invalid_garden' });
  for (const memoryDate of ['2026-02-30', '2026-1-01', '', 20261012]) {
    assert.throws(() => apply(state, 'note.update', { id: noteId, memoryDate }), { code: 'invalid_memory_date' });
  }
  state = apply(state, 'note.update', { id: noteId, labels: ['kỷ niệm', 'Đi biển'], memoryDate: '2026-10-12', garden: true }, 'haiyen');
  assert.deepEqual([state.notes[0].memoryDate, state.notes[0].garden], ['2026-10-12', true]);
  assert.throws(() => apply(state, 'note.update', { id: noteId, labels: ['Đi biển'], garden: true }), { code: 'invalid_garden' });
  state = apply(state, 'note.update', { id: noteId, labels: ['Đi biển'] });
  assert.equal(state.notes[0].garden, false, 'Dropping the label takes the note out of the garden');
  assert.equal(state.notes[0].memoryDate, '2026-10-12', 'The date stays for when the label comes back');
  const created = apply(state, 'note.create', { id: randomUUID(), columnId: null, x: 0, y: 0, width: 100, height: 100, color: '#ffffff', labels: ['Kỷ niệm'], memoryDate: '2025-01-01', garden: true });
  assert.equal(created.notes.at(-1).garden, true);
});

test('a journal page created without visibility stays private to its author on the server', () => {
  const journal = randomUUID(), page = { columnId: null, x: 0, y: 0, width: 100, height: 100, color: '#ffffff' };
  let state = apply(emptyNotesState(), 'board.create', { name: 'Nhật ký', visibility: 'shared', noteDefault: 'private' }, 'haiyen', journal);
  state = apply(state, 'note.create', { id: randomUUID(), ...page }, 'haiyen', journal);
  assert.equal(state.notes.at(-1).visibility, 'haiyen', 'Omitted visibility follows the journal default');
  state = apply(state, 'note.create', { id: randomUUID(), ...page, visibility: null }, 'haiyen', journal);
  assert.equal(state.notes.at(-1).visibility, null, 'An explicit "Theo bảng" choice is kept');
  state = apply(state, 'board.create', { name: 'Chung', visibility: 'shared' }, 'haiyen');
  const shared = state.boards.at(-1).id;
  state = apply(state, 'note.create', { id: randomUUID(), ...page }, 'haiyen', shared);
  assert.equal(state.notes.at(-1).visibility, null, 'Other boards keep following the board');
});
