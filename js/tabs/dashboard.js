import { authEvents, getUser } from '../auth.js';
import { openBoardClient, subscribeBoards } from '../notes/client.js';
import { mountBoard, askName } from '../notes/board.js';
import { mountBoardNoteEditor } from '../notes/editor.js';
import { mountBoardMedia, openLibrary } from '../notes/library.js';

const lastKey = 'homie-notes:last-board';
// "Nội quy" is a tab among the boards for members, but not a board: it mounts the rules panel instead.
const RULES = 'rules';
// Other pages open a note by writing {boardId, noteId} here and going to #dashboard; it is read once.
const focusKey = 'homie-notes:focus';
function takeFocus() {
  try {
    const value = JSON.parse(sessionStorage.getItem(focusKey)); sessionStorage.removeItem(focusKey);
    return typeof value?.boardId === 'string' && typeof value.noteId === 'string' ? value : null;
  } catch { return null; }
}
const pendingKey = account => `homie-notes:pending-boards:${account}`;
function stored(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* IndexedDB remains the source of draft durability. */ } }
export function render(container, { signal }) {
  if (signal.aborted) return () => {};
  const root = document.createElement('section'); root.className = 'notes-dashboard';
  root.innerHTML = '<div class="notes-heading"><p class="notes-eyebrow">NHỮNG ĐIỀU MUỐN GIỮ</p><h1>Góc ghi chép</h1></div><button type="button" class="notes-switcher" aria-expanded="false" aria-label="Chọn bảng"><span class="notes-switcher-name"></span><span class="notes-switcher-pill"></span><span class="notes-switcher-caret" aria-hidden="true">▾</span></button><div class="notes-catalog-bar"><div class="notes-tab-strip"><div class="notes-tabs" role="tablist" aria-label="Các bảng ghi chú"></div></div><div class="notes-catalog-actions"></div></div><p class="notes-catalog-status" role="status"></p><div class="notes-board-host"></div>';
  container.replaceChildren(root);
  const tabs = root.querySelector('.notes-tabs'), strip = root.querySelector('.notes-tab-strip'), actions = root.querySelector('.notes-catalog-actions'), status = root.querySelector('.notes-catalog-status'), host = root.querySelector('.notes-board-host');
  let focus = takeFocus();
  let disposed = false, boards = [], catalogLoaded = false, selectedId = focus?.boardId ?? stored(lastKey, null), account = getUser()?.id || null, pending = account ? stored(pendingKey(account), []) : [], current = null, generation = 0, explicitTrash = false, closeGlobalLibrary = null;
  const tabButtons = new Map(), switcher = root.querySelector('.notes-switcher'), catalogBar = root.querySelector('.notes-catalog-bar');
  // Phone (≤600px): the catalog bar (tabs and board actions) opens as a bottom sheet from the board switcher.
  function setSwitching(open){if(root.classList.contains('is-switching')===open)return;root.classList.toggle('is-switching',open);switcher.setAttribute('aria-expanded',String(open));if(open)(tabs.querySelector('[aria-selected=true]')||catalogBar.querySelector('button'))?.focus();else if(catalogBar.contains(document.activeElement))switcher.focus();}
  switcher.addEventListener('click',()=>setSwitching(!root.classList.contains('is-switching')),{signal});
  catalogBar.addEventListener('click',event=>{if(event.target.closest('button'))setSwitching(false);},{signal});
  root.addEventListener('click',event=>{if(event.target===root)setSwitching(false);},{signal});
  root.addEventListener('keydown',event=>{if(event.key==='Escape'&&root.classList.contains('is-switching')){event.preventDefault();setSwitching(false);}},{signal});
  // Phone keyboards shrink the visual viewport, not the layout one; the phone dashboard follows it so the dock stays above the keyboard.
  const visual=window.visualViewport,followScreen=()=>root.style.setProperty("--notes-vh",`${visual.height}px`);if(visual){followScreen();visual.addEventListener('resize',followScreen,{signal});addEventListener('resize',followScreen,{signal});}
  function alive() { return !disposed && !signal.aborted; }
  function button(label, action) { const control=document.createElement('button');control.type='button';control.className='notes-button';control.textContent=label;control.dataset.action=action;control.dataset.mutation='';return control; }
  function stopCurrent() {generation++;closeGlobalLibrary?.();closeGlobalLibrary=null;if(current){current.controller.abort();current.cleanup?.();current.client?.close();current=null;}host.replaceChildren();}
  function showError(error) { if(alive())status.textContent=error?.message || 'Chưa thể mở bảng. Hãy kiểm tra kết nối.'; }
  function available() {return [...boards,...pending.filter(p=>!boards.some(b=>b.id===p.id)).map(p=>({...p,pending:true})),...(account?[{id:RULES,name:'Nội quy',visibility:'shared'}]:[])];}
  function renderTabs() {
    if(!alive())return;
    const list=available();
    for(const [id,control] of tabButtons)if(!list.some(b=>b.id===id)){control.remove();tabButtons.delete(id);}
    for(const board of list){let control=tabButtons.get(board.id);if(!control){control=document.createElement('button');control.type='button';control.className='notes-board-tab';control.setAttribute('role','tab');control.dataset.boardTab=board.id;control.id=`board-tab-${board.id}`;control.setAttribute('aria-controls','notes-selected-board');control.onclick=()=>selectBoard(board.id);tabs.append(control);tabButtons.set(board.id,control);}control.textContent=board.name+(board.pending?' · Trên thiết bị':'');control.dataset.visibility=board.visibility==='public'||board.visibility==='shared'?board.visibility:board.visibility?'private':'';control.title=board.visibility==='public'?'Ai cũng xem được':board.visibility==='shared'?'Chỉ hai đứa mình':board.visibility?'Chỉ mình tôi':'';control.setAttribute('aria-selected',String(board.id===selectedId));control.tabIndex=board.id===selectedId?0:-1;}
    // Moving a node drops its focus, so only move the rules tab when a new board landed after it.
    const rulesTab=tabButtons.get(RULES);if(rulesTab&&tabs.lastChild!==rulesTab)tabs.append(rulesTab);
    const chosen=list.find(b=>b.id===selectedId),pill=root.querySelector('.notes-switcher-pill');
    root.querySelector('.notes-switcher-name').textContent=chosen?chosen.name:explicitTrash?'Bảng đã xóa':list.some(b=>b.id!==RULES)?'Chọn bảng':'Chưa có bảng';
    pill.textContent=chosen?.visibility==='public'?'công khai':chosen?.visibility&&chosen.visibility!=='shared'?'riêng':'';pill.dataset.visibility=chosen?.visibility==='public'?'public':'';
    if(!current && !list.some(b=>b.id!==RULES)){if(catalogLoaded&&account){if(!status.querySelector('.notes-empty-create'))status.replaceChildren(emptyCreate());}else{status.textContent=catalogLoaded?'Chưa có bảng nào. Đăng nhập để tạo bảng đầu tiên, hoặc ghé lại xem sau nhé. ':'Đang tìm những trang giấy…';if(catalogLoaded)status.append(loginButton());}}
  }
  async function selectBoard(id, { trash = false, force = false } = {}) {
    if(!alive() || current?.id===id && !force)return;
    stopCurrent();selectedId=id;explicitTrash=trash;if(!trash)save(lastKey,id);renderTabs();
    if(!id)return;
    if(id===RULES){mountRules();return;}
    const owner=account, intent=pending.find(board=>board.id===id && (!board.accountId || board.accountId===owner));
    const session={id,controller:new AbortController(),client:null,cleanup:null};current=session;const request=generation;
    host.id='notes-selected-board';host.setAttribute('role','tabpanel');if(tabButtons.has(id)){host.setAttribute('aria-labelledby',`board-tab-${id}`);host.removeAttribute('aria-label');}else{host.removeAttribute('aria-labelledby');host.setAttribute('aria-label','Bảng đã xóa');}status.textContent='Đang mở bảng…';
    try{
      const client=await openBoardClient({boardId:id,accountId:owner,signal:session.controller.signal});
      if(!alive()||current!==session||request!==generation){client.close();return;}
      const focusNoteId=focus?.boardId===id?focus.noteId:null;focus=null;
      session.client=client;session.cleanup=mountBoard(host,{client,signal:session.controller.signal,mountEditor:mountBoardNoteEditor,mountMedia:mountBoardMedia,focusNoteId});status.textContent='';
      if(intent && owner===account){
        const retained=client.getPending().find(entry=>entry.kind==='command' && entry.command.type==='board.create');
        intent.operationId=retained?.operationId || intent.operationId || crypto.randomUUID();intent.accountId=owner;save(pendingKey(owner),pending);
        await client.command(retained?.command || {operationId:intent.operationId,accountId:owner,type:'board.create',baseRevision:0,payload:{name:intent.name,...(intent.noteDefault?{noteDefault:intent.noteDefault}:{})}});
      }
    }catch(error){if(alive()&&current===session)showError(error);}
  }
  // Loaded on demand so the boards keep working even if the rules panel fails to load.
  function mountRules(){
    const session={id:RULES,controller:new AbortController(),client:null,cleanup:null};current=session;
    host.id='notes-selected-board';host.setAttribute('role','tabpanel');host.setAttribute('aria-labelledby',`board-tab-${RULES}`);host.removeAttribute('aria-label');status.textContent='Đang mở nội quy…';
    import('../notes/rules-panel.js').then(({mountRulesPanel})=>{if(!alive()||current!==session)return;status.textContent='';session.cleanup=mountRulesPanel(host,{signal:session.controller.signal});})
      .catch(()=>{if(alive()&&current===session)status.textContent='Đang làm';});
  }
  function reconcile() {
    if(!alive())return;
    const list=available();
    if(!explicitTrash && !list.some(b=>b.id===selectedId)){selectedId=list.find(b=>b.id!==RULES)?.id || null;if(!selectedId)stopCurrent();}
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
  // Guests get a sign-in entry; the shell owns the login dialog (app.js listens for 'login-request').
  function loginButton(){const control=document.createElement('button');control.type='button';control.className='notes-button notes-login';control.dataset.action='login';control.textContent='Đăng nhập để viết';control.onclick=()=>authEvents.dispatchEvent(new Event('login-request'));return control;}
  function askNewBoard(){askName(root,{title:'Tên bảng mới',option:'Nhật ký: note mới mặc định "Chỉ mình tôi"',signal,onSubmit:(name,journal)=>{const id=crypto.randomUUID();pending.push({id,name,operationId:crypto.randomUUID(),accountId:account,...(journal?{noteDefault:'private'}:{})});save(pendingKey(account),pending);selectBoard(id);}});}
  // No boards yet: the empty frame itself is one large "+" (the small tab "+" hides via CSS while it exists).
  function emptyCreate(){const control=document.createElement('button');control.type='button';control.className='notes-empty-create';control.dataset.action='board-new-empty';control.dataset.mutation='';control.setAttribute('aria-label','Tạo bảng mới');control.innerHTML='<span class="notes-empty-plus" aria-hidden="true">+</span><span class="notes-empty-label">Tạo bảng đầu tiên</span>';control.onclick=askNewBoard;return control;}
  function renderActions(){actions.replaceChildren();strip.replaceChildren(tabs);if(!account){actions.append(loginButton());return;}
    // The "+" sits after the tablist (not inside it) so arrow keys and tab roles only cover real boards.
    const create=button('+','board-new'),trash=button('Bảng đã xóa','boards-trash'),library=button('Thư viện hình','library-open');create.className='notes-tab-new';create.setAttribute('aria-label','Tạo bảng mới');strip.append(create);
    create.onclick=askNewBoard;
    library.onclick=async()=>{closeGlobalLibrary?.();const owner=account,request=generation;let temporary,client=current?.client;try{if(!client){temporary=new AbortController();client=await openBoardClient({boardId:'00000000-0000-4000-8000-000000000007',accountId:owner,signal:temporary.signal});}if(!alive()||owner!==account||request!==generation){temporary?.abort();if(temporary)client.close();return;}const cleanup=openLibrary(root,{client,signal:temporary?.signal || current?.controller.signal || signal});const closer=()=>{cleanup();if(temporary){temporary.abort();client.close();}};closeGlobalLibrary=closer;root.querySelector('.note-library')?.addEventListener('close',()=>{/* A replaced dialog's close event fires later; ignore it. */if(closeGlobalLibrary!==closer)return;closer();closeGlobalLibrary=null;},{once:true});}catch(error){temporary?.abort();if(temporary)client?.close();showError(error);}};
    trash.onclick=showBoardTrash;actions.append(trash,library);
  }
  tabs.addEventListener('keydown',event=>{const list=[...tabs.children];let index=list.indexOf(event.target);if(index<0)return;if(event.key==='ArrowRight')index=(index+1)%list.length;else if(event.key==='ArrowLeft')index=(index-1+list.length)%list.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=list.length-1;else return;event.preventDefault();list[index].focus();selectBoard(list[index].dataset.boardTab);},{signal});
  let catalogOffline=false;
  // The catalog is per viewer (private boards), so it reconnects whenever the account changes.
  const onCatalog=result=>{if(!alive())return;if(result.boards===null){renderTabs();status.textContent='Chưa kết nối được danh sách bảng. Các bản nháp trên thiết bị vẫn được giữ.';catalogOffline=true;return;}
    if(catalogOffline){catalogOffline=false;status.textContent='';}
    boards=result.boards;catalogLoaded=true;pending=pending.filter(p=>!boards.some(b=>b.id===p.id));if(account)save(pendingKey(account),pending);reconcile();
  };
  let unsubscribe=subscribeBoards({signal},onCatalog);
  function authChanged(){const next=getUser()?.id||null;if(next===account)return;stopCurrent();for(const dialog of root.querySelectorAll('dialog'))dialog.remove();account=next;pending=account?stored(pendingKey(account),[]):[];explicitTrash=false;unsubscribe();boards=[];catalogLoaded=false;unsubscribe=subscribeBoards({signal},onCatalog);renderActions();reconcile();}
  authEvents.addEventListener('change',authChanged,{signal});renderActions();renderTabs();
  function cleanup(){if(disposed)return;disposed=true;stopCurrent();unsubscribe();authEvents.removeEventListener('change',authChanged);signal.removeEventListener('abort',cleanup);root.remove();}
  signal.addEventListener('abort',cleanup,{once:true});return cleanup;
}
