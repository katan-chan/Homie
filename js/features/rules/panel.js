import { apiRequest, getUser, authEvents } from '../../auth.js';

const NAME = { minhle: 'Minh', haiyen: 'Yến' };
const MEMBERS = Object.keys(NAME);
const other = id => MEMBERS.find(member => member !== id);
const LIMITS = { title: 120, text: 3000, reason: 500 };
const dayFormat = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'numeric', year: 'numeric' });
const formatDay = iso => { try { return dayFormat.format(new Date(iso)); } catch { return ''; } };
let uid = 0;

function el(tag, props = {}, children = []) {
  const { data, attrs, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  for (const [key, value] of Object.entries(data ?? {})) node.dataset[key] = value;
  for (const [key, value] of Object.entries(attrs ?? {})) node.setAttribute(key, value);
  node.append(...children);
  return node;
}
const badge = (tone, textContent) => el('span', { className: `rules-badge is-${tone}`, textContent });
const button = (textContent, act, rule, tone = '') => el('button', {
  type: 'button', className: `rules-button ${tone}`.trim(), textContent,
  data: rule ? { act, rule: rule.id } : { act },
  attrs: rule ? { 'aria-describedby': `rules-${rule.id}-title` } : {},
});

/** Mounts the "Nội quy" panel (a special tab inside Góc ghi chép). Returns an idempotent cleanup. */
export function mountRulesPanel(container, { signal } = {}) {
  const controller = new AbortController();
  let disposed = false, busy = false, loadSeq = 0, rules = [], account = getUser()?.id ?? null, dialog = null;

  const status = el('p', { className: 'rules-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const newButton = button('+ Đề xuất nội quy', 'new', null, 'is-primary');
  const list = el('div', { className: 'rules-cards' });
  const root = el('section', { className: 'rules-panel', attrs: { 'aria-label': 'Nội quy' } }, [
    el('div', { className: 'rules-tools' }, [newButton, badge('shared', 'Hai đứa mình'),
      el('p', { className: 'rules-hint', textContent: 'Một bản chỉ có hiệu lực khi cả hai cùng đồng ý. Bản cũ vẫn áp dụng tới khi bản mới được cả hai đồng ý.' })]),
    status, list,
  ]);
  container.replaceChildren(root);

  const announce = text => { status.textContent = text; };
  const find = id => rules.find(rule => rule.id === id);
  const replace = next => { const at = rules.findIndex(rule => rule.id === next.id); if (at < 0) rules.push(next); else rules[at] = next; };
  const send = (path, body, requestId = crypto.randomUUID()) => apiRequest(path, { method: 'POST', body: { ...body, requestId }, signal: controller.signal });
  const quiet = error => disposed || error?.name === 'AbortError';
  function setBusy(value) { busy = value; root.toggleAttribute('aria-busy', value); }
  function focusRule(id) { (list.querySelector(`[data-card="${CSS.escape(id)}"] h3`) ?? newButton).focus(); }

  function card(rule) {
    const revision = n => rule.revisions.find(item => item.n === n);
    const active = revision(rule.activeN), proposed = revision(rule.proposedN);
    const titleId = `rules-${rule.id}-title`;
    const article = el('article', { className: 'rule-card', data: { card: rule.id }, attrs: { 'aria-labelledby': titleId } }, [
      el('h3', { id: titleId, tabIndex: -1, textContent: (active ?? proposed)?.title ?? '' }),
    ]);
    if (active) article.append(el('div', { className: 'rule-rev is-active' }, [
      badge('both', `Đang áp dụng · bản ${active.n}`), el('p', { className: 'rule-text', textContent: active.text })]));
    else article.append(badge('warn', 'Đang chờ cả hai đồng ý'));
    if (proposed) {
      const agreed = rule.agreements[proposed.n] ?? [];
      const block = el('div', { className: 'rule-rev is-pending' }, [badge('warn', `Đề xuất bản ${proposed.n} của ${NAME[proposed.byId] ?? proposed.byId}`)]);
      if (active && proposed.title !== active.title) block.append(el('p', { className: 'rule-new-title', textContent: `Tiêu đề mới: ${proposed.title}` }));
      block.append(el('p', { className: 'rule-text', textContent: proposed.text }));
      if (proposed.reason) block.append(el('p', { className: 'rule-note', textContent: `Lý do: ${proposed.reason}` }));
      block.append(el('div', { className: 'rule-meta' }, MEMBERS.map(member => agreed.includes(member)
        ? badge('both', `${NAME[member]} đã đồng ý ✓`) : badge('plain', `${NAME[member]} chưa đồng ý`))));
      if (!agreed.includes(account)) block.append(button('Mình đồng ý với bản này', 'agree', rule, 'is-primary'));
      article.append(block);
    }
    const requester = rule.archiveRequestBy;
    if (requester) article.append(el('p', { className: 'rule-archive-note rules-badge is-warn',
      textContent: `${NAME[requester]} đề nghị lưu trữ. Vẫn áp dụng tới khi ${NAME[other(requester)]} xác nhận.` }));
    const actions = el('div', { className: 'rule-actions' }, [button('Đề xuất sửa', 'revise', rule), button('Xem lịch sử', 'history', rule)]);
    if (!requester) actions.append(button('Đề nghị lưu trữ', 'archive-request', rule, 'is-danger'));
    else if (requester === account) actions.append(button('Rút đề nghị lưu trữ', 'archive-cancel', rule));
    else actions.append(button('Xác nhận lưu trữ', 'archive-confirm', rule, 'is-danger'), button('Giữ lại', 'archive-cancel', rule));
    article.append(actions);
    return article;
  }

  function render() {
    const visible = rules.filter(rule => !rule.archivedAt);
    list.replaceChildren(...(visible.length ? visible.map(card) : [el('p', { className: 'rules-empty', textContent: 'Chưa có nội quy nào.' })]));
  }

  async function load() {
    const seq = ++loadSeq;
    if (!account) { rules = []; list.replaceChildren(); announce('Đăng nhập để xem nội quy.'); return; }
    try {
      const data = await apiRequest('/api/rules', { signal: controller.signal });
      if (quiet() || seq !== loadSeq) return;
      rules = Array.isArray(data?.rules) ? data.rules : [];
      render();
    } catch (error) {
      if (quiet(error) || seq !== loadSeq) return;
      list.replaceChildren(el('div', { className: 'rules-empty' }, [
        el('p', { textContent: error.message || 'Không tải được nội quy.' }), button('Thử lại', 'reload')]));
    }
  }

  async function act(rule, action, extra, message) {
    if (busy) return;
    setBusy(true);
    try {
      const data = await send(`/api/rules/${encodeURIComponent(rule.id)}/${action}`, { ...extra, version: rule.version });
      if (quiet()) return;
      replace(data.rule);
      dialog?.close();
      render();
      focusRule(data.rule.id);
      announce(message(data.rule));
    } catch (error) {
      if (quiet(error)) return;
      dialog?.close();
      if (error.status === 409) {
        await load();
        if (quiet()) return;
        focusRule(rule.id);
        announce('Nội quy vừa được thay đổi ở nơi khác. Mình đã tải bản mới, bạn xem lại nhé.');
      } else announce(error.message);
    } finally { if (!disposed) setBusy(false); }
  }

  function openDialog(label) {
    dialog?.close();
    const id = `rules-dialog-${++uid}`;
    const node = el('dialog', { className: 'rules-dialog', attrs: { 'aria-labelledby': id } }, [
      el('div', { className: 'rules-dialog-head' }, [el('h2', { id, textContent: label }),
        el('button', { type: 'button', className: 'rules-icon-button', textContent: '×', attrs: { 'aria-label': 'Đóng' }, onclick: () => node.close() })]),
    ]);
    node.addEventListener('close', () => { node.remove(); if (dialog === node) dialog = null; });
    root.append(node);
    dialog = node;
    return node;
  }

  function field(label, control, max) {
    const wrap = el('label', { className: 'rules-field' }, [el('span', { textContent: label }), control]);
    if (max) {
      const count = el('small', { className: 'rules-count', attrs: { 'aria-hidden': 'true' } });
      const update = () => { count.textContent = `${[...control.value].length}/${max}`; };
      control.addEventListener('input', update);
      update();
      wrap.append(count);
    }
    return wrap;
  }

  function openForm(rule) {
    const node = openDialog(rule ? 'Đề xuất sửa' : 'Đề xuất nội quy');
    const base = () => rule?.revisions.find(item => item.n === (rule.proposedN ?? rule.activeN));
    const title = el('input', { name: 'title', required: true, maxLength: LIMITS.title, value: base()?.title ?? '' });
    const text = el('textarea', { name: 'text', required: true, maxLength: LIMITS.text, rows: 5, value: base()?.text ?? '' });
    const reason = el('textarea', { name: 'reason', maxLength: LIMITS.reason, rows: 3 });
    const error = el('p', { className: 'rules-error', hidden: true, attrs: { role: 'alert' } });
    const conflict = el('div', { className: 'rules-conflict', hidden: true, attrs: { role: 'alert' } }, [
      el('b', { textContent: 'Nội dung đã được thay đổi ở nơi khác.' }),
      el('span', { textContent: 'Bản bạn đang viết vẫn còn nguyên bên dưới.' }),
      el('div', { className: 'rule-actions' }, [
        el('button', { type: 'button', className: 'rules-button', textContent: 'Tải lại bản mới', onclick: () => {
          title.value = base()?.title ?? ''; text.value = base()?.text ?? ''; reason.value = '';
          for (const control of [title, text, reason]) control.dispatchEvent(new Event('input'));
          conflict.hidden = true; title.focus();
        } }),
        el('button', { type: 'button', className: 'rules-button', textContent: 'Giữ bản của mình để sửa tiếp', onclick: () => { conflict.hidden = true; title.focus(); } }),
      ]),
    ]);
    const submit = el('button', { type: 'submit', className: 'rules-button is-primary', textContent: 'Gửi đề xuất' });
    // One requestId per open sheet, so resending after a lost response cannot create a second rule.
    const requestId = crypto.randomUUID();
    const form = el('form', { className: 'rules-form' }, [
      el('p', { className: 'rule-note', textContent: rule ? 'Bản đang áp dụng giữ nguyên tới khi cả hai đồng ý bản mới.' : 'Nội quy chỉ có hiệu lực khi cả hai đồng ý.' }),
      conflict, error,
      field('Tiêu đề', title, LIMITS.title), field('Nội dung', text, LIMITS.text),
      ...(rule ? [field('Vì sao muốn sửa', reason, LIMITS.reason)] : []),
      el('div', { className: 'rule-actions rules-dialog-actions' }, [
        el('button', { type: 'button', className: 'rules-button', textContent: 'Hủy', onclick: () => node.close() }), submit]),
    ]);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      setBusy(true); submit.disabled = true; error.hidden = true;
      const values = { title: title.value, text: text.value };
      try {
        const data = rule
          ? await send(`/api/rules/${encodeURIComponent(rule.id)}/revisions`, { ...values, reason: reason.value, version: rule.version }, requestId)
          : await send('/api/rules', values, requestId);
        if (quiet()) return;
        replace(data.rule);
        node.close();
        render();
        focusRule(data.rule.id);
        announce('Đã gửi đề xuất. Cần cả hai đồng ý.');
      } catch (failure) {
        if (quiet(failure)) return;
        if (failure.status === 409 && rule) {
          // Keep the draft; the next submit is based on the fresh version.
          await load();
          if (quiet()) return;
          rule = find(rule.id);
          if (!rule || rule.archivedAt) { error.textContent = 'Nội quy này vừa được lưu trữ ở nơi khác.'; error.hidden = false; return; }
          conflict.hidden = false;
          conflict.querySelector('button').focus();
        } else {
          error.textContent = failure.message || 'Không gửi được đề xuất.';
          error.hidden = false;
        }
      } finally {
        if (!disposed) { setBusy(false); submit.disabled = false; }
      }
    });
    node.append(form);
    node.showModal();
    title.focus();
  }

  function openHistory(rule) {
    const node = openDialog('Lịch sử nội quy');
    node.append(el('ol', { className: 'rules-history' }, rule.revisions.slice().reverse().map(item => {
      const state = item.n === rule.activeN ? ['both', 'Đang áp dụng', 'is-active']
        : item.n === rule.proposedN ? ['warn', 'Đang chờ', 'is-pending'] : ['plain', 'Bản cũ', ''];
      return el('li', { className: `rule-rev ${state[2]}`.trim() }, [
        el('div', { className: 'rule-meta' }, [el('b', { textContent: `Bản ${item.n}` }),
          el('span', { textContent: `${NAME[item.byId] ?? item.byId} · ${formatDay(item.at)}` }), badge(state[0], state[1])]),
        el('h3', { textContent: item.title }),
        el('p', { className: 'rule-text', textContent: item.text }),
        ...(item.reason ? [el('p', { className: 'rule-note', textContent: `Lý do: ${item.reason}` })] : []),
      ]);
    })));
    node.showModal();
    node.querySelector('.rules-icon-button').focus();
  }

  function openArchiveRequest(rule) {
    const node = openDialog('Đề nghị lưu trữ');
    node.append(el('p', { textContent: `Nội quy vẫn áp dụng tới khi ${NAME[other(account)]} xác nhận.` }),
      el('div', { className: 'rule-actions rules-dialog-actions' }, [
        el('button', { type: 'button', className: 'rules-button', textContent: 'Thôi', onclick: () => node.close() }),
        el('button', { type: 'button', className: 'rules-button is-primary', textContent: 'Gửi đề nghị',
          onclick: () => act(rule, 'archive-request', {}, () => 'Đã gửi đề nghị lưu trữ.') }),
      ]));
    node.showModal();
    node.querySelector('.is-primary').focus();
  }

  root.addEventListener('click', event => {
    const target = event.target.closest('button[data-act]');
    if (!target || !list.contains(target) && target !== newButton) return;
    const rule = find(target.dataset.rule);
    switch (target.dataset.act) {
      case 'new': return openForm(null);
      case 'reload': return load();
      case 'revise': return openForm(rule);
      case 'history': return openHistory(rule);
      case 'archive-request': return openArchiveRequest(rule);
      case 'agree': return act(rule, 'agree', { n: rule.proposedN }, next => next.activeN === rule.proposedN
        ? 'Cả hai đã đồng ý. Bản mới có hiệu lực.' : `Đã ghi bạn đồng ý. Chờ ${NAME[other(account)]}.`);
      case 'archive-confirm': return act(rule, 'archive-confirm', {}, () => 'Đã lưu trữ nội quy.');
      case 'archive-cancel': return act(rule, 'archive-cancel', {}, () => rule.archiveRequestBy === account ? 'Đã rút đề nghị lưu trữ.' : 'Đã giữ lại nội quy.');
    }
  });

  // The partner may have agreed meanwhile; refresh when the app comes back to the foreground.
  const onVisible = () => { if (document.visibilityState === 'visible' && !busy && !dialog) load(); };
  // Never keep one member's view (or an open draft) after logout or an account switch.
  const onAuth = () => {
    const next = getUser()?.id ?? null;
    if (next === account) return;
    account = next;
    dialog?.close();
    announce('');
    load();
  };
  document.addEventListener('visibilitychange', onVisible);
  authEvents.addEventListener('change', onAuth);

  function cleanup() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    signal?.removeEventListener('abort', cleanup);
    document.removeEventListener('visibilitychange', onVisible);
    authEvents.removeEventListener('change', onAuth);
    root.remove();
  }
  if (signal?.aborted) cleanup();
  else { signal?.addEventListener('abort', cleanup, { once: true }); announce('Đang tải nội quy…'); load().then(() => { if (!disposed && status.textContent === 'Đang tải nội quy…') announce(''); }); }
  return cleanup;
}
