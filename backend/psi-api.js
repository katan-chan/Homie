// Tờ PSI: Minh Lê's daily sheet about himself (likes and dislikes about himself, weaknesses, strengths).
// Both members read every sheet; only minhle writes, and only the sheet for today in Asia/Ho_Chi_Minh.
import { createDocStore } from './doc-store.js';
import { localDate } from './dates.js';
import { handleErrors, httpError, readJson, requireMember, requireWrite, sendJson } from './http.js';

export const route = path => /^\/api\/psi(?:\/|$)/.test(path);

export const OWNER = 'minhle';
export const FIELDS = Object.freeze(['likes', 'dislikes', 'weaknesses', 'strengths']);
export const MAX_FIELD = 4000;

export const emptyPsi = () => ({ sheets: {} });
export function validatePsi(doc) {
  if (!doc || typeof doc.sheets !== 'object' || Array.isArray(doc.sheets)) throw new Error('Invalid psi document');
  return doc;
}

/** The four trimmed fields from a request body; 400 when a field is missing, not text, too long, or all are empty. */
export function cleanSheet(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !FIELDS.includes(key))) {
    throw httpError(400, 'invalid_body', 'Body must have only likes, dislikes, weaknesses, strengths');
  }
  const sheet = {};
  for (const field of FIELDS) {
    const value = body[field] ?? '';
    if (typeof value !== 'string') throw httpError(400, 'invalid_' + field, `${field} must be text`);
    sheet[field] = value.trim();
    if ([...sheet[field]].length > MAX_FIELD) throw httpError(400, 'invalid_' + field, `${field} is longer than ${MAX_FIELD} characters`);
  }
  if (FIELDS.every(field => !sheet[field])) throw httpError(400, 'empty_sheet', 'Write at least one box');
  return sheet;
}

export function create({ auth, allowedOrigins, dataDir, remote, now = () => new Date().toISOString() }) {
  const store = createDocStore({ key: 'psi', dataDir, remote, empty: emptyPsi, validate: validatePsi });

  async function handle(req, res) {
    const path = req.url.split('?')[0];
    if (path === '/api/psi' && ['GET', 'HEAD'].includes(req.method)) {
      requireMember(req, auth);
      // ponytail: every sheet in one response (~16 KB max each); page by month if years of sheets make it slow.
      return sendJson(res, 200, { today: localDate(now()), sheets: (await store.read()).sheets });
    }
    if (path !== '/api/psi/today') throw httpError(404, 'not_found', 'Not found');
    if (req.method !== 'PUT') throw httpError(405, 'method_not_allowed', 'Method not allowed');
    const actor = requireWrite(req, { auth, allowedOrigins });
    if (actor !== OWNER) throw httpError(403, 'owner_only', 'Only Minh Lê writes this sheet');
    // 4 × 4000 Vietnamese characters can pass 32 KB of UTF-8.
    const fields = cleanSheet(await readJson(req, { limit: 65536 }));
    const savedAt = now(), date = localDate(savedAt);
    const sheet = await store.update(doc => (doc.sheets[date] = { ...fields, savedAt }));
    sendJson(res, 200, { date, sheet });
  }

  return {
    handle: (req, res) => handleErrors(res, () => handle(req, res)),
    close: () => store.close(),
  };
}
