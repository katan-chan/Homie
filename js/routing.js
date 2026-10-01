export function resolveTab(tabs, hash) {
  const active = tabs.filter((tab) => tab.enabled);
  const id = hash.replace(/^#/, '');
  return active.find((tab) => tab.id === id)
    ?? active.find((tab) => tab.id === 'garden')
    ?? active[0]
    ?? null;
}
