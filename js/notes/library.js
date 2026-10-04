import { API_BASE_URL } from '../config.js';
import { getAuthGeneration } from '../auth.js';
import { askName } from './board.js';

const el=(tag,className,text)=>{const node=document.createElement(tag);node.className=className||'';if(text!==undefined)node.textContent=text;return node;};
const button=(label,action)=>{const node=el('button','notes-button',label);node.type='button';node.dataset.action=action;return node;};
const url=path=>API_BASE_URL+path;
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
  const form=el('form','note-media-upload'),file=el('input');file.type='file';file.accept='image/png,image/gif,video/webm,video/mp4';file.setAttribute('aria-label','Chọn PNG, GIF, WebM hoặc MP4');
  const name=el('input');name.maxLength=120;name.setAttribute('aria-label','Tên tài nguyên');name.placeholder='Tên tài nguyên';
  const sheet=el('input');sheet.type='checkbox';const sheetLabel=el('label','note-media-sheet-toggle','PNG spritesheet ');sheetLabel.append(sheet);
  const config=el('div','note-media-sheet');config.hidden=true;const inputs={};
  for(const [key,label,value] of [['frameWidth','Chiều rộng khung',16],['frameHeight','Chiều cao khung',16],['frames','Số khung (tối đa 256)',1],['fps','Khung/giây (1–60)',12]]){const wrapper=el('label','',label),input=el('input');input.type='number';input.min='1';input.value=value;input.dataset.sheetField=key;wrapper.append(input);config.append(wrapper);inputs[key]=input;}
  const requestPreview=button('Xem bản chuyển đổi','media-preview');form.append(file,name,sheetLabel,config,requestPreview);
  const explanation=el('p','note-media-limits','PNG/GIF/WebM/MP4 · tối đa 10 MiB, 4096 px, 16 triệu pixel, 30 giây và 60 fps. GIF dùng bảng màu và alpha nhị phân; hãy xem bản chuyển đổi trước khi xác nhận.');
  const preview=el('div','note-media-preview'),publish=button('Xác nhận vào thư viện','media-publish'),discard=button('Bỏ file chờ','media-discard');publish.disabled=true;discard.hidden=true;
  const list=el('div','note-library-list'),pendingList=el('div','note-library-pending'),close=button('Đóng','library-close');dialog.append(heading,explanation,form,status,preview,publish,discard,pendingList,list,close);container.append(dialog);
  let disposed=false,prepared=null,previewOperation=null,shownPreview=null,loading=0,accepting=false,previewDirty=false;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const alive=()=>!disposed&&!signal?.aborted&&generation===getAuthGeneration()&&client.getState().writable;
  const failure=error=>{if(alive())status.textContent=error.message || 'Chưa thể tải tài nguyên.';};
  function run(job){Promise.resolve().then(job).catch(failure);}
  async function load(){const request=++loading;try{const result=await client.authenticatedRequest('/api/note-assets');if(!alive()||request!==loading)return;stopMedia(list);list.replaceChildren();
    if(!result.assets.length)list.append(el('p','note-library-empty','Thư viện đang trống. Chọn một hình để bắt đầu.'));
    for(const asset of result.assets){const row=el('article','note-library-item'),label=el('span','',asset.name),image=visual(asset,true),insert=button('Chèn vào note','media-insert'),rename=button('Đổi tên','media-rename'),remove=button('Gỡ khỏi thư viện','media-remove');row.dataset.assetId=asset.id;insert.disabled=!noteId;
      insert.onclick=()=>run(async()=>{await client.command({type:'decoration.add',payload:{id:crypto.randomUUID(),noteId,assetId:asset.id,x:20,y:20,width:Math.min(100,asset.width),height:Math.min(100,asset.height),rotation:0,z:0}});if(alive())cleanup();});
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
  function adopt(entry){prepared=entry;previewOperation=entry.operationId;name.value=entry.name;discard.hidden=false;previewDirty=false;sheet.checked=!!entry.fields?.spritesheet;config.hidden=!sheet.checked;if(sheet.checked){const grid=JSON.parse(entry.fields.spritesheet);for(const [key,input]of Object.entries(inputs))input.value=grid[key];}}
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
    const fields=sheet.checked?{spritesheet:JSON.stringify(Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,Number(input.value)])))}:{};
    if(previewOperation)await client.discardPending(previewOperation);if(!alive())return;
    previewOperation=crypto.randomUUID();prepared={operationId:previewOperation,file:selected,name:name.value.trim() || selected.name,fields};shownPreview=null;previewDirty=false;publish.disabled=true;discard.hidden=false;status.textContent='Đang chuẩn bị bản xem trước…';
    const result=await client.queueUpload({...prepared,path:'/api/note-assets?preview=1'});if(!alive())return;showPreview(result);
    if(result.pending)status.textContent='File chờ trên thiết bị (tổng tối đa 50 MiB). Kết nối lại để xem bản chuyển đổi; chưa xuất bản.';
  }
  file.onchange=()=>{name.value=file.files[0]?.name || '';run(prepare);};sheet.onchange=()=>{config.hidden=!sheet.checked;previewDirty=true;publish.disabled=true;};
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

export function mountNoteMedia(layer,{client,note,signal}={}) {
  if(signal?.aborted)return ()=>{};
  const controller=new AbortController(),motion=matchMedia('(prefers-reduced-motion: reduce)'),records=new Map();let disposed=false,state=client.getState(),visible=true,drag=null,serial=Promise.resolve(),closeLibrary,closeInspector;
  const alive=()=>!disposed&&!signal?.aborted;
  const status=el('span','notes-media-status');status.setAttribute('role','status');
  const add=button('+ Hình','media-add');add.classList.add('note-media-add');add.onclick=()=>{closeLibrary?.();closeLibrary=openLibrary(layer.closest('.notes-board'),{client,noteId:note.id,signal:controller.signal});};
  function report(error){if(alive())status.textContent=error.message || 'Chưa đổi được trang trí.';}
  const current=id=>state.snapshot?.decorations.find(d=>d.id===id&&!d.deletedAt);
  const scale=()=>layer.closest('.paper-note').getBoundingClientRect().width/layer.closest('.paper-note').offsetWidth || 1;
  function place(record,value){record.node.style.left=`${value.x}px`;record.node.style.top=`${value.y}px`;record.node.style.width=`${value.width}px`;record.node.style.height=`${value.height}px`;record.node.style.transform=`rotate(${value.rotation}deg)`;record.node.style.zIndex=value.z;}
  function cancelDrag(){const prior=drag;drag=null;if(prior){const record=records.get(prior.id);if(record&&current(prior.id))place(record,current(prior.id));if(prior.leased)client.releaseLease({kind:'decoration',id:prior.id}).catch(()=>{});}}
  async function geometry(id,change){const action=async()=>{if(!alive()||!state.writable)return;await client.flush();if(!alive()||!state.writable)return;const d=current(id);if(!d)return;const online=state.connection==='online';if(online)await client.acquireLease({kind:'decoration',id});
    try {if(alive()&&state.writable)await client.command({type:'decoration.update',payload:{id,...change(current(id))}});}finally{if(online)await client.releaseLease({kind:'decoration',id}).catch(()=>{});}};
    serial=serial.catch(()=>{}).then(action);return serial;
  }
  function inspect(id){closeInspector?.();if(!state.writable)return;const d=current(id);if(!d)return;const dialog=el('dialog','notes-dialog note-decoration-inspector'),opener=document.activeElement;dialog.append(el('h2','','Trang trí trên giấy'));
    for(const [label,action,change] of [['←','left',v=>({x:v.x-10})],['→','right',v=>({x:v.x+10})],['↑','up',v=>({y:v.y-10})],['↓','down',v=>({y:v.y+10})],['Ra trước','front',v=>({z:v.z+1})],['Ra sau','back',v=>({z:v.z-1})]]){const control=button(label,`decoration-${action}`);control.setAttribute('aria-label',label==='←'?'Sang trái':label==='→'?'Sang phải':label==='↑'?'Lên trên':label==='↓'?'Xuống dưới':label);control.onclick=()=>geometry(id,change).catch(report);dialog.append(control);}
    for(const [key,label] of [['width','Rộng'],['height','Cao'],['rotation','Góc xoay']]){const wrapper=el('label','',label),input=el('input');input.type='number';input.dataset.mediaField=key;input.value=d[key];if(key!=='rotation'){input.min='16';input.max='2400';}input.onchange=()=>{const value=Number(input.value);if(!Number.isFinite(value))return;geometry(id,()=>({[key]:key==='rotation'?value:Math.min(2400,Math.max(16,value))})).catch(report);};wrapper.append(input);dialog.append(wrapper);}
    const remove=button('Gỡ hình khỏi note','decoration-remove'),close=button('Đóng','decoration-close');remove.onclick=()=>{client.command({type:'decoration.remove',payload:{id}}).then(()=>closeInspector?.()).catch(report);};close.onclick=()=>dialog.close();dialog.append(remove,close);layer.closest('.notes-board').append(dialog);
    let cleaned=false;closeInspector=()=>{if(cleaned)return;cleaned=true;dialog.remove();if(opener?.isConnected)opener.focus();};dialog.onclose=closeInspector;dialog.showModal();
  }
  function animate(record){const active=visible&&!document.hidden&&!motion.matches,asset=record.asset,mode=active&&asset.animated?'animated':'poster';if(record.mode===mode)return;stopMedia(record.node);record.image?.remove();record.image=visual(asset,mode==='poster');record.node.prepend(record.image);record.mode=mode;
    if(record.image.tagName==='VIDEO')record.image.play().catch(()=>{});
  }
  function render(next){if(!alive())return;state=next;if(drag&&(state.leaseState==='lost'||!state.writable))cancelDrag();
    if(state.writable){if(!add.isConnected)layer.append(add,status);}else {add.remove();status.remove();closeLibrary?.();closeInspector?.();}
    const items=(state.snapshot?.decorations || []).filter(d=>d.noteId===note.id&&!d.deletedAt);
    for(const [id,record] of records)if(!items.some(d=>d.id===id)){stopMedia(record.node);record.node.remove();records.delete(id);}
    for(const decoration of items){const data=state.snapshot.media?.find(a=>a.id===decoration.assetId);if(!data)continue;const asset={...data,fileUrl:`/api/note-assets/${data.id}/file`,posterUrl:`/api/note-assets/${data.id}/poster`};let record=records.get(decoration.id);
      if(!record){const node=el('div','note-decoration');node.dataset.decorationId=decoration.id;record={node,asset,mode:null,image:null};records.set(decoration.id,record);layer.append(node);}
      record.asset=asset;if(drag?.id!==decoration.id)place(record,decoration);animate(record);
      if(state.writable&&!record.handle){record.handle=button('↔','decoration-edit');record.handle.classList.add('note-decoration-handle');record.handle.setAttribute('aria-label','Kéo trang trí; Enter để chỉnh hình');record.handle.onclick=()=>{if(record.suppressClick){record.suppressClick=false;return;}inspect(decoration.id);};record.handle.onkeydown=event=>{const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(delta){event.stopPropagation();event.preventDefault();geometry(decoration.id,v=>({x:v.x+delta[0]*(event.shiftKey?10:1),y:v.y+delta[1]*(event.shiftKey?10:1)})).catch(report);}};record.node.append(record.handle);}
      if(!state.writable){record.handle?.remove();record.handle=null;}
    }
  }
  layer.addEventListener('pointerdown',event=>{const handle=event.target.closest('.note-decoration-handle');if(!handle||event.button!==0||!state.writable)return;event.stopPropagation();event.preventDefault();handle.focus();cancelDrag();const id=handle.parentElement.dataset.decorationId,d=current(id);drag={id,start:{...d},pointerId:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0,ready:state.connection!=='online',leased:false};const pending=drag;handle.setPointerCapture(event.pointerId);
    if(!pending.ready)client.flush().then(async()=>{if(!alive()||drag!==pending)return;if(state.connection==='online'){await client.acquireLease({kind:'decoration',id});pending.leased=true;}if(!alive()||drag!==pending){if(pending.leased)await client.releaseLease({kind:'decoration',id});return;}pending.ready=true;}).catch(error=>{cancelDrag();report(error);});
  },{signal:controller.signal});
  layer.addEventListener('pointermove',event=>{if(!drag||drag.pointerId!==event.pointerId)return;event.stopPropagation();if(!drag.ready)return;drag.dx=(event.clientX-drag.x)/scale();drag.dy=(event.clientY-drag.y)/scale();place(records.get(drag.id),{...drag.start,x:drag.start.x+drag.dx,y:drag.start.y+drag.dy});},{signal:controller.signal});
  async function end(event,cancel=false){if(!drag||drag.pointerId!==event.pointerId)return;event.stopPropagation();const prior=drag;drag=null;if(Math.abs(prior.dx)>1||Math.abs(prior.dy)>1)records.get(prior.id).suppressClick=true;try{if(!cancel&&prior.ready&&alive()&&state.writable&&(Math.abs(prior.dx)>1||Math.abs(prior.dy)>1))await client.command({type:'decoration.update',payload:{id:prior.id,x:prior.start.x+prior.dx,y:prior.start.y+prior.dy}});}catch(error){report(error);}finally{if(prior.leased)await client.releaseLease({kind:'decoration',id:prior.id}).catch(()=>{});const record=records.get(prior.id);if(record&&current(prior.id))place(record,current(prior.id));}}
  layer.addEventListener('pointerup',event=>end(event),{signal:controller.signal});layer.addEventListener('pointercancel',event=>end(event,true),{signal:controller.signal});layer.addEventListener('lostpointercapture',event=>end(event,true),{signal:controller.signal});
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;for(const record of records.values())animate(record);},{root:layer.closest('.notes-viewport')});observer.observe(layer.closest('.paper-note'));
  const refreshAnimation=()=>{for(const record of records.values())animate(record);};motion.addEventListener('change',refreshAnimation,{signal:controller.signal});document.addEventListener('visibilitychange',refreshAnimation,{signal:controller.signal});
  const unsubscribe=client.subscribe(render);
  function cleanup(){if(disposed)return;disposed=true;cancelDrag();controller.abort();unsubscribe();observer.disconnect();closeLibrary?.();closeInspector?.();for(const record of records.values()){stopMedia(record.node);record.node.remove();}records.clear();add.remove();status.remove();signal?.removeEventListener('abort',cleanup);}
  signal?.addEventListener('abort',cleanup,{once:true});return cleanup;
}
