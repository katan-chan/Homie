import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export async function mediaBytes(format = 'png', { width = 16, height = 16, duration = .4, fps = 5 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'homie-media-input-')), path = join(dir, `fixture.${format}`);
  const args = ['-v', 'error', '-f', 'lavfi', '-i', `color=red@0.5:s=${width}x${height}:r=${fps}:d=${duration},format=rgba`, '-y'];
  if (format === 'png') args.push('-frames:v', '1');
  if (format === 'webm') args.push('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p');
  if (format === 'mp4') args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  args.push(path);
  try {
    await new Promise((resolve, reject) => { const p = spawn(process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg', args);let log='';p.stderr.on('data',c=>log+=c);p.on('error',reject);p.on('close',code=>code?reject(Error(log)):resolve()); });
    return await readFile(path);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
