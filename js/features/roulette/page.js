// One page builder for "Gợi ý chủ đề seminar" and "Hoạt động chung": shared current pick, skip/done,
// history with ratings, and the idea pool. The server owns picking; this page only shows its answer.
import { apiRequest, authEvents, getUser } from '../../auth.js';
import { ACTIVITY_CATEGORIES, NAME, button, el, problem, vnDate } from './ui.js';
import { enableDrag, renderPool } from './pool.js';
import { confirmArchive, openDoneSheet, openIdeaSheet, openRateSheet } from './sheets.js';

const KIND = {
  seminar: {
    title: 'Gợi ý chủ đề seminar', sub: 'Chủ đề để hai đứa tìm hiểu rồi kể cho nhau nghe. Seminar là một loại hoạt động, không phải lịch họp.',
    pick: '🌱 Gieo một hạt', add: '+ Chủ đề', pool: 'Kho chủ đề', empty: 'Chưa có chủ đề nào. Thêm một chủ đề nhé.',
  },
  activity: {
    title: 'Hoạt động chung', sub: 'Những điều để cùng làm: trò chuyện, sáng tạo, khám phá, chơi, tự làm.',
    pick: '🎲 Chọn gì đó cho tụi mình', add: '+ Ý tưởng', pool: 'Kho ý tưởng', empty: 'Chưa có ý tưởng nào. Thêm một ý tưởng nhé.',
  },
};
const FIRST_PAGE = 2, MORE = 5;
const PICK_CHANGED = 'Lượt bốc vừa được đổi ở máy kia. Đã tải lại.';

export function mountRoulette(container, { kind, signal }) {
  if (signal.aborted) return () => {};
  const K = KIND[kind], me = getUser()?.id, controller = new AbortController(), own = { signal: controller.signal };
  const state = {
    view: null, loadError: '', history: [], cursor: null, historyError: '', category: '', busy: false, revealed: null,
    mode: matchMedia('(max-width: 640px)').matches ? 'list' : 'board',
  };
  const call = (path, method = 'GET', body) => apiRequest(path, { method, body, signal: controller.signal });
  const alive = () => !controller.signal.aborted;

  const root = el('section', `roulette roulette--${kind}`);
  const pickPanel = el('section', 'roulette-panel roulette-pick');
  pickPanel.setAttribute('aria-label', 'Lượt bốc hiện tại');
  pickPanel.tabIndex = -1;
  const historyPanel = el('section', 'roulette-panel roulette-history'), historyTitle = el('h2', '', 'Đã làm cùng nhau');
  historyTitle.id = `roulette-history-${kind}`;
  historyPanel.setAttribute('aria-labelledby', historyTitle.id);
  const historyBody = el('div', 'roulette-history-body');
  historyPanel.append(historyTitle, historyBody);
  const split = el('div', 'roulette-split');
  split.append(pickPanel, historyPanel);

  const tools = el('div', 'roulette-tools'), poolTitle = el('h2', '', K.pool), add = button(K.add, 'roulette-btn primary');
  const seg = el('div', 'roulette-seg'), modes = { board: button('Mặt bảng', ''), list: button('Danh sách', '') };
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Cách xem');
  seg.append(modes.board, modes.list);
  tools.append(poolTitle, add, el('span', 'roulette-badge shared', 'Hai đứa mình'), el('span', 'roulette-spacer'), seg);
  const chips = el('div', 'roulette-chips');
  const poolHost = el('div', 'roulette-pool');
  const toastLine = el('p', 'roulette-toast');
  toastLine.setAttribute('role', 'status');
  root.append(el('h1', 'roulette-title', K.title), el('p', 'roulette-sub', K.sub), split, tools);
  if (kind === 'activity') {
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Lọc theo loại');
    for (const [value, label] of [['', 'Tất cả'], ...ACTIVITY_CATEGORIES.map(c => [c, c])]) {
      const chip = button(label, 'roulette-chip');
      chip.dataset.category = value;
      chip.addEventListener('click', () => { state.category = value; renderChips(); renderPoolArea(); loadView(); }, own);
      chips.append(chip);
    }
    root.append(chips);
  }
  root.append(poolHost, toastLine);
  container.replaceChildren(root);

  let toastTimer = 0;
  function toast(message) {
    if (!message) return;
    clearTimeout(toastTimer);
    toastLine.textContent = message;
    toastTimer = setTimeout(() => { toastLine.textContent = ''; }, 4000);
  }
  // Re-rendering can remove the focused button; send focus to the pick panel instead of the page body.
  function keepFocus() {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    (pickPanel.querySelector('button:not(:disabled)') ?? pickPanel).focus();
  }

  const ideaById = id => state.view?.ideas.find(idea => idea.id === id);
  const visibleIdeas = () => (state.view?.ideas ?? []).filter(idea => !state.category || idea.category === state.category);

  function renderPick() {
    const v = state.view, nodes = [];
    const note = text => el('p', 'roulette-note', text);
    const actionRow = (...buttons) => { const row = el('div', 'roulette-actions'); row.append(...buttons); return row; };
    if (!v) {
      nodes.push(note(state.loadError || 'Đang tải…'));
      if (state.loadError) {
        const retry = button('Thử lại', 'roulette-btn');
        retry.addEventListener('click', loadAll);
        nodes.push(retry);
      }
    } else if (v.pick) {
      const idea = ideaById(v.pick.ideaId), card = el('div', `roulette-card${state.revealed === v.pick.id ? ' is-revealed' : ''}`);
      card.append(note(`${v.pick.byId === me ? 'Bạn' : NAME[v.pick.byId]} đã chọn cho tụi mình`), el('h2', 'roulette-pick-title', idea?.title ?? ''));
      const meta = el('div', 'roulette-meta');
      if (idea) meta.append(el('span', 'roulette-badge', idea.category));
      if (idea?.minutes) meta.append(el('span', 'roulette-badge', `khoảng ${idea.minutes} phút`));
      card.append(meta);
      if (idea?.desc) card.append(el('p', 'roulette-desc', idea.desc));
      const skip = button('Bỏ qua'), done = button('Xong rồi', 'roulette-btn primary');
      skip.disabled = done.disabled = state.busy;
      skip.addEventListener('click', () => act('skip', { kind, pickId: v.pick.id }, { conflict: PICK_CHANGED }));
      done.addEventListener('click', () => openDone(v.pick, idea));
      card.append(actionRow(skip, done));
      nodes.push(card);
    } else if (!v.ideas.length) {
      nodes.push(note(K.empty));
    } else if (!visibleIdeas().length) {
      nodes.push(note('Chưa có ý tưởng nào thuộc loại này.'));
    } else if (!v.eligibleCount) {
      nodes.push(el('p', '', `Chưa còn gì để bốc: ${v.exhausted.recent} mục vừa làm trong 14 ngày qua, ${v.exhausted.skipped} mục đã bỏ qua lượt này.`));
      const reset = button('Đặt lại các mục đã bỏ qua');
      reset.disabled = state.busy;
      reset.addEventListener('click', () => act('reset-skips', { kind }));
      const row = actionRow(reset);
      if (!v.relax) {
        const relax = button('Cho bốc cả mục vừa làm');
        relax.disabled = state.busy;
        relax.addEventListener('click', () => act('relax', { kind }));
        row.append(relax);
      }
      nodes.push(row);
    } else {
      nodes.push(note(`${v.eligibleCount} mục có thể bốc${v.relax ? ' (gồm cả mục vừa làm)' : ''}`));
      const go = button(state.busy ? 'Đang chọn…' : K.pick, 'roulette-btn primary roulette-go');
      go.disabled = state.busy;
      go.addEventListener('click', () => act('pick', { kind, category: state.category || undefined, requestId: crypto.randomUUID() }, { conflict: 'Chưa còn gì để bốc.', reveal: true }));
      nodes.push(go);
    }
    pickPanel.replaceChildren(...nodes);
    pickPanel.setAttribute('aria-busy', String(state.busy));
  }

  function renderHistory() {
    const nodes = [];
    if (state.historyError) nodes.push(el('p', 'roulette-note', state.historyError));
    if (!state.history.length && !state.historyError) nodes.push(el('p', 'roulette-note', 'Chưa có lần nào.'));
    if (state.history.length) {
      const list = el('ul', 'roulette-sessions');
      for (const session of state.history) {
        const item = el('li', 'roulette-session'), line = el('span', 'roulette-session-title');
        line.append(el('b', '', session.title), `${session.archived ? ' (đã lưu trữ)' : ''} · ${vnDate(session.date)}`);
        item.append(line);
        if (session.text) item.append(el('span', 'roulette-note', `${NAME[session.byId]}: ${session.text}`));
        item.append(el('span', 'roulette-note', ['minhle', 'haiyen'].map(id => session.ratings[id] ? `${NAME[id]} thích mức ${session.ratings[id]}/5` : `${NAME[id]} chưa chấm`).join(' · ')));
        const rate = button('Mình thích mức…', 'roulette-btn small');
        rate.setAttribute('aria-label', `Mình thích mức… cho ${session.title}, ${vnDate(session.date)}`);
        rate.addEventListener('click', () => openRateSheet(root, {
          session, me, signal: controller.signal,
          save: async rating => {
            const { session: saved } = await call(`/api/ideas/sessions/${encodeURIComponent(session.id)}/rating`, 'PUT', { rating });
            if (!alive()) return;
            state.history = state.history.map(entry => entry.id === saved.id ? saved : entry);
            renderHistory();
            toast('Đã lưu mức bạn thích');
          },
        }));
        item.append(rate);
        list.append(item);
      }
      nodes.push(list);
    }
    if (state.cursor || state.historyError) {
      const more = button(state.historyError ? 'Thử lại' : 'Xem thêm', 'roulette-btn ghost');
      more.addEventListener('click', () => loadHistory(Boolean(state.cursor)));
      nodes.push(more);
    }
    historyBody.replaceChildren(...nodes);
  }

  function renderChips() {
    for (const chip of chips.children) chip.setAttribute('aria-pressed', String(chip.dataset.category === state.category));
  }
  function renderPoolArea() {
    for (const [mode, node] of Object.entries(modes)) node.setAttribute('aria-pressed', String(state.mode === mode));
    add.disabled = !state.view;
    if (!state.view) return poolHost.replaceChildren();
    const ideas = visibleIdeas();
    if (!ideas.length) {
      const empty = el('div', 'roulette-empty'), first = button(K.add, 'roulette-btn primary');
      first.addEventListener('click', () => openIdea(null));
      empty.append(el('p', '', state.view.ideas.length ? 'Chưa có ý tưởng nào thuộc loại này.' : K.empty), first);
      return poolHost.replaceChildren(empty);
    }
    renderPool(poolHost, {
      ideas, mode: state.mode, pickedId: state.view.pick?.ideaId, me,
      onEdit: idea => openIdea(idea),
      onArchive: idea => confirmArchive(root, {
        signal: controller.signal,
        save: async () => {
          await call(`/api/ideas/${encodeURIComponent(idea.id)}/archive`, 'POST', { version: idea.version })
            .catch(error => { if (error.status === 409) loadView(); throw error; });
          toast('Đã lưu trữ');
          await loadView();
          keepFocus();
        },
      }),
    });
  }

  function openIdea(idea) {
    openIdeaSheet(root, {
      kind, idea, category: state.category, signal: controller.signal,
      save: async (values, { version, requestId }) => {
        if (idea) await call(`/api/ideas/${encodeURIComponent(idea.id)}`, 'PUT', { ...values, version });
        else await call('/api/ideas', 'POST', { ...values, kind, requestId });
        toast('Đã lưu');
        await loadView();
      },
      latest: async () => { await loadView(); return ideaById(idea.id) ?? null; },
    });
  }

  function openDone(pick, idea) {
    openDoneSheet(root, {
      idea, me, signal: controller.signal,
      save: async ({ date, text, rating, requestId }, close) => {
        try {
          await call('/api/ideas/done', 'POST', { kind, pickId: pick.id, date, text, rating, requestId });
          toast('Đã ghi lại, có trong lịch. Vui quá!');
        } catch (error) {
          if (error.status !== 409) throw error;
          close();
          toast(PICK_CHANGED);
        }
        if (!alive()) return;
        await Promise.all([loadView(), loadHistory(false)]);
        keepFocus();
      },
    });
  }

  async function act(path, body, { conflict, reveal = false } = {}) {
    if (state.busy) return;
    state.busy = true;
    renderPick();
    try {
      state.view = await call(`/api/ideas/${path}`, 'POST', body);
      if (reveal) state.revealed = state.view.pick?.id ?? null;
    } catch (error) {
      if (!alive()) return;
      toast(problem(error, conflict));
      if (error.status === 409) await loadView({ quiet: true });
    }
    if (!alive()) return;
    state.busy = false;
    renderPick();
    renderPoolArea();
    keepFocus();
  }

  async function loadView({ quiet = false } = {}) {
    const query = new URLSearchParams({ kind });
    if (state.category) query.set('category', state.category);
    try {
      state.view = await call(`/api/ideas?${query}`);
      state.loadError = '';
    } catch (error) {
      if (!alive()) return;
      if (!state.view) state.loadError = problem(error) ?? '';
      else if (!quiet) toast(problem(error));
    }
    if (!alive()) return;
    renderPick();
    renderPoolArea();
  }

  async function loadHistory(append) {
    // The server caps a page at 100; a reload past that keeps the first 100 and "Xem thêm" continues from there.
    const query = new URLSearchParams({ kind, limit: String(append ? MORE : Math.min(100, Math.max(FIRST_PAGE, state.history.length))) });
    if (append) query.set('cursor', state.cursor);
    try {
      const page = await call(`/api/ideas/sessions?${query}`);
      if (!alive()) return;
      state.history = append ? [...state.history, ...page.items] : page.items;
      state.cursor = page.nextCursor;
      state.historyError = '';
    } catch (error) {
      if (!alive()) return;
      state.historyError = problem(error) ?? '';
    }
    renderHistory();
  }

  function loadAll() {
    state.loadError = '';
    renderPick();
    loadView();
    loadHistory(false);
  }

  add.addEventListener('click', () => openIdea(null), own);
  for (const [mode, node] of Object.entries(modes)) node.addEventListener('click', () => { state.mode = mode; renderPoolArea(); }, own);
  enableDrag(poolHost, {
    signal: controller.signal,
    onMove: async (id, x, y) => {
      try {
        const { idea } = await call(`/api/ideas/${encodeURIComponent(id)}/position`, 'PUT', { x, y });
        const local = ideaById(id);
        if (!local || !alive()) return;
        Object.assign(local, { x: idea.x, y: idea.y });
        renderPoolArea();
      } catch (error) {
        if (!alive()) return;
        toast(problem(error) && 'Chưa lưu được chỗ mới của tờ giấy.');
        renderPoolArea();
      }
    },
  });
  // The pick is shared: coming back to the window shows what the other person did meanwhile.
  window.addEventListener('focus', () => { if (!state.busy) { loadView({ quiet: true }); loadHistory(false); } }, own);
  // Identity changed under this page (logout, expiry): drop the shared content right away.
  authEvents.addEventListener('change', () => {
    if (getUser()?.id === me) return;
    controller.abort();
    root.replaceChildren(el('h1', 'roulette-title', K.title), el('p', 'roulette-note', 'Phiên đăng nhập đã thay đổi. Hãy đăng nhập lại để xem tiếp.'));
  }, own);

  renderChips();
  renderPick();
  renderPoolArea();
  renderHistory();
  loadAll();

  let disposed = false;
  function cleanup() {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', cleanup);
    controller.abort();
    clearTimeout(toastTimer);
    root.remove();
  }
  signal.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}
