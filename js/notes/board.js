import { clampPaperSize } from './model.js';
import { mountBoardPresence } from './editor.js';

// Board owns geometry and camera. Editor/media hooks own their stable note slots.
const colors = ['#fff0b8', '#f9dbe5', '#deead9', '#dce9f5', '#e8ddf1', '#fffaf0'];
const authors = { minhle: 'Minh Lê', haiyen: 'Hải Yến' };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label, action, mutation = false) {
  const node = element('button', 'notes-button', label); node.type = 'button'; node.dataset.action = action;
  if (mutation) node.dataset.mutation = '';
  return node;
}
export function askName(container, { title, value = '', signal, onSubmit }) {
  const dialog = element('dialog', 'notes-dialog');
  const form = element('form', 'notes-name-form');
  const label = element('label', '', title); const input = document.createElement('input');
  input.required = true; input.maxLength = 120; input.value = value; label.append(input);
  const submit = button('Lưu', 'name-save'); submit.type = 'submit';
  const cancel = button('Hủy', 'name-cancel'); cancel.onclick = () => dialog.close();
  form.append(label, submit, cancel); dialog.append(form); container.append(dialog);
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); signal?.removeEventListener('abort', close); };
  dialog.addEventListener('close', close, { once: true }); signal?.addEventListener('abort', close, { once: true });
  form.addEventListener('submit', event => { event.preventDefault(); const name = input.value.trim(); if (!name) return; close(); onSubmit(name); });
  dialog.showModal(); input.focus(); input.select();
  return close;
}
export function mountBoard(container, { client, signal, mountEditor, mountMedia }) {
  if (signal?.aborted) return () => {};
  const controller = new AbortController(), events = { signal: controller.signal };
  const root = element('section', 'notes-board'); root.dataset.boardId = client.boardId;
  const toolbar = element('div', 'notes-toolbar'); toolbar.setAttribute('aria-label', 'Công cụ bảng');
  const mutations = element('div', 'notes-tools');
  mutations.append(button('+ Note', 'note-new', true), button('+ Cột', 'column-new', true), button('Đổi tên bảng', 'board-rename', true), button('Bỏ bảng', 'board-trash', true), button('Thùng rác', 'trash', true), button('Hoàn tác vị trí', 'undo', true), button('Làm lại vị trí', 'redo', true), button('Lưu', 'save', true));
  // One shared format row per board; editors register into it (see mountBoardNoteEditor).
  const formatRow = element('div', 'notes-format-row'); formatRow.setAttribute('role', 'toolbar'); formatRow.setAttribute('aria-label', 'Định dạng chữ'); formatRow.hidden = true;
  const durability = element('p', 'notes-durability'); durability.setAttribute('role', 'status');
  const error = element('p', 'notes-error'); error.setAttribute('role', 'alert');
  const viewport = element('div', 'notes-viewport'); viewport.tabIndex = 0; viewport.setAttribute('aria-label', 'Mặt bảng. Dùng phím mũi tên để di chuyển góc nhìn.');
  // Stickers live on one board-wide layer above notes and columns, in world coordinates.
  const world = element('div', 'notes-world'), decorations = element('div', 'notes-decorations'); world.append(decorations); viewport.append(world);
  const empty = element('p', 'notes-empty', 'Một mặt giấy trống, dành cho những điều của chúng mình.');
  const cameraTools = element('div', 'notes-camera');
  const zoomLabel = element('output', 'notes-zoom', '100%'); zoomLabel.setAttribute('aria-label', 'Độ thu phóng');
  cameraTools.append(button('−', 'zoom-out'), zoomLabel, button('+', 'zoom-in'), button('Vừa màn hình', 'fit'));
  const inspector = element('div', 'notes-inspector'); inspector.setAttribute('aria-label', 'Chỉnh đối tượng đã chọn');
  const hint = element('p', 'notes-hint', 'Chuột phải kéo góc nhìn · Cuộn trên nền để zoom · Hai ngón để di chuyển trên điện thoại');
  // Camera sits in the toolbar and hint/inspector float over the board, so the board fills the screen without page scroll.
  toolbar.append(mutations, durability, cameraTools); viewport.append(hint); root.append(toolbar, formatRow, error, viewport, inspector); container.replaceChildren(root);
  let state, disposed = false, selection = null, drag = null, cameraDrag = null, pinch = null, inspectorKey = '', geometryWork = Promise.resolve();
  const cameraKey = `homie-notes:camera:${client.boardId}`;
  const camera = { x: 32, y: 32, scale: 1 }, records = new Map(), pointers = new Map();
  // follow: camera tracks fit() until the user pans/zooms; awaitContent: fit once when the first content arrives.
  let follow = true, awaitContent = true;
  try { const saved = JSON.parse(localStorage.getItem(cameraKey)); if (saved && !saved.fit && ['x', 'y', 'scale'].every(key => Number.isFinite(saved[key]))) { Object.assign(camera, { x: saved.x, y: saved.y, scale: clamp(saved.scale, .2, 3) }); follow = awaitContent = false; } } catch { /* Camera preference does not affect note durability. */ }
  function alive() { return !disposed && !controller.signal.aborted; }
  function report(cause) { if (alive()) error.textContent = cause?.code === 'lease_conflict' ? 'Người kia đang di chuyển đối tượng này. Hãy thử lại sau.' : cause?.message || 'Chưa thể lưu. Bản nháp vẫn được giữ trên thiết bị.'; }
  async function run(action) { try { return await action(); } catch (cause) { report(cause); } }
  function applyCamera(manual = false) { if (manual) follow = false; world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`; zoomLabel.value = `${Math.round(camera.scale * 100)}%`; try { localStorage.setItem(cameraKey, JSON.stringify({ ...camera, fit: follow })); } catch { /* The current view still works without local storage. */ } }
  function fit() {
    const w = viewport.clientWidth, h = viewport.clientHeight, all = [...records.values()].map(r => r.entity).concat((state?.snapshot?.decorations || []).filter(d => !d.deletedAt)); if (!alive() || !w || !h) return; follow = true;
    if (!all.length) Object.assign(camera, { x: w / 2, y: h / 2, scale: 1 });
    else { awaitContent = false; const minX=Math.min(...all.map(e=>e.x)),minY=Math.min(...all.map(e=>e.y)),maxX=Math.max(...all.map(e=>e.x+e.width)),maxY=Math.max(...all.map(e=>e.y+e.height));camera.scale=clamp(Math.min((w-64)/(maxX-minX),(h-64)/(maxY-minY)),.2,1.5);camera.x=w/2-(minX+maxX)/2*camera.scale;camera.y=h/2-(minY+maxY)/2*camera.scale; }
    applyCamera();
  }
  function worldPoint(x, y) { const rect = viewport.getBoundingClientRect(); return { x: (x - rect.left - camera.x) / camera.scale, y: (y - rect.top - camera.y) / camera.scale }; }
  function zoom(scale, x, y) {
    const rect = viewport.getBoundingClientRect(), point = worldPoint(x, y); camera.scale = clamp(scale, .2, 3);
    camera.x = x - rect.left - point.x * camera.scale; camera.y = y - rect.top - point.y * camera.scale; applyCamera(true);
  }
  function visible(kind, entity) { return !state.snapshot?.deletedAt && !entity.deletedAt && (kind !== 'note' || !entity.columnId || state.snapshot.columns.some(c => c.id === entity.columnId && !c.deletedAt)); }
  function selected() { return selection && records.get(selection.id)?.entity; }
  function place(node, entity) { Object.assign(node.style, { left: `${entity.x}px`, top: `${entity.y}px`, width: `${entity.width}px`, height: `${entity.height}px` }); }
  function select(kind, id) { selection = { kind, id }; for (const [key, record] of records) record.node.classList.toggle('is-selected', key === id); updateInspector(); }
  function updateInspector() {
    const entity = selected(); inspector.hidden = !state?.writable || !entity;
    if (inspector.hidden) { inspector.replaceChildren(); inspectorKey = ''; return; }
    const columns = state.snapshot.columns.filter(c => !c.deletedAt);
    const key = `${selection.kind}:${entity.id}:${columns.map(c => c.id + c.name).join()}`;
    if (key === inspectorKey) {
      const select = inspector.querySelector('select'); if (select && document.activeElement !== select) select.value = entity.columnId || '';
      for (const field of ['width', 'height']) { const input = inspector.querySelector(`[name=${field}]`); if (input && document.activeElement !== input) input.value = Math.round(entity[field]); }
      return;
    }
    inspectorKey = key; inspector.replaceChildren(element('strong', '', selection.kind === 'note' ? 'Tờ ghi chú' : 'Cột giấy'));
    for (const [label, action] of [['←','move-left'],['↑','move-up'],['↓','move-down'],['→','move-right']]) { const control = button(label, action, true); control.setAttribute('aria-label', `Di chuyển ${ { 'move-left':'trái', 'move-up':'lên', 'move-down':'xuống', 'move-right':'phải' }[action]} 10 điểm`); inspector.append(control); }
    for (const [field,labelText] of [['width','Rộng'],['height','Cao']]) {
      const label = element('label', '', labelText), input = document.createElement('input'); input.type = 'number'; input.name = field; input.min = selection.kind === 'note' ? 180 : 240; input.max = 2400; input.step = 10; input.value = Math.round(entity[field]); input.dataset.action = 'object-size'; input.dataset.mutation = ''; label.append(input); inspector.append(label);
    }
    if (selection.kind === 'note') {
      const label = element('label', '', 'Cột'), select = document.createElement('select'); select.dataset.action = 'object-column'; select.dataset.mutation = '';
      for (const c of [{id:'',name:'Ngoài cột'}, ...columns]) { const option = document.createElement('option'); option.value = c.id; option.textContent = c.name; select.append(option); }
      select.value = entity.columnId || ''; label.append(select); inspector.append(label);
      for (const color of colors) { const control = button('', 'note-color', true); control.style.background = color; control.dataset.color = color; control.setAttribute('aria-label', `Màu giấy ${color}`); inspector.append(control); }
    } else inspector.append(button('Đổi tên cột', 'column-rename', true));
    inspector.append(button('Bỏ vào thùng rác', 'object-trash', true));
  }
  function destroyRecord(record) { record.controller.abort(); record.editorCleanup?.(); record.node.remove(); }
  function makeRecord(kind, entity) {
    const node = element(kind === 'note' ? 'article' : 'section', kind === 'note' ? 'paper-note' : 'paper-column');
    node.dataset[kind === 'note' ? 'noteId' : 'columnId'] = entity.id;
    const handle = element('button', kind === 'note' ? 'note-handle' : 'column-handle'); handle.type = 'button'; handle.dataset.drag = kind; handle.setAttribute('aria-label', kind === 'note' ? 'Di chuyển ghi chú' : 'Di chuyển cột');
    const title = element('span', kind === 'note' ? 'note-author' : 'column-name'); handle.append(title); node.append(handle);
    const record = { kind, entity, node, handle, title, controller: new AbortController() };
    if (kind === 'note') {
      const text = element('div', 'note-text'); text.dataset.noteId = entity.id;
      record.text = text; node.append(text);
      record.editorCleanup = mountEditor?.(text, { client, note: entity, signal: record.controller.signal, formatRow });
    }
    const resize = button('↘', 'object-resize', true); resize.classList.add('note-resize'); resize.dataset.drag = 'resize'; resize.setAttribute('aria-label', 'Kéo đổi kích thước'); node.append(resize);
    world.append(node); records.set(entity.id, record); return record;
  }
  function textContent(value) { if (!value) return ''; if (typeof value === 'string') return value; if (value.text) return value.text; return (value.content || []).map(textContent).join(value.type === 'doc' ? '\n' : ''); }
  function render(next) {
    if (!alive()) return;
    const modeChanged = state && next.writable !== state.writable;
    state = next;
    mutations.querySelector('[data-action=undo]').disabled = !state.history.canUndo;
    mutations.querySelector('[data-action=redo]').disabled = !state.history.canRedo;
    if (modeChanged) { cancelDrag(); for (const record of records.values()) destroyRecord(record); records.clear(); selection = null; }
    if(state.writable){if(mutations.parentNode!==toolbar)toolbar.prepend(mutations);}else {mutations.remove();for(const dialog of root.querySelectorAll('dialog'))dialog.remove();}
    formatRow.hidden = !state.writable;
    // Hidden mutation DOM is removed on auth downgrade, including editor/media slots.
    for (const control of mutations.children) control.toggleAttribute('data-mutation', state.writable);
    durability.dataset.durability = state.durability;
    durability.textContent = ({ unknown: 'Đang kiểm tra kết nối…', saving: 'Đang lưu…', local: 'Đã lưu trên thiết bị · Chờ đồng bộ', saved: 'Đã lưu', unsaved: 'Chưa lưu trên thiết bị · Hãy thử Lưu lại' })[state.durability] + (state.connection === 'offline' ? ' · Ngoại tuyến' : '') + (state.pending.total ? ` · ${state.pending.total} mục đang chờ` : '');
    if (!state.writable) durability.textContent = state.connection === 'auth-required' ? 'Phiên đã hết hạn · Đang xem công khai' : state.connection === 'online' ? 'Chế độ xem' : 'Đang mở bảng…';
    error.textContent = state.error?.message || (state.leaseState === 'blocked' ? 'Đối tượng đang được người kia di chuyển.' : state.leaseState === 'lost' && drag?.leased ? 'Đã mất quyền kéo. Vị trí đã trở về bản được lưu.' : '');
    // A stale 'lost' left by a reconnect must not cancel a drag that has not taken its lease yet.
    if (drag && ((drag.leased && state.leaseState === 'lost') || !state.writable)) cancelDrag();
    const ids = new Set();
    for (const kind of ['column', 'note']) for (const entity of state.snapshot?.[kind === 'column' ? 'columns' : 'notes'] || []) {
      if (!visible(kind, entity)) continue; ids.add(entity.id);
      const record = records.get(entity.id) || makeRecord(kind, entity); record.entity = entity;
      const dragged = drag && (drag.id === entity.id || drag.kind === 'column' && entity.columnId === drag.id);
      if (!dragged) place(record.node, entity);
      record.title.textContent = kind === 'note' ? authors[entity.authorId] || entity.authorId : entity.name;
      record.handle.disabled = !state.writable; record.node.querySelector('.note-resize').hidden = !state.writable;
      record.node.querySelector('.note-resize').toggleAttribute('data-mutation', state.writable);
      if (kind === 'note') { record.node.style.backgroundColor = entity.color; record.node.dataset.columnId = entity.columnId || ''; if (!mountEditor) { record.text.textContent = textContent(entity.content) || ''; record.text.setAttribute('aria-label', 'Nội dung ghi chú'); } }
    }
    for (const [id, record] of records) if (!ids.has(id)) { if (drag?.id === id) cancelDrag(); destroyRecord(record); records.delete(id); }
    if (selection && !records.has(selection.id)) selection = null;
    empty.textContent = state.snapshot?.deletedAt ? 'Bảng đang ở thùng rác. Khôi phục bảng để xem nội dung.' : state.snapshot ? 'Một mặt giấy trống, dành cho những điều của chúng mình.' : 'Đang mở mặt giấy…';
    if (!records.size) viewport.append(empty); else empty.remove();
    if (follow && awaitContent && records.size) fit();
    updateInspector();
  }
  async function mutate(type, payload) { if (!state.writable || !alive()) return; return client.command({type,payload}); }
  function geometry(kind, entity, patch, move = false) {
    const id = entity.id;
    const job = geometryWork.then(async () => {
      if (!alive() || !state.writable) return;
      // Resolve relative intent after earlier actions and pending creations settle.
      let online = state.connection === 'online';
      if (online) { await client.flush(); if (!alive() || !state.writable) return; online = state.connection === 'online'; }
      const current = records.get(id)?.entity; if (!current) return;
      const destination = typeof patch === 'function' ? patch(current) : patch;
      const target = {kind,id};
      if (online) await client.acquireLease(target);
      try { if (alive() && state.writable) await mutate(`${kind}.${move ? 'move' : 'update'}`, {id,...destination}); }
      finally { if (online) await client.releaseLease(target).catch(() => {}); }
    });
    geometryWork = job.catch(() => {}); return job;
  }
  function creationPoint() { const rect = viewport.getBoundingClientRect(); return worldPoint(rect.left + Math.min(rect.width / 2, 380), rect.top + Math.min(rect.height / 2, 220)); }
  async function showTrash() {
    if (!state.writable) return;
    const dialog = element('dialog', 'notes-dialog notes-trash'); dialog.append(element('h2', '', 'Thùng rác của bảng'));
    const message = element('p', '', 'Khôi phục từng mục. Mục vẫn bị ẩn nếu bảng hoặc cột cha còn trong thùng rác.'); dialog.append(message);
    const items = [{kind:'board', entity:state.snapshot}, ...(state.snapshot?.columns || []).map(entity=>({kind:'column',entity})), ...(state.snapshot?.notes || []).map(entity=>({kind:'note',entity}))].filter(item=>item.entity?.deletedAt);
    if (!items.length) dialog.append(element('p', '', 'Chưa có mục nào trong thùng rác.'));
    for (const {kind,entity} of items) { const row = element('div', 'notes-trash-row'), restore = button('Khôi phục', 'restore', true); row.append(element('span','', entity.name || `Ghi chú của ${authors[entity.authorId]}`), restore); restore.onclick = () => run(async()=>{await mutate(`${kind}.restore`,kind === 'board' ? {} : {id:entity.id});if(alive() && state.writable) {row.remove(); message.textContent='Đã gửi khôi phục. Nếu mục cha còn bị xóa, hãy khôi phục mục cha để xem lại.';}}); dialog.append(row); }
    const close = button('Đóng', 'close'); close.onclick = () => dialog.close(); dialog.append(close); root.append(dialog);
    const stop = () => {dialog.remove(); controller.signal.removeEventListener('abort', stop);}; dialog.onclose = stop; controller.signal.addEventListener('abort',stop,{once:true}); dialog.showModal();
  }
  root.addEventListener('click', event => {
    const handle = event.target.closest('[data-drag]'); if (handle && handle.dataset.drag !== 'resize' && state.writable) { const node = handle.closest('.paper-note,.paper-column'); select(handle.dataset.drag, node.dataset.noteId || node.dataset.columnId); }
    const control = event.target.closest('[data-action]'); if (!control) return;
    const action = control.dataset.action, entity = selected();
    run(async () => {
      if (action === 'zoom-in' || action === 'zoom-out') { const rect = viewport.getBoundingClientRect(); zoom(camera.scale * (action === 'zoom-in' ? 1.2 : 1 / 1.2), rect.left + rect.width / 2, rect.top + rect.height / 2); return; }
      if (action === 'fit') { fit(); return; }
      if (!state.writable) return;
      if (action === 'save') await client.flush();
      if (action === 'undo') await client.undo();
      if (action === 'redo') await client.redo();
      if (action === 'note-new') {const point=creationPoint();await mutate('note.create',{id:crypto.randomUUID(),columnId:selection?.kind==='column'?selection.id:null,x:point.x-180,y:point.y-120,width:360,height:320,color:colors[0]});}
      if (action === 'column-new') askName(root,{title:'Tên cột mới',signal:controller.signal,onSubmit:name=>run(()=>{const p=creationPoint();return mutate('column.create',{id:crypto.randomUUID(),name,x:p.x-160,y:p.y-110,width:360,height:480});})});
      if (action === 'board-rename') askName(root,{title:'Đổi tên bảng',value:state.snapshot?.name,signal:controller.signal,onSubmit:name=>run(()=>mutate('board.rename',{name}))});
      if (action === 'board-trash') await mutate('board.trash',{});
      if (action === 'trash') await showTrash();
      if (!entity) return;
      if (action.startsWith('move-')) {const delta={ 'move-left':[-10,0], 'move-right':[10,0], 'move-up':[0,-10], 'move-down':[0,10] }[action]; if(delta)await geometry(selection.kind,entity,current=>({x:current.x+delta[0],y:current.y+delta[1]}));}
      if (action === 'note-color') await mutate('note.update',{id:entity.id,color:control.dataset.color});
      if (action === 'object-trash') await mutate(`${selection.kind}.trash`,{id:entity.id});
      if (action === 'column-rename') askName(root,{title:'Đổi tên cột',value:entity.name,signal:controller.signal,onSubmit:name=>run(()=>mutate('column.update',{id:entity.id,name}))});
    });
  }, events);
  inspector.addEventListener('change', event => {const entity=selected();if(!entity || !state.writable)return;const input=event.target, columnId=input.value || null;
    run(()=>input.dataset.action==='object-column' ? geometry('note',entity,current=>({columnId,x:current.x,y:current.y}),true)
      : input.dataset.action==='object-size' && Number.isFinite(input.valueAsNumber) ? geometry(selection.kind,entity,{[input.name]:clampPaperSize(selection.kind,input.valueAsNumber)}) : undefined);
  },events);
  root.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='s' && state.writable) {event.preventDefault();run(()=>client.flush());return;}
    if (event.target.closest('input,select,textarea,[contenteditable=true],.note-text')) return;
    if ((event.ctrlKey || event.metaKey) && ['z','y'].includes(event.key.toLowerCase()) && state.writable) {event.preventDefault();run(()=>event.shiftKey || event.key.toLowerCase()==='y' ? client.redo() : client.undo());return;}
    if(event.key==='Escape') {cancelDrag();return;}
    const delta={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[event.key]; if(!delta)return;
    const handle=event.target.closest('[data-drag]');
    if(handle && state.writable) {event.preventDefault();const node=handle.closest('.paper-note,.paper-column'),kind=node.classList.contains('paper-note')?'note':'column';select(kind,node.dataset.noteId||node.dataset.columnId);const e=selected(),amount=event.shiftKey?5:1;run(()=>geometry(kind,e,current=>({x:current.x+delta[0]*amount,y:current.y+delta[1]*amount})));}
    else if(event.target===viewport) {event.preventDefault();camera.x-=delta[0]*3;camera.y-=delta[1]*3;applyCamera(true);}
  },events);
  // While a note or column is dragged, the stickers that follow it move along (CSS translate; the saved move shifts them for real).
  function carryStickers(active){const moving=new Set(active&&!active.resize?[...records.values()].filter(r=>r.entity.id===active.id||active.kind==='column'&&r.entity.columnId===active.id).map(r=>r.entity.id):[]);
    for(const node of decorations.querySelectorAll('.note-decoration')){const follows=moving.has(node.dataset.noteId)||active?.kind==='column'&&node.dataset.columnId===active.id;node.style.translate=follows?`${active.dx}px ${active.dy}px`:'';}}
  function cancelDrag() {
    const previous=drag;drag=null;carryStickers(null);
    if(previous) {for(const record of records.values())place(record.node,record.entity);if(previous.leased)client.releaseLease({kind:previous.kind,id:previous.id}).catch(()=>{});}
  }
  viewport.addEventListener('contextmenu',event=>event.preventDefault(),events);
  viewport.addEventListener('wheel',event=>{if(event.target.closest('.note-text'))return;event.preventDefault();zoom(camera.scale*Math.exp(-event.deltaY*.0015),event.clientX,event.clientY);},{...events,passive:false});
  viewport.addEventListener('pointerdown',event=>{
    if(event.target.closest('.note-text,input,select,textarea,[contenteditable=true]'))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(event.pointerType==='touch' && pointers.size===2) {cancelDrag();const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),scale:camera.scale,point:worldPoint((a.x+b.x)/2,(a.y+b.y)/2)};viewport.setPointerCapture(event.pointerId);event.preventDefault();return;}
    if(event.button===2) {cameraDrag={id:event.pointerId,x:event.clientX,y:event.clientY,startX:camera.x,startY:camera.y};viewport.setPointerCapture(event.pointerId);event.preventDefault();return;}
    const handle=event.target.closest('[data-drag]');if(event.button!==0 || !handle || !state.writable)return;
    const node=handle.closest('.paper-note,.paper-column'),kind=node.classList.contains('paper-note')?'note':'column',id=node.dataset.noteId||node.dataset.columnId;
    select(kind,id);cancelDrag();const entity=selected();drag={id,kind,pointerId:event.pointerId,entity:{...entity},x:event.clientX,y:event.clientY,dx:0,dy:0,resize:handle.dataset.drag==='resize',ready:state.connection!=='online',leased:false};
    const pending=drag;viewport.setPointerCapture(event.pointerId);event.preventDefault();handle.focus();
    if(!pending.ready)run(async()=>{try{await client.flush();if(!alive()||drag!==pending)return;const online=state.connection==='online';if(online)await client.acquireLease({kind,id});if(!alive()||drag!==pending){if(online)await client.releaseLease({kind,id});return;}pending.ready=true;pending.leased=online;}catch(cause){if(drag===pending)cancelDrag();throw cause;}});
  },events);
  viewport.addEventListener('pointermove',event=>{
    if(pointers.has(event.pointerId))pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pinch && pointers.size>=2){const[a,b]=[...pointers.values()],rect=viewport.getBoundingClientRect();camera.scale=clamp(pinch.scale*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance),.2,3);camera.x=(a.x+b.x)/2-rect.left-pinch.point.x*camera.scale;camera.y=(a.y+b.y)/2-rect.top-pinch.point.y*camera.scale;applyCamera(true);return;}
    if(cameraDrag?.id===event.pointerId){camera.x=cameraDrag.startX+event.clientX-cameraDrag.x;camera.y=cameraDrag.startY+event.clientY-cameraDrag.y;applyCamera(true);return;}
    if(!drag?.ready||drag.pointerId!==event.pointerId)return;
    drag.dx=(event.clientX-drag.x)/camera.scale;drag.dy=(event.clientY-drag.y)/camera.scale;
    for(const record of records.values())if(record.entity.id===drag.id || !drag.resize && drag.kind==='column' && record.entity.columnId===drag.id){const e=record.entity;place(record.node,drag.resize?{...e,width:clampPaperSize(drag.kind,drag.entity.width+drag.dx),height:clampPaperSize(drag.kind,drag.entity.height+drag.dy)}:{...e,x:e.x+drag.dx,y:e.y+drag.dy});}
    carryStickers(drag);
  },events);
  function endPointer(event,cancel=false){pointers.delete(event.pointerId);if(pointers.size<2)pinch=null;if(cameraDrag?.id===event.pointerId)cameraDrag=null;
    if(drag?.pointerId===event.pointerId){const ended=drag;drag=null;carryStickers(null);for(const record of records.values())place(record.node,record.entity);
      run(async()=>{try{if(!cancel && ended.ready && state.writable && (Math.abs(ended.dx)>1||Math.abs(ended.dy)>1)) {const e=ended.entity;
        if(ended.resize)await mutate(`${ended.kind}.update`,{id:e.id,width:clampPaperSize(ended.kind,e.width+ended.dx),height:clampPaperSize(ended.kind,e.height+ended.dy)});
        else {const x=e.x+ended.dx,y=e.y+ended.dy;const column=ended.kind==='note'?(state.snapshot.columns||[]).filter(c=>!c.deletedAt).findLast(c=>x+e.width/2>=c.x&&x+e.width/2<=c.x+c.width&&y+e.height/2>=c.y&&y+e.height/2<=c.y+c.height):null;await mutate(`${ended.kind}.${ended.kind==='note'?'move':'update'}`,{id:e.id,x,y,...(ended.kind==='note'?{columnId:column?.id||null}:{})});}
      }}finally{if(ended.leased)await client.releaseLease({kind:ended.kind,id:ended.id}).catch(()=>{});}});
    }
    if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);
  }
  viewport.addEventListener('pointerup',event=>endPointer(event),events);viewport.addEventListener('pointercancel',event=>endPointer(event,true),events);viewport.addEventListener('lostpointercapture',event=>{if(drag?.pointerId===event.pointerId)endPointer(event,true);},events);
  const unsubscribe=client.subscribe(render),mediaCleanup=mountMedia?.(decorations,{client,signal:controller.signal,formatRow});if(follow)fit();else applyCamera();
  const resizeObserver=new ResizeObserver(()=>{if(follow)fit();});resizeObserver.observe(viewport);
  const stopPresence=mountBoardPresence(viewport,{client,signal:controller.signal,worldPoint});
  function cleanup(){if(disposed)return;disposed=true;resizeObserver.disconnect();cancelDrag();controller.abort();unsubscribe();mediaCleanup?.();stopPresence();for(const record of records.values())destroyRecord(record);records.clear();signal?.removeEventListener('abort',cleanup);root.remove();}
  signal?.addEventListener('abort',cleanup,{once:true});return cleanup;
}
