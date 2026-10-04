import { API_BASE_URL } from '../config.js';
import { getAuthGeneration } from '../auth.js';
import { askName } from './board.js';

const el=(tag,className,text)=>{const node=document.createElement(tag);node.className=className||'';if(text!==undefined)node.textContent=text;return node;};
const button=(label,action)=>{const node=el('button','notes-button',label);node.type='button';node.dataset.action=action;return node;};
const url=path=>API_BASE_URL+path;
// What a sticker follows after a move: the topmost live note under its centre, else a column, else nothing (free on the board).
function attachmentAt(snapshot,box){const cx=box.x+box.width/2,cy=box.y+box.height/2,inside=e=>!e.deletedAt&&cx>=e.x&&cx<=e.x+e.width&&cy>=e.y&&cy<=e.y+e.height;
  const note=(snapshot?.notes||[]).filter(inside).at(-1),column=note?null:(snapshot?.columns||[]).filter(inside).at(-1);return {noteId:note?.id??null,columnId:column?.id??null};}
function withAttachment(snapshot,before,patch){if(!('x' in patch||'y' in patch))return patch;const next=attachmentAt(snapshot,{...before,...patch});
  return next.noteId===(before.noteId??null)&&next.columnId===(before.columnId??null)?patch:{...patch,...next};}
// New stickers land on the board just below the writing note's header and follow that note; at most 100px on the long side (aspect kept).
function stickerPayload(client,noteId,asset){const note=client.getState().snapshot?.notes?.find(n=>n.id===noteId),k=Math.min(1,100/Math.max(asset.width,asset.height));
  return {id:crypto.randomUUID(),assetId:asset.id,...(note?{noteId:note.id}:{}),x:(note?.x??0)+20,y:(note?.y??0)+60,width:Math.max(16,Math.round(asset.width*k)),height:Math.max(16,Math.round(asset.height*k)),rotation:0,z:0};}
function stopMedia(node) {for(const video of node.querySelectorAll('video')){video.pause();video.removeAttribute('src');video.load();}for(const image of node.querySelectorAll('img'))image.removeAttribute('src');}
function visual(asset,poster=false) {
  const video=asset.mimeType==='video/webm'&&!poster,node=el(video?'video':'img','note-media-image');
  if(video){node.muted=true;node.loop=true;node.playsInline=true;node.autoplay=true;node.poster=url(asset.posterUrl);node.setAttribute('aria-label',asset.name || 'Trang trí');}
  else node.alt=asset.name || 'Trang trí';
  node.src=url(poster?asset.posterUrl:asset.fileUrl);return node;
}

/** Preview receipts retain source blobs in the existing account/board queue until explicit accept/discard. */
export function openLibrary(container,{client,noteId=null,signal}={}) {
  if(signal?.aborted || !client.getState().writable)return ()=>{};
  const generation=getAuthGeneration(),opener=document.activeElement,controller=new AbortController();
  const dialog=el('dialog','notes-dialog note-library'),heading=el('h2','', 'Thư viện trang trí chung'),status=el('p','notes-media-status');status.setAttribute('role','status');
  const form=el('form','note-media-upload'),file=el('input');file.type='file';file.accept='image/png,image/jpeg,.jpg,.jpeg,image/gif,video/webm,video/mp4';file.setAttribute('aria-label','Chọn PNG, JPG, GIF, WebM hoặc MP4');
  const name=el('input');name.maxLength=120;name.setAttribute('aria-label','Tên tài nguyên');name.placeholder='Tên tài nguyên';
  const sheet=el('input');sheet.type='checkbox';const sheetLabel=el('label','note-media-sheet-toggle','PNG spritesheet ');sheetLabel.append(sheet);
  // Still PNG/JPG stickers get their plain border-connected background cut out by default; the preview shows the result.
  const cutout=el('input');cutout.type='checkbox';cutout.checked=true;cutout.dataset.mediaField='removeBackground';const cutoutLabel=el('label','note-media-sheet-toggle','Tự khử nền (ảnh tĩnh PNG/JPG) ');cutoutLabel.append(cutout);
  const config=el('div','note-media-sheet');config.hidden=true;const inputs={};
  for(const [key,label,value] of [['frameWidth','Chiều rộng khung',16],['frameHeight','Chiều cao khung',16],['frames','Số khung (tối đa 256)',1],['fps','Khung/giây (1–60)',12]]){const wrapper=el('label','',label),input=el('input');input.type='number';input.min='1';input.value=value;input.dataset.sheetField=key;wrapper.append(input);config.append(wrapper);inputs[key]=input;}
  const requestPreview=button('Xem bản chuyển đổi','media-preview');form.append(file,name,cutoutLabel,sheetLabel,config,requestPreview);
  const explanation=el('p','note-media-limits','PNG/JPG/GIF/WebM/MP4 · tối đa 10 MiB, 4096 px, 16 triệu pixel, 30 giây và 60 fps. GIF dùng bảng màu và alpha nhị phân; hãy xem bản chuyển đổi trước khi xác nhận.');
  const preview=el('div','note-media-preview'),publish=button('Xác nhận vào thư viện','media-publish'),discard=button('Bỏ file chờ','media-discard');publish.disabled=true;discard.hidden=true;
  const list=el('div','note-library-list'),pendingList=el('div','note-library-pending'),close=button('Đóng','library-close');dialog.append(heading,explanation,form,status,preview,publish,discard,pendingList,list,close);container.append(dialog);
  let disposed=false,prepared=null,previewOperation=null,shownPreview=null,loading=0,accepting=false,previewDirty=false;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const alive=()=>!disposed&&!signal?.aborted&&generation===getAuthGeneration()&&client.getState().writable;
  const failure=error=>{if(alive())status.textContent=error.message || 'Chưa thể tải tài nguyên.';};
  function run(job){Promise.resolve().then(job).catch(failure);}
  async function load(){const request=++loading;try{const result=await client.authenticatedRequest('/api/note-assets');if(!alive()||request!==loading)return;stopMedia(list);list.replaceChildren();
    if(!result.assets.length)list.append(el('p','note-library-empty','Thư viện đang trống. Chọn một hình để bắt đầu.'));
    for(const asset of result.assets){const row=el('article','note-library-item'),label=el('span','',asset.name),image=visual(asset,true),insert=button('Chèn vào note','media-insert'),rename=button('Đổi tên','media-rename'),remove=button('Gỡ khỏi thư viện','media-remove');row.dataset.assetId=asset.id;insert.hidden=!noteId;
      insert.onclick=()=>run(async()=>{await client.command({type:'decoration.add',payload:stickerPayload(client,noteId,asset)});if(alive())cleanup();});
      rename.onclick=()=>askName(dialog,{title:'Đổi tên tài nguyên',value:asset.name,signal:controller.signal,onSubmit:newName=>run(async()=>{await client.authenticatedRequest(`/api/note-assets/${asset.id}`,{method:'PUT',body:{accountId:client.accountId,operationId:crypto.randomUUID(),action:'rename',name:newName}});await load();})});
      remove.onclick=()=>run(async()=>{await client.authenticatedRequest(`/api/note-assets/${asset.id}`,{method:'PUT',body:{accountId:client.accountId,operationId:crypto.randomUUID(),action:'remove'}});await load();});
      row.append(image,label,insert,rename,remove);list.append(row);
    }
  }catch(error){failure(error);}}
  function showPreview(receipt){if(!alive()||!prepared || receipt?.previewId===shownPreview)return;stopMedia(preview);preview.replaceChildren();shownPreview=receipt?.previewId || null;publish.disabled=true;
    if(!receipt?.previewId)return;
    if(receipt.expiresAt<=Date.now()){status.textContent='Bản xem trước đã hết hạn. Chọn Xem bản chuyển đổi để xem lại trước khi xác nhận.';return;}
    const image=visual(receipt.asset,motion.matches);image.addEventListener('error',()=>{if(alive()&&shownPreview===receipt.previewId){publish.disabled=true;status.textContent='Bản xem trước không còn trong phiên này. Chọn Xem bản chuyển đổi để xem lại; file chờ vẫn được giữ.';}},{once:true});
    image.addEventListener(image.tagName==='VIDEO'?'loadeddata':'load',()=>{if(alive()&&shownPreview===receipt.previewId&&!previewDirty){publish.disabled=false;status.textContent='Bản chuyển đổi đã sẵn sàng. Chưa có trong thư viện.';}},{once:true});
    preview.append(image);status.textContent='Đang tải bản chuyển đổi để xem trước…';
  }
  function adopt(entry){prepared=entry;previewOperation=entry.operationId;name.value=entry.name;discard.hidden=false;previewDirty=false;sheet.checked=!!entry.fields?.spritesheet;cutout.checked=!!entry.fields?.removeBackground||!entry.fields?.spritesheet&&!['image/png','image/jpeg'].includes(entry.file?.type);config.hidden=!sheet.checked;if(sheet.checked){const grid=JSON.parse(entry.fields.spritesheet);for(const [key,input]of Object.entries(inputs))input.value=grid[key];}}
  function reconcile(){if(!alive()){cleanup();return;}const pending=client.getPending().filter(e=>e.kind==='upload');if(!prepared){const entry=pending.find(e=>e.path==='/api/note-assets?preview=1');if(entry)adopt(entry);}
    if(prepared){showPreview(client.getUploadReceipt(previewOperation));const retained=client.getPending().find(e=>e.operationId===previewOperation);if(retained?.failure)failure(retained.failure);}
    pendingList.replaceChildren();
    for(const entry of pending.filter(e=>e.operationId!==previewOperation)){
      const row=el('div','notes-trash-row'),text=el('span','',`${entry.name} · ${entry.path.endsWith('?preview=1')?'Chờ xem trước':'Đã xác nhận, chờ gửi'}${entry.failure?' · '+entry.failure.message:''}`),remove=button('Bỏ file chờ','pending-upload-discard');
      remove.onclick=()=>run(()=>client.discardPending(entry.operationId));row.append(text,remove);
      if(entry.path.endsWith('?preview=1')){const show=button('Xem file chờ','pending-upload-view');show.onclick=()=>{adopt(entry);shownPreview=null;reconcile();};row.append(show);}
      else if(entry.failure?.code==='preview_required'){const again=button('Xem lại bản chuyển đổi','pending-upload-repreview');again.onclick=()=>run(async()=>{await client.discardPending(entry.operationId);if(!alive())return;adopt(entry);previewOperation=null;shownPreview=null;await prepare();});row.append(again);}
      else {const retry=button('Thử gửi','pending-upload-retry');retry.onclick=()=>run(async()=>{await client.flush();if(alive())await load();});row.append(retry);}
      pendingList.append(row);
    }
  }
  async function prepare(){if(!alive())return;const selected=file.files[0] || prepared?.file;if(!selected){status.textContent='Chọn file trước khi xem.';return;}
    if(selected.size>10*1024*1024){status.textContent='File vượt giới hạn 10 MiB.';return;}
    const fields=sheet.checked?{spritesheet:JSON.stringify(Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,Number(input.value)])))}:cutout.checked&&['image/png','image/jpeg'].includes(selected.type)?{removeBackground:'true'}:{};
    if(previewOperation)await client.discardPending(previewOperation);if(!alive())return;
    previewOperation=crypto.randomUUID();prepared={operationId:previewOperation,file:selected,name:name.value.trim() || selected.name,fields};shownPreview=null;previewDirty=false;publish.disabled=true;discard.hidden=false;status.textContent='Đang chuẩn bị bản xem trước…';
    const result=await client.queueUpload({...prepared,path:'/api/note-assets?preview=1'});if(!alive())return;showPreview(result);
    if(result.pending)status.textContent='File chờ trên thiết bị (tổng tối đa 50 MiB). Kết nối lại để xem bản chuyển đổi; chưa xuất bản.';
  }
  file.onchange=()=>{name.value=file.files[0]?.name || '';run(prepare);};sheet.onchange=()=>{config.hidden=!sheet.checked;previewDirty=true;publish.disabled=true;};cutout.onchange=()=>{if(file.files[0]||prepared?.file)run(prepare);};
  for(const input of [name,...Object.values(inputs)])input.addEventListener('input',()=>{previewDirty=true;publish.disabled=true;});
  requestPreview.onclick=()=>run(prepare);form.onsubmit=event=>{event.preventDefault();run(prepare);};
  publish.onclick=()=>run(async()=>{if(accepting||publish.disabled||!prepared)return;const receipt=client.getUploadReceipt(previewOperation);if(!receipt || receipt.expiresAt<=Date.now()){shownPreview=null;showPreview(receipt);return;}
    accepting=true;publish.disabled=true;try{const result=await client.queueUpload({file:prepared.file,name:prepared.name,fields:{...prepared.fields,previewId:receipt.previewId}});if(!alive())return;
      await client.discardPending(previewOperation);if(!alive())return;prepared=null;previewOperation=null;shownPreview=null;stopMedia(preview);preview.replaceChildren();discard.hidden=true;
      status.textContent=result.pending?'Đã xác nhận, đang chờ gửi từ thiết bị này.':'Đã lưu bền trong thư viện.';if(!result.pending)await load();
    }finally{accepting=false;}
  });
  discard.onclick=()=>run(async()=>{if(previewOperation)await client.discardPending(previewOperation);if(!alive())return;prepared=null;previewOperation=null;shownPreview=null;stopMedia(preview);preview.replaceChildren();discard.hidden=true;publish.disabled=true;status.textContent='Đã bỏ file chờ trên thiết bị.';});
  close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>cleanup(),{signal:controller.signal});
  const unsubscribe=client.subscribe(reconcile);motion.addEventListener('change',()=>{shownPreview=null;reconcile();},{signal:controller.signal});
  function cleanup(){if(disposed)return;disposed=true;loading++;controller.abort();unsubscribe?.();stopMedia(dialog);signal?.removeEventListener('abort',cleanup);dialog.remove();if(opener?.isConnected)opener.focus();}
  signal?.addEventListener('abort',cleanup,{once:true});dialog.showModal();load();return cleanup;
}

/** Browse-only picker for the shared format row; uploads and library edits stay in openLibrary. */
export function openAssetPicker(container,{client,noteId,signal}={}) {
  if(signal?.aborted || !client.getState().writable)return ()=>{};
  const generation=getAuthGeneration(),opener=document.activeElement,controller=new AbortController();
  const dialog=el('dialog','notes-dialog note-asset-picker'),heading=el('h2','','Chèn hình vào ghi chú'),status=el('p','notes-media-status','Đang tải thư viện hình…'),list=el('div','note-picker-list'),close=button('Đóng','picker-close');
  heading.id=`note-asset-picker-${crypto.randomUUID()}`;dialog.setAttribute('aria-labelledby',heading.id);status.setAttribute('role','status');dialog.append(heading,status,list,close);container.append(dialog);
  let disposed=false;
  const alive=()=>!disposed&&!signal?.aborted&&generation===getAuthGeneration()&&client.getState().writable;
  const failure=error=>{if(alive())status.textContent=error.message || 'Chưa thể tải thư viện hình.';};
  async function load(){try{const result=await client.authenticatedRequest('/api/note-assets');if(!alive())return;
    status.textContent=result.assets.length?'':'Thư viện hình đang trống. Hãy vào mục Thư viện hình ở đầu Góc ghi chép để thêm hình.';
    for(const asset of result.assets){const row=el('article','note-picker-item'),insert=button('Chèn','picker-insert');row.dataset.assetId=asset.id;insert.setAttribute('aria-label',`Chèn ${asset.name || 'hình'}`);
      insert.onclick=()=>{insert.disabled=true;client.command({type:'decoration.add',payload:stickerPayload(client,noteId,asset)}).then(()=>{if(alive())cleanup();},error=>{if(alive()){insert.disabled=false;failure(error);}});};
      row.append(visual(asset,true),el('span','note-picker-name',asset.name),insert);list.append(row);
    }
  }catch(error){failure(error);}}
  close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>cleanup(),{signal:controller.signal});
  const unsubscribe=client.subscribe(()=>{if(!disposed&&!alive())cleanup();});
  function cleanup(){if(disposed)return;disposed=true;controller.abort();unsubscribe?.();stopMedia(dialog);signal?.removeEventListener('abort',cleanup);dialog.remove();if(opener?.isConnected)opener.focus();}
  signal?.addEventListener('abort',cleanup,{once:true});dialog.showModal();load();return cleanup;
}

// One sticker tool group per board format row; buttons act on the decoration selected last (any note on the board).
const stickerRows=new WeakMap();
function stickerTools(row){
  let tools=stickerRows.get(row);if(tools)return tools;
  const group=el('div','notes-sticker-tools');group.setAttribute('role','group');group.setAttribute('aria-label','Trang trí đang chọn');group.hidden=true;let active=null;
  const resize=f=>v=>{const width=Math.min(2400,Math.max(16,Math.round(v.width*f))),height=Math.min(2400,Math.max(16,Math.round(v.height*f)));return {width,height};};
  group.append(el('span','notes-sticker-label','Trang trí'));
  for(const [label,action,title,change] of [['←','left','Sang trái',v=>({x:v.x-10})],['→','right','Sang phải',v=>({x:v.x+10})],['↑','up','Lên trên',v=>({y:v.y-10})],['↓','down','Xuống dưới',v=>({y:v.y+10})],['−','smaller','Nhỏ lại',resize(1/1.1)],['+','bigger','To lên',resize(1.1)],['⟲','rotate-left','Xoay trái',v=>({rotation:v.rotation-15})],['⟳','rotate-right','Xoay phải',v=>({rotation:v.rotation+15})],['Ra trước','front','Ra trước',v=>({z:v.z+1})],['Ra sau','back','Ra sau',v=>({z:v.z-1})]]){
    const control=button(label,`decoration-${action}`);control.classList.add('notes-format-button');control.title=title;control.setAttribute('aria-label',title);control.onmousedown=event=>event.preventDefault();control.onclick=()=>active?.apply(change);group.append(control);
  }
  const remove=button('Gỡ','decoration-remove'),done=button('Xong','decoration-close');
  for(const control of [remove,done]){control.classList.add('notes-format-button');control.onmousedown=event=>event.preventDefault();}
  remove.title='Gỡ hình khỏi note';remove.setAttribute('aria-label','Gỡ hình khỏi note');remove.onclick=()=>{const prior=active;prior?.deselect();prior?.remove();};
  done.title='Bỏ chọn trang trí';done.onclick=()=>active?.deselect();group.append(remove,done);
  // While a decoration is selected its tools replace the text tools, so the row keeps one height and the board does not jump.
  tools={select(actions){active=actions;if(!group.isConnected)row.append(group);group.hidden=false;row.classList.add('has-sticker');},clear(id){if(active?.id!==id)return;active=null;group.hidden=true;row.classList.remove('has-sticker');}};
  stickerRows.set(row,tools);return tools;
}

/** Board-wide sticker layer (inside .notes-world): decorations use world coordinates and move anywhere on the board. */
export function mountBoardMedia(layer,{client,signal,formatRow}={}) {
  if(signal?.aborted)return ()=>{};
  const controller=new AbortController(),motion=matchMedia('(prefers-reduced-motion: reduce)'),records=new Map();let disposed=false,state=client.getState(),drag=null,serial=Promise.resolve();
  const alive=()=>!disposed&&!signal?.aborted;
  const status=el('span','notes-media-status');status.setAttribute('role','status');
  function report(error){if(alive())status.textContent=error.message || 'Chưa đổi được trang trí.';}
  const current=id=>state.snapshot?.decorations.find(d=>d.id===id&&!d.deletedAt);
  // The layer is 100px wide in world units, so its rendered width gives the camera scale.
  const scale=()=>layer.getBoundingClientRect().width/layer.offsetWidth || 1;
  function place(record,value){record.node.style.left=`${value.x}px`;record.node.style.top=`${value.y}px`;record.node.style.width=`${value.width}px`;record.node.style.height=`${value.height}px`;record.node.style.transform=`rotate(${value.rotation}deg)`;record.node.style.zIndex=value.z;}
  function cancelDrag(){const prior=drag;drag=null;if(prior){const record=records.get(prior.id);if(record&&current(prior.id))place(record,current(prior.id));if(prior.leased)client.releaseLease({kind:'decoration',id:prior.id}).catch(()=>{});}}
  async function geometry(id,change){const action=async()=>{if(!alive()||!state.writable)return;await client.flush();if(!alive()||!state.writable)return;const d=current(id);if(!d)return;const online=state.connection==='online';if(online)await client.acquireLease({kind:'decoration',id});
    try {if(alive()&&state.writable){const before=current(id);await client.command({type:'decoration.update',payload:{id,...withAttachment(state.snapshot,before,change(before))}});}}finally{if(online)await client.releaseLease({kind:'decoration',id}).catch(()=>{});}};
    serial=serial.catch(()=>{}).then(action);return serial;
  }
  // Selecting a decoration shows its tools in the shared format row (no overlay on the decoration itself).
  const tools=formatRow?stickerTools(formatRow):null;let selected=null;
  const stickerActions=id=>({id,apply:change=>geometry(id,change).catch(report),remove:()=>client.command({type:'decoration.remove',payload:{id}}).catch(report),deselect:()=>deselect(id)});
  function select(id){if(!state.writable||!current(id)||!tools)return;if(selected!==id){deselect();selected=id;const node=records.get(id)?.node;if(node){node.classList.add('is-selected');const grip=el('span','note-decoration-resize');grip.title='Kéo để đổi cỡ';grip.setAttribute('aria-hidden','true');node.append(grip);}}tools.select(stickerActions(id));}
  function deselect(id=selected){if(!selected||id!==selected)return;const node=records.get(selected)?.node;node?.classList.remove('is-selected');node?.querySelector('.note-decoration-resize')?.remove();tools?.clear(selected);selected=null;}
  function animate(record){const active=record.visible!==false&&!document.hidden&&!motion.matches,asset=record.asset,mode=active&&asset.animated?'animated':'poster';if(record.mode===mode)return;stopMedia(record.node);record.image?.remove();record.image=visual(asset,mode==='poster');record.node.prepend(record.image);record.mode=mode;
    if(record.image.tagName==='VIDEO')record.image.play().catch(()=>{});
  }
  // Only a lease this drag actually held can be lost; a stale 'lost' from an earlier reconnect must not cancel a drag still acquiring one.
  function render(next){if(!alive())return;state=next;if(drag&&((drag.leased&&state.leaseState==='lost')||!state.writable))cancelDrag();
    if(state.writable){if(!status.isConnected)(layer.closest('.notes-viewport')||layer).append(status);}else {status.remove();deselect();}
    const items=(state.snapshot?.decorations || []).filter(d=>!d.deletedAt);
    for(const [id,record] of records)if(!items.some(d=>d.id===id)){deselect(id);observer.unobserve(record.node);stopMedia(record.node);record.node.remove();records.delete(id);}
    for(const decoration of items){const data=state.snapshot.media?.find(a=>a.id===decoration.assetId);if(!data)continue;const asset={...data,fileUrl:`/api/note-assets/${data.id}/file`,posterUrl:`/api/note-assets/${data.id}/poster`};let record=records.get(decoration.id);
      if(!record){const node=el('div','note-decoration');node.dataset.decorationId=decoration.id;record={node,asset,mode:null,image:null,visible:true};records.set(decoration.id,record);layer.append(node);observer.observe(node);}
      record.asset=asset;record.node.dataset.noteId=decoration.noteId??'';record.node.dataset.columnId=decoration.columnId??'';if(drag?.id!==decoration.id)place(record,decoration);animate(record);
      const editable=state.writable;record.node.classList.toggle('is-editable',editable);
      if(editable){record.node.tabIndex=0;record.node.setAttribute('role','button');record.node.setAttribute('aria-label',`Trang trí ${asset.name}: kéo để di chuyển, mũi tên để dời, Delete để gỡ`);}else {record.node.removeAttribute('tabindex');record.node.removeAttribute('role');record.node.removeAttribute('aria-label');}
    }
  }
  // The corner grip of a selected decoration resizes it with its aspect ratio kept (16–2400 px); elsewhere a drag moves it.
  function moved(d){if(d.mode!=='resize')return {x:d.start.x+d.dx,y:d.start.y+d.dy};const {width,height}=d.start,f=Math.max((width+d.dx)/width,(height+d.dy)/height),k=Math.min(2400/Math.max(width,height),Math.max(16/Math.min(width,height),f));return {width:Math.round(width*k),height:Math.round(height*k)};}
  layer.addEventListener('pointerdown',event=>{// Press selects the decoration; drag it with the left button or by holding the right one.
    const handle=event.target.closest('.note-decoration.is-editable');if(!handle||(event.button!==0&&event.button!==2)||!state.writable)return;event.stopPropagation();event.preventDefault();handle.focus({preventScroll:true});cancelDrag();const id=handle.dataset.decorationId,d=current(id);select(id);drag={id,mode:event.target.closest('.note-decoration-resize')?'resize':'move',start:{...d},pointerId:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0,ready:state.connection!=='online',leased:false};const pending=drag;handle.setPointerCapture(event.pointerId);
    if(!pending.ready)client.flush().then(async()=>{if(!alive()||drag!==pending)return;if(state.connection==='online'){await client.acquireLease({kind:'decoration',id});pending.leased=true;}if(!alive()||drag!==pending){if(pending.leased)await client.releaseLease({kind:'decoration',id});return;}pending.ready=true;}).catch(error=>{cancelDrag();report(error);});
  },{signal:controller.signal});
  layer.addEventListener('pointermove',event=>{if(!drag||drag.pointerId!==event.pointerId)return;event.stopPropagation();if(!drag.ready)return;drag.dx=(event.clientX-drag.x)/scale();drag.dy=(event.clientY-drag.y)/scale();place(records.get(drag.id),{...drag.start,...moved(drag)});},{signal:controller.signal});
  async function end(event,cancel=false){if(!drag||drag.pointerId!==event.pointerId)return;event.stopPropagation();const prior=drag;drag=null;try{if(!cancel&&prior.ready&&alive()&&state.writable&&(Math.abs(prior.dx)>1||Math.abs(prior.dy)>1))await client.command({type:'decoration.update',payload:{id:prior.id,...withAttachment(state.snapshot,prior.start,moved(prior))}});}catch(error){report(error);}finally{if(prior.leased)await client.releaseLease({kind:'decoration',id:prior.id}).catch(()=>{});const record=records.get(prior.id);if(record&&current(prior.id))place(record,current(prior.id));}}
  layer.addEventListener('contextmenu',event=>{if(event.target.closest('.note-decoration.is-editable'))event.preventDefault();},{signal:controller.signal});
  layer.addEventListener('focusin',event=>{const node=event.target.closest?.('.note-decoration.is-editable');if(node)select(node.dataset.decorationId);},{signal:controller.signal});
  layer.addEventListener('keydown',event=>{const node=event.target.closest?.('.note-decoration.is-editable');if(!node)return;const id=node.dataset.decorationId;
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if(delta){event.stopPropagation();event.preventDefault();geometry(id,v=>({x:v.x+delta[0]*(event.shiftKey?10:1),y:v.y+delta[1]*(event.shiftKey?10:1)})).catch(report);}
    else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();event.stopPropagation();client.command({type:'decoration.remove',payload:{id}}).catch(report);}
    else if(event.key==='Escape'){event.stopPropagation();deselect(id);node.blur();}
  },{signal:controller.signal});
  // Pressing anywhere outside decorations and the sticker tools ends the selection.
  document.addEventListener('pointerdown',event=>{if(selected&&!event.target.closest?.('.note-decoration,.notes-sticker-tools'))deselect();},{capture:true,signal:controller.signal});
  layer.addEventListener('pointerup',event=>end(event),{signal:controller.signal});layer.addEventListener('pointercancel',event=>end(event,true),{signal:controller.signal});layer.addEventListener('lostpointercapture',event=>end(event,true),{signal:controller.signal});
  // Off-screen stickers show their poster instead of animating.
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){const record=records.get(entry.target.dataset.decorationId);if(record){record.visible=entry.isIntersecting;animate(record);}}},{root:layer.closest('.notes-viewport')});
  const refreshAnimation=()=>{for(const record of records.values())animate(record);};motion.addEventListener('change',refreshAnimation,{signal:controller.signal});document.addEventListener('visibilitychange',refreshAnimation,{signal:controller.signal});
  const unsubscribe=client.subscribe(render);
  function cleanup(){if(disposed)return;disposed=true;cancelDrag();controller.abort();unsubscribe();observer.disconnect();deselect();for(const record of records.values()){stopMedia(record.node);record.node.remove();}records.clear();status.remove();signal?.removeEventListener('abort',cleanup);}
  signal?.addEventListener('abort',cleanup,{once:true});return cleanup;
}
