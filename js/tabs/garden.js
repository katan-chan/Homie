// The garden tab owns lettering only; the shell owns the landscape.
export function render(container, { signal } = {}) {
  if (signal?.aborted) return () => {};
  const section = document.createElement('section');
  section.className = 'garden-content';
  section.innerHTML = `<h1 class="garden-title"><span class="title-fallback">Vườn của chúng mình.</span><img class="title-lettering" alt="" aria-hidden="true" width="1536" height="1024" hidden></h1><div class="garden-status title-status" role="status" hidden><span>Chưa tải được chữ trang trí.</span><button type="button">Thử tải lại chữ</button></div>`;
  container.replaceChildren(section);
  const image = section.querySelector('img');
  const text = section.querySelector('h1 span');
  const status = section.querySelector('.title-status');
  const retry = status.querySelector('button');
  let disposed = false;
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
  function cleanup() {
    if (disposed) return;
    disposed = true;
    image.onload = image.onerror = null;
    signal?.removeEventListener('abort', cleanup);
    section.remove();
  }
  signal?.addEventListener('abort', cleanup, { once: true });
  load();
  return cleanup;
}
