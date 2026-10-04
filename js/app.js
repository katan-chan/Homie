import { tabs } from './tabs.js';
import { resolveTab } from './routing.js';
import { authEvents, getUser, logout, refreshSession } from './auth.js';
import { renderLogin } from './login.js';
import { mountBackground } from './background.js';

const backgroundController = new AbortController();
const background = mountBackground(document.querySelector('#app-background'), { signal: backgroundController.signal });
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) backgroundController.abort();
});

const navigation = document.querySelector('#tabs');
const content = document.querySelector('#content');
const sidebar = document.querySelector('#sidebar');
const menuToggle = document.querySelector('.menu-toggle');
menuToggle.addEventListener('click', () => {
  sidebar.showModal();
  menuToggle.setAttribute('aria-expanded', 'true');
  navigation.querySelector('[aria-selected="true"]')?.focus();
});
document.querySelector('.menu-close').addEventListener('click', () => sidebar.close());
sidebar.addEventListener('close', () => {
  if (sidebar.open) return;
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.focus();
});
sidebar.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const controls = [...sidebar.querySelectorAll('button')].filter((button) => button.tabIndex >= 0 && !button.disabled);
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
sidebar.addEventListener('click', (event) => {
  const bounds = sidebar.getBoundingClientRect();
  if (event.target === sidebar && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) sidebar.close();
});
const activeTabs = tabs.filter((tab) => tab.enabled);
const buttons = new Map();
let sequence = 0;
let current = null;
const accountControls = document.querySelector('#account-controls');
function updateAccountControls() {
  accountControls.replaceChildren();
  const user = getUser();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary-button';
  if (user) {
    const name = document.createElement('p');
    name.className = 'account-name';
    name.textContent = user.displayName;
    accountControls.append(name);
    button.classList.add('logout-button');
    button.textContent = 'Đăng xuất';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await logout();
        await navigate(true);
        if (sidebar.open) document.querySelector('.menu-close').focus();
      } catch {
        button.disabled = false;
        message.textContent = 'Chưa đăng xuất được. Hãy thử lại.';
      }
    });
  } else {
    button.textContent = 'Đăng nhập';
    button.addEventListener('click', openLogin);
  }
  const message = document.createElement('p');
  message.className = 'form-message';
  message.setAttribute('role', 'status');
  accountControls.append(button, message);
}
authEvents.addEventListener('change', updateAccountControls);
// Tabs ask for the shell login without importing the shell.
authEvents.addEventListener('login-request', openLogin);
updateAccountControls();

// Shell login is an account action, independent of any tab's access policy.
function openLogin() {
  const opener = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'shell-login';
  dialog.setAttribute('aria-label', 'Đăng nhập');
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'secondary-button'; close.textContent = 'Đóng';
  close.addEventListener('click', () => dialog.close());
  const host = document.createElement('div');
  dialog.append(close, host); document.body.append(dialog);
  const controller = new AbortController();
  const cleanup = renderLogin(host, { signal: controller.signal, onSuccess: () => { dialog.close(); navigate(true); } });
  dialog.addEventListener('close', () => {
    controller.abort(); cleanup(); dialog.remove();
    if (sidebar.open) (opener?.isConnected && sidebar.contains(opener) ? opener : accountControls.querySelector('button') || document.querySelector('.menu-close')).focus();
    else if (opener?.isConnected) opener.focus();
  }, { once: true });
  dialog.showModal(); host.querySelector('input')?.focus();
}

function choose(tab) {
  if (!tab) return;
  if (location.hash === `#${tab.id}`) return;
  location.hash = tab.id;
}

for (const tab of activeTabs) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tab-button';
  button.id = `tab-${tab.id}`;
  button.textContent = tab.label;
  button.setAttribute('role', 'tab');
  button.setAttribute('aria-controls', `panel-${tab.id}`);
  button.setAttribute('aria-selected', 'false');
  button.tabIndex = -1;
  button.addEventListener('click', () => choose(tab));
  button.addEventListener('keydown', (event) => {
    const index = activeTabs.indexOf(tab);
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % activeTabs.length;
    if (event.key === 'ArrowUp') next = (index - 1 + activeTabs.length) % activeTabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = activeTabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    buttons.get(activeTabs[next].id).focus();
    choose(activeTabs[next]);
  });
  buttons.set(tab.id, button);
  navigation.append(button);
}

document.querySelector('a.skip').addEventListener('click', (event) => {
  event.preventDefault();
  content.focus();
});

function showStatus(panel, message, retry = false, reload = false) {
  const status = document.createElement('div');
  status.className = 'route-status';
  status.setAttribute('role', retry ? 'alert' : 'status');
  const text = document.createElement('p');
  text.textContent = message;
  status.append(text);
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'retry-button';
    button.textContent = 'Thử lại';
    button.addEventListener('click', () => reload ? location.reload() : navigate(true));
    status.append(button);
  }
  panel.replaceChildren(status);
}

function dispose(session) {
  if (!session) return Promise.resolve();
  session.controller.abort();
  session.disposal ??= (async () => {
    try {
      const cleanup = await session.renderPromise;
      if (typeof cleanup === 'function') await cleanup();
    } catch (error) {
      console.error('Tab cleanup failed:', error);
    }
  })();
  return session.disposal;
}

async function navigate(retry = false) {
  const tab = resolveTab(tabs, location.hash);
  if (tab && location.hash !== `#${tab.id}`) {
    history.replaceState(null, '', `#${tab.id}`);
  }
  if (!retry && current?.tab === tab) return;

  const request = ++sequence;
  const previous = current;
  const hadContentFocus = content.contains(document.activeElement);
  const hadTabFocus = navigation.contains(document.activeElement);
  current = {
    tab,
    controller: new AbortController(),
    renderPromise: null,
  };
  const session = current;

  for (const [id, button] of buttons) {
    const selected = id === tab?.id;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  document.body.dataset.tab = tab?.id ?? '';
  background.update(tab?.background);
  const panel = document.createElement('section');
  panel.className = 'tab-panel';
  if (tab) {
    panel.id = `panel-${tab.id}`;
    panel.tabIndex = 0;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `tab-${tab.id}`);
  }
  content.replaceChildren(panel);
  if (hadTabFocus && tab) buttons.get(tab.id).focus();
  else if (hadContentFocus) content.focus();
  if (!tab) {
    showStatus(panel, 'Chưa có góc nào được mở.');
    await dispose(previous);
    return;
  }

  panel.setAttribute('aria-busy', 'true');
  showStatus(panel, 'Đang mở góc vườn…');
  await dispose(previous);
  if (request !== sequence) return;

  let moduleLoaded = false;
  let moduleAttempted = false;
  try {
    if (tab.requiresAuth) {
      const user = await refreshSession({ signal: session.controller.signal });
      if (request !== sequence || session.controller.signal.aborted) return;
      if (!user) {
        session.renderPromise = Promise.resolve(renderLogin(panel, {
          signal: session.controller.signal,
          onSuccess: () => navigate(true),
        }));
        panel.removeAttribute('aria-busy');
        panel.classList.add('is-entering');
        return;
      }
    }
    moduleAttempted = true;
    const module = await tab.load();
    moduleLoaded = true;
    if (request !== sequence || session.controller.signal.aborted) return;
    panel.replaceChildren();
    session.renderPromise = Promise.resolve(module.render(panel, {
      signal: session.controller.signal,
    }));
    await session.renderPromise;
    if (request !== sequence) return;
    panel.removeAttribute('aria-busy');
    panel.classList.add('is-entering');
  } catch (error) {
    if (request !== sequence || session.controller.signal.aborted) return;
    panel.removeAttribute('aria-busy');
    console.error('Tab could not be opened:', error);
    // A failed import can remain cached in a browser's module map.
    // Reloading on import failure clears that map while preserving the hash.
    showStatus(panel, 'Không thể mở góc này. Bạn có thể thử lại.', true, moduleAttempted && !moduleLoaded);
  }
}

window.addEventListener('hashchange', () => navigate());
navigate();
refreshSession().catch(() => {});
