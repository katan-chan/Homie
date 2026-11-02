// Words for times on the Vị trí map and timeline, in Vietnam time.
const ZONE = 'Asia/Ho_Chi_Minh';
const MIN = 60000, HOUR = 60 * MIN;
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'HH:MM' */
export const clock = ms => timeFormat.format(new Date(ms));
/** 'YYYY-MM-DD' */
export const localDay = ms => dayFormat.format(new Date(ms));

/** 'Vừa xong', 'x phút trước', 'x giờ trước' (same day), 'hôm qua lúc HH:MM' or 'DD/MM lúc HH:MM'. */
export function ago(at, now) {
  const diff = Math.max(0, now - at);
  if (diff < MIN) return 'Vừa xong';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} phút trước`;
  if (localDay(at) === localDay(now)) return `${Math.floor(diff / HOUR)} giờ trước`;
  if (localDay(at) === localDay(now - 24 * HOUR)) return `hôm qua lúc ${clock(at)}`;
  const [, month, day] = localDay(at).split('-');
  return `${day}/${month} lúc ${clock(at)}`;
}

/** '25 phút', '1 giờ', '2 giờ 15 phút' (at least 1 phút). */
export function duration(ms) {
  const minutes = Math.max(1, Math.round(ms / MIN)), hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (!hours) return `${minutes} phút`;
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
}

/** The line under a person's picture: off, lost signal, or how long ago the last point came. */
export function personLine(person, now) {
  if (!person.sharing.on) {
    if (!person.sharing.stoppedAt) return 'Chưa chia sẻ vị trí';
    return `Đã tắt lúc ${clock(person.sharing.stoppedAt)}${person.sharing.reason === 'battery' ? ' vì pin yếu' : ''}`;
  }
  if (!person.at) return 'Đang chờ vị trí đầu tiên';
  if (person.stale) return `Mất tín hiệu từ ${clock(person.at)}`;
  return ago(person.at, now);
}
