import { API_BASE_URL } from './config.js';

export const authEvents = new EventTarget();
let user = null;
let version = 0;

export function getUser() {
  return user;
}

function setUser(next, reason = 'session') {
  if (JSON.stringify(user) === JSON.stringify(next)) return;
  user = next;
  authEvents.dispatchEvent(new CustomEvent('change', { detail: { reason } }));
}

export async function apiRequest(path, { method = 'GET', body, signal } = {}) {
  const request = version;
  const headers = {};
  if (!['GET', 'HEAD'].includes(method)) headers['X-Requested-With'] = 'Homie';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method, credentials: 'include', headers, signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth/') && request === version) {
      version++;
      setUser(null, 'expired');
    }
    const error = new Error(data?.error ?? 'Không thể kết nối với máy chủ.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function refreshSession({ signal } = {}) {
  const request = version;
  try {
    const data = await apiRequest('/api/auth/session', { signal });
    if (request === version && !signal?.aborted) setUser(data.user);
    return request === version ? data.user : user;
  } catch (error) {
    if (error.status === 401) {
      if (request === version && !signal?.aborted) setUser(null, 'expired');
      return request === version ? null : user;
    }
    throw error;
  }
}

export async function login(accountId, password, { signal } = {}) {
  const request = ++version;
  const data = await apiRequest('/api/auth/login', { method: 'POST', body: { accountId, password }, signal });
  if (request === version && !signal?.aborted) setUser(data.user);
  return data.user;
}

export async function logout() {
  await apiRequest('/api/auth/logout', { method: 'POST' });
  version++;
  setUser(null, 'logout');
}

export function updateUserProfile(profile) {
  if (user?.id === profile.id) setUser({ ...user, ...profile });
}
