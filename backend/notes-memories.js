// Stub owned by part D. Memories are notes labelled "Kỷ niệm" with a memoryDate.

/**
 * Memories viewerId (account id, or null for a guest) may see via canSee, skipping trashed notes, with from/to ('YYYY-MM-DD', inclusive)
 * filtering memoryDate and gardenOnly keeping garden: true. Synchronous; callers may await it.
 * @returns {{noteId: string, boardId: string, title: string, memoryDate: string, garden: boolean}[]}
 */
export function listMemories(store, viewerId, { from, to, gardenOnly = false } = {}) {
  return [];
}
