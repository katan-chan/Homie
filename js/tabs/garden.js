// The approved concept's compositor, scoped to this tab's lifetime.
export function render(container, { signal } = {}) {
  if (signal?.aborted) return () => {};

  container.innerHTML = `<section class="garden-page" aria-label="Khung cảnh vườn hoa với Loopy ngồi bên trái và Loopy ngủ bên phải">
    <canvas id="garden-canvas" aria-hidden="true"></canvas>
    <h1 class="garden-title"><span class="title-fallback">Vườn của chúng mình.</span><img class="title-lettering" alt="" aria-hidden="true" width="1536" height="1024" hidden></h1>
    <canvas id="garden-foreground" aria-hidden="true"></canvas>
    <div class="garden-status" role="status" aria-live="polite"><span></span><button type="button" hidden>Thử tải lại ảnh</button></div>
  </section>`;

  const canvas = container.querySelector('#garden-canvas');
  const foreground = container.querySelector('#garden-foreground');
  const lettering = container.querySelector('.title-lettering');
  const titleText = container.querySelector('.garden-title span');
  const status = container.querySelector('.garden-status');
  const statusText = container.querySelector('.garden-status span');
  const retry = container.querySelector('.garden-status button');
  const assets = [
    { path: 'flowers/handdrawn-meadow.webp', label: 'hoa thấp' },
    { path: 'flowers/handdrawn-spires.webp', label: 'hoa cao' },
    { path: 'characters/loopy-trio.webp', label: 'Loopy' },
    { path: 'typography/center-title.webp', label: 'tiêu đề' },
  ].map(asset => ({ ...asset, state: 'loading', image: null }));
  let disposed = false;
  let frame = null;

  function updateStatus() {
    if (disposed) return;
    const failed = assets.filter(asset => asset.state === 'error');
    const loading = assets.some(asset => asset.state === 'loading');
    if (!failed.length && document.activeElement === retry) container.focus();
    status.hidden = !failed.length && !loading;
    statusText.textContent = failed.length
      ? `Chưa tải được ảnh ${failed.map(asset => asset.label).join(', ')}.${loading ? ' Các ảnh khác đang tải…' : ''}`
      : 'Đang tải ảnh khu vườn…';
    retry.hidden = !failed.length;
  }

  function scheduleDraw() {
    if (disposed || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!disposed) drawGarden();
    });
  }

  function load(asset) {
    if (disposed) return;
    asset.state = 'loading';
    const image = new Image();
    asset.image = image;
    const settle = state => {
      if (disposed || asset.image !== image) return;
      image.onload = image.onerror = null;
      asset.state = state;
      if (asset === assets[3]) {
        lettering.hidden = state !== 'ready';
        titleText.className = state === 'ready' ? 'sr-only' : 'title-fallback';
        if (state === 'ready') lettering.src = image.src;
      }
      updateStatus();
      scheduleDraw();
    };
    image.onload = async () => {
      try {
        await image.decode();
        settle('ready');
      } catch {
        settle('error');
      }
    };
    image.onerror = () => settle('error');
    image.src = new URL(`../../assets/${asset.path}`, import.meta.url).href;
    updateStatus();
  }

  function drawGarden() {
    const { width: w, height: h } = canvas.getBoundingClientRect();
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    let c = canvas.getContext('2d');
    foreground.width = canvas.width;
    foreground.height = canvas.height;
    const front = foreground.getContext('2d');
    if (!c || !front) return;
    c.scale(dpr, dpr);
    front.scale(dpr, dpr);
    const meadow = assets[0].state === 'ready' ? assets[0].image : null;
    const spires = assets[1].state === 'ready' ? assets[1].image : null;
    const loopyTrio = assets[2].state === 'ready' ? assets[2].image : null;
    const draw = (image, x, bottom, height, alpha = 1, flip = false) => {
      if (!image?.naturalWidth) return;
      const width = height * image.naturalWidth / image.naturalHeight;
      c.globalAlpha = alpha;
      c.save();
      c.translate(x + (flip ? width : 0), bottom - height);
      c.scale(flip ? -1 : 1, 1);
      c.drawImage(image, 0, 0, width, height);
      c.restore();
      c.globalAlpha = 1;
    };
    const mobile = w < 600;
    const bed = (height, baseline, alpha) => {
      if (!meadow?.naturalWidth) return;
      const width = height * meadow.naturalWidth / meadow.naturalHeight;
      const count = Math.max(2, Math.ceil(w / (width * .78 * .62)));
      const step = w / count;
      for (let i = -1; i <= count; i++) {
        const t = (i + .5) / count;
        const taper = 1 - .22 * Math.max(0, Math.min(1, t));
        const localHeight = height * taper;
        const localWidth = width * taper;
        const curve = .025 * Math.sin(Math.PI * (t + .12));
        draw(meadow, (i + .5) * step - localWidth / 2, h * (baseline + curve), localHeight, alpha);
      }
    };
    c.filter = 'blur(.7px)';
    bed(h * (mobile ? .42 : .50), mobile ? .89 : .92, .44);
    c.filter = 'none';
    const sideHeight = h * (mobile ? .74 : .92);
    const sideWidth = sideHeight * 2 / 3;
    const sideVisible = mobile ? w * .18 : Math.min(w * .20, 290);
    const poses = mobile ? [[.22, .63, .13], [.83, .89, .12]] : [[.19, .70, .18], [.82, .92, .19]];
    const figure = i => {
      if (!loopyTrio?.naturalWidth) return;
      const [x, bottom, scale] = poses[i];
      const frames = [[0, 1 / 3], [.603333, .396667]];
      const [offset, fraction] = frames[i];
      const sw = loopyTrio.naturalWidth * fraction;
      const sh = loopyTrio.naturalHeight;
      const height = mobile ? Math.min(h * scale, w * .25) : h * scale;
      const width = height * sw / sh;
      const left = w * x - width / 2;
      const top = h * bottom - height;
      c.save();
      c.filter = 'blur(3px)';
      c.fillStyle = '#3f604020';
      c.beginPath();
      c.ellipse(w * x, h * bottom - 4, width * .30, Math.max(3, height * .025), 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
      c.drawImage(loopyTrio, offset * loopyTrio.naturalWidth, 0, sw, sh, left, top, width, height);
    };
    figure(0);
    draw(spires, sideVisible - sideWidth, h * 1.02, sideHeight, 1, true);
    draw(spires, w - sideVisible * .80, h * 1.05, sideHeight * .68);
    bed(h * (mobile ? .48 : .63), mobile ? 1.02 : 1.07, .94);
    c = front;
    bed(h * (mobile ? .24 : .32), mobile ? 1.08 : 1.10, 1);
    figure(1);
  }

  function retryFailed() {
    assets.filter(asset => asset.state === 'error').forEach(load);
  }

  const observer = new ResizeObserver(scheduleDraw);
  function cleanup() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    assets.forEach(asset => {
      if (asset.image) asset.image.onload = asset.image.onerror = null;
    });
    retry.removeEventListener('click', retryFailed);
    signal?.removeEventListener('abort', cleanup);
  }

  observer.observe(canvas);
  retry.addEventListener('click', retryFailed);
  signal?.addEventListener('abort', cleanup, { once: true });
  assets.forEach(load);
  scheduleDraw();
  return cleanup;
}
