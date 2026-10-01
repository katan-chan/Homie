// Vercel build replaces this local default with PUBLIC_API_BASE_URL.
export const API_BASE_URL = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? `http://${location.hostname}:3001` : '';
