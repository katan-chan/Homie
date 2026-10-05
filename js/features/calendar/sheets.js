// Sheets (native modal <dialog>) for occasions and cycles. A failed save keeps the draft in the open form.
import { el, button } from './view.js';
import { vnDate, SHORT_NAME } from './model.js';

const KIND_LABEL = { occasion: 'Dịp đặc biệt', anniversary: 'Kỷ niệm ngày', milestone: 'Cột mốc' };

/** Opens a modal sheet appended to host; closes on abort. Returns { dialog, close }. */
export function openSheet(host, title, { signal, form = false } = {}) {
  const dialog = el('dialog', 'cal-sheet');
  dialog.setAttribute('aria-label', title);
  const body = el(form ? 'form' : 'div', 'cal-sheet-body');
  const head = el('div', 'cal-sheet-head');
  const close = button('×', 'cal-icon-btn', () => dialog.close());
  close.setAttribute('aria-label', 'Đóng');
  head.append(el('h2', '', title), close);
  body.append(head);
  dialog.append(body);
  const stop = () => dialog.close();
  dialog.addEventListener('close', () => { signal?.removeEventListener('abort', stop); dialog.remove(); });
  signal?.addEventListener('abort', stop, { once: true });
  host.append(dialog);
  dialog.showModal();
  return { dialog, body, close: () => dialog.close() };
}

function field(label, control) {
  const wrap = el('label', 'cal-field');
  wrap.append(el('span', '', label), control);
  return wrap;
}

function input(name, value, attrs = {}) {
  const node = el('input');
  Object.assign(node, { name, value: value ?? '' }, attrs);
  return node;
}

/**
 * Shared form flow: save(values, version) resolves on success; a 409 shows the conflict box, whose
 * buttons call reload() for the newest record and either refill the form or only take its version.
 */
function formFlow({ sheet, read, fill, version, save, reload, validate = () => '' }) {
  const alert = el('div', 'cal-alert');
  alert.setAttribute('role', 'alert');
  alert.hidden = true;
  sheet.body.children[0].after(alert);
  const actions = el('div', 'cal-actions');
  const submit = el('button', 'cal-btn primary', 'Lưu');
  submit.type = 'submit';
  actions.append(button('Hủy', 'cal-btn', sheet.close), submit);
  sheet.body.append(actions);
  const show = (message, buttons = []) => { alert.replaceChildren(el('b', '', message), ...buttons); alert.hidden = false; };

  async function fresh(keepDraft) {
    try {
      const record = await reload();
      version = record.version;
      if (!keepDraft) fill(record);
      alert.hidden = true;
    } catch { show('Chưa tải được bản mới. Thử lại sau nhé.'); }
  }
  sheet.body.addEventListener('submit', async event => {
    event.preventDefault();
    const values = read();
    const problem = validate(values);
    if (problem) return show(problem);
    submit.disabled = true;
    try {
      await save(values, version);
      sheet.close();
    } catch (error) {
      if (!sheet.dialog.isConnected) return;
      if (error.status === 409) {
        const actions = el('div', 'cal-actions');
        actions.append(button('Tải lại bản mới', 'cal-btn small', () => fresh(false)),
          button('Giữ bản của mình để sửa tiếp', 'cal-btn small', () => fresh(true)));
        const note = el('span', '', 'Bản bạn đang viết vẫn còn nguyên bên dưới.');
        show('Nội dung đã được thay đổi ở nơi khác.', [note, actions]);
      } else {
        show(error.status === 400 ? 'Thông tin chưa hợp lệ. Kiểm tra lại nhé.' : 'Chưa lưu được. Bản nháp vẫn còn, thử lại nhé.');
      }
    } finally {
      submit.disabled = false;
    }
  });
}

export function eventForm(host, { event, date, signal, save, reload }) {
  const sheet = openSheet(host, event ? 'Sửa dịp' : 'Thêm dịp', { signal, form: true });
  const title = input('title', event?.title, { required: true, maxLength: 120, autocomplete: 'off' });
  const day = input('date', event?.date ?? date, { type: 'date', required: true });
  const kind = el('select');
  kind.name = 'kind';
  for (const [value, label] of Object.entries(KIND_LABEL)) kind.append(new Option(label, value, false, value === (event?.kind ?? 'occasion')));
  const row = el('div', 'cal-row2');
  row.append(field('Ngày', day), field('Loại', kind));
  sheet.body.append(field('Tên dịp', title), row);
  formFlow({ sheet, version: event?.version, save, reload,
    read: () => ({ title: title.value.trim(), date: day.value, kind: kind.value }),
    fill: record => { title.value = record.title; day.value = record.date; kind.value = record.kind; } });
  title.focus();
  return sheet;
}

export function eventView(host, { event, viewerId, signal, onEdit, onArchive }) {
  const sheet = openSheet(host, event.title, { signal });
  sheet.body.append(el('p', 'cal-meta', `${vnDate(event.date)} · ${KIND_LABEL[event.kind] ?? 'Dịp'} · ${SHORT_NAME[event.authorId] ?? ''} thêm`));
  if (event.authorId === viewerId) {
    const actions = el('div', 'cal-actions');
    actions.append(button('Sửa', 'cal-btn small', () => { sheet.close(); onEdit(event); }),
      button('Lưu trữ', 'cal-btn small danger', () => { sheet.close(); onArchive(event); }));
    sheet.body.append(actions);
  } else {
    sheet.body.append(el('p', 'cal-note', `Chỉ ${SHORT_NAME[event.authorId] ?? 'người tạo'} sửa được dịp này.`));
  }
  return sheet;
}

export function cycleForm(host, { cycle, today, signal, save, reload }) {
  const sheet = openSheet(host, cycle ? 'Sửa kỳ' : 'Ghi kỳ mới', { signal, form: true });
  const start = input('start', cycle?.start ?? today, { type: 'date', required: true });
  const end = input('end', cycle?.end, { type: 'date' });
  const note = el('textarea');
  Object.assign(note, { name: 'note', maxLength: 1000, value: cycle?.note ?? '' });
  const row = el('div', 'cal-row2');
  row.append(field('Ngày bắt đầu', start), field('Ngày kết thúc (để trống nếu đang diễn ra)', end));
  sheet.body.append(el('div', 'cal-audience', 'Chỉ Yến xem. Minh không thấy gì trong lịch.'), row, field('Ghi chú', note));
  formFlow({ sheet, version: cycle?.version, save, reload,
    read: () => ({ start: start.value, end: end.value || null, note: note.value }),
    fill: record => { start.value = record.start; end.value = record.end ?? ''; note.value = record.note; },
    validate: values => values.end && values.end < values.start ? 'Ngày kết thúc phải sau ngày bắt đầu.' : '' });
  start.focus();
  return sheet;
}

export function cycleList(host, { cycles, signal, onEnd, onEdit, onArchive }) {
  const sheet = openSheet(host, 'Các kỳ đã ghi', { signal });
  const list = el('div', 'cal-list');
  for (const cycle of cycles) {
    const row = el('div', 'cal-item');
    row.append(el('span', 'cal-t', cycle.end ? `${vnDate(cycle.start)} – ${vnDate(cycle.end)}` : `${vnDate(cycle.start)} · đang diễn ra`));
    if (!cycle.end) row.append(button('Kết thúc hôm nay', 'cal-btn small', () => { sheet.close(); onEnd(cycle); }));
    row.append(button('Sửa', 'cal-btn small', () => { sheet.close(); onEdit(cycle); }),
      button('Lưu trữ', 'cal-btn small danger', () => { sheet.close(); onArchive(cycle); }));
    list.append(row);
  }
  if (!cycles.length) list.append(el('p', 'cal-note', 'Chưa có kỳ nào trong khoảng này.'));
  sheet.body.append(list, el('p', 'cal-note', 'Không dự đoán, không lời khuyên y tế, không thông báo.'));
  return sheet;
}
