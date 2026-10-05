import { isMemory } from '../js/notes/model.js';

// Memories are notes labelled "Kỷ niệm"; the date and the garden flag live on the note.
function firstLine(node) {
  const text = value => value.text ?? (value.content || []).map(text).join('');
  for (const block of node?.content || []) { const line = text(block).trim(); if (line) return line.slice(0, 120); }
  return '';
}

/**
 * Memories viewerId (account id, or null for a guest) may see via canSee, skipping trashed notes (and notes in a
 * trashed column or board), with from/to ('YYYY-MM-DD', inclusive) filtering memoryDate and gardenOnly keeping
 * garden: true. A memory without a date only appears when no range is given. Sorted by date. Synchronous.
 * @returns {{noteId: string, boardId: string, title: string, memoryDate: string|null, garden: boolean, gardenFlower: string|null}[]}
 */
export function listMemories(store, viewerId, { from, to, gardenOnly = false } = {}) {
  // ponytail: decodes every visible note's text per call; index memories if boards grow past a few hundred notes.
  return store.list(viewerId).flatMap(board => store.publicBoard(board.id, viewerId)?.notes ?? [])
    .filter(note => isMemory(note.labels) && (!gardenOnly || note.garden)
      && (from == null && to == null || note.memoryDate !== null
        && (from == null || note.memoryDate >= from) && (to == null || note.memoryDate <= to)))
    .map(note => ({ noteId: note.id, boardId: note.boardId, title: firstLine(note.content), memoryDate: note.memoryDate, garden: note.garden, gardenFlower: note.gardenFlower }))
    .sort((a, b) => (a.memoryDate ?? '9999').localeCompare(b.memoryDate ?? '9999') || a.noteId.localeCompare(b.noteId));
}
