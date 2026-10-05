// Nội quy API (part E). Members only; the rules themselves live in rules-domain.js.
import { randomUUID } from 'node:crypto';
import { createDocStore, recalled, rememberRequest } from './doc-store.js';
import { handleErrors, httpError, readJson, requireMember, requireWrite, sendJson } from './http.js';
import { agree, cancelArchive, confirmArchive, emptyRules, proposeRevision, proposeRule, requestArchive, validateRulesDoc } from './rules-domain.js';

export const route = path => /^\/api\/rules(?:\/|$)/.test(path);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actions = {
  revisions: proposeRevision,
  agree,
  'archive-request': requestArchive,
  'archive-confirm': confirmArchive,
  'archive-cancel': cancelArchive,
};

export function create({ auth, allowedOrigins, dataDir, remote }) {
  const store = createDocStore({ key: 'rules', dataDir, remote, empty: emptyRules, validate: validateRulesDoc });

  async function handle(req, res) {
    const path = req.url.split('?')[0];
    if (path === '/api/rules' && ['GET', 'HEAD'].includes(req.method)) {
      requireMember(req, auth);
      return sendJson(res, 200, { rules: (await store.read()).rules });
    }
    const match = path === '/api/rules' ? [path, null, null] : path.match(/^\/api\/rules\/([^/]+)\/([a-z-]+)$/);
    if (!match || req.method !== 'POST' || (match[1] && (!UUID.test(match[1]) || !Object.hasOwn(actions, match[2])))) {
      throw httpError(404, 'not_found', 'Not found');
    }
    const actor = requireWrite(req, { auth, allowedOrigins });
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'invalid_body', 'Body must be an object');
    if (typeof body.requestId !== 'string' || !UUID.test(body.requestId)) throw httpError(400, 'invalid_request_id', 'requestId must be a UUID');
    // Scoped by account so one member can never replay the other's request.
    const requestKey = `${actor}:${body.requestId}`;
    const rule = await store.update(doc => {
      const seen = recalled(doc, requestKey);
      if (seen) return doc.rules.find(item => item.id === seen);
      const now = new Date().toISOString();
      const result = match[1]
        ? actions[match[2]](doc, actor, match[1], body, { now })
        : proposeRule(doc, actor, body, { id: randomUUID(), now });
      rememberRequest(doc, requestKey, result.id);
      return result;
    });
    sendJson(res, match[1] ? 200 : 201, { rule });
  }

  return {
    handle: (req, res) => handleErrors(res, () => handle(req, res)),
    close: () => store.close(),
  };
}
