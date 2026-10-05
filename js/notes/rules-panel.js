// Stub owned by part E. The dashboard mounts this in place of the board surface for the "Nội quy" tab.
export function mountRulesPanel(container, { signal }) {
  if (signal.aborted) return () => {};
  const section = document.createElement('section');
  section.className = 'route-status';
  const status = document.createElement('p');
  status.textContent = 'Nội quy: đang làm';
  section.append(status);
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
