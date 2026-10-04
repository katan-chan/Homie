import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackend, hashPassword } from '../../backend/server.js';

const root = new URL('../../', import.meta.url);
export const fixturePasswords = { minhle: 'notes-client-only-minh', haiyen: 'notes-client-only-yen' };
let credentials;
export async function createNotesFixture({ app = false, ...options } = {}) {
  credentials ||= await Promise.all(Object.entries(fixturePasswords).map(async ([id, password]) => [id, await hashPassword(password)])).then(Object.fromEntries);
  const dataDir = await mkdtemp(join(tmpdir(), 'homie-client-fixture-'));
  let backend;
  const frontend = createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) {
      const proxy = httpRequest({ hostname: '127.0.0.1', port: backend.address().port,
        path: req.url, method: req.method, headers: req.headers }, upstream => {
        res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
        res.on('close', () => upstream.destroy());
      });
      proxy.on('error', () => { if (!res.headersSent) res.writeHead(503); res.end(); });
      req.pipe(proxy); req.on('aborted', () => proxy.destroy());
      return;
    }
    if (req.url === '/js/config.js') {
      res.setHeader('Content-Type', 'text/javascript'); res.end("export const API_BASE_URL = '';\n"); return;
    }
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(app ? await readFile(new URL('index.html', root)) : '<!doctype html><html lang="vi"><body></body></html>'); return;
    }
    const path = resolve(root.pathname, '.' + new URL(req.url, 'http://fixture').pathname);
    if (!path.startsWith(root.pathname) || !['.js', '.css', '.png', '.gif', '.webp', '.woff2', '.ttf'].includes(extname(path))) { res.writeHead(404).end(); return; }
    try { res.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : extname(path) === '.css' ? 'text/css' : 'image/' + extname(path).slice(1)); res.end(await readFile(path)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(done => frontend.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${frontend.address().port}`;
  backend = createBackend(origin, { credentials, dataDir, production: false, ...options });
  await new Promise(done => backend.listen(0, '127.0.0.1', done));
  return { origin, dataDir, backend, async close() {
    await new Promise(done => backend.close(done));
    frontend.closeAllConnections(); await new Promise(done => frontend.close(done));
    await rm(dataDir, { recursive: true, force: true });
  } };
}
