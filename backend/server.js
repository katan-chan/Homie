import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function createBackend(frontendOrigins = process.env.FRONTEND_ORIGINS ?? '') {
  const allowed = new Set(frontendOrigins.split(',').map((origin) => origin.trim()).filter(Boolean));
  return createServer((request, response) => {
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
      response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (request.url?.split('?')[0] !== '/api/health') {
      response.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
    } else if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
    } else if (request.method === 'GET' || request.method === 'HEAD') {
      response.writeHead(200).end(JSON.stringify({ status: 'ok' }));
    } else {
      response.setHeader('Allow', 'GET, HEAD, OPTIONS');
      response.writeHead(405).end(JSON.stringify({ error: 'Method not allowed' }));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3001);
  createBackend().listen(port, '0.0.0.0', () => console.log(`Backend listening on port ${port}`));
}
