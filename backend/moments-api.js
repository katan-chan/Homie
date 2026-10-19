// Khoảnh khắc: photobooth strips, snaps and uploads both members share. Records live in the "moments" document; image
// files live beside note media (bucket path moments/…, or <dataDir>/moments/ locally) and only ever leave through here.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { handleErrors, httpError, readJson, requireMember, requireWrite, sendJson } from './http.js';
import { createDocStore, recalled, rememberRequest } from './doc-store.js';
import { localDate, localTime, parseRange } from './dates.js';
import { imageInfo } from './image-info.js';

export const KINDS = ['booth', 'snap', 'upload'];
export const LIMITS = Object.freeze({ photoBytes: 400 * 1024, thumbBytes: 40 * 1024, photoWidth: 1920, photoHeight: 2400, thumbSide: 400, caption: 40, body: 640 * 1024 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg' };

export const route = path => /^\/api\/moments(?:\/|$)/.test(path);

export const emptyMoments = () => ({ records: [], requests: [] });
export function validateMoments(saved) {
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.records)) throw new Error('Invalid moments document');
  return { ...saved, requests: Array.isArray(saved.requests) ? saved.requests : [] };
}

const invalid = (code, message) => httpError(400, code, message);
const notFound = () => httpError(404, 'not_found', 'Not found');
const fileNames = record => [`moments/${record.id}.${EXT[record.photo.mime]}`, `moments/${record.id}-thumb.${EXT[record.thumb.mime]}`];

/** Trimmed caption, '' when absent; one line of at most 40 characters. */
export function caption(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || /[\r\n]/.test(value)) throw invalid('invalid_caption', 'caption must be one line of text');
  const text = value.trim();
  if ([...text].length > LIMITS.caption) throw invalid('invalid_caption', 'caption is too long');
  return text;
}

function image(part, which) {
  if (!part || typeof part !== 'object' || typeof part.data !== 'string') throw invalid('invalid_image', `${which} is missing`);
  const buffer = Buffer.from(part.data, 'base64');
  const info = imageInfo(buffer);
  if (!info) throw invalid('invalid_image', `${which} must be WebP or JPEG`);
  const tooBig = which === 'photo'
    ? buffer.length > LIMITS.photoBytes || info.width > LIMITS.photoWidth || info.height > LIMITS.photoHeight
    : buffer.length > LIMITS.thumbBytes || info.width > LIMITS.thumbSide || info.height > LIMITS.thumbSide;
  if (tooBig) throw invalid('image_too_large', `${which} is too large`);
  return { buffer, meta: { ...info, bytes: buffer.length } };
}

const view = record => ({
  ...record, localDate: localDate(record.takenAt), time: localTime(record.takenAt),
  fileUrl: `/api/moments/${record.id}/file`, thumbUrl: `/api/moments/${record.id}/thumb`,
});

function localFiles(dataDir) {
  const path = name => join(dataDir, name);
  return {
    async put(name, buffer) {
      await mkdir(join(dataDir, 'moments'), { recursive: true, mode: 0o700 });
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

export function create({ auth, allowedOrigins, dataDir, remote }) {
  const store = createDocStore({ key: 'moments', dataDir, remote, empty: emptyMoments, validate: validateMoments });
  const files = remote ? remoteFiles(remote) : localFiles(dataDir);

  async function body(req, limit) {
    const value = await readJson(req, { limit });
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('invalid_body', 'Body must be an object');
    return value;
  }

  async function createMoment(req) {
    const actorId = requireWrite(req, { auth, allowedOrigins });
    const input = await body(req, LIMITS.body);
    if (typeof input.requestId !== 'string' || !UUID.test(input.requestId)) throw invalid('invalid_body', 'requestId must be a UUID');
    if (!KINDS.includes(input.kind)) throw invalid('invalid_body', 'Unknown kind');
    const text = caption(input.caption);
    const photo = image(input.photo, 'photo'), thumb = image(input.thumb, 'thumb');
    const key = `${actorId}:${input.requestId}`;
    const earlier = recalled(await store.read(), key);
    if (earlier) return [200, earlier];

    const now = new Date().toISOString();
    const record = { id: randomUUID(), ownerId: actorId, kind: input.kind, takenAt: now, caption: text, photo: photo.meta, thumb: thumb.meta, version: 1, createdAt: now, updatedAt: now };
    const names = fileNames(record);
    try {
      await files.put(names[0], photo.buffer, photo.meta.mime);
      await files.put(names[1], thumb.buffer, thumb.meta.mime);
      const result = await store.update(doc => {
        const raced = recalled(doc, key);
        if (raced) return { raced };
        doc.records.push(record);
        rememberRequest(doc, key, record);
        return { record };
      });
      if (result.raced) { await files.remove(names).catch(() => {}); return [200, result.raced]; }
      return [201, record];
    } catch (error) {
      await files.remove(names).catch(() => {});
      throw error.status ? error : httpError(503, 'storage_unavailable', 'Storage is unavailable');
    }
  }

  const owned = (doc, actorId, id) => {
    const record = doc.records.find(item => item.id === id);
    if (!record) throw notFound();
    if (record.ownerId !== actorId) throw httpError(403, 'not_owner', 'Only the photographer can change this moment');
    return record;
  };

  async function sendFile(req, res, record, part) {
    const name = fileNames(record)[part === 'thumb' ? 1 : 0];
    const file = await files.open(name);
    if (!file) throw notFound();
    res.setHeader('Content-Type', record[part === 'thumb' ? 'thumb' : 'photo'].mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    if (file.size) res.setHeader('Content-Length', String(file.size));
    res.writeHead(200);
    if (req.method === 'HEAD') { file.stream.destroy(); await file.cancel?.(); res.end(); return; }
    await pipeline(file.stream, res);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').slice(3); // after /api/moments
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const [id, part] = parts;

    if (method === 'GET') {
      requireMember(req, auth);
      const doc = await store.read();
      if (!id) {
        const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        const range = from || to ? parseRange(from, to) : null;
        const moments = doc.records.map(view)
          .filter(m => !range || (m.localDate >= range.from && m.localDate <= range.to))
          .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
        return sendJson(res, 200, { moments });
      }
      const record = doc.records.find(item => item.id === id);
      if (!record || !['file', 'thumb'].includes(part) || parts.length !== 2) throw notFound();
      return sendFile(req, res, record, part);
    }
    if (method === 'POST' && !id) {
      const [status, record] = await createMoment(req);
      return sendJson(res, status, { moment: view(record) });
    }
    if (method === 'PUT' && id && parts.length === 1) {
      const actorId = requireWrite(req, { auth, allowedOrigins });
      const input = await body(req);
      const record = await store.update(doc => {
        const target = owned(doc, actorId, id);
        if (input.version !== target.version) throw httpError(409, 'version_conflict', 'Version conflict');
        Object.assign(target, { caption: caption(input.caption), version: target.version + 1, updatedAt: new Date().toISOString() });
        return target;
      });
      return sendJson(res, 200, { moment: view(record) });
    }
    if (method === 'DELETE' && id && parts.length === 1) {
      const actorId = requireWrite(req, { auth, allowedOrigins });
      const record = await store.update(doc => {
        const target = owned(doc, actorId, id);
        doc.records = doc.records.filter(item => item !== target);
        return target;
      });
      // The record is gone either way; a file left behind costs storage, not correctness.
      await files.remove(fileNames(record)).catch(() => {});
      return sendJson(res, 204);
    }
    throw notFound();
  }

  return {
    // An early refusal leaves the body unread; drain it so the connection can answer.
    handle: (req, res) => handleErrors(res, () => handle(req, res).catch(error => { req.resume(); throw error; })),
    close: () => store.close(),
  };
}
