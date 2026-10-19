// Type and pixel size read from the file's own bytes, so an upload is judged by what it is, not by what the client says.
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpeg(b) {
  let i = 2;
  while (i + 9 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (SOF.has(marker)) return { mime: 'image/jpeg', width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

function webp(b) {
  const tag = b.toString('latin1', 12, 16);
  if (tag === 'VP8 ' && b.length >= 30) return { mime: 'image/webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (tag === 'VP8L' && b.length >= 25) {
    const bits = b.readUInt32LE(21);
    return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (tag === 'VP8X' && b.length >= 30) return { mime: 'image/webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  return null;
}

/** { mime: 'image/webp'|'image/jpeg', width, height } from the header, or null for anything else or a cut-off header. */
export function imageInfo(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return jpeg(buffer);
  if (buffer.length >= 16 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return webp(buffer);
  return null;
}
