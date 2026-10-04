// Durable storage on Supabase over plain fetch: JSON documents in public.documents, files in a private bucket.
// The secret key stays on the server; tables have RLS on with no policies, so the publishable key cannot read them.
function failure(message, status) {
  return Object.assign(new Error(message), { code: 'storage_unavailable', status });
}

export function supabaseFromEnv(env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return null;
  return createSupabase({ url: env.SUPABASE_URL, key: env.SUPABASE_SECRET_KEY, bucket: env.SUPABASE_BUCKET || 'note-media', prefix: env.SUPABASE_PREFIX || '' });
}

/** prefix namespaces document keys and file paths, so integration tests never touch real data. */
export function createSupabase({ url, key, bucket = 'note-media', prefix = '', fetch: request = fetch }) {
  const base = url.replace(/\/+$/, ''), auth = { apikey: key, Authorization: `Bearer ${key}` };
  const objectUrl = path => `${base}/storage/v1/object/${bucket}/${prefix}${path.split('/').map(encodeURIComponent).join('/')}`;
  async function call(target, init, label) {
    let response;
    try { response = await request(target, { ...init, headers: { ...auth, ...init?.headers } }); }
    catch { throw failure(`${label} failed: network error`, 503); }
    return response;
  }
  return {
    async getDocument(name) {
      const response = await call(`${base}/rest/v1/documents?key=eq.${encodeURIComponent(prefix + name)}&select=value`, {}, 'Read document');
      if (!response.ok) throw failure(`Read document failed (${response.status})`, 503);
      const rows = await response.json();
      return rows.length ? rows[0].value : null;
    },
    async putDocument(name, value) {
      const response = await call(`${base}/rest/v1/documents?on_conflict=key`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ key: prefix + name, value, updated_at: new Date().toISOString() }),
      }, 'Write document');
      if (!response.ok) throw failure(`Write document failed (${response.status})`, 503);
    },
    async deleteDocument(name) {
      const response = await call(`${base}/rest/v1/documents?key=eq.${encodeURIComponent(prefix + name)}`, { method: 'DELETE' }, 'Delete document');
      if (!response.ok) throw failure(`Delete document failed (${response.status})`, 503);
    },
    async putFile(path, body, contentType) {
      const response = await call(objectUrl(path), { method: 'POST', headers: { 'Content-Type': contentType, 'x-upsert': 'true' }, body }, 'Upload file');
      if (!response.ok) throw failure(`Upload file failed (${response.status})`, 503);
    },
    /** Returns the fetch Response for streaming, or null when the object does not exist. */
    async getFile(path) {
      const response = await call(objectUrl(path), {}, 'Download file');
      if (response.status === 404 || response.status === 400) { await response.body?.cancel(); return null; }
      if (!response.ok) throw failure(`Download file failed (${response.status})`, 503);
      return response;
    },
    async removeFiles(paths) {
      if (!paths.length) return;
      const response = await call(`${base}/storage/v1/object/${bucket}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths.map(path => prefix + path) }),
      }, 'Remove files');
      if (!response.ok) throw failure(`Remove files failed (${response.status})`, 503);
    },
  };
}
