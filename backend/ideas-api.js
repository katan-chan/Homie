// /api/ideas (part C): seminar topics and shared activities. Rules live in ideas-domain.js; this file maps HTTP to them.
import { handleErrors, httpError, readJson, requireMember, requireWrite, sendJson } from './http.js';
import { createDocStore, recalled, rememberRequest } from './doc-store.js';
import { localDate } from './dates.js';
import * as domain from './ideas-domain.js';

export const route = path => /^\/api\/ideas(?:\/|$)/.test(path);

const context = () => {
  const now = new Date().toISOString();
  return { now, today: localDate(now) };
};

export function create({ auth, allowedOrigins, dataDir, remote }) {
  const store = createDocStore({ key: 'ideas', dataDir, remote, empty: domain.emptyIdeas, validate: domain.validateIdeas });

  // Creates: a retried requestId returns the first result instead of a second record.
  const once = (actor, body, run) => store.update(doc => {
    const requestId = domain.requireRequestId(body.requestId), key = `${actor}:${requestId}`, prior = recalled(doc, key);
    if (prior !== undefined) return prior;
    const result = run(doc);
    rememberRequest(doc, key, result);
    return result;
  });
  const view = (doc, body) => domain.viewIdeas(doc, { kind: body.kind, category: body.category }, context());

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local'), parts = url.pathname.split('/').slice(3), method = req.method;
    const query = Object.fromEntries(url.searchParams);

    if (method === 'GET') {
      requireMember(req, auth);
      const doc = await store.read();
      if (!parts.length) return sendJson(res, 200, domain.viewIdeas(doc, query, context()));
      if (parts.length === 1 && parts[0] === 'sessions') return sendJson(res, 200, domain.listSessions(doc, query));
      throw httpError(404, 'not_found', 'Not found');
    }
    if (method !== 'POST' && method !== 'PUT') throw httpError(405, 'method_not_allowed', 'Method not allowed');

    const actor = requireWrite(req, { auth, allowedOrigins });
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'invalid_body', 'Invalid body');
    const [first, second, third] = parts, size = parts.length;
    const send = async (status, mutator) => sendJson(res, status, await store.update(mutator));

    if (method === 'POST' && size === 0) {
      return sendJson(res, 201, { idea: await once(actor, body, doc => domain.createIdea(doc, actor, body, context())) });
    }
    if (method === 'POST' && size === 1) {
      switch (first) {
        case 'pick':
          return send(200, doc => {
            const key = `${actor}:${domain.requireRequestId(body.requestId)}`;
            // A retried pick never draws again: it answers with the current round.
            if (recalled(doc, key) === undefined) {
              domain.pick(doc, actor, body, context());
              rememberRequest(doc, key, true);
            }
            return view(doc, body);
          });
        case 'skip': return send(200, doc => { domain.skip(doc, body); return view(doc, body); });
        case 'reset-skips': return send(200, doc => { domain.resetSkips(doc, body); return view(doc, body); });
        case 'relax': return send(200, doc => { domain.relax(doc, body); return view(doc, body); });
        case 'done': return sendJson(res, 201, { session: await once(actor, body, doc => domain.done(doc, actor, body, context())) });
      }
    }
    if (method === 'POST' && size === 2 && second === 'archive') {
      return send(200, doc => ({ idea: domain.archiveIdea(doc, actor, first, body, context()) }));
    }
    if (method === 'PUT' && size === 1 && first !== 'sessions') {
      return send(200, doc => ({ idea: domain.updateIdea(doc, actor, first, body, context()) }));
    }
    if (method === 'PUT' && size === 2 && second === 'position') {
      return send(200, doc => ({ idea: domain.moveIdea(doc, first, body) }));
    }
    if (method === 'PUT' && size === 3 && first === 'sessions' && third === 'rating') {
      return send(200, doc => ({ session: domain.rateSession(doc, actor, second, body) }));
    }
    throw httpError(404, 'not_found', 'Not found');
  }

  return {
    handle: (req, res) => handleErrors(res, () => handle(req, res)),
    close: () => store.close(),
  };
}
