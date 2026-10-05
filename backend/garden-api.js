// GET /api/garden (part G): planted memories the viewer may see, for the memory flowers. Read-only; guests get none.
import { handleErrors, httpError, requireMember, sendJson } from './http.js';
import { listMemories } from './notes-memories.js';

export const route = path => /^\/api\/garden(?:\/|$)/.test(path);

const text = node => node.text ?? (node.content || []).map(text).join('');

/** The note's lines after its title line (the title is the first non-empty line, as in listMemories). */
function bodyText(content) {
  const lines = (content?.content || []).map(block => text(block).trim());
  return lines.slice(lines.findIndex(Boolean) + 1).join('\n').trim().slice(0, 4000);
}

export function create({ auth, notesStore }) {
  async function handle(req, res) {
    if (new URL(req.url, 'http://localhost').pathname !== '/api/garden' || !['GET', 'HEAD'].includes(req.method)) {
      throw httpError(404, 'not_found', 'Not found');
    }
    let viewer;
    try { viewer = requireMember(req, auth); } catch { return sendJson(res, 200, { items: [] }); }
    const store = await notesStore();
    const memories = listMemories(store, viewer, { gardenOnly: true });
    // Same viewer projection listMemories used, so the sheet gets nothing the viewer could not already open.
    const boards = new Map();
    const items = memories.flatMap(memory => {
      if (!boards.has(memory.boardId)) boards.set(memory.boardId, store.publicBoard(memory.boardId, viewer));
      const board = boards.get(memory.boardId);
      const note = board?.notes.find(item => item.id === memory.noteId);
      if (!note) return [];
      return [{ noteId: memory.noteId, boardId: memory.boardId, boardName: board.name, title: memory.title,
        memoryDate: memory.memoryDate, gardenFlower: memory.gardenFlower, authorId: note.authorId, body: bodyText(note.content) }];
    });
    return sendJson(res, 200, { items });
  }
  return { handle: (req, res) => handleErrors(res, () => handle(req, res)), close() {} };
}
