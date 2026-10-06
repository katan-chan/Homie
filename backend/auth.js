import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const parameters = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const cookieName = 'homie_session';
const accounts = ['minhle', 'haiyen'];
const DAY = 24 * 60 * 60 * 1000;
// The server keeps only a hash of each session token, in memory and in the 'sessions' document.
const keyOf = token => token ? createHash('sha256').update(token).digest('hex') : null;

export const emptySessions = () => ({ sessions: [] });
export function validateSessions(saved) {
  if (!Array.isArray(saved?.sessions)) throw new Error('Invalid sessions document');
  return { sessions: saved.sessions.filter(item => typeof item?.key === 'string' && accounts.includes(item.id) && Number.isFinite(item.expires)) };
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || !password.length) throw new TypeError('Password must be a nonempty string');
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 64, parameters);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function parseHash(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{32}:[a-f\d]{128}$/i.test(value)) return null;
  const [salt, hash] = value.split(':');
  return { salt: Buffer.from(salt, 'hex'), hash: Buffer.from(hash, 'hex') };
}

export function createAuth(options) {
  const configured = options.credentials ?? { minhle: process.env.MINHLE_PASSWORD_HASH, haiyen: process.env.HAIYEN_PASSWORD_HASH };
  const credentials = Object.fromEntries(accounts.map(id => [id, parseHash(configured[id])]));
  const ready = accounts.every(id => credentials[id]);
  const secure = options.production ?? process.env.NODE_ENV === 'production';
  const sameSite = options.sameSite ?? process.env.SESSION_SAME_SITE ?? 'Lax';
  if (!['Lax', 'Strict', 'None'].includes(sameSite)) throw new Error('SESSION_SAME_SITE must be Lax, Strict or None');
  if (sameSite === 'None' && !secure) throw new Error('SameSite=None requires Secure production cookies');
  // Sliding: a session in use is extended (at most once a day) to ttl from its last use.
  const ttl = options.sessionTtlMs ?? 90 * DAY, step = Math.min(DAY, ttl / 2);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('Session TTL must be positive');
  const sessions = new Map();
  const listeners = new Set();
  const attempts = new Map();
  let working = 0;
  // Optional durable store ({ read, update, close }); without one sessions live in memory only.
  const store = options.sessionStore ?? null;
  let loaded = !store, loading = null, saving = Promise.resolve();
  function load() {
    if (loaded) return Promise.resolve();
    loading ??= store.read().then(doc => {
      for (const item of doc.sessions) if (item.expires > Date.now() && !sessions.has(item.key)) sessions.set(item.key, { id: item.id, expires: item.expires });
      loaded = true;
    }, error => {
      // Storage down: sessions stay in memory and nothing is written until a later request loads them.
      loading = null;
      console.error('sessions: could not load', error.message);
    });
    return loading;
  }
  function save() {
    if (!store || !loaded) return;
    // ponytail: rewrites the whole (small) list on each login, logout and daily extension; fine for two people.
    saving = saving.then(() => store.update(doc => {
      doc.sessions = [...sessions].filter(([, session]) => session.expires > Date.now()).map(([key, session]) => ({ key, id: session.id, expires: session.expires }));
    })).catch(error => console.error('sessions: could not save', error.message));
  }
  function lookup(request) {
    pruneSessions();
    const key = keyOf(token(request)), session = key && sessions.get(key);
    if (session && session.expires - Date.now() < ttl - step) { session.expires = Date.now() + ttl; save(); }
    return session ? { key, session } : null;
  }

  function token(request) {
    return (request.headers.cookie ?? '').split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  }
  function pruneSessions() {
    for (const [key, session] of sessions) if (session.expires <= Date.now()) revoke(key);
  }
  function revoke(key) {
    if (!key || !sessions.delete(key)) return;
    save();
    for (const listener of listeners) {
      try { listener(key); } catch { /* Session revocation must finish even if a subscriber fails. */ }
    }
  }
  function cookie(value, maxAge) {
    return `${cookieName}=${value}; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }
  function throttle(request, accountId) {
    const now = Date.now();
    for (const [key, bucket] of attempts) if (bucket.expires <= now) attempts.delete(key);
    // Trust the socket, never a caller-supplied forwarded IP header.
    const keys = [[`ip:${request.socket.remoteAddress}`, 30], [`account:${accounts.includes(accountId) ? accountId : 'unknown'}`, 10]];
    for (const [key, limit] of keys) {
      let bucket = attempts.get(key);
      if (!bucket) {
        if (attempts.size >= 5000) return 900;
        bucket = { count: 0, expires: now + 15 * 60 * 1000 };
        attempts.set(key, bucket);
      }
      if (bucket.count >= limit) return Math.ceil((bucket.expires - now) / 1000);
    }
    for (const [key] of keys) attempts.get(key).count++;
    return 0;
  }

  return {
    ready,
    throttle,
    async verify(accountId, password) {
      if (working >= 2) return null;
      working++;
      try {
        const credential = accounts.includes(accountId) ? credentials[accountId] : credentials.minhle;
        const actual = await derive(password, credential.salt, 64, parameters);
        const matches = timingSafeEqual(actual, credential.hash);
        return accounts.includes(accountId) && matches;
      } finally {
        working--;
      }
    },
    load,
    userId(request) {
      return lookup(request)?.session.id ?? null;
    },
    /** token is the server-side key of the session (a hash), safe to compare and keep in memory. */
    session(request) {
      const found = lookup(request);
      return found ? Object.freeze({ token: found.key, id: found.session.id, expiresAt: found.session.expires }) : null;
    },
    isSession(session) {
      pruneSessions();
      return !!session && sessions.get(session.token)?.id === session.id;
    },
    /** A fresh cookie for a live session, so the phone keeps it for another ttl; null without one. */
    refreshCookie(request) {
      return lookup(request) ? cookie(token(request), Math.ceil(ttl / 1000)) : null;
    },
    subscribeRevocation(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    issue(request, id) {
      pruneSessions();
      revoke(keyOf(token(request)));
      if (sessions.size >= 1000) return null;
      const value = randomBytes(32).toString('hex');
      sessions.set(keyOf(value), { id, expires: Date.now() + ttl });
      save();
      return cookie(value, Math.ceil(ttl / 1000));
    },
    logout(request) {
      revoke(keyOf(token(request)));
      return cookie('', 0);
    },
    /** Resolves once every login, logout and extension so far is written (or failed and was logged). */
    flush: () => saving,
    async close() {
      await saving;
      await store?.close();
    },
  };
}
