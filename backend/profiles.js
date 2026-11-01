import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const accountIds = ['minhle', 'haiyen'];

export function validateProfile(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== 2 || !Object.hasOwn(body, 'displayName') || !Object.hasOwn(body, 'bio')) return null;
  if (typeof body.displayName !== 'string' || typeof body.bio !== 'string') return null;
  const displayName = body.displayName.trim();
  const bio = body.bio.trim();
  if (!displayName.length || displayName.length > 80 || bio.length > 500) return null;
  return { displayName, bio };
}

const AVATAR_TYPES = ['image/webp', 'image/jpeg'];

/** { version, mime } of a stored avatar (set only through the avatar route), or null. */
export function validateAvatar(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2) return null;
  if (!Number.isInteger(value.version) || value.version < 1 || !AVATAR_TYPES.includes(value.mime)) return null;
  return { version: value.version, mime: value.mime };
}

/** remote: optional Supabase storage (backend/supabase.js); otherwise profiles.json in dataDir. */
export function createProfiles(dataDir, remote = null) {
  const path = join(dataDir, 'profiles.json');
  let profiles;
  let loadError = false;
  let writes = Promise.resolve();
  const load = async () => {
    loadError = false;
    try {
      const saved = remote ? await remote.getDocument('profiles') : JSON.parse(await readFile(path, 'utf8'));
      if (saved === null) throw Object.assign(new Error('No profiles yet'), { code: 'ENOENT' });
      if (!saved || Array.isArray(saved) || typeof saved !== 'object' || Object.keys(saved).length !== 2) throw new Error('Invalid profiles');
      profiles = {};
      for (const id of accountIds) {
        const record = saved[id];
        if (!record || record.id !== id) throw new Error('Invalid profile');
        const { id: ignored, avatar, ...fields } = record;
        const text = validateProfile(fields);
        const picture = avatar === undefined ? null : validateAvatar(avatar);
        if (!text || (avatar !== undefined && !picture)) throw new Error('Invalid profile');
        profiles[id] = picture ? { id, ...text, avatar: picture } : { id, ...text };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        loadError = true;
        return;
      }
      profiles = {
        minhle: { id: 'minhle', displayName: 'Minh Lê', bio: '' },
        haiyen: { id: 'haiyen', displayName: 'Hải Yến', bio: '' },
      };
    }
  };
  let loaded = load();
  async function ensureLoaded() {
    await loaded;
    // A network blip at boot must not disable remote profiles until restart; retry on the next request.
    if (loadError && remote) { loaded = load(); await loaded; }
    if (loadError) throw new Error('Profile storage is unavailable');
  }

  // Every write rewrites the whole document, one at a time.
  function write(id, change) {
    const operation = writes.then(async () => {
      await ensureLoaded();
      const next = { ...profiles, [id]: change(profiles[id]) };
      if (remote) { await remote.putDocument('profiles', next); profiles = next; return { ...profiles[id] }; }
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
      profiles = next;
      return { ...profiles[id] };
    });
    writes = operation.catch(() => {});
    return operation;
  }

  return {
    async get(id) {
      await ensureLoaded();
      return { ...profiles[id] };
    },
    /** Text fields only; the avatar stays. */
    update: (id, fields) => write(id, current => ({ ...current, ...fields, id })),
    /** avatar { version, mime }, or null to remove it. */
    setAvatar: (id, avatar) => write(id, ({ avatar: old, ...rest }) => (avatar ? { ...rest, avatar } : rest)),
  };
}
