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
    load: () => import('./tabs/dashboard.js'),
  },
  { id: 'jar', label: 'Hũ', enabled: true, requiresAuth: true, load: () => import('./tabs/jar.js') },
  { id: 'calendar', label: 'Lịch', enabled: true, requiresAuth: true, load: () => import('./tabs/calendar.js') },
  { id: 'seminar', label: 'Gợi ý chủ đề seminar', enabled: true, requiresAuth: true, load: () => import('./tabs/seminar.js') },
  { id: 'activity', label: 'Hoạt động chung', enabled: true, requiresAuth: true, load: () => import('./tabs/activity.js') },
  { id: 'minhle', label: 'Minh Lê', enabled: true, load: () => import('./tabs/minhle.js') },
  { id: 'haiyen', label: 'Hải Yến', enabled: true, load: () => import('./tabs/haiyen.js') },
];
