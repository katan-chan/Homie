// Vercel build replaces this local default with PUBLIC_API_BASE_URL.
export const API_BASE_URL = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? `http://${location.hostname}:3001` : '';
// Esri basemap key for the Vị trí map; the build fills it from PUBLIC_ESRI_BASEMAP_KEY. Empty: the map says it is not set up.
export const ESRI_BASEMAP_KEY = '';
