// Ảnh đại diện: a square cut from the picked picture, chosen by dragging and zooming, then drawn at 512×512 and
// compressed in the browser like Khoảnh khắc photos (the server only checks and stores it).
import { encodeUnder, encoder, toBase64 } from '../moments/image.js';

export const AVATAR = Object.freeze({ size: 512, maxBytes: 75_000, minZoom: 1, maxZoom: 4 });

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const sideOf = (width, height, zoom) => Math.min(width, height) / zoom;

/** The crop with its centre moved so the square stays inside a width×height picture. */
function inside(width, height, { zoom, cx, cy }) {
  const half = sideOf(width, height, zoom) / 2;
  return { zoom, cx: clamp(cx, half, width - half), cy: clamp(cy, half, height - half) };
}

export const initialCrop = (width, height) => ({ zoom: AVATAR.minZoom, cx: width / 2, cy: height / 2 });

/** Source square { sx, sy, side } in picture pixels for crop { zoom, cx, cy }. */
export function cropRect(width, height, crop) {
  const { zoom, cx, cy } = inside(width, height, crop);
  const side = sideOf(width, height, zoom);
  return { sx: cx - side / 2, sy: cy - side / 2, side };
}

/** Dragging the picture by (dx, dy) screen pixels on a viewport px wide circle moves the centre the other way. */
export function panBy(crop, width, height, dx, dy, viewport) {
  const scale = sideOf(width, height, crop.zoom) / viewport;
  return inside(width, height, { ...crop, cx: crop.cx - dx * scale, cy: crop.cy - dy * scale });
}

export const zoomTo = (crop, width, height, zoom) =>
  inside(width, height, { ...crop, zoom: clamp(zoom, AVATAR.minZoom, AVATAR.maxZoom) });

/** { data: base64, previewUrl } for PUT /api/profiles/:id/avatar; the caller revokes previewUrl. */
export async function renderAvatar(source, crop) {
  const width = source.width, height = source.height;
  const { sx, sy, side } = cropRect(width, height, crop);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AVATAR.size;
  canvas.getContext('2d').drawImage(source, sx, sy, side, side, 0, 0, AVATAR.size, AVATAR.size);
  const blob = await encodeUnder(encoder(canvas), AVATAR.maxBytes);
  return { data: await toBase64(blob), previewUrl: URL.createObjectURL(blob) };
}
