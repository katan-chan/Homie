import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { httpError } from './http.js';

const MAX_REQUESTS = 500;

/**
 * One JSON document per feature: remote.getDocument/putDocument (Supabase) when remote is set,
 * otherwise <dataDir>/<key>.json. empty() builds the first document; validate(saved) returns the
 * document to use (it may migrate) or throws when the stored value is unusable.
 */
export function createDocStore({ key, dataDir, remote = null, empty, validate = doc => doc }) {
  const path = join(dataDir, `${key}.json`);
  let doc = null, loading = null, writes = Promise.resolve(), closed = false;

  async function load() {
    let saved;
    try { saved = remote ? await remote.getDocument(key) : JSON.parse(await readFile(path, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw httpError(503, 'storage_unavailable', 'Storage is unavailable');
      saved = null;
    }
    try { return saved === null ? empty() : validate(saved); }
    catch { throw httpError(503, 'storage_unavailable', 'Stored document is invalid'); }
  }
  async function ready() {
    if (doc) return doc;
    // A failed load is retried on the next call instead of cached.
    loading ??= load().finally(() => { loading = null; });
    doc = await loading;
    return doc;
  }
  async function persist(next) {
    if (remote) return remote.putDocument(key, next);
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  return {
    /** A copy of the saved document; edits to it are not stored. */
    async read() {
      if (closed) throw httpError(503, 'store_closed', 'Storage is closing');
      return structuredClone(await ready());
    },
    /** Runs mutator(draft) after earlier updates, saves the draft and returns the mutator's result. A throw keeps the old document. */
    update(mutator) {
      const operation = writes.then(async () => {
        if (closed) throw httpError(503, 'store_closed', 'Storage is closing');
        const draft = structuredClone(await ready());
        const result = await mutator(draft);
        try { await persist(draft); }
        catch (error) {
          // The write may have landed before the failure (lost response): reload before the next change.
          doc = null;
          throw error.status ? error : httpError(503, 'storage_unavailable', 'Storage is unavailable');
        }
        doc = draft;
        return result;
      });
      writes = operation.catch(() => {});
      return operation;
    },
    async close() {
      closed = true;
      await writes;
    },
  };
}

/** Stores value under requestId in doc.requests so a retried create returns the first result. Keeps the newest 500. */
export function rememberRequest(doc, requestId, value) {
  doc.requests = (doc.requests ?? []).filter(entry => entry.id !== requestId);
  doc.requests.push({ id: requestId, value: structuredClone(value) });
  if (doc.requests.length > MAX_REQUESTS) doc.requests.splice(0, doc.requests.length - MAX_REQUESTS);
}

/** The value remembered for requestId, or undefined. */
export function recalled(doc, requestId) {
  return doc.requests?.find(entry => entry.id === requestId)?.value;
}
