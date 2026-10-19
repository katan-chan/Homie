// Photos are shrunk and encoded in the browser so the server only checks and stores them: WebP (JPEG where the
// browser cannot write WebP) at the highest quality that fits each byte target. Redrawing through a canvas also drops
// EXIF, GPS included.
export const TARGETS = { snap: 150_000, upload: 250_000, booth: 300_000, thumb: 30_000 };
export const SIZES = { snap: 1080, upload: 1440, thumb: 320, frame: { width: 800, height: 600 } };

const PAD = 24, GAP = 16, FOOT = 110;
const PAPER = '#fffaf5', INK = '#985a74', SOFT = '#b48a9b', HAND = '"Patrick Hand", "Comic Sans MS", cursive';

/** Frame rectangles of a photobooth strip; a grid needs 4 frames and one frame is always a column. */
export function stripGeometry(count, layout) {
  const shape = count === 1 || (layout === 'grid' && count !== 4) ? 'column' : layout;
  const cols = shape === 'row' ? count : shape === 'grid' ? 2 : 1, rows = Math.ceil(count / cols);
  const w = shape === 'column' ? 552 : 400, h = w * 3 / 4;
  const frames = Array.from({ length: count }, (_, i) => ({ x: PAD + (i % cols) * (w + GAP), y: PAD + Math.floor(i / cols) * (h + GAP), w, h }));
  const footY = PAD + rows * h + (rows - 1) * GAP;
  return { width: PAD * 2 + cols * w + (cols - 1) * GAP, height: footY + FOOT, frames, footY };
}

export function fitSize(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * encode(type, quality) -> Blob. Tries WebP at 0.82, falls back to JPEG when the result is not WebP, then searches
 * quality in [0.6, 0.82] for the best blob under maxBytes; at most 6 encodes. Nothing fits: the 0.6 blob.
 */
export async function encodeUnder(encode, maxBytes) {
  let type = 'image/webp', tries = 1;
  let first = await encode(type, 0.82);
  if (first.type !== type) { type = 'image/jpeg'; first = await encode(type, 0.82); tries++; }
  if (first.size <= maxBytes) return first;
  let low = 0.6, high = 0.82, fit = await encode(type, low);
  tries++;
  if (fit.size > maxBytes) return fit;
  while (tries < 6) {
    const middle = (low + high) / 2, candidate = await encode(type, middle);
    tries++;
    if (candidate.size <= maxBytes) { fit = candidate; low = middle; } else high = middle;
  }
  return fit;
}

const sizeOf = source => ({ width: source.videoWidth || source.naturalWidth || source.width, height: source.videoHeight || source.naturalHeight || source.height });

/** Draws source into a width×height canvas, cropping the centre to that shape; mirror flips it like the preview. */
export function toCanvas(source, width, height, { mirror = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'), size = sizeOf(source);
  const scale = Math.max(width / size.width, height / size.height);
  const sw = width / scale, sh = height / scale;
  if (mirror) { ctx.translate(width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, (size.width - sw) / 2, (size.height - sh) / 2, sw, sh, 0, 0, width, height);
  return canvas;
}

async function handFont() { try { await document.fonts.load(`40px ${HAND}`); } catch {} }
const two = n => String(n).padStart(2, '0');

/** Paper strip with the frames, the date and "Homie" in the foot. The caption is never drawn here. */
export async function composeStrip(frames, layout, date) {
  await handFont();
  const g = stripGeometry(frames.length, layout);
  const canvas = document.createElement('canvas');
  canvas.width = g.width; canvas.height = g.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, g.width, g.height);
  frames.forEach((frame, i) => { const f = g.frames[i]; ctx.drawImage(toCanvas(frame, f.w, f.h), f.x, f.y); });
  ctx.textAlign = 'center';
  ctx.fillStyle = INK; ctx.font = `40px ${HAND}`;
  ctx.fillText(`${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()}`, g.width / 2, g.footY + FOOT / 2 + 4);
  ctx.fillStyle = SOFT; ctx.font = `22px ${HAND}`;
  ctx.fillText('Homie', g.width / 2, g.height - 22);
  return canvas;
}

const encoder = canvas => (type, quality) => new Promise((resolve, reject) =>
  canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('encode'))), type, quality));

export async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Encodes a finished canvas for POST /api/moments: { photo: { data }, thumb: { data }, previewUrl } (revoke previewUrl). */
export async function prepare(canvas, kind) {
  const photo = await encodeUnder(encoder(canvas), TARGETS[kind]);
  const small = fitSize(canvas.width, canvas.height, SIZES.thumb);
  const thumb = await encodeUnder(encoder(toCanvas(canvas, small.width, small.height)), TARGETS.thumb);
  return { photo: { data: await toBase64(photo) }, thumb: { data: await toBase64(thumb) }, previewUrl: URL.createObjectURL(photo) };
}

function lines(ctx, text, maxWidth) {
  const out = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) { out.push(line); line = word; } else line = next;
  }
  return [...out, line];
}

/** The image (a Blob) as a JPEG with the caption drawn as a dark pill near the bottom, for downloads. */
export async function withCaption(source, caption) {
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  if (caption) {
    await handFont();
    const size = Math.max(18, Math.round(Math.min(canvas.width, canvas.height) * 0.05)), pad = size * 0.6;
    ctx.font = `${size}px ${HAND}`;
    const rows = lines(ctx, caption, canvas.width - size * 3), lineHeight = size * 1.25;
    const width = Math.max(...rows.map(row => ctx.measureText(row).width)) + pad * 2.4, height = rows.length * lineHeight + pad;
    const x = (canvas.width - width) / 2, y = canvas.height - height - size * 0.6;
    ctx.fillStyle = 'rgba(59, 42, 51, 0.7)';
    ctx.beginPath(); ctx.roundRect(x, y, width, height, Math.min(height / 2, size)); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    rows.forEach((row, i) => ctx.fillText(row, canvas.width / 2, y + pad / 2 + lineHeight * (i + 0.5)));
  }
  return encoder(canvas)('image/jpeg', 0.9);
}

/** A picked file as an upright canvas, long side ≤ 1440. Throws Error('unsupported') for anything but JPEG/PNG/WebP. */
export async function loadFile(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file?.type ?? '')) throw new Error('unsupported');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const size = fitSize(bitmap.width, bitmap.height, SIZES.upload);
  return toCanvas(bitmap, size.width, size.height);
}
