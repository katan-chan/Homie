import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rm, copyFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { notesError, requireAccount, requireId, requireKeys } from '../js/notes/model.js';

export const MEDIA_LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, side: 4096, pixels: 16000000, seconds: 30, fps: 60, frames: 256, jobs: 2, timeout: 30000, previewTTL: 300000, previews: 16 });
// Browsers report both .jpg and .jpeg as image/jpeg.
const types = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'video/webm': 'webm', 'video/mp4': 'mp4' };
export function validateMediaMetadata(value) {
  requireKeys(value, ['accountId','operationId','hash','name','mimeType'], ['spritesheet','previewId','preview']);
  requireAccount(value.accountId); requireId(value.operationId);
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 || /[\\/\x00-\x1f]/.test(value.name)
    || !Object.hasOwn(types,value.mimeType) || !/^[a-f0-9]{64}$/.test(value.hash)) throw notesError('invalid_media');
  if (value.previewId !== undefined) requireId(value.previewId);
  if (value.preview !== undefined && typeof value.preview !== 'boolean') throw notesError('invalid_media');
  if (value.spritesheet !== undefined) {
    requireKeys(value.spritesheet,['frameWidth','frameHeight','frames','fps']);
    const s=value.spritesheet;
    if(value.mimeType!=='image/png' || !Object.values(s).every(Number.isSafeInteger) || s.frameWidth<1 || s.frameHeight<1 || s.frames<1 || s.frames>MEDIA_LIMITS.frames || s.fps<1 || s.fps>MEDIA_LIMITS.fps || s.frames/s.fps>MEDIA_LIMITS.seconds)throw notesError('invalid_spritesheet');
  }
  return { ...value, name:value.name.trim() };
}
function identity(meta) { return { accountId:meta.accountId,hash:meta.hash,name:meta.name,mimeType:meta.mimeType,...(meta.spritesheet?{spritesheet:meta.spritesheet}:{}) }; }
const binding = meta => JSON.stringify(identity(meta));
export function assetView(asset, prefix=`/api/note-assets/${asset.id}`) {
  const { fileName,posterName,...publicFields }=asset;
  return { ...publicFields,fileUrl:`${prefix}/file`,posterUrl:`${prefix}/poster` };
}
function run(binary,args,signal) {
  return new Promise((resolve,reject)=>{
    if(signal.aborted)return reject(signal.reason);
    const process=spawn(binary,args,{stdio:['ignore','pipe','pipe']});let output='',error='',size=0,failed;
    const cancel=()=>{failed=signal.reason;process.kill('SIGKILL');};signal.addEventListener('abort',cancel,{once:true});
    process.stdout.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){failed=notesError('invalid_media');process.kill('SIGKILL');}else output+=chunk;});
    process.stderr.on('data',chunk=>{if(error.length<4096)error+=chunk;});
    process.on('error',()=>{failed=notesError('media_unavailable','Media converter is unavailable',503);});
    process.on('close',code=>{signal.removeEventListener('abort',cancel);failed?reject(failed):code?reject(notesError('invalid_media','Cannot decode this media')):resolve(output);});
  });
}
async function syncFile(path) {const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}

/** Files and stages stay outside the web root. The existing notes store alone owns durable metadata/receipts. */
export function createNoteMedia({dataDir,store,remote=null,ffmpegPath=process.env.FFMPEG_PATH || 'ffmpeg',ffprobePath=process.env.FFPROBE_PATH || 'ffprobe'}) {
  const files=join(dataDir,'note-media'),temporary=join(dataDir,'note-media-tmp'),stages=new Map(),controllers=new Set(),publishing=new Map();
  let active=0,closed=false;const waiters=[],jobs=new Set();
  const ready=(async()=>{if(!remote)await mkdir(files,{recursive:true});await rm(temporary,{recursive:true,force:true});await mkdir(temporary,{recursive:true});})();ready.catch(()=>{});
  async function prune() {for(const [id,s] of stages)if(s.expiresAt<=Date.now()){stages.delete(id);await rm(s.dir,{recursive:true,force:true});}}
  const timer=setInterval(()=>prune().catch(()=>{}),30000);timer.unref();
  async function slot(signal) {
    if(active<MEDIA_LIMITS.jobs){active++;return;}
    if(waiters.length>=8)throw notesError('media_busy','Media queue is full',429);
    await new Promise((resolve,reject)=>{const entry={resolve,reject,signal};const abort=()=>{const i=waiters.indexOf(entry);if(i>=0)waiters.splice(i,1);reject(signal.reason);};entry.abort=abort;signal.addEventListener('abort',abort,{once:true});waiters.push(entry);});
  }
  function release() {const next=waiters.shift();if(next){next.signal.removeEventListener('abort',next.abort);next.resolve();}else active--;}
  async function ingest({stream,metadata,signal,sessionToken,authorize=()=>{}}) {
    const meta=validateMediaMetadata(metadata);
    if(closed)throw notesError('store_closed','Media is closed',503);
    if(!sessionToken)throw notesError('unauthorized','Authentication required',401);
    const controller=new AbortController(),abort=()=>controller.abort(signal.reason ?? notesError('media_aborted'));
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    controllers.add(controller);let dir,retained=false,acquired=false;
    const timeout=setTimeout(()=>controller.abort(notesError('media_timeout','Media processing timed out',408)),MEDIA_LIMITS.timeout);timeout.unref();
    const fence=()=>{controller.signal.throwIfAborted();if(closed)throw notesError('store_closed','Media is closed',503);};
    try {
      await ready;fence();await slot(controller.signal);acquired=true;fence();await prune();await authorize();
      dir=await mkdtemp(join(temporary,'job-'));const source=join(dir,'source'),handle=await open(source,'wx');let bytes=0;const hash=createHash('sha256');
      const stop=()=>stream.destroy?.(controller.signal.reason);controller.signal.addEventListener('abort',stop,{once:true});
      try {for await(const chunk of stream){fence();bytes+=chunk.length;if(bytes>MEDIA_LIMITS.bytes)throw notesError('media_too_large','Upload exceeds 10 MiB',413);hash.update(chunk);await handle.write(chunk);}await handle.sync();}
      finally {controller.signal.removeEventListener('abort',stop);await handle.close();}
      if(!bytes || hash.digest('hex')!==meta.hash)throw notesError('media_hash','Source SHA does not match');
      fence();await authorize();
      const uploadIdentity=identity(meta);
      if(!meta.preview){
        const retry=await store.assetRegistration(meta.accountId,meta.operationId,uploadIdentity,{authorize});
        if(retry)return {...retry,asset:assetView(retry.asset)};
        const stage=stages.get(meta.previewId);
        if(!stage || stage.expiresAt<=Date.now() || stage.sessionToken!==sessionToken || stage.binding!==binding(meta))throw notesError('preview_required','Review the normalized preview before publishing',409);
        const key=meta.operationId,current=publishing.get(key);
        if(current){if(current.binding!==binding(meta))throw notesError('operation_conflict','Operation content differs',409);return await current.promise;}
        const job=(async()=>{
          const id=meta.operationId,record={...stage.asset,id,name:meta.name,fileName:`${id}.${stage.asset.mimeType==='image/gif'?'gif':'webm'}`,posterName:`${id}.png`};
          const targets=[[source,`${id}.source`],[join(stage.dir,'converted'),record.fileName],[join(stage.dir,'poster.png'),record.posterName]],created=[];
          try {
            // Remote mode uploads to the private bucket; local mode copies into dataDir. Either way files exist before registration.
            if(remote){const contentTypes=[meta.mimeType,record.mimeType,'image/png'];for(const [index,[input,name]] of targets.entries()){fence();await remote.putFile(name,await readFile(input),contentTypes[index]);created.push(name);}}
            else {for(const [input,name] of targets){fence();const dest=join(files,name),scratch=`${dest}.${randomUUID()}.tmp`;try{await copyFile(input,scratch);await syncFile(scratch);await rename(scratch,dest);created.push(dest);}finally{await rm(scratch,{force:true});}}
              await syncFile(files);}
            fence();await authorize();
            const result=await store.registerAsset(meta.accountId,record,meta.operationId,{authorize,uploadIdentity});
            return {...result,asset:assetView(result.asset)};
          }catch(error){if(!store.asset(id))await (remote?remote.removeFiles(created).catch(()=>{}):Promise.all(created.map(path=>rm(path,{force:true}))));throw error;}
        })();publishing.set(key,{binding:binding(meta),promise:job});try{return await job;}finally{publishing.delete(key);}
      }
      if(stages.size>=MEDIA_LIMITS.previews)throw notesError('media_busy','Too many outstanding previews',429);
      const signature=(await readFile(source)).subarray(0,16),type=types[meta.mimeType];
      const matches=type==='png'?signature.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='jpg'?signature.subarray(0,3).equals(Buffer.from([255,216,255])):type==='gif'?/^GIF8[79]a/.test(signature.toString()):type==='webm'?signature.subarray(0,4).equals(Buffer.from([26,69,223,163])):signature.subarray(4,8).toString()==='ftyp';
      if(!matches)throw notesError('invalid_media','Declared media type does not match file');
      // Read dimensions/rate before decoding frames; giant compressed images must fail before allocation.
      if(type==='png'){const header=await readFile(source);if(header.length<24)throw notesError('invalid_media');const w=header.readUInt32BE(16),h=header.readUInt32BE(20);if(w>MEDIA_LIMITS.side||h>MEDIA_LIMITS.side||w*h>MEDIA_LIMITS.pixels)throw notesError('media_dimensions','Media dimensions exceed limits');}
      const probe=JSON.parse(await run(ffprobePath,['-v','error','-select_streams','v','-show_streams','-show_format','-of','json',source],controller.signal));
      const video=probe.streams?.[0];
      const validCodec=type==='png'?video?.codec_name==='png':type==='jpg'?video?.codec_name==='mjpeg':type==='gif'?video?.codec_name==='gif':type==='webm'?['vp8','vp9','av1'].includes(video?.codec_name):['h264','hevc','av1','mpeg4'].includes(video?.codec_name);
      if(!validCodec || probe.streams.length!==1)throw notesError('invalid_media','Unsupported video codec/stream');
      const width=video.width,height=video.height,duration=Number(video.duration ?? probe.format?.duration ?? 0),rate=video.avg_frame_rate?.split('/').map(Number),fps=rate?.[1]?rate[0]/rate[1]:0;
      if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>MEDIA_LIMITS.side||height>MEDIA_LIMITS.side||width*height>MEDIA_LIMITS.pixels)throw notesError('media_dimensions','Media dimensions exceed limits');
      if(!Number.isFinite(duration)||duration>MEDIA_LIMITS.seconds+.001||fps>MEDIA_LIMITS.fps+.001)throw notesError('media_duration','Animation exceeds duration or FPS limit');
      const counted=JSON.parse(await run(ffprobePath,['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=nb_read_frames','-of','json',source],controller.signal));
      const frames=Number(counted.streams?.[0]?.nb_read_frames);
      if(!Number.isSafeInteger(frames)||frames<1||frames>MEDIA_LIMITS.seconds*MEDIA_LIMITS.fps)throw notesError('media_duration','Too many animation frames');
      const sheet=meta.spritesheet;
      if(sheet && (width%sheet.frameWidth || height%sheet.frameHeight || sheet.frames>width/sheet.frameWidth*(height/sheet.frameHeight)))throw notesError('invalid_spritesheet','Frames do not fit the spritesheet grid');
      const outWidth=sheet?.frameWidth ?? width,outHeight=sheet?.frameHeight ?? height,animated=sheet?sheet.frames>1:frames>1;
      const mimeType=['png','jpg','gif'].includes(type)?'image/gif':'video/webm',output=join(dir,'converted');
      const common=['-v','error','-nostdin','-threads','1','-filter_complex_threads','1','-i',source];
      if(mimeType==='image/gif'){
        let prefix='[0:v]';
        if(sheet){
          const columns=width/sheet.frameWidth;
          // loop duplicates the source; crop expressions select grid cells in row-major order.
          prefix=`[0:v]loop=loop=${sheet.frames-1}:size=1:start=0,crop=${sheet.frameWidth}:${sheet.frameHeight}:x='mod(n,${columns})*${sheet.frameWidth}':y='floor(n/${columns})*${sheet.frameHeight}',setpts=N/(${sheet.fps}*TB),`;
        }
        const filter=`${prefix}split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=full[p];[b][p]paletteuse=alpha_threshold=128`;
        await run(ffmpegPath,[...common,'-filter_complex',filter,'-an','-map_metadata','-1','-loop','0',...(sheet?['-frames:v',String(sheet.frames),'-r',String(sheet.fps)]:[]),'-f','gif',output],controller.signal);
      }else await run(ffmpegPath,[...common,'-map','0:v:0','-an','-map_metadata','-1','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-b:v','0','-crf','32','-f','webm',output],controller.signal);
      await run(ffmpegPath,['-v','error','-nostdin','-threads','1','-i',output,'-frames:v','1','-map_metadata','-1',join(dir,'poster.png')],controller.signal);
      const normalizedBytes=(await readFile(output)).length;
      if(normalizedBytes>MEDIA_LIMITS.bytes)throw notesError('media_too_large','Normalized output exceeds 10 MiB',413);
      const previewId=randomUUID(),asset={id:previewId,name:meta.name,mimeType,width:outWidth,height:outHeight,bytes:normalizedBytes,animated};
      fence();await authorize();stages.set(previewId,{dir,asset,binding:binding(meta),sessionToken,expiresAt:Date.now()+MEDIA_LIMITS.previewTTL});retained=true;
      return {previewId,expiresAt:stages.get(previewId).expiresAt,asset:assetView(asset,`/api/note-assets/previews/${previewId}`)};
    }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);controllers.delete(controller);if(acquired)release();if(dir&&!retained)await rm(dir,{recursive:true,force:true});}
  }
  const stored=(asset,poster)=>{const name=poster?asset.posterName:asset.fileName,mimeType=poster?'image/png':asset.mimeType;return remote?{remoteKey:name,mimeType}:{path:join(files,name),mimeType};};
  return {ingest(options){const job=ingest(options);jobs.add(job);job.finally(()=>jobs.delete(job)).catch(()=>{});return job;},list:()=>store.library().map(asset=>assetView(asset)),
    rename:(id,name,{accountId,operationId,authorize}={})=>store.updateAsset(accountId,id,{name},operationId,{authorize}),
    remove:(id,{accountId,operationId,authorize}={})=>store.updateAsset(accountId,id,{removed:true},operationId,{authorize}),
    resolvePublicAsset(id,poster=false){const asset=store.asset(id);return asset&&store.isAssetPublic(id)?stored(asset,poster):null;},
    resolveAsset(id,poster=false){const asset=store.asset(id);return asset?stored(asset,poster):null;},
    /** Remote files: a fetch Response to stream, or null when missing. */
    fetchRemote:key=>remote.getFile(key),
    resolvePreview(id,token,poster=false){const stage=stages.get(id);return stage&&stage.sessionToken===token&&stage.expiresAt>Date.now()?{path:join(stage.dir,poster?'poster.png':'converted'),mimeType:poster?'image/png':stage.asset.mimeType}:null;},
    async close(){if(closed)return;closed=true;clearInterval(timer);for(const c of controllers)c.abort(notesError('store_closed','Media is closing',503));await Promise.allSettled([...jobs]);await Promise.all([...stages.values()].map(s=>rm(s.dir,{recursive:true,force:true})));stages.clear();},
  };
}
