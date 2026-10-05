// The garden tab owns lettering and the memory flowers; the shell owns the landscape.
import { apiRequest, authEvents, getUser } from '../auth.js';

const FOCUS_KEY = 'homie-notes:focus';
const NAME = { minhle: 'Minh', haiyen: 'Yến' };
const FLOWER = new URL('../../assets/flowers/memory-cosmos.webp', import.meta.url).href;
// Stem-base spots inside the meadow band, as % of the viewport: clear of the lettering and both Loopy.
const WIDE = [[30, 71], [41, 70], [51, 71], [61, 70], [71, 71], [81, 69], [35, 83], [46, 84], [56, 83], [66, 84],
  [27, 95], [38, 96], [49, 95], [59, 96], [69, 95]];
const PHONE = [[44, 70], [62, 70], [80, 70], [18, 80], [36, 80], [54, 80], [72, 80], [12, 90], [30, 90], [48, 90],
  [22, 100], [40, 100], [58, 100], [78, 100]];
// Short landscape screens: the lettering fills the middle, so flowers grow on both sides of it.
const SHORT = [[5, 70], [27, 76], [12, 86], [25, 97], [5, 99], [74, 70], [95, 76], [73, 98], [95, 99]];

function hash(text) {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.codePointAt(0), 16777619);
  return h >>> 0;
}

/** Same id, same spot: each memory takes its hashed slot, or the next free one; past the last slot they share. */
function place(items) {
  const taken = { wide: new Set(), phone: new Set(), short: new Set() };
  const pick = (slots, used, h) => {
    let i = h % slots.length;
    for (let n = 0; n < slots.length && used.has(i); n++) i = (i + 1) % slots.length;
    used.add(i);
    return slots[i];
  };
  return [...items].sort((a, b) => hash(a.noteId) - hash(b.noteId) || a.noteId.localeCompare(b.noteId))
    .map(item => { const h = hash(item.noteId); return { item, h, wide: pick(WIDE, taken.wide, h), phone: pick(PHONE, taken.phone, h >>> 7), short: pick(SHORT, taken.short, h >>> 13) }; });
}

const vnDate = date => { const [y, m, d] = date.split('-'); return `${+d}/${+m}/${y}`; };

export function render(container, { signal } = {}) {
  if (signal?.aborted) return () => {};
  const section = document.createElement('section');
  section.className = 'garden-content';
  section.innerHTML = `<h1 class="garden-title"><span class="title-fallback">Vườn của chúng mình.</span><img class="title-lettering" alt="" aria-hidden="true" width="1536" height="1024" hidden></h1><div class="garden-status title-status" role="status" hidden><span>Chưa tải được chữ trang trí.</span><button type="button">Thử tải lại chữ</button></div><div class="memory-flowers" role="group" aria-label="Hoa kỷ niệm"></div>`;
  container.replaceChildren(section);
  const image = section.querySelector('img');
  const text = section.querySelector('h1 span');
  const status = section.querySelector('.title-status');
  const retry = status.querySelector('button');
  const bed = section.querySelector('.memory-flowers');
  let disposed = false;
  let viewerId = getUser()?.id ?? null;
  let loader = null;
  let sheet = null;
  function load() {
    status.hidden = true;
    image.src = new URL('../../assets/typography/center-title.webp', import.meta.url).href;
  }
  image.onload = async () => {
    try {
      await image.decode();
      if (disposed || signal?.aborted) return;
      image.hidden = false;
      text.className = 'sr-only';
      if (document.activeElement === retry) container.focus();
      status.hidden = true;
    } catch {
      if (!disposed && !signal?.aborted) status.hidden = false;
    }
  };
  image.onerror = () => {
    if (!disposed && !signal?.aborted) status.hidden = false;
  };
  retry.addEventListener('click', load, { signal });

  function openMemory(memory, opener) {
    sheet?.remove();
    const dialog = sheet = document.createElement('dialog');
    dialog.className = 'memory-sheet';
    dialog.setAttribute('aria-labelledby', 'memory-sheet-title');
    dialog.innerHTML = `<div class="memory-sheet-head"><h2 id="memory-sheet-title"></h2><button type="button" class="memory-close" aria-label="Đóng">×</button></div><p class="memory-meta"></p><p class="memory-body"></p><div class="memory-actions"><button type="button" class="memory-open">Mở trong Góc ghi chép</button></div>`;
    dialog.querySelector('h2').textContent = memory.title || 'Kỷ niệm';
    dialog.querySelector('.memory-meta').textContent = [memory.memoryDate && vnDate(memory.memoryDate),
      NAME[memory.authorId] && `${NAME[memory.authorId]} viết`, memory.boardName && `bảng ${memory.boardName}`].filter(Boolean).join(' · ');
    const body = dialog.querySelector('.memory-body');
    body.textContent = memory.body ?? '';
    body.hidden = !memory.body;
    dialog.querySelector('.memory-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { // the backdrop, not the sheet's own padding
      const box = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
    });
    // Safari does not focus a tapped button, so return focus to the flower explicitly.
    dialog.addEventListener('close', () => { if (opener.isConnected) opener.focus(); });
    dialog.querySelector('.memory-open').addEventListener('click', () => {
      try { sessionStorage.setItem(FOCUS_KEY, JSON.stringify({ boardId: memory.boardId, noteId: memory.noteId })); } catch {}
      dialog.close();
      location.hash = 'dashboard';
    });
    section.append(dialog);
    dialog.showModal();
  }

  function plant(items) {
    bed.replaceChildren(...place(items).map(({ item, h, wide, phone, short }) => {
      const flower = document.createElement('button');
      flower.type = 'button';
      flower.className = 'memory-flower';
      flower.setAttribute('aria-label', `Hoa kỷ niệm: ${item.title || 'Kỷ niệm'}`);
      flower.style.cssText = `--x:${wide[0]};--y:${wide[1]};--px:${phone[0]};--py:${phone[1]};--sx:${short[0]};--sy:${short[1]};--size:${0.92 + (h % 5) * 0.04};--delay:${-(h % 7)}s`;
      if (h & 1) flower.classList.add('is-mirrored');
      const picture = document.createElement('img');
      picture.src = FLOWER;
      picture.alt = '';
      picture.draggable = false;
      flower.append(picture);
      flower.addEventListener('click', () => openMemory(item, flower));
      return flower;
    }));
  }

  async function loadFlowers() {
    loader?.abort();
    loader = null;
    sheet?.close();
    bed.replaceChildren();
    if (!viewerId) return; // Guests see the original garden.
    const current = loader = new AbortController();
    try {
      const { items } = await apiRequest('/api/garden', { signal: current.signal });
      if (!disposed && loader === current) plant(Array.isArray(items) ? items : []);
    } catch {
      // A failed fetch leaves the plain garden; flowers come back on the next visit or sign-in.
    }
  }

  function authChanged() {
    const next = getUser()?.id ?? null;
    if (next === viewerId) return;
    viewerId = next;
    loadFlowers();
  }
  authEvents.addEventListener('change', authChanged);

  function cleanup() {
    if (disposed) return;
    disposed = true;
    loader?.abort();
    sheet?.close();
    authEvents.removeEventListener('change', authChanged);
    image.onload = image.onerror = null;
    signal?.removeEventListener('abort', cleanup);
    section.remove();
  }
  signal?.addEventListener('abort', cleanup, { once: true });
  load();
  loadFlowers();
  return cleanup;
}
