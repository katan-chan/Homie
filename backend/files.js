// Feature files (moments, avatars): Supabase Storage when remote is set, otherwise files under dataDir. Names are
// relative paths like "moments/<id>.webp"; files only ever leave through the backend.
import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';

function localFiles(dataDir) {
  const path = name => join(dataDir, name);
  return {
    async put(name, buffer) {
      await mkdir(dirname(path(name)), { recursive: true, mode: 0o700 });
      const temporary = `${path(name)}.${randomBytes(8).toString('hex')}.tmp`;
      try { await writeFile(temporary, buffer, { mode: 0o600, flag: 'wx' }); await rename(temporary, path(name)); }
      finally { await rm(temporary, { force: true }); }
    },
    async open(name) {
      try { const handle = await open(path(name), 'r'); return { size: (await handle.stat()).size, stream: handle.createReadStream() }; }
      catch { return null; }
    },
    async remove(names) { await Promise.all(names.map(name => rm(path(name), { force: true }))); },
  };
}

function remoteFiles(remote) {
  return {
    put: (name, buffer, type) => remote.putFile(name, buffer, type),
    async open(name) {
      const response = await remote.getFile(name);
      if (!response) return null;
      return { size: Number(response.headers.get('content-length')) || null, stream: Readable.fromWeb(response.body), cancel: () => response.body?.cancel() };
    },
    remove: names => remote.removeFiles(names),
  };
}

/** { put(name, buffer, type), open(name) -> { size, stream, cancel? } | null, remove(names) } */
export const createFiles = ({ dataDir, remote }) => (remote ? remoteFiles(remote) : localFiles(dataDir));
