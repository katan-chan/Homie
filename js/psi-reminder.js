// Android app only: a local notification at 21:00 (Asia/Ho_Chi_Minh) each evening reminds Minh Lê to write his PSI sheet.
// The next 30 evenings are scheduled on every app start, login and save; tonight is skipped once today's sheet exists.
// Any other account, or logging out, cancels them.
import { apiRequest, authEvents, getUser } from './auth.js';

const plugin = () => window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.LocalNotifications ?? null : null;
const OWNER = 'minhle', DAYS = 30, FIRST_ID = 7000;
const ids = Array.from({ length: DAYS }, (_, i) => ({ id: FIRST_ID + i }));
// 21:00 in Vietnam (UTC+7, no daylight saving) is 14:00 UTC the same day.
const eveningOf = (date, offset) => new Date(Date.parse(`${date}T14:00:00Z`) + offset * 86400000);
let running = Promise.resolve();

/** Reschedules the reminders. Pass { today, filled } when the caller already knows them, to skip a request. */
export function refreshPsiReminder(known) {
  running = running.then(() => schedule(known)).catch(() => { /* The next app start or save tries again. */ });
  return running;
}

async function schedule(known) {
  const notifications = plugin();
  if (!notifications) return;
  await notifications.cancel({ notifications: ids });
  if (getUser()?.id !== OWNER) return;
  if (!known) {
    const { today, sheets } = await apiRequest('/api/psi');
    known = { today, filled: Boolean(sheets[today]) };
  }
  let { display } = await notifications.checkPermissions();
  if (display === 'prompt' || display === 'prompt-with-rationale') ({ display } = await notifications.requestPermissions());
  if (display !== 'granted' || getUser()?.id !== OWNER) return;
  const now = Date.now();
  const list = ids.map(({ id }, i) => ({
    id, at: eveningOf(known.today, i),
  })).filter(({ at }, i) => at > now && !(i === 0 && known.filled)).map(({ id, at }) => ({
    id, title: 'Tờ PSI hôm nay',
    body: 'Hôm nay Minh thích và chưa thích gì ở chính mình? Viết tờ PSI tối nay nhé.',
    extra: { hash: 'minhle' },
    schedule: { at, allowWhileIdle: true },
  }));
  if (list.length) await notifications.schedule({ notifications: list });
}

export function initPsiReminder() {
  const notifications = plugin();
  if (!notifications) return;
  notifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    const hash = notification.extra?.hash;
    if (!hash) return;
    try { sessionStorage.setItem('homie-psi:focus', '1'); } catch {}
    // Already on that tab: reload so the profile reads the focus request.
    if (location.hash === `#${hash}`) location.reload();
    else location.hash = hash;
  });
  authEvents.addEventListener('change', () => refreshPsiReminder());
  refreshPsiReminder();
}
