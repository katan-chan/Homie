import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNotesStore } from '../backend/notes-store.js';
import { mediaBytes } from './helpers/media-fixture.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'homie-media-')),store=await createNotesStore({dataDir:dir});
  const {createNoteMedia}=await import('../backend/note-media.js');
  const media=createNoteMedia({dataDir:dir,store,ffmpegPath:process.env.FFMPEG_PATH || 'ffmpeg',ffprobePath:process.env.FFPROBE_PATH || 'ffprobe'});
  t.after(async()=>{await media.close();await store.close();await rm(dir,{recursive:true,force:true});});
  const metadata=(bytes,mimeType='image/png',extra={})=>({accountId:'minhle',operationId:randomUUID(),hash:sha(bytes),name:'Cánh hoa',mimeType,...extra});
  const ingest=(bytes,meta,extra={})=>media.ingest({stream:Readable.from([bytes]),metadata:meta,sessionToken:'session-a',...extra});
  return {dir,store,media,metadata,ingest};
}
test('normalizes alpha PNG to static GIF and poster; preview stays private until explicit acceptance',async t=>{
  const f=await fixture(t),bytes=await mediaBytes(),meta=f.metadata(bytes);
  const preview=await f.ingest(bytes,{...meta,preview:true});
  assert.equal(preview.asset.mimeType,'image/gif');assert.equal(preview.asset.animated,false);
  assert.deepEqual(f.media.list(),[]);assert.equal(f.media.resolvePublicAsset(preview.previewId),null);
  const gif=await readFile(f.media.resolvePreview(preview.previewId,'session-a').path);assert.equal(gif.subarray(0,3).toString(),'GIF');
  const result=await f.ingest(bytes,{...meta,previewId:preview.previewId});
  assert.equal(f.media.list().length,1);assert.equal(result.asset.id,meta.operationId);
  assert.equal(f.store.asset(result.asset.id).width,16);
  assert.deepEqual(await f.ingest(bytes,{...meta,previewId:preview.previewId}),result);
  assert.equal(f.media.resolvePublicAsset(result.asset.id),null);
});
test('JPEG (.jpg/.jpeg share image/jpeg) normalizes to a static GIF; a PNG declared as JPEG is rejected',async t=>{
  const f=await fixture(t),bytes=await mediaBytes('jpg',{width:24,height:20});
  assert.deepEqual([...bytes.subarray(0,3)],[0xff,0xd8,0xff]);
  const preview=await f.ingest(bytes,{...f.metadata(bytes,'image/jpeg'),preview:true});
  assert.deepEqual([preview.asset.mimeType,preview.asset.animated,preview.asset.width,preview.asset.height],['image/gif',false,24,20]);
  assert.equal((await readFile(f.media.resolvePreview(preview.previewId,'session-a').path)).subarray(0,3).toString(),'GIF');
  const png=await mediaBytes();
  await assert.rejects(f.ingest(png,{...f.metadata(png,'image/jpeg'),preview:true}),{code:'invalid_media'});
});
test('animated GIF, WebM, MP4 and PNG spritesheets get normalized animation and PNG poster',async t=>{
  const f=await fixture(t);
  for(const [format,mime] of [['gif','image/gif'],['webm','video/webm'],['mp4','video/mp4'],['png','image/png']]){
    const bytes=await mediaBytes(format),meta=f.metadata(bytes,mime,format==='png'?{spritesheet:{frameWidth:8,frameHeight:8,frames:4,fps:4}}:{});
    const p=await f.ingest(bytes,{...meta,preview:true});assert.equal(p.asset.animated,true,format);
    const result=await f.ingest(bytes,{...meta,previewId:p.previewId});
    const poster=await readFile(join(f.dir,'note-media',f.store.asset(result.asset.id).posterName));assert.equal(poster.subarray(1,4).toString(),'PNG');
    assert.equal((await readdir(join(f.dir,'note-media'))).filter(n=>n.startsWith(result.asset.id)).length,3,'source + normalized + poster');
  }
});
test('rejects invalid grid/FPS, spoofed format, oversized bytes/pixels/duration, traversal and SHA mismatch',async t=>{
  const f=await fixture(t),png=await mediaBytes();
  for(const extra of [{spritesheet:{frameWidth:7,frameHeight:8,frames:4,fps:4}},{spritesheet:{frameWidth:8,frameHeight:8,frames:4,fps:61}},{spritesheet:{frameWidth:8,frameHeight:8,frames:257,fps:4}},{mimeType:'video/mp4'},{name:'../escape'},{hash:'a'.repeat(64)}])await assert.rejects(f.ingest(png,{...f.metadata(png),...extra,preview:true}));
  const huge=Buffer.alloc(10*1024*1024+1);await assert.rejects(f.ingest(huge,{...f.metadata(huge),preview:true}),{code:'media_too_large'});
  const large=await mediaBytes('png',{width:4098,height:2});await assert.rejects(f.ingest(large,{...f.metadata(large),preview:true}),{code:'media_dimensions'});
  const long=await mediaBytes('mp4',{duration:31,fps:1});await assert.rejects(f.ingest(long,{...f.metadata(long,'video/mp4'),preview:true}),{code:'media_duration'});
  assert.deepEqual(await readdir(join(f.dir,'note-media-tmp')),[]);
});
test('acceptance binds original session/source/config; durable retry survives restart and rejects changed operation',async t=>{
  const f=await fixture(t),bytes=await mediaBytes(),meta=f.metadata(bytes),p=await f.ingest(bytes,{...meta,preview:true});
  assert.equal(f.media.resolvePreview(p.previewId,'other-session'),null);
  await assert.rejects(f.ingest(bytes,{...meta,previewId:p.previewId},{sessionToken:'other-session'}),{code:'preview_required'});
  await assert.rejects(f.ingest(bytes,{...meta,name:'Other',previewId:p.previewId}),{code:'preview_required'});
  await assert.rejects(f.ingest(bytes,{...meta,previewId:p.previewId},{authorize:()=>{throw Object.assign(Error('expired'),{status:401});}}),{status:401});
  assert.deepEqual(f.media.list(),[]);
  const result=await f.ingest(bytes,{...meta,previewId:p.previewId});
  const {createNoteMedia}=await import('../backend/note-media.js');const reopened=createNoteMedia({dataDir:f.dir,store:f.store,ffmpegPath:process.env.FFMPEG_PATH || 'ffmpeg',ffprobePath:process.env.FFPROBE_PATH || 'ffprobe'});
  t.after(()=>reopened.close());
  assert.deepEqual(await reopened.ingest({stream:Readable.from([bytes]),metadata:meta,sessionToken:'new-same-account-session'}),result);
  await assert.rejects(f.ingest(bytes,{...meta,name:'Changed',previewId:p.previewId}),{code:'operation_conflict'});
});
test('expired preview requires reconversion; the in-memory asset receipt does not survive a store restart',async t=>{
  const f=await fixture(t),bytes=await mediaBytes(),meta=f.metadata(bytes),p=await f.ingest(bytes,{...meta,preview:true});
  const realNow=Date.now;t.mock.method(Date,'now',()=>realNow()+300001);
  await assert.rejects(f.ingest(bytes,{...meta,previewId:p.previewId}),{code:'preview_required'});
  t.mock.restoreAll();const newer=await f.ingest(bytes,{...meta,operationId:randomUUID(),preview:true});
  const accepted=await f.ingest(bytes,{...meta,previewId:newer.previewId});await f.media.close();await f.store.close();
  const reopened=await createNotesStore({dataDir:f.dir}),{createNoteMedia}=await import('../backend/note-media.js');
  const media=createNoteMedia({dataDir:f.dir,store:reopened,ffmpegPath:'/missing/ffmpeg',ffprobePath:'/missing/ffprobe'});t.after(async()=>{await media.close();await reopened.close();});
  assert.ok(reopened.library().some(asset=>asset.id===accepted.asset.id),'the asset itself is saved');
  // ponytail: receipts live in memory only, so a retry after a restart must review again; persist receipts if lost ACKs show up.
  await assert.rejects(media.ingest({stream:Readable.from([bytes]),metadata:meta,sessionToken:'new-session'}),{code:'preview_required'});
  await assert.rejects(media.ingest({stream:Readable.from([bytes]),metadata:{...meta,operationId:randomUUID(),preview:true},sessionToken:'new-session'}),{code:'media_unavailable'});
});
test('two-job bound, queued abort and close clean temp jobs without library mutation',async t=>{
  const f=await fixture(t),bytes=await mediaBytes(),controllers=[new AbortController(),new AbortController(),new AbortController()];
  let entered=0,release;const gate=new Promise(resolve=>release=resolve);
  const jobs=controllers.map(controller=>f.ingest(bytes,{...f.metadata(bytes),preview:true},{stream:Readable.from((async function*(){entered++;await gate;yield bytes;})()),signal:controller.signal}));
  while(entered<2)await new Promise(r=>setTimeout(r,5));
  await new Promise(r=>setTimeout(r,30));assert.equal(entered,2,'third ingest has not started consuming source while both slots are occupied');
  controllers[2].abort(Object.assign(Error('cancelled'),{code:'cancelled'}));
  release();
  const results=await Promise.allSettled(jobs);assert.equal(results[2].status,'rejected');assert.equal(results[2].reason.code,'cancelled');
  assert.equal(results.slice(0,2).every(r=>r.status==='fulfilled'),true);assert.deepEqual(f.media.list(),[]);
  await f.media.close();assert.deepEqual(await readdir(join(f.dir,'note-media-tmp')),[]);
});
test('raw HTTP upload authenticates preview/library, CSRF-checks PUT, and hides media only when its board sticker is gone',async t=>{
  const f=await createNotesFixture({ffmpegPath:process.env.FFMPEG_PATH || 'ffmpeg',ffprobePath:process.env.FFPROBE_PATH || 'ffprobe'});t.after(()=>f.close());
  const base=f.origin,headers={Origin:base,'X-Requested-With':'Homie','Content-Type':'application/json'};
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({accountId:'minhle',password:fixturePasswords.minhle})});const cookie=login.headers.get('set-cookie').split(';')[0];
  const bytes=await mediaBytes(),metadata={accountId:'minhle',operationId:randomUUID(),name:'Fixture',mimeType:'image/png',hash:sha(bytes)};
  const upload=(meta,preview=false,c=cookie)=>fetch(base+'/api/note-assets'+(preview?'?preview=1':''),{method:'POST',headers:{...headers,Cookie:c,'Content-Type':'application/octet-stream','X-Note-Metadata':Buffer.from(JSON.stringify(meta)).toString('base64')},body:bytes});
  assert.equal((await fetch(base+'/api/note-assets')).status,401);
  assert.equal((await upload(metadata,true,'')).status,401);
  assert.equal((await upload(metadata)).status,409);
  const pre=await upload(metadata,true);assert.equal(pre.status,200);const p=await pre.json();
  assert.equal((await fetch(base+p.asset.fileUrl)).status,401);
  assert.equal((await fetch(base+p.asset.fileUrl,{headers:{Cookie:cookie}})).status,200);
  const accepted=await upload({...metadata,previewId:p.previewId});assert.equal(accepted.status,200);const {asset}=await accepted.json();
  assert.equal((await fetch(base+asset.fileUrl)).status,404);
  const boardId=randomUUID(),noteId=randomUUID(),columnId=randomUUID(),clientId=randomUUID();
  const cmd=async(type,payload)=>fetch(base+'/api/boards/commands',{method:'POST',headers:{...headers,Cookie:cookie},body:JSON.stringify({clientId,command:{accountId:'minhle',operationId:randomUUID(),boardId,baseRevision:0,type,payload}})});
  assert.equal((await cmd('board.create',{name:'Media', visibility: 'public' })).status,200);
  assert.equal((await cmd('column.create',{id:columnId,name:'Column',x:0,y:0,width:300,height:400})).status,200);
  assert.equal((await cmd('note.create',{id:noteId,columnId,x:10,y:10,width:240,height:300,color:'#ffeedd'})).status,200);
  const decorationId=randomUUID();assert.equal((await cmd('decoration.add',{id:decorationId,assetId:asset.id,x:0,y:0,width:40,height:40,rotation:0,z:0})).status,200);
  const projection=(await (await fetch(`${base}/api/boards/${boardId}`)).json()).board;
  assert.equal(projection.media.length,1);assert.equal(projection.media[0].id,asset.id);
  assert.equal(JSON.stringify(projection).includes('.source'),false);assert.equal(JSON.stringify(projection).includes('previewId'),false);
  for(const target of ['file','poster'])assert.equal((await fetch(`${base}/api/note-assets/${asset.id}/${target}`)).status,200);
  const update=(action,extra={},csrf=true)=>fetch(`${base}/api/note-assets/${asset.id}`,{method:'PUT',headers:csrf?{...headers,Cookie:cookie}:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({accountId:'minhle',operationId:randomUUID(),action,...extra})});
  assert.equal((await update('rename',{name:'New'},false)).status,403);
  assert.equal((await update('rename',{name:'New'})).status,200);
  assert.equal((await update('remove')).status,200);
  assert.deepEqual((await (await fetch(base+'/api/note-assets',{headers:{Cookie:cookie}})).json()).assets,[]);
  assert.equal((await fetch(base+asset.fileUrl)).status,200,'library removal retains inserted references');
  // Stickers are board objects: trashing a note or column keeps them public; trashing the board or removing the sticker hides the media.
  for(const [kind,id] of [['note',noteId],['column',columnId],['board',boardId]]){
    assert.equal((await cmd(`${kind}.trash`,kind==='board'?{}:{id})).status,200);
    assert.equal((await fetch(base+asset.fileUrl)).status,kind==='board'?404:200,`${kind} tombstone ${kind==='board'?'hides':'keeps'} media`);
    const projected=(await (await fetch(`${base}/api/boards/${boardId}`)).json()).board;if(projected)assert.equal(projected.media.length,1);
    assert.equal((await cmd(`${kind}.restore`,kind==='board'?{}:{id})).status,200);
  }
  assert.equal((await cmd('decoration.remove',{id:decorationId})).status,200);
  assert.equal((await fetch(base+asset.fileUrl)).status,404,'removing the last sticker hides the media');
});

test('removeBackground die-cuts: clears the border-connected background, keeps a margin and enclosed same-colour areas', async () => {
  const { removeBackground } = await import('../backend/note-media.js');
  const w = 16, h = 16, rgba = new Uint8Array(w * h * 4).fill(255);
  const set = (x, y, v) => { rgba.set([v, v, v, 255], (y * w + x) * 4); };
  for (let i = 5; i <= 10; i++) { set(i, 5, 0); set(i, 10, 0); set(5, i, 0); set(10, i, 0); }   // black ring around a white inside
  set(0, 0, 240);                                                                            // JPEG-ish noise on the background
  assert.equal(removeBackground(rgba, w, h), true);
  const alpha = (x, y) => rgba[(y * w + x) * 4 + 3];
  assert.deepEqual([alpha(0, 0), alpha(15, 15), alpha(1, 7), alpha(4, 7), alpha(5, 5), alpha(7, 7)], [0, 0, 0, 255, 255, 255], 'far background cleared; the 1px die-cut margin, ring and enclosed white kept');
  const photo = new Uint8Array(w * h * 4).map((_, i) => i % 4 === 3 ? 255 : (i * 37) % 256);
  assert.equal(removeBackground(photo, w, h), false, 'A busy border is left alone');
});

test('JPEG with removeBackground previews a GIF whose outside is transparent and enclosed white stays', async t => {
  const f = await fixture(t), dir = await mkdtemp(join(tmpdir(), 'homie-cutout-')), source = join(dir, 'sticker.jpg'), out = join(dir, 'out.rgba');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ffmpeg = (args) => new Promise((resolve, reject) => { const p = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-y', ...args]); p.on('error', reject); p.on('close', code => code ? reject(Error('ffmpeg ' + code)) : resolve()); });
  await ffmpeg(['-f', 'lavfi', '-i', 'color=white:s=40x40:d=1', '-vf', 'drawbox=x=10:y=10:w=20:h=20:color=black:t=3', '-frames:v', '1', '-pix_fmt', 'yuvj420p', source]);
  const bytes = await readFile(source);
  const preview = await f.ingest(bytes, { ...f.metadata(bytes, 'image/jpeg', { removeBackground: true }), preview: true });
  await ffmpeg(['-i', f.media.resolvePreview(preview.previewId, 'session-a').path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', out]);
  const rgba = await readFile(out), at = (x, y) => [...rgba.subarray((y * 40 + x) * 4, (y * 40 + x) * 4 + 4)];
  assert.equal(at(2, 2)[3], 0, 'Background outside the frame is transparent');
  assert.equal(at(20, 20)[3], 255, 'White enclosed by the frame is kept');
  assert.ok(at(20, 20)[0] > 200, 'and is still white');
  await assert.rejects(f.ingest(bytes, { ...f.metadata(bytes, 'image/gif', { removeBackground: true }), preview: true }), { code: 'invalid_media' });
});
