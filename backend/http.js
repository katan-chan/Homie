// Shared HTTP helpers for feature APIs (backend/features.js). Errors are { error, code }.
import { accountIds } from './profiles.js';

export function httpError(status, code, message = code) {
  return Object.assign(new Error(message), { status, code });
}

export function sendJson(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(status).end(body === undefined ? undefined : JSON.stringify(body));
}

export function readJson(req, { limit = 32768 } = {}) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    req.resume();
    return Promise.reject(httpError(415, 'unsupported_media_type', 'Content-Type must be application/json'));
  }
  if (Number(req.headers['content-length'] ?? 0) > limit) {
    req.resume();
    return Promise.reject(httpError(413, 'body_too_large', 'Request body too large'));
  }
  return new Promise((resolve, reject) => {
    let size = 0, failed = false;
    const chunks = [];
    const fail = error => { if (!failed) { failed = true; chunks.length = 0; reject(error); } };
    // Oversized bodies keep draining so the connection can still answer.
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) fail(httpError(413, 'body_too_large', 'Request body too large'));
      else if (!failed) chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { fail(httpError(400, 'invalid_body', 'Invalid JSON')); }
    });
    req.on('error', () => fail(httpError(400, 'invalid_body', 'Invalid request body')));
    req.on('aborted', () => fail(httpError(400, 'invalid_body', 'Request aborted')));
  });
}

/** Returns 'minhle' | 'haiyen' from the session cookie; 401 otherwise. */
export function requireMember(req, auth) {
  const id = auth.userId(req);
  if (!accountIds.includes(id)) throw httpError(401, 'unauthorized', 'Authentication required');
  return id;
}

/** Writes need an allowlisted Origin, X-Requested-With: Homie and a session. Returns the account id. */
export function requireWrite(req, { auth, allowedOrigins }) {
  const origin = req.headers.origin;
  if (!origin || !new Set(allowedOrigins).has(origin) || req.headers['x-requested-with'] !== 'Homie') {
    throw httpError(403, 'forbidden', 'Mutation requires allowed Origin and X-Requested-With');
  }
  return requireMember(req, auth);
}

export async function handleErrors(res, fn) {
  try {
    return await fn();
  } catch (error) {
    // Unexpected errors never echo their message: it may carry private content.
    sendJson(res, error.status ?? 500, error.status
      ? { error: error.message, code: error.code ?? 'error' }
      : { error: 'Internal server error', code: 'internal_error' });
  }
}
