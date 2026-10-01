export const tabs = [
  {
    id: 'garden',
    background: { showCharacters: true },
    label: 'Vườn hoa',
    enabled: true,
    load: () => import('./tabs/garden.js'),
  },
  {
    id: 'dashboard',
    label: 'Góc ghi chép',
    enabled: true,
    requiresAuth: true,
    load: () => import('./tabs/dashboard.js'),
  },
  { id: 'minhle', label: 'Minh Lê', enabled: true, load: () => import('./tabs/minhle.js') },
  { id: 'haiyen', label: 'Hải Yến', enabled: true, load: () => import('./tabs/haiyen.js') },
];
