// Downloads: a normal file download in browsers; inside the Android app the WebView cannot download a blob, so the
// in-app MomentSaver plugin (android/app/.../MomentSaverPlugin.java) writes the photo into Pictures/Homie.
import { toBase64 } from './image.js';

const two = n => String(n).padStart(2, '0');
export const fileName = (date = new Date()) =>
  `homie-${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}.jpg`;

/** Saves the JPEG blob. Resolves 'gallery' inside the Android app, 'downloaded' in a browser. */
export async function saveImage(blob, name = fileName()) {
  const capacitor = globalThis.Capacitor;
  if (capacitor?.isNativePlatform?.()) {
    const saver = capacitor.Plugins?.MomentSaver ?? capacitor.registerPlugin?.('MomentSaver');
    await saver.save({ data: await toBase64(blob), fileName: name });
    return 'gallery';
  }
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
