// Taking a moment: the desktop photobooth (1–4 frames, column/row/grid strip) or the phone's square camera, plus a
// photo picked from the device; then the review with one line of text, Lưu, Chụp lại and Tải về.
// The camera runs only while its preview is on screen: it stops for the review, when the page hides and on destroy.
import { SIZES, composeStrip, loadFile, prepare, toCanvas, withCaption } from './image.js';

const MAX_CAPTION = 40;
const LAYOUTS = [['column', 'Dọc'], ['row', 'Ngang'], ['grid', 'Lưới 2×2']];
const PREFS = 'homie.moments.booth';
const calm = matchMedia('(prefers-reduced-motion: reduce)');

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function button(text, className = 'moments-btn', onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

function readPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS));
    if ([1, 2, 3, 4].includes(saved?.frames) && LAYOUTS.some(([key]) => key === saved?.layout)) return saved;
  } catch {}
  return { frames: 4, layout: 'column' };
}
const fits = (frames, layout) => (frames === 1 ? layout === 'column' : layout !== 'grid' || frames === 4);

/**
 * Mounts into host. onSave(body) -> Promise (POST /api/moments body without requestId handling), onDownload(blob),
 * toast(text, { error }). Returns { destroy }.
 */
export function createCapture({ host, desktop, onSave, onDownload, toast }) {
  let stream = null, facing = 'user', noCamera = false, destroyed = false, run = 0, shooting = null, review = null, opening = 0;
  let prefs = readPrefs();
  const timers = new Set();
  const video = el('video');
  video.muted = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.setAttribute('aria-label', 'Khung camera');
  const picker = el('input');
  picker.type = 'file'; picker.accept = 'image/jpeg,image/png,image/webp'; picker.hidden = true;
  picker.addEventListener('change', () => { const file = picker.files[0]; picker.value = ''; if (file) pickFile(file); });
  const flash = el('div', 'moments-flash');

  const wait = ms => new Promise(resolve => { const id = setTimeout(() => { timers.delete(id); resolve(); }, ms); timers.add(id); });
  const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch {} };

  function stopCamera() {
    opening++;
    stream?.getTracks().forEach(track => track.stop());
    stream = null; video.srcObject = null;
  }
  async function startCamera() {
    stopCamera();
    const ticket = opening;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('No camera', 'NotFoundError');
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      if (destroyed || ticket !== opening || review || document.hidden) { next.getTracks().forEach(track => track.stop()); return; }
      stream = next; noCamera = false;
      video.srcObject = stream;
      video.play().catch(() => {});
    } catch {
      if (destroyed || ticket !== opening) return;
      noCamera = true;
    }
    render();
  }
  const frameReady = () => video.readyState >= 2 && video.videoWidth > 0;
  function doFlash() {
    if (calm.matches) return;
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
  }

  async function shoot() {
    if (!frameReady()) return;
    const ticket = ++run, frames = [];
    shooting = { n: 1, count: 3, shots: [] };
    render();
    for (let n = 1; n <= prefs.frames; n++) {
      for (let count = 3; count > 0; count--) {
        if (ticket !== run || destroyed) return;
        Object.assign(shooting, { n, count }); render();
        await wait(1000);
      }
      if (ticket !== run || destroyed || !frameReady()) { shooting = null; render(); return; }
      const frame = toCanvas(video, SIZES.frame.width, SIZES.frame.height, { mirror: true });
      frames.push(frame);
      shooting.shots.push(frame.toDataURL('image/jpeg', 0.7));
      shooting.count = 0; render(); doFlash();
      await wait(350);
    }
    if (ticket !== run || destroyed) return;
    const strip = await composeStrip(frames, prefs.layout, new Date());
    shooting = null;
    openReview(strip, 'booth');
  }
  function snap() {
    if (!frameReady()) return;
    doFlash();
    openReview(toCanvas(video, SIZES.snap, SIZES.snap, { mirror: facing === 'user' }), 'snap');
  }
  async function pickFile(file) {
    try { openReview(await loadFile(file), 'upload'); }
    catch (error) { toast(error.message === 'unsupported' ? 'Chỉ chọn được ảnh JPG, PNG hoặc WebP.' : 'Không mở được ảnh này.', { error: true }); }
  }

  function openReview(canvas, kind) {
    if (destroyed) return;
    run++; shooting = null;
    stopCamera();
    review = { canvas, kind, caption: '', requestId: crypto.randomUUID(), saving: false, failed: false, prepared: prepare(canvas, kind) };
    review.prepared.catch(() => {});
    render();
    host.querySelector('#moments-caption')?.focus();
  }
  async function closeReview(restart = true) {
    const old = review;
    review = null;
    old?.prepared.then(p => URL.revokeObjectURL(p.previewUrl), () => {});
    render();
    if (restart && !destroyed) await startCamera();
  }
  async function save() {
    if (!review || review.saving) return;
    const current = review;
    current.saving = true; current.failed = false; render();
    try {
      const prepared = await current.prepared;
      await onSave({ requestId: current.requestId, kind: current.kind, caption: current.caption, photo: prepared.photo, thumb: prepared.thumb });
      if (review !== current) return;
      toast('Đã lưu. Ảnh hiện trong Lịch hôm nay.');
      await closeReview();
    } catch {
      if (review !== current) return;
      current.saving = false; current.failed = true; render();
    }
  }
  async function download() {
    if (!review) return;
    try {
      const prepared = await review.prepared;
      const blob = await withCaption(await (await fetch(prepared.previewUrl)).blob(), review.caption.trim());
      await onDownload(blob);
    } catch { toast('Không tải được ảnh. Thử lại nhé.', { error: true }); }
  }
  function again() {
    const kind = review?.kind;
    closeReview(kind !== 'upload');
    if (kind === 'upload') picker.click();
  }

  /* ---------- DOM ---------- */
  function seg(label, options, current, onPick, disabled = () => false) {
    const group = el('div', 'moments-seg');
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
    for (const [value, text] of options) {
      const b = button(text, '', () => onPick(value));
      b.setAttribute('aria-pressed', String(value === current));
      b.disabled = disabled(value);
      group.append(b);
    }
    return group;
  }
  function noCameraCard(phone) {
    const card = el('div', 'moments-nocam');
    card.append(el('p', 'moments-strong', 'Không mở được camera.'),
      el('p', '', phone ? 'Cho phép Homie dùng camera trong Cài đặt của máy, hoặc chọn ảnh có sẵn.' : 'Cho phép Homie dùng camera trong cài đặt trình duyệt, hoặc chọn ảnh có sẵn trong máy.'));
    const row = el('div', 'moments-row');
    row.append(button('Thử lại camera', 'moments-btn', startCamera));
    if (!phone) row.append(button('Chọn ảnh từ máy', 'moments-btn', () => picker.click()));
    card.append(row);
    return card;
  }
  function captionInput(className) {
    const input = el('input', className);
    input.id = 'moments-caption'; input.maxLength = MAX_CAPTION; input.value = review.caption;
    input.placeholder = desktop ? 'Hôm nay vui ghê' : 'Thêm một dòng chữ…'; input.autocomplete = 'off';
    input.disabled = review.saving;
    input.addEventListener('input', () => {
      review.caption = input.value;
      const counter = host.querySelector('.moments-counter'), preview = host.querySelector('.moments-review .moments-cap');
      if (counter) counter.textContent = `${[...input.value].length}/${MAX_CAPTION}`;
      if (preview) { preview.textContent = input.value; preview.hidden = !input.value; }
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') save(); });
    return input;
  }
  const counter = () => el('span', 'moments-counter', `${[...review.caption].length}/${MAX_CAPTION}`);
  function status() {
    if (review.failed) { const line = el('p', 'moments-error', 'Chưa lưu được. Ảnh và dòng chữ vẫn còn đây, bấm Thử lại khi có mạng.'); line.setAttribute('role', 'alert'); return line; }
    if (review.saving) { const line = el('p', 'moments-hint', 'Đang lưu…'); line.setAttribute('role', 'status'); return line; }
    return null;
  }

  function desktopView() {
    const wrap = el('section', 'moments-booth');
    wrap.setAttribute('aria-label', 'Photobooth');
    const stage = el('div', 'moments-stage'), side = el('div', 'moments-side');
    if (noCamera) stage.append(noCameraCard(false));
    else {
      const cam = el('div', 'moments-cam');
      cam.append(video, flash);
      video.classList.add('moments-mirror');
      if (shooting) {
        cam.append(el('span', 'moments-shotno', `Tấm ${shooting.n}/${prefs.frames}`));
        const count = el('div', 'moments-countdown', shooting.count ? String(shooting.count) : '');
        count.setAttribute('aria-live', 'assertive');
        cam.append(count);
      }
      stage.append(cam);
    }
    const row = el('div', 'moments-row');
    if (shooting) {
      row.append(button('Hủy', 'moments-btn', () => { run++; shooting = null; render(); }), el('span', 'moments-hint', `Nhìn vào camera nhé, chụp ${prefs.frames} tấm liền.`));
    } else if (!noCamera) {
      const locked = Boolean(review);
      row.append(
        seg('Số tấm trong dải', [1, 2, 3, 4].map(n => [n, `${n} tấm`]), prefs.frames, n => {
          prefs = { frames: n, layout: fits(n, prefs.layout) ? prefs.layout : 'column' }; savePrefs(); render();
        }, () => locked),
        seg('Bố cục', LAYOUTS, prefs.layout, layout => { prefs = { ...prefs, layout }; savePrefs(); render(); }, layout => locked || prefs.frames === 1 || !fits(prefs.frames, layout)),
      );
      const go = button(`● Chụp ${prefs.frames} tấm`, 'moments-btn primary', shoot);
      go.disabled = locked;
      const pick = button('Chọn ảnh từ máy', 'moments-btn', () => picker.click());
      pick.disabled = locked;
      row.append(go, pick);
    }
    stage.append(row);

    if (review) {
      side.classList.add('moments-review');
      side.append(el('h2', '', review.kind === 'booth' ? 'Dải ảnh của hai đứa' : 'Ảnh từ máy'));
      const pic = el('div', 'moments-pic');
      const cap = el('span', 'moments-cap', review.caption);
      cap.hidden = !review.caption;
      review.canvas.classList.add('moments-review-img');
      review.canvas.setAttribute('role', 'img'); review.canvas.setAttribute('aria-label', 'Ảnh vừa chụp');
      pic.append(review.canvas, cap);
      const field = el('div', 'moments-field'), label = el('label', '', 'Một dòng chữ (không bắt buộc)');
      label.htmlFor = 'moments-caption';
      field.append(label, captionInput(''), counter());
      const actions = el('div', 'moments-row center');
      const saveBtn = button(review.failed ? 'Thử lại' : 'Lưu', 'moments-btn primary', save);
      const againBtn = button(review.kind === 'upload' ? 'Chọn ảnh khác' : 'Chụp lại', 'moments-btn', again);
      saveBtn.disabled = againBtn.disabled = review.saving;
      actions.append(saveBtn, againBtn, button('Tải về', 'moments-btn', download));
      side.append(pic, field, ...[status()].filter(Boolean), actions);
    } else {
      side.append(el('h2', '', prefs.frames === 1 ? 'Ảnh' : `Dải ảnh · ${LAYOUTS.find(([key]) => key === prefs.layout)[1]}`));
      const ph = el('div', 'moments-strip-ph');
      const cols = prefs.layout === 'row' ? prefs.frames : prefs.layout === 'grid' ? 2 : 1;
      ph.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      ph.style.width = cols === 1 ? '150px' : `${Math.min(100, cols * 30)}%`;
      for (let i = 0; i < prefs.frames; i++) {
        const slot = el('div');
        const shot = shooting?.shots[i];
        if (shot) { const img = el('img'); img.src = shot; img.alt = `Tấm ${i + 1}`; slot.append(img); }
        ph.append(slot);
      }
      side.append(ph, el('p', 'moments-hint', 'Chọn số tấm, rồi bấm Chụp: đếm 3‑2‑1 trước mỗi tấm.'));
    }
    wrap.append(stage, side);
    return wrap;
  }

  function round(text, label, onClick, disabled = false) {
    const cell = el('div', 'moments-cell');
    const b = button(text, 'moments-round', onClick);
    b.setAttribute('aria-label', label); b.disabled = disabled;
    cell.append(b, el('span', 'moments-lbl', label));
    return cell;
  }
  function phoneView() {
    const wrap = el('section', 'moments-snap');
    wrap.setAttribute('aria-label', 'Chụp nhanh');
    const finder = el('div', 'moments-finder');
    const controls = el('div', 'moments-pctl');
    if (review) {
      finder.classList.add('moments-review');
      review.canvas.setAttribute('role', 'img'); review.canvas.setAttribute('aria-label', 'Ảnh vừa chụp');
      review.canvas.classList.add('moments-review-img');
      const pill = el('div', 'moments-capin');
      const input = captionInput('');
      input.setAttribute('aria-label', 'Một dòng chữ');
      pill.append(input, counter());
      finder.append(review.canvas, pill);
      const saveCell = el('div', 'moments-cell');
      const saveBtn = button('✓', 'moments-savebtn', save);
      saveBtn.setAttribute('aria-label', review.failed ? 'Thử lại' : 'Lưu'); saveBtn.disabled = review.saving;
      saveCell.append(saveBtn, el('span', 'moments-lbl', review.failed ? 'Thử lại' : 'Lưu'));
      controls.append(round('↺', review.kind === 'upload' ? 'Chọn lại' : 'Chụp lại', again, review.saving), saveCell, round('⤓', 'Tải về', download));
      wrap.append(finder, ...[status()].filter(Boolean), controls);
    } else {
      if (noCamera) finder.append(noCameraCard(true));
      else {
        video.classList.toggle('moments-mirror', facing === 'user');
        finder.append(video, flash);
      }
      const shutter = button('', 'moments-shutter', snap);
      shutter.setAttribute('aria-label', 'Chụp'); shutter.disabled = noCamera;
      controls.append(round('🖼', 'Chọn ảnh', () => picker.click()), shutter,
        round('⟲', 'Đổi camera', () => { facing = facing === 'user' ? 'environment' : 'user'; startCamera(); }, noCamera));
      wrap.append(finder, controls);
    }
    return wrap;
  }

  function render() {
    if (destroyed) return;
    const focused = document.activeElement?.id === 'moments-caption';
    host.replaceChildren(desktop ? desktopView() : phoneView(), picker);
    if (focused) host.querySelector('#moments-caption')?.focus();
  }

  const onVisibility = () => { if (document.hidden) { run++; shooting = null; stopCamera(); render(); } else if (!review) startCamera(); };
  document.addEventListener('visibilitychange', onVisibility);
  render();
  startCamera();

  return {
    destroy() {
      destroyed = true; run++;
      for (const id of timers) clearTimeout(id);
      document.removeEventListener('visibilitychange', onVisibility);
      stopCamera();
      review?.prepared.then(p => URL.revokeObjectURL(p.previewUrl), () => {});
      host.replaceChildren();
    },
  };
}
