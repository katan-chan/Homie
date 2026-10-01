import { apiRequest, authEvents, getUser, updateUserProfile } from './auth.js';
import { renderLogin } from './login.js';
import { render as renderGarden } from './tabs/garden.js';

export function renderProfile(container, { signal }, definition) {
  if (signal.aborted) return () => {};
  const section = document.createElement('section');
  section.className = `profile-page profile--${definition.id}`;
  section.dataset.profileId = definition.id;
  section.style.setProperty('--profile-accent', definition.accent);
  section.innerHTML = `
    <div class="account-card profile-card">
      <p class="page-eyebrow">Một góc trong vườn</p>
      <h1 class="profile-name"></h1>
      <p class="profile-bio"></p>
      <div class="profile-actions"></div>
      <div class="profile-editor"></div>
      <p class="profile-status form-message" role="status"></p>
    </div>`;
  const backdrop = document.createElement('div');
  backdrop.className = 'profile-garden';
  const cleanupGarden = renderGarden(backdrop, { signal, showTitle: false, showCharacters: false });
  section.prepend(backdrop);
  container.replaceChildren(section);
  const title = section.querySelector('.profile-name');
  const bio = section.querySelector('.profile-bio');
  const actions = section.querySelector('.profile-actions');
  const editor = section.querySelector('.profile-editor');
  const status = section.querySelector('.profile-status');
  let profile = null;
  let editing = false;
  let draft = null;
  let loginCleanup = null;
  let disposed = false;

  function showActions() {
    if (disposed || signal.aborted) return;
    title.textContent = profile?.displayName ?? definition.displayName;
    bio.textContent = profile?.bio || 'Chưa có giới thiệu.';
    actions.replaceChildren();
    const viewer = getUser();
    if (!profile) return;
    if (viewer?.id === definition.id) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'secondary-button';
      edit.dataset.action = 'edit-profile';
      edit.textContent = 'Edit';
      edit.disabled = editing;
      edit.addEventListener('click', showEditor, { signal });
      actions.append(edit);
    } else if (!viewer) {
      const signIn = document.createElement('button');
      signIn.type = 'button';
      signIn.className = 'secondary-button';
      signIn.textContent = 'Đăng nhập để chỉnh sửa';
      signIn.addEventListener('click', () => {
        const form = editor.querySelector('.profile-edit-form');
        if (form) draft = { displayName: form.elements.displayName.value, bio: form.elements.bio.value };
        editing = false;
        loginCleanup?.();
        editor.replaceChildren();
        loginCleanup = renderLogin(editor, {
          signal,
          onSuccess: () => {
            loginCleanup?.();
            loginCleanup = null;
            editor.replaceChildren();
            status.textContent = getUser()?.id === definition.id ? '' : 'Bạn chỉ có thể sửa hồ sơ của mình.';
            showActions();
            if (getUser()?.id === definition.id && draft) showEditor();
          },
        });
        editor.querySelector('input')?.focus();
      }, { signal });
      actions.append(signIn);
    }
  }

  function showEditor() {
    if (!profile || getUser()?.id !== definition.id || signal.aborted) return;
    editing = true;
    status.textContent = '';
    editor.innerHTML = `
      <form class="profile-edit-form">
        <label for="profile-display-name">Tên hiển thị</label>
        <input id="profile-display-name" name="displayName" maxlength="80" required autocomplete="name">
        <label for="profile-bio">Giới thiệu</label>
        <textarea id="profile-bio" name="bio" maxlength="500" rows="4"></textarea>
        <div class="form-actions">
          <button class="primary-button" type="submit">Lưu thay đổi</button>
          <button class="secondary-button" type="button" data-action="cancel-edit">Hủy</button>
        </div>
      </form>`;
    const form = editor.querySelector('form');
    form.elements.displayName.value = draft?.displayName ?? profile.displayName;
    form.elements.bio.value = draft?.bio ?? profile.bio;
    const cancel = form.querySelector('[data-action=cancel-edit]');
    cancel.addEventListener('click', () => {
      editing = false;
      draft = null;
      editor.replaceChildren();
      showActions();
      actions.querySelector('button')?.focus();
    }, { signal });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type=submit]');
      if (submit.disabled) return;
      submit.disabled = true;
      cancel.disabled = true;
      status.textContent = 'Đang lưu…';
      try {
        const result = await apiRequest(`/api/profiles/${definition.id}`, {
          method: 'PUT', signal,
          body: { displayName: form.elements.displayName.value, bio: form.elements.bio.value },
        });
        if (disposed || signal.aborted) return;
        profile = result.profile;
        editing = false;
        draft = null;
        editor.replaceChildren();
        updateUserProfile(profile);
        showActions();
        status.textContent = 'Đã lưu hồ sơ.';
        actions.querySelector('button')?.focus();
      } catch (error) {
        if (disposed || signal.aborted) return;
        status.textContent = error.status === 401 ? 'Phiên đã hết hạn. Hãy đăng nhập lại.'
          : error.status === 403 ? 'Bạn chỉ có thể sửa hồ sơ của mình.'
          : error.status === 400 ? 'Tên hiển thị tối đa 80 ký tự, giới thiệu tối đa 500 ký tự.'
          : 'Chưa lưu được. Nội dung bạn nhập vẫn được giữ để thử lại.';
        submit.disabled = false;
        cancel.disabled = false;
      }
    }, { signal });
    showActions();
    form.elements.displayName.focus();
  }

  async function loadProfile() {
    status.textContent = 'Đang tải hồ sơ…';
    try {
      const result = await apiRequest(`/api/profiles/${definition.id}`, { signal });
      if (disposed || signal.aborted) return;
      profile = result.profile;
      status.textContent = '';
      showActions();
    } catch {
      if (disposed || signal.aborted) return;
      status.textContent = 'Chưa tải được hồ sơ. ';
      const retry = document.createElement('button');
      retry.className = 'secondary-button';
      retry.type = 'button';
      retry.textContent = 'Thử lại';
      retry.addEventListener('click', loadProfile, { signal });
      status.append(retry);
    }
  }

  authEvents.addEventListener('change', (event) => {
    const expired = event.detail?.reason === 'expired' && !getUser();
    if (getUser()?.id !== definition.id && !expired) {
      editing = false;
      draft = null;
      editor.replaceChildren();
    }
    showActions();
  }, { signal });
  showActions();
  loadProfile();
  return () => {
    disposed = true;
    cleanupGarden();
    loginCleanup?.();
    section.remove();
  };
}
