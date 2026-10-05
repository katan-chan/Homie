// Native <dialog> sheets: idea form, Xong rồi, Mình thích mức…, archive confirm. A failed save keeps the dialog and the draft.
import { ACTIVITY_CATEGORIES, NAME, SEMINAR_CATEGORY, button, el, problem, today } from './ui.js';

let sheetCount = 0;
function openSheet(host, { title, signal }) {
  const dialog = el('dialog', 'roulette-sheet'), heading = el('h2', '', title);
  heading.id = `roulette-sheet-${++sheetCount}`;
  dialog.setAttribute('aria-labelledby', heading.id);
  const close = button('×', 'roulette-icon');
  close.setAttribute('aria-label', 'Đóng');
  close.addEventListener('click', () => dialog.close());
  const head = el('div', 'roulette-sheet-head'), body = el('div', 'roulette-sheet-body'), error = el('p', 'roulette-error');
  error.setAttribute('role', 'alert');
  head.append(heading, close);
  dialog.append(head, body, error);
  host.append(dialog);
  const shut = () => { if (dialog.open) dialog.close(); };
  dialog.addEventListener('close', () => { dialog.remove(); signal.removeEventListener('abort', shut); }, { once: true });
  signal.addEventListener('abort', shut, { once: true });
  return { dialog, body, error, close: shut, show: () => dialog.showModal() };
}

function field(label, control, extra) {
  const wrap = el('label', 'roulette-field');
  wrap.append(el('span', '', label), control);
  if (extra) wrap.append(extra);
  return wrap;
}
function input(name, value, attributes = {}) {
  const node = el('input');
  node.name = name;
  Object.assign(node, attributes);
  node.value = value ?? '';
  return node;
}
function textarea(name, max, value = '') {
  const node = el('textarea'), count = el('span', 'roulette-count');
  Object.assign(node, { name, maxLength: max, rows: 4, value });
  const update = () => { count.textContent = `${[...node.value].length}/${max}`; };
  node.addEventListener('input', update);
  update();
  return [node, count];
}
function select(name, values, current) {
  const node = el('select');
  node.name = name;
  for (const [value, label] of values) node.append(Object.assign(el('option', '', label), { value }));
  node.value = current;
  return node;
}
function formActions(form, close, label = 'Lưu') {
  const row = el('div', 'roulette-actions'), cancel = button('Thôi'), submit = button(label, 'roulette-btn primary');
  submit.type = 'submit';
  cancel.addEventListener('click', close);
  row.append(cancel, submit);
  form.append(row);
  return submit;
}
// Submits once at a time; a thrown error is shown and the form stays filled.
function onSubmit(form, sheet, submit, save) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    sheet.error.textContent = '';
    try { await save(); }
    catch (error) { sheet.error.textContent = error.shown ?? problem(error) ?? ''; }
    finally { submit.disabled = false; }
  });
}

/**
 * New or edited idea. save(values, version) resolves when stored; latest() resolves to the stored idea (or null)
 * for the "edited elsewhere" box.
 */
export function openIdeaSheet(host, { kind, idea, category, signal, save, latest }) {
  const sheet = openSheet(host, { title: idea ? 'Sửa' : kind === 'seminar' ? 'Chủ đề seminar mới' : 'Ý tưởng hoạt động mới', signal });
  const form = el('form', 'roulette-form');
  const title = input('title', idea?.title, { required: true, maxLength: 120 });
  const [desc, count] = textarea('desc', 2000, idea?.desc ?? '');
  const categories = kind === 'seminar' ? [SEMINAR_CATEGORY] : ACTIVITY_CATEGORIES;
  const cat = select('category', categories.map(c => [c, c]), idea?.category ?? (category || categories[0]));
  const minutes = input('minutes', idea?.minutes ?? '', { type: 'number', min: 1, max: 1440, step: 1, inputMode: 'numeric' });
  const row = el('div', 'roulette-row');
  row.append(field('Loại', cat), field('Khoảng bao nhiêu phút (không bắt buộc)', minutes));
  form.append(field(kind === 'seminar' ? 'Chủ đề' : 'Ý tưởng', title), field('Mô tả (không bắt buộc)', desc, count), row);
  let version = idea?.version;

  const conflict = el('div', 'roulette-conflict');
  conflict.setAttribute('role', 'alert');
  conflict.hidden = true;
  const reload = button('Tải lại bản mới', 'roulette-btn small'), keep = button('Giữ bản của mình để sửa tiếp', 'roulette-btn small');
  const conflictActions = el('div', 'roulette-actions');
  conflictActions.append(reload, keep);
  conflict.append(el('b', '', 'Nội dung đã được thay đổi ở nơi khác.'), el('span', '', 'Bản bạn đang viết vẫn còn nguyên bên dưới.'), conflictActions);
  const resolve = async useLatest => {
    const fresh = await latest().catch(() => null);
    if (!fresh) { sheet.error.textContent = 'Mục này không còn nữa.'; return; }
    version = fresh.version;
    if (useLatest) {
      title.value = fresh.title; desc.value = fresh.desc; cat.value = fresh.category; minutes.value = fresh.minutes ?? '';
      desc.dispatchEvent(new Event('input'));
    }
    conflict.hidden = true;
    title.focus();
  };
  reload.addEventListener('click', () => resolve(true));
  keep.addEventListener('click', () => resolve(false));
  form.prepend(conflict);

  const submit = formActions(form, sheet.close);
  // One requestId per sheet: a retry after a lost response cannot create the idea twice.
  const requestId = crypto.randomUUID();
  onSubmit(form, sheet, submit, async () => {
    const values = { title: title.value, desc: desc.value, category: cat.value, minutes: minutes.value === '' ? null : Number(minutes.value) };
    try { await save(values, { version, requestId }); }
    catch (error) {
      if (error.status === 409 && idea) { conflict.hidden = false; reload.focus(); error.shown = ''; }
      throw error;
    }
    sheet.close();
  });
  sheet.body.append(form);
  sheet.show();
  title.focus();
}

/** Xong rồi: date, a short note and the person's own rating. */
export function openDoneSheet(host, { idea, me, signal, save }) {
  const sheet = openSheet(host, { title: 'Xong rồi!', signal });
  const form = el('form', 'roulette-form');
  const date = input('date', today(), { type: 'date', required: true, max: today() });
  const [text, count] = textarea('text', 1000);
  const rating = select('rating', [['', 'Chưa chấm'], ...[1, 2, 3, 4, 5].map(n => [String(n), String(n)])], '');
  form.append(el('h3', 'roulette-sheet-title', idea?.title ?? ''), field('Ngày', date), field('Ghi lại một chút (không bắt buộc)', text, count),
    field(`${NAME[me]} thích mức (không bắt buộc)`, rating));
  const submit = formActions(form, sheet.close);
  const requestId = crypto.randomUUID();
  onSubmit(form, sheet, submit, async () => {
    await save({ date: date.value, text: text.value, rating: rating.value ? Number(rating.value) : null, requestId }, sheet.close);
    sheet.close();
  });
  sheet.body.append(form);
  sheet.show();
  date.focus();
}

/** Mình thích mức…: the person rates only their own enjoyment. */
export function openRateSheet(host, { session, me, signal, save }) {
  const sheet = openSheet(host, { title: 'Mình thích mức…', signal });
  const stars = el('div', 'roulette-stars');
  stars.setAttribute('role', 'group');
  stars.setAttribute('aria-label', 'Mức bạn thích, từ 1 đến 5');
  for (let n = 1; n <= 5; n++) {
    const choice = button(String(n), 'roulette-star');
    choice.setAttribute('aria-pressed', String(session.ratings[me] === n));
    choice.addEventListener('click', async () => {
      if (stars.dataset.busy) return;
      stars.dataset.busy = '1';
      sheet.error.textContent = '';
      try { await save(n); sheet.close(); }
      catch (error) { sheet.error.textContent = problem(error) ?? ''; }
      finally { delete stars.dataset.busy; }
    });
    stars.append(choice);
  }
  sheet.body.append(el('p', 'roulette-note', 'Chấm cho niềm vui của bạn với lần này. Không chấm người kia, không ai so với ai.'), stars);
  sheet.show();
  (stars.querySelector('[aria-pressed="true"]') ?? stars.firstChild).focus();
}

export function confirmArchive(host, { signal, save }) {
  const sheet = openSheet(host, { title: 'Lưu trữ', signal });
  const form = el('form', 'roulette-form');
  form.append(el('p', '', 'Mục này sẽ không còn được bốc. Lịch sử các lần đã làm vẫn giữ.'));
  const submit = formActions(form, sheet.close, 'Lưu trữ');
  submit.classList.add('danger');
  onSubmit(form, sheet, submit, async () => { await save(); sheet.close(); });
  sheet.body.append(form);
  sheet.show();
  submit.focus();
}
