import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createAuth } from './auth.js';
import { accountIds, createProfiles, validateProfile } from './profiles.js';
export { hashPassword } from './auth.js';

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
    request.resume();
    throw failure(415, 'Content-Type must be application/json');
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let oversized = false;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 8192) {
        if (!oversized) reject(failure(413, 'Request body too large'));
        oversized = true;
        chunks.length = 0;
      } else if (!oversized) chunks.push(chunk);
    });
    request.on('end', () => {
      if (oversized) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(failure(400, 'Invalid JSON')); }
    });
    request.on('error', () => reject(failure(400, 'Invalid request body')));
    request.on('aborted', () => reject(failure(400, 'Request aborted')));
  });
}

export function createBackend(frontendOrigins = process.env.FRONTEND_ORIGINS ?? '', options = {}) {
  const allowed = new Set(frontendOrigins.split(',').map((origin) => origin.trim()).filter(Boolean));
  const auth = createAuth(options);
  const profiles = createProfiles(options.dataDir ?? process.env.PROFILE_DATA_DIR ?? '.data');
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vary', 'Origin');
    const origin = request.headers.origin;
    if (origin && !allowed.has(origin)) {
      response.writeHead(403).end(JSON.stringify({ error: 'Origin not allowed' }));
      return;
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
    }
    const send = (status, body) => response.writeHead(status).end(body === undefined ? undefined : JSON.stringify(body));
    const path = request.url?.split('?')[0];
    const profileId = /^\/api\/profiles\/(minhle|haiyen)$/.exec(path)?.[1];
    const methods = path === '/api/health' || path === '/api/auth/session' ? ['GET', 'HEAD']
      : path === '/api/auth/login' || path === '/api/auth/logout' ? ['POST']
        : profileId ? ['GET', 'HEAD', 'PUT'] : null;
    if (!methods) return send(404, { error: 'Not found' });
    if (request.method === 'OPTIONS') return send(204);
    if (!methods.includes(request.method)) {
      response.setHeader('Allow', [...methods, 'OPTIONS'].join(', '));
      return send(405, { error: 'Method not allowed' });
    }
    try {
      if (path === '/api/health') return send(200, { status: 'ok' });
      if (request.method === 'POST' || request.method === 'PUT') {
        if (!origin || !allowed.has(origin) || request.headers['x-requested-with'] !== 'Homie') throw failure(403, 'Mutation requires allowed Origin and X-Requested-With');
      }
      if (path === '/api/auth/login') {
        const body = await readJson(request);
        if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== 2 || !Object.hasOwn(body, 'accountId') || !Object.hasOwn(body, 'password') || typeof body.accountId !== 'string' || typeof body.password !== 'string' || body.accountId.length > 80 || !body.password.length || body.password.length > 1024) throw failure(400, 'Invalid login request');
        if (!auth.ready) throw failure(503, 'Authentication is unavailable');
        const retryAfter = auth.throttle(request, body.accountId);
        if (retryAfter) {
          response.setHeader('Retry-After', String(retryAfter));
          throw failure(429, 'Too many login attempts');
        }
        const valid = await auth.verify(body.accountId, body.password);
        if (valid === null) throw failure(503, 'Authentication is busy');
        if (!valid) throw failure(401, 'Invalid account or password');
        const user = await profiles.get(body.accountId);
        const cookie = auth.issue(request, body.accountId);
        if (!cookie) throw failure(503, 'Authentication is busy');
        response.setHeader('Set-Cookie', cookie);
        return send(200, { user });
      }
      if (path === '/api/auth/logout') {
        if (Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding']) {
          const body = await readJson(request);
          if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length) throw failure(400, 'Logout does not accept fields');
        }
        response.setHeader('Set-Cookie', auth.logout(request));
        return send(204);
      }
      if (path === '/api/auth/session') {
        const id = auth.userId(request);
        if (!id) throw failure(401, 'Authentication required');
        return send(200, { user: await profiles.get(id) });
      }
      if (request.method !== 'PUT') return send(200, { profile: await profiles.get(profileId) });
      const id = auth.userId(request);
      if (!id) throw failure(401, 'Authentication required');
      if (id !== profileId) throw failure(403, 'Only the profile owner may edit');
      const fields = validateProfile(await readJson(request));
      if (!fields || !accountIds.includes(id)) throw failure(400, 'Invalid profile fields');
      return send(200, { profile: await profiles.update(id, fields) });
    } catch (error) {
      send(error.status ?? 500, { error: error.status ? error.message : 'Internal server error' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3001);
  createBackend().listen(port, '0.0.0.0', () => console.log(`Backend listening on port ${port}`));
}
