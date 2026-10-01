export const tabs = [
  {
    id: 'garden',
    label: 'Vườn hoa',
    enabled: true,
    load: () => import('./tabs/garden.js'),
  },
  {
    id: 'dashboard',
    label: 'Góc ghi chép',
    enabled: true,
    load: () => import('./tabs/dashboard.js'),
  },
];
