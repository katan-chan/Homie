// Stub owned by part C; replace with the real page, keeping the tab contract.
export function render(container, { signal }) {
  if (signal.aborted) return () => {};
  const section = document.createElement('section');
  section.className = 'route-status';
  const title = document.createElement('h1');
  title.textContent = 'Gợi ý chủ đề seminar';
  const status = document.createElement('p');
  status.textContent = 'Đang làm';
  section.append(title, status);
  container.replaceChildren(section);

  let disposed = false;
  function cleanup() {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', cleanup);
    section.remove();
  }
  signal.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}
