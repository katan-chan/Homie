// Ảnh đại diện: the owner uploads a square picture cut and compressed in the browser; anyone may read it, like the
// rest of the profile. The profile keeps { version, mime }; the file is avatars/<id>-<version>.<webp|jpg>.
import { pipeline } from 'node:stream/promises';
import { handleErrors, httpError, readJson, requireWrite, sendJson } from './http.js';
import { imageInfo } from './image-info.js';
import { createFiles } from './files.js';

export const LIMITS = Object.freeze({ bytes: 80 * 1024, maxSide: 512, minSide: 64, body: 112 * 1024 });
const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg' };
const PATH = /^\/api\/profiles\/(minhle|haiyen)\/avatar$/;

export const route = path => PATH.test(path);
const fileName = (id, avatar) => `avatars/${id}-${avatar.version}.${EXT[avatar.mime]}`;
const invalid = (code, message) => httpError(400, code, message);

function image(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.data !== 'string') throw invalid('invalid_image', 'data is missing');
  const buffer = Buffer.from(input.data, 'base64');
  const info = imageInfo(buffer);
  if (!info || info.width !== info.height) throw invalid('invalid_image', 'Avatar must be a square WebP or JPEG');
  if (buffer.length > LIMITS.bytes || info.width > LIMITS.maxSide) throw invalid('image_too_large', 'Avatar is too large');
  if (info.width < LIMITS.minSide) throw invalid('image_too_small', 'Avatar is too small');
  return { buffer, mime: info.mime };
}

export function create({ auth, allowedOrigins, dataDir, remote, profiles }) {
  const files = createFiles({ dataDir, remote });
  const unavailable = () => httpError(503, 'storage_unavailable', 'Storage is unavailable');

  function owner(req, id) {
    const actorId = requireWrite(req, { auth, allowedOrigins });
    if (actorId !== id) throw httpError(403, 'not_owner', 'Only the profile owner may change the avatar');
  }

  async function upload(req, id) {
    owner(req, id);
    const { buffer, mime } = image(await readJson(req, { limit: LIMITS.body }));
    const old = (await profiles.get(id)).avatar;
    const avatar = { version: (old?.version ?? 0) + 1, mime };
    const name = fileName(id, avatar);
    try {
      await files.put(name, buffer, mime);
      const profile = await profiles.setAvatar(id, avatar);
      if (old) await files.remove([fileName(id, old)]).catch(() => {});
      return profile;
    } catch {
      // A failed write may still have landed: keep the new file when the profile points at it or cannot be read.
      const landed = await profiles.get(id).then(p => p.avatar?.version === avatar.version, () => true);
      if (!landed) await files.remove([name]).catch(() => {});
      throw unavailable();
    }
  }

  async function remove(req, id) {
    owner(req, id);
    const old = (await profiles.get(id)).avatar;
    if (!old) return profiles.get(id);
    const profile = await profiles.setAvatar(id, null).catch(() => { throw unavailable(); });
    // The profile no longer points at the file; one left behind costs storage, not correctness.
    await files.remove([fileName(id, old)]).catch(() => {});
    return profile;
  }

  async function send(req, res, id) {
    const avatar = (await profiles.get(id)).avatar;
    const file = avatar && await files.open(fileName(id, avatar));
    if (!file) throw httpError(404, 'not_found', 'Not found');
    res.setHeader('Content-Type', avatar.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (file.size) res.setHeader('Content-Length', String(file.size));
    res.writeHead(200);
    if (req.method === 'HEAD') { file.stream.destroy(); res.end(); return; }
    await pipeline(file.stream, res);
  }

  async function handle(req, res) {
    const id = PATH.exec(new URL(req.url, 'http://localhost').pathname)[1];
    if (req.method === 'GET' || req.method === 'HEAD') return send(req, res, id);
    if (req.method === 'PUT') return sendJson(res, 200, { profile: await upload(req, id) });
    if (req.method === 'DELETE') return sendJson(res, 200, { profile: await remove(req, id) });
    res.setHeader('Allow', 'GET, HEAD, PUT, DELETE, OPTIONS');
    throw httpError(405, 'method_not_allowed', 'Method not allowed');
  }

  return {
    // An early refusal leaves the body unread; drain it so the connection can answer.
    handle: (req, res) => handleErrors(res, () => handle(req, res).catch(error => { req.resume(); throw error; })),
  };
}
