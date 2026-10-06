// /api/push/devices: the Android app registers its Firebase token after login (POST) and forgets it before logout (DELETE).
import { handleErrors, httpError, readJson, requireWrite, sendJson } from './http.js';
import { TOKEN } from './push.js';

export const route = path => /^\/api\/push(?:\/|$)/.test(path);

export function create({ auth, allowedOrigins, push }) {
  async function handle(req, res) {
    if (new URL(req.url, 'http://push').pathname !== '/api/push/devices') throw httpError(404, 'not_found', 'Not found');
    if (!['POST', 'DELETE'].includes(req.method)) throw httpError(405, 'method_not_allowed', 'Method not allowed');
    const account = requireWrite(req, { auth, allowedOrigins });
    const body = await readJson(req);
    if (!body || typeof body.token !== 'string' || !TOKEN.test(body.token) || Object.keys(body).length !== 1) throw httpError(400, 'invalid_token', 'token must be a device token');
    await (req.method === 'POST' ? push.register(account, body.token) : push.unregister(account, body.token));
    sendJson(res, 204);
  }
  return { handle: (req, res) => handleErrors(res, () => handle(req, res)) };
}
