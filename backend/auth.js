import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const parameters = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const cookieName = 'homie_session';
const accounts = ['minhle', 'haiyen'];

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
  const ttl = options.sessionTtlMs ?? 24 * 60 * 60 * 1000;
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('Session TTL must be positive');
  const sessions = new Map();
  const attempts = new Map();
  let working = 0;

  function token(request) {
    return (request.headers.cookie ?? '').split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  }
  function pruneSessions() {
    for (const [key, session] of sessions) if (session.expires <= Date.now()) sessions.delete(key);
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
    userId(request) {
      pruneSessions();
      return sessions.get(token(request))?.id ?? null;
    },
    issue(request, id) {
      pruneSessions();
      sessions.delete(token(request));
      if (sessions.size >= 1000) return null;
      const value = randomBytes(32).toString('hex');
      sessions.set(value, { id, expires: Date.now() + ttl });
      return cookie(value, Math.ceil(ttl / 1000));
    },
    logout(request) {
      sessions.delete(token(request));
      return cookie('', 0);
    },
  };
}
