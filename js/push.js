// Phone notifications, Android app only (Capacitor injects window.Capacitor into the hosted page). After login the
// phone asks once for permission and registers its token; a tapped notification opens the jar or the note it is about.
import { apiRequest, authEvents, getUser } from './auth.js';

const plugin = () => window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.PushNotifications ?? null : null;
let token = null, registeredFor = null, asked = false;

async function sync() {
  const push = plugin(), user = getUser();
  if (!push || !user) { registeredFor = null; return; }
  if (!token) {
    if (asked) return;
    asked = true;
    let { receive } = await push.checkPermissions();
    if (receive === 'prompt' || receive === 'prompt-with-rationale') ({ receive } = await push.requestPermissions());
    if (receive === 'granted') await push.register();
    return;
  }
  if (registeredFor === user.id) return;
  try {
    await apiRequest('/api/push/devices', { method: 'POST', body: { token } });
    registeredFor = user.id;
  } catch { /* The next login or app start tries again. */ }
}

function open(data = {}) {
  if (data.boardId) {
    try { sessionStorage.setItem('homie-notes:focus', JSON.stringify({ boardId: data.boardId, noteId: data.noteId ?? '' })); } catch {}
  }
  if (!data.hash) return;
  // Already on that tab: reload so the tab reads the note to focus.
  if (location.hash === `#${data.hash}`) location.reload();
  else location.hash = data.hash;
}

export function initPush() {
  const push = plugin();
  if (!push) return;
  push.addListener('registration', ({ value }) => { token = value; sync(); });
  push.addListener('pushNotificationActionPerformed', ({ notification }) => open(notification.data));
  authEvents.addEventListener('change', () => { sync().catch(() => {}); });
  sync().catch(() => {});
}

/** Before logout: this phone stops receiving the account's notifications. */
export async function forgetDevice() {
  if (!plugin() || !token || !getUser()) return;
  try { await apiRequest('/api/push/devices', { method: 'DELETE', body: { token } }); } catch {}
  registeredFor = null;
}
