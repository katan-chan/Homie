import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

// Frontend can deploy independently while the backend is not configured.
const apiBaseUrl = (process.env.PUBLIC_API_BASE_URL || (process.env.VERCEL ? '' : 'http://localhost:3001')).replace(/\/+$/, '');
const url = apiBaseUrl ? new URL(apiBaseUrl) : null;
if (url && (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/')) {
  throw new Error('PUBLIC_API_BASE_URL must be an HTTP(S) origin, e.g. https://your-backend.onrender.com');
}

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'styles.css', 'js', 'assets']) {
  await cp(path, `dist/${path}`, { recursive: true });
}
await writeFile('dist/js/config.js', `export const API_BASE_URL = ${JSON.stringify(apiBaseUrl)};\n`);
console.log('Frontend built in dist/');
