import { authEvents, getUser } from '../auth.js';
import { openBoardClient, subscribeBoards } from '../notes/client.js';
import { mountBoard, askName } from '../notes/board.js';

const lastKey = 'homie-notes:last-board';
const pendingKey = account => `homie-notes:pending-boards:${account}`;
function stored(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* IndexedDB remains the source of draft durability. */ } }
export function render(container, { signal }) {
  if (signal.aborted) return () => {};
  const root = document.createElement('section'); root.className = 'notes-dashboard';
  root.innerHTML = '<div class="notes-heading"><div><p class="notes-eyebrow">NHỮNG ĐIỀU MUỐN GIỮ</p><h1>Góc ghi chép</h1></div><div class="notes-catalog-actions"></div></div><div class="notes-tabs" role="tablist" aria-label="Các bảng ghi chú"></div><p class="notes-catalog-status" role="status"></p><div class="notes-board-host"></div>';
  container.replaceChildren(root);
  const tabs = root.querySelector('.notes-tabs'), actions = root.querySelector('.notes-catalog-actions'), status = root.querySelector('.notes-catalog-status'), host = root.querySelector('.notes-board-host');
  let disposed = false, boards = [], catalogLoaded = false, selectedId = stored(lastKey, null), account = getUser()?.id || null, pending = account ? stored(pendingKey(account), []) : [], current = null, generation = 0, explicitTrash = false;
  const tabButtons = new Map();
  function alive() { return !disposed && !signal.aborted; }
  function button(label, action) { const control=document.createElement('button');control.type='button';control.className='notes-button';control.textContent=label;control.dataset.action=action;control.dataset.mutation='';return control; }
  function stopCurrent() {generation++;if(current){current.controller.abort();current.cleanup?.();current.client?.close();current=null;}host.replaceChildren();}
  function showError(error) { if(alive())status.textContent=error?.message || 'Chưa thể mở bảng. Hãy kiểm tra kết nối.'; }
  function available() {return [...boards,...pending.filter(p=>!boards.some(b=>b.id===p.id)).map(p=>({...p,pending:true}))];}
  function renderTabs() {
    if(!alive())return;
    const list=available();
    for(const [id,control] of tabButtons)if(!list.some(b=>b.id===id)){control.remove();tabButtons.delete(id);}
    for(const board of list){let control=tabButtons.get(board.id);if(!control){control=document.createElement('button');control.type='button';control.className='notes-board-tab';control.setAttribute('role','tab');control.dataset.boardTab=board.id;control.id=`board-tab-${board.id}`;control.setAttribute('aria-controls','notes-selected-board');control.onclick=()=>selectBoard(board.id);tabs.append(control);tabButtons.set(board.id,control);}control.textContent=board.name+(board.pending?' · Trên thiết bị':'');control.setAttribute('aria-selected',String(board.id===selectedId));control.tabIndex=board.id===selectedId?0:-1;}
    if(!current && !list.length){status.textContent=catalogLoaded?'Chưa có bảng nào. '+(account?'Tạo một bảng trống và đặt tên cho những điều muốn giữ.':'Khi có bảng, bạn có thể ghé vào xem ở đây.'):'Đang tìm những trang giấy…';}
  }
  async function selectBoard(id, { trash = false, force = false } = {}) {
    if(!alive() || current?.id===id && !force)return;
    stopCurrent();selectedId=id;explicitTrash=trash;if(!trash)save(lastKey,id);renderTabs();
    if(!id)return;
    const owner=account, intent=pending.find(board=>board.id===id && (!board.accountId || board.accountId===owner));
    const session={id,controller:new AbortController(),client:null,cleanup:null};current=session;const request=generation;
    host.id='notes-selected-board';host.setAttribute('role','tabpanel');if(tabButtons.has(id)){host.setAttribute('aria-labelledby',`board-tab-${id}`);host.removeAttribute('aria-label');}else{host.removeAttribute('aria-labelledby');host.setAttribute('aria-label','Bảng đã xóa');}status.textContent='Đang mở bảng…';
    try{
      const client=await openBoardClient({boardId:id,accountId:owner,signal:session.controller.signal});
      if(!alive()||current!==session||request!==generation){client.close();return;}
      session.client=client;session.cleanup=mountBoard(host,{client,signal:session.controller.signal});status.textContent='';
      if(intent && owner===account){
        const retained=client.getPending().find(entry=>entry.kind==='command' && entry.command.type==='board.create');
        intent.operationId=retained?.operationId || intent.operationId || crypto.randomUUID();intent.accountId=owner;save(pendingKey(owner),pending);
        await client.command(retained?.command || {operationId:intent.operationId,accountId:owner,type:'board.create',baseRevision:0,payload:{name:intent.name}});
      }
    }catch(error){if(alive()&&current===session)showError(error);}
  }
  function reconcile() {
    if(!alive())return;
    const list=available();
    if(!explicitTrash && !list.some(b=>b.id===selectedId)){selectedId=list[0]?.id || null;if(!selectedId)stopCurrent();}
    renderTabs();if(selectedId && current?.id!==selectedId)selectBoard(selectedId);
  }
  async function showBoardTrash() {
    if(!account)return;
    const request=generation, owner=account;
    let client=current?.client, temporary;
    try{
      if(!client){temporary=new AbortController();client=await openBoardClient({boardId:crypto.randomUUID(),accountId:owner,signal:temporary.signal});}
      const deleted=await client.listTrash();if(!alive()||owner!==account||request!==generation)return;
      const dialog=document.createElement('dialog');dialog.className='notes-dialog notes-board-trash';const title=document.createElement('h2');title.textContent='Các bảng đã cất đi';dialog.append(title);
      if(!deleted.length){const text=document.createElement('p');text.textContent='Thùng rác chưa có bảng nào.';dialog.append(text);}
      for(const board of deleted){const row=document.createElement('div');row.className='notes-trash-row';const text=document.createElement('span');text.textContent=board.name;const open=button('Mở để khôi phục','trash-open');open.onclick=()=>{dialog.close();selectBoard(board.id,{trash:true});};row.append(text,open);dialog.append(row);}
      const close=button('Đóng','trash-close');close.onclick=()=>dialog.close();dialog.append(close);dialog.onclose=()=>dialog.remove();root.append(dialog);dialog.showModal();
    }catch(error){if(owner===account)showError(error);}finally{if(temporary){temporary.abort();client?.close();}}
  }
  function renderActions(){actions.replaceChildren();if(!account)return;
    const create=button('+ Bảng mới','board-new'),trash=button('Bảng đã xóa','boards-trash');
    create.onclick=()=>askName(root,{title:'Tên bảng mới',signal,onSubmit:name=>{const id=crypto.randomUUID();pending.push({id,name,operationId:crypto.randomUUID(),accountId:account});save(pendingKey(account),pending);selectBoard(id);}});
    trash.onclick=showBoardTrash;actions.append(create,trash);
  }
  tabs.addEventListener('keydown',event=>{const list=[...tabButtons.values()];let index=list.indexOf(event.target);if(index<0)return;if(event.key==='ArrowRight')index=(index+1)%list.length;else if(event.key==='ArrowLeft')index=(index-1+list.length)%list.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=list.length-1;else return;event.preventDefault();list[index].focus();selectBoard(list[index].dataset.boardTab);},{signal});
  const unsubscribe=subscribeBoards({signal},result=>{if(!alive())return;if(result.boards===null){status.textContent='Chưa kết nối được danh sách bảng. Các bản nháp trên thiết bị vẫn được giữ.';renderTabs();return;}
    boards=result.boards;catalogLoaded=true;pending=pending.filter(p=>!boards.some(b=>b.id===p.id));if(account)save(pendingKey(account),pending);reconcile();
  });
  function authChanged(){const next=getUser()?.id||null;if(next===account)return;stopCurrent();for(const dialog of root.querySelectorAll('dialog'))dialog.remove();account=next;pending=account?stored(pendingKey(account),[]):[];explicitTrash=false;renderActions();reconcile();}
  authEvents.addEventListener('change',authChanged,{signal});renderActions();renderTabs();
  function cleanup(){if(disposed)return;disposed=true;stopCurrent();unsubscribe();authEvents.removeEventListener('change',authChanged);signal.removeEventListener('abort',cleanup);root.remove();}
  signal.addEventListener('abort',cleanup,{once:true});return cleanup;
}
