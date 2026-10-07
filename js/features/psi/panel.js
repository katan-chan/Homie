import { apiRequest, getUser } from '../../auth.js';
import { refreshPsiReminder } from '../../psi-reminder.js';

const OWNER = 'minhle';
const FIELDS = [
  { key: 'likes', label: 'thích ở bản thân', tone: 'warm', placeholder: 'Ở bản thân, mình thích… vì…' },
  { key: 'dislikes', label: 'không thích ở bản thân', tone: 'rose', placeholder: 'Ở bản thân, mình không thích… vì…' },
  { key: 'weaknesses', label: 'điểm yếu của mình', tone: 'rose', placeholder: 'Mình còn yếu ở… vì…' },
  { key: 'strengths', label: 'điểm mạnh của mình', tone: 'warm', placeholder: 'Mình mạnh ở… vì…' },
];
const MAX = 4000;
const WEEKDAY = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const savedTime = iso => { try { return timeFormat.format(new Date(iso)); } catch { return ''; } };
function longDate(date) {
  const [y, m, d] = date.split('-');
  return `${WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]}, ${d}/${m}/${y}`;
}
function el(tag, props = {}, children = []) {
  const { attrs, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  for (const [key, value] of Object.entries(attrs ?? {})) node.setAttribute(key, value);
  node.append(...children);
  return node;
}
const blank = () => Object.fromEntries(FIELDS.map(({ key }) => [key, '']));

/** Mounts Minh Lê's PSI sheets (members only). Returns an idempotent cleanup. */
export function mountPsiPanel(container, { signal } = {}) {
  const controller = new AbortController();
  let disposed = false, today = null, sheets = {}, date = null, draft = null, saving = false;
  const root = el('section', { className: 'psi-panel', attrs: { 'aria-labelledby': 'psi-title' } });
  container.replaceChildren(root);
  const alive = () => !disposed && !signal?.aborted;
  const owner = () => getUser()?.id === OWNER;
  const days = () => [...new Set([...Object.keys(sheets), today])].sort();

  function render({ focus, message } = {}) {
    if (!alive()) return;
    const writable = owner() && date === today;
    const list = days(), at = list.indexOf(date), sheet = sheets[date];
    if (writable && !draft) draft = { ...blank(), ...sheets[today] };
    delete draft?.savedAt;

    const go = next => { date = next; render({ focus: 'day' }); };
    const pick = el('select', { id: 'psi-day', className: 'psi-day', attrs: { 'aria-label': 'Chọn ngày' } },
      [...list].reverse().map(key => el('option', { value: key, selected: key === date, textContent: key.split('-').reverse().slice(0, 2).join('/') + (key === today ? ' (hôm nay)' : '') })));
    pick.addEventListener('change', () => go(pick.value));
    const nav = el('div', { className: 'psi-nav' }, [
      el('button', { type: 'button', className: 'psi-arrow', textContent: '‹', disabled: at <= 0, onclick: () => go(list[at - 1]), attrs: { 'aria-label': 'Ngày trước' } }),
      pick,
      el('button', { type: 'button', className: 'psi-arrow', textContent: '›', disabled: at >= list.length - 1, onclick: () => go(list[at + 1]), attrs: { 'aria-label': 'Ngày sau' } }),
    ]);
    if (date !== today) nav.append(el('button', { type: 'button', className: 'secondary-button', textContent: 'Hôm nay', onclick: () => go(today) }));
    const hint = writable ? 'Mỗi tối viết lại mình là người thế nào. Sửa được tới hết ngày.'
      : owner() ? 'Tờ ngày cũ chỉ để xem lại, so với hôm nay.' : 'Minh tự viết về mình. Yến đọc được.';
    const children = [el('div', { className: 'psi-head' }, [
      el('div', {}, [el('h2', { id: 'psi-title', textContent: 'Minh nghĩ gì về Minh' }), el('p', { className: 'psi-hint', textContent: hint })]), nav])];

    const status = el('p', { className: 'psi-status', attrs: { role: 'status' }, textContent: message ?? (sheet ? `Đã lưu lúc ${savedTime(sheet.savedAt)}.` : '') });
    if (!writable && !sheet) {
      children.push(el('p', { className: 'psi-empty', textContent: date === today ? 'Minh chưa điền tờ hôm nay.' : 'Ngày này không có tờ nào.' }));
    } else {
      const grid = el('div', { className: 'psi-grid' }, FIELDS.map(field => {
        const id = `psi-${field.key}`;
        const chip = el(writable ? 'label' : 'span', { className: `psi-chip is-${field.tone}`, textContent: field.label });
        if (writable) chip.htmlFor = id;
        const body = writable
          ? el('textarea', { id, className: 'psi-text', maxLength: MAX, placeholder: field.placeholder, value: draft[field.key] })
          : el('div', { className: `psi-text${sheet[field.key] ? '' : ' is-empty'}`, textContent: sheet[field.key] || '(để trống)', tabIndex: 0, attrs: { role: 'region', 'aria-label': field.label } });
        if (writable) body.addEventListener('input', () => { draft[field.key] = body.value; });
        return el('div', { className: `psi-quad is-${field.key}` }, [chip, body]);
      }));
      children.push(el('div', { className: 'psi-sheet' }, [el('h3', { textContent: 'PSI' }), el('p', { className: 'psi-date', textContent: longDate(date) }), grid]));
    }

    const foot = el('div', { className: 'psi-foot' });
    if (writable) {
      const save = el('button', { type: 'button', className: 'primary-button', textContent: saving ? 'Đang lưu…' : sheets[today] ? 'Lưu thay đổi' : 'Lưu tờ hôm nay', disabled: saving });
      save.addEventListener('click', () => submit(status));
      foot.append(save);
      const last = list.filter(key => key < today && sheets[key]).at(-1);
      if (last && !sheets[today] && FIELDS.every(({ key }) => !draft[key].trim())) {
        foot.append(el('button', { type: 'button', className: 'secondary-button', textContent: `Chép từ tờ ${last.split('-').reverse().slice(0, 2).join('/')}`, onclick: () => {
          draft = { ...blank(), ...sheets[last] };
          render({ focus: 'text', message: 'Đã chép tờ trước. Sửa chỗ nào thấy khác rồi lưu.' });
        } }));
      }
    }
    foot.append(status);
    children.push(foot);
    if (writable && window.Capacitor?.isNativePlatform?.()) children.push(el('p', { className: 'psi-hint', textContent: 'Điện thoại này nhắc lúc 21:00 mỗi tối nếu tờ hôm nay chưa điền.' }));
    root.replaceChildren(...children);
    if (focus === 'day') root.querySelector('#psi-day').focus();
    if (focus === 'text') { const text = root.querySelector('textarea'); text?.scrollIntoView({ block: 'center' }); text?.focus(); }
    if (focus === 'save') root.querySelector('.primary-button')?.focus();
  }

  async function submit(status) {
    if (saving || !alive()) return;
    if (FIELDS.every(({ key }) => !draft[key].trim())) { status.textContent = 'Viết ít nhất một ô rồi lưu nhé.'; return; }
    saving = true;
    const button = root.querySelector('.primary-button');
    button.disabled = true; button.textContent = 'Đang lưu…'; status.textContent = '';
    try {
      const result = await apiRequest('/api/psi/today', { method: 'PUT', body: draft, signal: controller.signal });
      if (!alive()) return;
      saving = false;
      // Past midnight the server saved under its new date; follow it.
      today = result.date; date = today; sheets[today] = result.sheet; draft = null;
      render({ focus: 'save' });
      refreshPsiReminder({ today, filled: true });
    } catch (error) {
      if (!alive()) return;
      saving = false;
      button.disabled = false; button.textContent = sheets[today] ? 'Lưu thay đổi' : 'Lưu tờ hôm nay';
      status.textContent = error.status === 401 ? 'Phiên đã hết hạn. Đăng nhập lại rồi lưu nhé; chữ vẫn còn đây.'
        : error.status === 400 ? 'Mỗi ô tối đa 4000 ký tự.'
          : 'Chưa lưu được. Chữ bạn viết vẫn còn đây, bấm lưu lại nhé.';
    }
  }

  async function load() {
    root.replaceChildren(el('p', { className: 'psi-status', attrs: { role: 'status' }, textContent: 'Đang mở tờ PSI…' }));
    try {
      const result = await apiRequest('/api/psi', { signal: controller.signal });
      if (!alive()) return;
      ({ today, sheets } = result);
      date = today;
      let focus = null;
      try { if (sessionStorage.getItem('homie-psi:focus')) { sessionStorage.removeItem('homie-psi:focus'); focus = 'text'; } } catch {}
      render({ focus });
    } catch (error) {
      if (!alive() || error.name === 'AbortError') return;
      const retry = el('button', { type: 'button', className: 'secondary-button', textContent: 'Thử lại', onclick: load });
      root.replaceChildren(el('p', { className: 'psi-status', attrs: { role: 'status' }, textContent: 'Chưa mở được tờ PSI. ' }, [retry]));
    }
  }

  load();
  function cleanup() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    signal?.removeEventListener('abort', cleanup);
    root.remove();
  }
  signal?.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}
