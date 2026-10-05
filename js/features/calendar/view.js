// DOM for the calendar month grid, the selected-day panel and the legend. Data always goes in via textContent.
import { monthGrid, monthTitle, vnDate, dayLabel, addDays, MEMBERS, SHORT_NAME } from './model.js';
import { moodColor, SAMPLE, mini } from './colors.js';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label, className, onClick) {
  const node = el('button', className, label);
  node.type = 'button';
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export function renderHead({ month, viewerId, on }) {
  const head = el('div', 'cal-head');
  const prev = button('‹', 'cal-btn', () => on.month(-1));
  prev.setAttribute('aria-label', 'Tháng trước');
  const next = button('›', 'cal-btn', () => on.month(1));
  next.setAttribute('aria-label', 'Tháng sau');
  const title = el('h2', 'cal-month', monthTitle(month));
  title.setAttribute('aria-live', 'polite');
  head.append(prev, title, next, button('Hôm nay', 'cal-btn', on.today), el('span', 'cal-spacer'),
    button('Thêm dịp', 'cal-btn', on.addEvent));
  if (viewerId === 'haiyen') head.append(button('Ghi kỳ mới', 'cal-btn', on.addCycle));
  return head;
}

const dot = value => {
  const node = el('i');
  node.style.background = moodColor(value);
  node.setAttribute('aria-hidden', 'true');
  return node;
};

function counts(day) {
  const marks = el('span', 'cal-marks');
  if (day.kiss) marks.append(mini('kiss', SAMPLE.kiss), `${day.kiss} `);
  if (day.sorry) marks.append(mini('sorry', SAMPLE.sorry), String(day.sorry));
  return marks;
}

/** Month grid; one tab stop (the selected day), arrows move by day and week. */
export function renderGrid({ month, selected, today, day, on }) {
  const grid = el('div', 'cal-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', monthTitle(month));
  for (const name of ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']) {
    const head = el('div', 'cal-dow', name);
    head.setAttribute('aria-hidden', 'true');
    grid.append(head);
  }
  for (const date of monthGrid(month)) {
    const info = day(date);
    const cell = button('', 'cal-day', () => on.select(date));
    cell.dataset.date = date;
    cell.classList.toggle('other', date.slice(0, 7) !== month);
    cell.classList.toggle('today', date === today);
    cell.classList.toggle('cycle', info.cycle);
    cell.setAttribute('aria-pressed', String(date === selected));
    cell.setAttribute('aria-label', dayLabel(date, info));
    cell.tabIndex = date === selected ? 0 : -1;
    if (date === today) cell.setAttribute('aria-current', 'date');
    const dots = el('span', 'cal-dots');
    for (const member of MEMBERS) if (info.mood[member] !== null) dots.append(dot(info.mood[member]));
    const signs = [info.events.length && '📌', info.memories.length && '🌸',
      info.activities.some(a => a.kind === 'seminar') && '📚', info.activities.some(a => a.kind === 'activity') && '🎲'].filter(Boolean).join('');
    cell.append(el('span', 'cal-n', String(+date.slice(8))), dots);
    if (info.kiss || info.sorry) cell.append(counts(info));
    if (signs) cell.append(el('span', 'cal-marks', signs));
    for (const child of cell.children) child.setAttribute('aria-hidden', 'true');
    grid.append(cell);
  }
  const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  grid.addEventListener('keydown', event => {
    const date = event.target.closest?.('.cal-day')?.dataset.date;
    if (!date || !(event.key in steps)) return;
    event.preventDefault();
    on.select(addDays(date, steps[event.key]), { focus: true });
  });
  return grid;
}

/** Selected-day panel. Partner moods arrive pre-filtered: only shared ones are in day.moods. */
export function renderPanel({ date, day, viewerId, on }) {
  const panel = el('section', 'cal-panel');
  panel.setAttribute('aria-label', `Ngày ${vnDate(date)}`);
  panel.append(el('h2', '', vnDate(date)));
  for (const member of MEMBERS) {
    const row = el('div', 'cal-who');
    if (day.mood[member] === null) {
      row.append(el('span', 'cal-note', `${SHORT_NAME[member]}: chưa có cảm xúc${member !== viewerId ? ' được chia sẻ' : ''}`));
    } else {
      row.append(dot(day.mood[member]), el('span', '', `${SHORT_NAME[member]}: ${day.moods[member].join(', ')}`));
    }
    panel.append(row);
  }
  const totals = el('p', 'cal-totals');
  totals.append(mini('kiss', SAMPLE.kiss), ` ${day.kiss} nụ hôn · `, mini('sorry', SAMPLE.sorry), ` ${day.sorry} lời xin lỗi`);
  panel.append(totals);

  const list = el('div', 'cal-list');
  const item = (type, typeClass, title, onClick) => {
    const row = onClick ? button('', 'cal-item', onClick) : el('div', 'cal-item');
    row.append(el('span', `cal-type ${typeClass}`, type), el('span', 'cal-t', title));
    return row;
  };
  for (const event of day.events) list.append(item('Dịp', 'occasion', event.title, () => on.openEvent(event)));
  for (const memory of day.memories) list.append(item('Kỷ niệm', '', memory.title || 'Kỷ niệm', () => on.openMemory(memory)));
  for (const activity of day.activities) {
    list.append(item(activity.kind === 'seminar' ? 'Seminar' : 'Hoạt động', 'activity', activity.title, () => on.openActivity(activity)));
  }
  if (day.cycle) {
    const row = item('Chu kỳ', 'cycle', 'Trong kỳ (chỉ Yến thấy)');
    row.append(button('Xem các kỳ', 'cal-btn small', on.openCycles));
    list.append(row);
  }
  if (!list.children.length) list.append(el('p', 'cal-note', 'Ngày này chưa có dịp, kỷ niệm hay hoạt động.'));
  panel.append(list);
  return panel;
}

export function renderLegend(viewerId) {
  return el('p', 'cal-note cal-legend', 'Viên hồng: nụ hôn · viên bạc hà: lời xin lỗi · 📌 dịp · 🌸 kỷ niệm · 📚 seminar · 🎲 hoạt động. '
    + 'Chấm màu: cảm xúc trung bình trong ngày, Minh trước, Yến sau. Cảm xúc riêng tư của người kia không hiện.'
    + (viewerId === 'haiyen' ? ' Nền tím nhạt: ngày trong kỳ, chỉ Yến thấy.' : ''));
}
