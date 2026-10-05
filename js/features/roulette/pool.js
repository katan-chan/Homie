// The idea pool as a board (papers dragged by their head, x/y saved) or as a list.
import { NAME, button, el } from './ui.js';

const WORLD = { width: 1180, height: 900, paper: 270 };

/** Renders the papers. The board grows to fit the furthest paper. */
export function renderPool(host, { ideas, mode, pickedId, me, onEdit, onArchive }) {
  const papers = ideas.map(idea => {
    const paper = el('article', `roulette-paper${idea.id === pickedId ? ' is-picked' : ''}`);
    paper.dataset.id = idea.id;
    paper.style.background = idea.color;
    if (mode === 'board') Object.assign(paper.style, { left: `${idea.x}px`, top: `${idea.y}px` });
    const head = el('div', 'roulette-paper-head');
    if (mode === 'board') head.dataset.drag = '';
    head.append(el('b', '', NAME[idea.authorId] ?? ''), el('span', 'roulette-badge', idea.category));
    if (idea.minutes) head.append(el('span', '', `${idea.minutes} phút`));
    if (idea.recent) head.append(el('span', 'roulette-badge recent', 'Vừa làm'));
    paper.append(head, el('h3', '', idea.title));
    if (idea.desc) paper.append(el('p', 'roulette-hand', idea.desc));
    if (idea.authorId === me) {
      const actions = el('div', 'roulette-actions'), edit = button('Sửa', 'roulette-btn small'), archive = button('Lưu trữ', 'roulette-btn small danger');
      edit.setAttribute('aria-label', `Sửa: ${idea.title}`);
      archive.setAttribute('aria-label', `Lưu trữ: ${idea.title}`);
      edit.addEventListener('click', () => onEdit(idea));
      archive.addEventListener('click', () => onArchive(idea));
      actions.append(edit, archive);
      paper.append(actions);
    }
    return paper;
  });
  if (mode === 'list') {
    const list = el('div', 'roulette-list');
    list.append(...papers);
    return host.replaceChildren(list);
  }
  const surface = el('div', 'roulette-surface'), world = el('div', 'roulette-world');
  surface.setAttribute('aria-label', 'Mặt bảng ý tưởng. Kéo phần đầu tờ giấy để đổi chỗ.');
  surface.setAttribute('role', 'region');
  world.style.width = `${Math.max(WORLD.width, ...ideas.map(i => i.x + WORLD.paper + 40))}px`;
  world.style.height = `${Math.max(WORLD.height, ...ideas.map(i => i.y + 360))}px`;
  world.append(...papers);
  surface.append(world);
  host.replaceChildren(surface);
}

/** Pointer drag on paper heads inside host; onMove(id, x, y) runs once per drop that actually moved. */
export function enableDrag(host, { signal, onMove }) {
  let drag = null;
  const end = (event, cancelled) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const { paper, moved, left, top, nx, ny } = drag;
    drag = null;
    paper.classList.remove('is-dragging');
    if (cancelled) Object.assign(paper.style, { left: `${left}px`, top: `${top}px` });
    // Coordinates come from the drag itself: the paper may have been re-rendered (detached) meanwhile.
    else if (moved) onMove(paper.dataset.id, nx, ny);
  };
  host.addEventListener('pointerdown', event => {
    const head = event.target.closest('[data-drag]'), paper = head?.closest('.roulette-paper');
    if (!paper || drag || event.button !== 0) return;
    drag = { paper, pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: paper.offsetLeft, top: paper.offsetTop, moved: false };
    head.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, { signal });
  host.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    drag.nx = Math.max(0, drag.left + dx);
    drag.ny = Math.max(0, drag.top + dy);
    drag.paper.classList.add('is-dragging');
    Object.assign(drag.paper.style, { left: `${drag.nx}px`, top: `${drag.ny}px` });
  }, { signal });
  host.addEventListener('pointerup', event => end(event, false), { signal });
  host.addEventListener('pointercancel', event => end(event, true), { signal });
  host.addEventListener('lostpointercapture', event => end(event, false), { signal });
}
