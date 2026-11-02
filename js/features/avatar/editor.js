// Ảnh đại diện on the profile: the picture (or the name's first letter), and the owner's editor: pick a picture, cut a
// circle by dragging and zooming, save; or delete it. Calls only /api/profiles/:id/avatar.
import { API_BASE_URL } from '../../config.js';
import { apiRequest } from '../../auth.js';
import { loadFile } from '../moments/image.js';
import { AVATAR, cropRect, initialCrop, panBy, renderAvatar, zoomTo } from './crop.js';

/** Public URL of the profile's picture (changes with every new picture), or null when there is none. */
export function avatarUrl(profile) {
  return profile?.avatar ? `${API_BASE_URL}/api/profiles/${profile.id}/avatar?v=${profile.avatar.version}` : null;
}

/** <img class="profile-avatar"> or the first letter of the name in a circle (hidden from screen readers). */
export function avatarNode(profile, name) {
  const url = avatarUrl(profile);
  if (url) {
    const img = document.createElement('img');
    img.className = 'profile-avatar';
    img.src = url;
    img.alt = `Ảnh đại diện của ${name}`;
    img.width = img.height = 112;
    return img;
  }
  const initial = document.createElement('span');
  initial.className = 'profile-avatar profile-avatar-initial';
  initial.setAttribute('aria-hidden', 'true');
  initial.textContent = ([...name.trim()][0] ?? '?').toUpperCase();
  return initial;
}

const TYPES = /^image\/(jpeg|png|webp)$/;
const button = (text, className, onClick, signal) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.addEventListener('click', onClick, { signal });
  return b;
};
const saveError = error => error.status === 401 ? 'Phiên đã hết hạn. Hãy đăng nhập lại.'
  : error.status === 400 || error.status === 413 ? 'Ảnh quá lớn, thử ảnh khác.'
    : 'Chưa lưu được ảnh. Thử lại nhé.';

/** The owner's picture controls inside host; onChange(profile) after a save or delete. Returns an idempotent cleanup. */
export function mountAvatarEditor(host, { profile, signal, onChange }) {
  const local = new AbortController();
  const stop = () => local.abort();
  signal.addEventListener('abort', stop, { once: true });
  const on = local.signal;
  let current = profile, previewUrl = null;

  const root = document.createElement('div');
  root.className = 'avatar-editor';
  const actions = document.createElement('div');
  actions.className = 'avatar-actions';
  const panel = document.createElement('div');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.hidden = true;
  const status = document.createElement('p');
  status.className = 'avatar-status form-message';
  status.setAttribute('role', 'status');
  root.append(actions, input, panel, status);
  host.append(root);

  function closePanel() {
    panel.replaceChildren();
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  }

  function showActions() {
    actions.replaceChildren(button('Đổi ảnh', 'secondary-button', () => input.click(), on));
    if (current.avatar) actions.append(button('Xóa ảnh', 'secondary-button', confirmDelete, on));
  }

  function confirmDelete() {
    closePanel();
    const box = document.createElement('div');
    box.className = 'avatar-confirm';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-labelledby', 'avatar-confirm-q');
    const q = document.createElement('p');
    q.id = 'avatar-confirm-q';
    q.textContent = 'Xóa ảnh đại diện?';
    const keep = button('Giữ lại', 'secondary-button', () => { closePanel(); actions.querySelector('button')?.focus(); }, on);
    const yes = button('Xóa', 'primary-button', async () => {
      yes.disabled = keep.disabled = true;
      status.textContent = 'Đang xóa ảnh…';
      try {
        const result = await apiRequest(`/api/profiles/${current.id}/avatar`, { method: 'DELETE', signal: on });
        if (on.aborted) return;
        current = result.profile;
        closePanel();
        showActions();
        status.textContent = 'Đã xóa ảnh.';
        onChange(current);
        actions.querySelector('button')?.focus();
      } catch (error) {
        if (on.aborted) return;
        status.textContent = error.status === 401 ? 'Phiên đã hết hạn. Hãy đăng nhập lại.' : 'Chưa xóa được ảnh. Thử lại nhé.';
        yes.disabled = keep.disabled = false;
      }
    }, on);
    const row = document.createElement('div');
    row.className = 'form-actions';
    row.append(yes, keep);
    box.append(q, row);
    panel.replaceChildren(box);
    keep.focus();
  }

  function showCutter(source) {
    closePanel();
    const { width, height } = source;
    let crop = initialCrop(width, height);
    const box = document.createElement('div');
    box.className = 'avatar-crop';
    const frame = document.createElement('div');
    frame.className = 'avatar-crop-frame';
    frame.tabIndex = 0;
    frame.setAttribute('role', 'group');
    frame.setAttribute('aria-label', 'Khung cắt ảnh. Kéo hoặc dùng phím mũi tên để dịch ảnh.');
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    frame.append(img);
    const zoom = document.createElement('input');
    zoom.type = 'range';
    zoom.min = String(AVATAR.minZoom);
    zoom.max = String(AVATAR.maxZoom);
    zoom.step = '0.01';
    zoom.value = '1';
    zoom.setAttribute('aria-label', 'Phóng to');
    const size = () => frame.clientWidth || 280;
    const draw = () => {
      const { sx, sy, side } = cropRect(width, height, crop), scale = size() / side;
      img.style.transform = `translate(${-sx * scale}px, ${-sy * scale}px) scale(${scale})`;
    };
    zoom.addEventListener('input', () => { crop = zoomTo(crop, width, height, Number(zoom.value)); draw(); }, { signal: on });
    let drag = null;
    frame.addEventListener('pointerdown', event => { drag = { x: event.clientX, y: event.clientY }; frame.setPointerCapture?.(event.pointerId); }, { signal: on });
    frame.addEventListener('pointermove', event => {
      if (!drag) return;
      crop = panBy(crop, width, height, event.clientX - drag.x, event.clientY - drag.y, size());
      drag = { x: event.clientX, y: event.clientY };
      draw();
    }, { signal: on });
    for (const type of ['pointerup', 'pointercancel']) frame.addEventListener(type, () => { drag = null; }, { signal: on });
    const KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    frame.addEventListener('keydown', event => {
      const step = KEYS[event.key];
      if (!step) return;
      event.preventDefault();
      crop = panBy(crop, width, height, step[0] * size() * 0.1, step[1] * size() * 0.1, size());
      draw();
    }, { signal: on });

    const cancel = button('Hủy', 'secondary-button', () => { closePanel(); status.textContent = ''; actions.querySelector('button')?.focus(); }, on);
    const save = button('Lưu ảnh', 'primary-button', async () => {
      save.disabled = cancel.disabled = true;
      status.textContent = 'Đang lưu ảnh…';
      try {
        const picture = await renderAvatar(source, crop);
        URL.revokeObjectURL(picture.previewUrl);
        if (on.aborted) return;
        const result = await apiRequest(`/api/profiles/${current.id}/avatar`, { method: 'PUT', body: { data: picture.data }, signal: on });
        if (on.aborted) return;
        current = result.profile;
        closePanel();
        showActions();
        status.textContent = 'Đã lưu ảnh.';
        onChange(current);
        actions.querySelector('button')?.focus();
      } catch (error) {
        if (on.aborted) return;
        status.textContent = saveError(error);
        save.disabled = cancel.disabled = false;
      }
    }, on);
    const row = document.createElement('div');
    row.className = 'form-actions';
    row.append(save, cancel);
    box.append(frame, zoom, row);
    panel.replaceChildren(box);
    source.toBlob(blob => {
      if (on.aborted || !blob || !box.isConnected) return;
      previewUrl = URL.createObjectURL(blob);
      img.src = previewUrl;
      img.style.width = `${width}px`;
      img.style.height = `${height}px`;
      draw();
      frame.focus();
    });
  }

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!TYPES.test(file.type)) { closePanel(); status.textContent = 'Chỉ nhận ảnh JPG, PNG hoặc WebP.'; return; }
    status.textContent = '';
    try {
      const source = await loadFile(file);
      if (!on.aborted) showCutter(source);
    } catch {
      if (!on.aborted) status.textContent = 'Chưa mở được ảnh này. Thử ảnh khác nhé.';
    }
  }, { signal: on });

  showActions();
  return () => {
    stop();
    signal.removeEventListener('abort', stop);
    closePanel();
    root.remove();
  };
}
