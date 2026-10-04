import { Editor, Document, Paragraph, Text, Bold, Italic, Underline, TextStyle, Color,
  BulletList, OrderedList, ListItem, ListKeymap, TaskList, TaskItem,
  Collaboration, CollaborationCaret, Y, yUndoPluginKey } from '../../assets/vendor/notes.js';

const extensions = [Document, Paragraph, Text, Bold, Italic, Underline, TextStyle, Color,
  BulletList, OrderedList, ListItem, ListKeymap, TaskList, TaskItem.configure({ nested: true, a11y: { checkboxLabel: node => `Đánh dấu việc: ${node.textContent || 'Việc chưa có tên'}` } })];
const colors = ['#654c51', '#9a3456', '#37664c', '#345d85', '#79549a'];
const maximumCharacters = 100000;
const presenceSessions = new WeakMap();
function presenceSession(client) {
  let session = presenceSessions.get(client);
  if (session) return session;
  let timer = null, inFlight = false, dirty = false, lastSent = 0;
  session = { editors: new Map(), containers: new Map(), pointer: null, owners: 0, schedule, release };
  presenceSessions.set(client, session);
  function schedule() {
    dirty = true;
    if (timer !== null || inFlight || !session.owners) return;
    timer = setTimeout(send, Math.max(0, 50 - (performance.now() - lastSent)));
  }
  async function send() {
    timer = null;
    if (!session.owners || !client.getState().writable) return;
    dirty = false; inFlight = true; lastSent = performance.now();
    try { await client.publishPresence({ pointer: session.pointer, editors: [...session.editors.values()].filter(editor=>editor.anchor !== null && editor.head !== null && session.containers.get(editor.noteId)?.contains(document.activeElement)) }); }
    catch { /* Client exposes transport/auth failures through its reactive state. */ }
    finally { inFlight = false; if (!session.owners) withdraw(); else if (dirty) schedule(); }
  }
  function withdraw() { if (client.getState().writable) client.publishPresence({pointer:null,editors:[]}).catch(()=>{}); }
  function release() {
    session.owners--;
    if (!session.owners) { clearTimeout(timer); timer = null; session.editors.clear(); session.pointer = null; presenceSessions.delete(client); if (!inFlight) withdraw(); }
  }
  return session;
}

// Public JSON is never used to initialize a collaborative document.
function publicContent(content) {
  const allowed = new Set(['doc','paragraph','text','bulletList','orderedList','listItem','taskList','taskItem']);
  let count = 0, characters = 0;
  function clean(node, depth = 0) {
    if (!node || !allowed.has(node.type) || depth > 32 || ++count > 10000) return null;
    if (node.type === 'text') {
      if (typeof node.text !== 'string' || !node.text) return null;
      const text = node.text.slice(0, Math.max(0, maximumCharacters - characters)); characters += text.length;
      if (!text) return null;
      const marks = (Array.isArray(node.marks) ? node.marks : []).flatMap(mark => {
        if (['bold','italic','underline'].includes(mark.type)) return [{type:mark.type}];
        if (mark.type === 'textStyle' && /^#[\da-f]{3,8}$/i.test(mark.attrs?.color || '')) return [{type:'textStyle',attrs:{color:mark.attrs.color}}];
        if (mark.type === 'textStyle' && /^rgb\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}\s*\)$/.test(mark.attrs?.color || '') && mark.attrs.color.match(/\d+/g).every(n=>Number(n)<=255)) return [{type:'textStyle',attrs:{color:mark.attrs.color}}];
        return [];
      });
      return {type:'text',text,...(marks.length ? {marks} : {})};
    }
    const result = {type:node.type};
    if (node.type === 'taskItem') result.attrs = {checked:node.attrs?.checked === true};
    if (node.type === 'orderedList') result.attrs = {start:Number.isSafeInteger(node.attrs?.start) && node.attrs.start > 0 ? node.attrs.start : 1};
    if (Array.isArray(node.content)) result.content = node.content.map(child=>clean(child,depth+1)).filter(Boolean);
    return result;
  }
  const result = clean(content);
  return result?.type === 'doc' ? result : {type:'doc',content:[{type:'paragraph'}]};
}

export function mountNoteEditor(element, { noteId, client, signal, readOnly = false }) {
  let disposed = false, editor = null, awareness = null, presence = null, unsubscribe = () => {}, lastPublic = '', localChange = null;
  const controller = new AbortController();
  const toolbar = document.createElement('div'); toolbar.className = 'note-format-tools'; toolbar.setAttribute('role','toolbar'); toolbar.setAttribute('aria-label','Định dạng ghi chú');
  const content = document.createElement('div'); content.className = 'note-editor';
  const message = document.createElement('p'); message.className = 'note-editor-status'; message.setAttribute('role','status');
  const controls = [];
  function alive() { return !disposed && !signal?.aborted && !controller.signal.aborted; }
  function writable() { return alive() && !readOnly && client.getState().writable; }
  function report(error) { if (alive()) message.textContent = error?.message || 'Chưa thể mở văn bản. Hãy thử lại.'; }
  function undo() { return writable() && !!editor?.commands.undo(); }
  function redo() { return writable() && !!editor?.commands.redo(); }
  function updateControls() {
    if (!editor || !alive()) return;
    for (const {node,active,command} of controls) {
      if (active) node.setAttribute('aria-pressed',String(editor.isActive(active)));
      if (command === 'undo' || command === 'redo') { const manager = yUndoPluginKey.getState(editor.state)?.undoManager; node.disabled = !manager || !(command === 'undo' ? manager.undoStack : manager.redoStack).length; }
    }
  }
  function addButton(label, title, command, active) {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'note-format-button'; node.textContent = label; node.setAttribute('aria-label',title); node.title = title; node.dataset.format = command;
    node.addEventListener('mousedown', event=>event.preventDefault(),{signal:controller.signal});
    node.addEventListener('click',()=>{if(!writable() || !editor)return;editor.chain().focus()[command]().run();updateControls();},{signal:controller.signal});
    toolbar.append(node); controls.push({node,command,active});
  }
  function create(options) {
    editor = new Editor({ element: content, extensions, editable: !readOnly,
      editorProps: {
        attributes: { 'aria-label':'Nội dung ghi chú', role:'textbox', 'aria-multiline':'true', spellcheck:'true' },
        handleTextInput: (view,from,to,text)=> {
          if (view.state.doc.textContent.length - (to-from) + text.length <= maximumCharacters) return false;
          message.textContent = 'Ghi chú tối đa 100.000 ký tự.'; return true;
        },
        handlePaste: (view,event)=> {
          if (view.state.doc.textContent.length + (event.clipboardData?.getData('text/plain') || '').length <= maximumCharacters) return false;
          message.textContent = 'Nội dung dán vượt giới hạn 100.000 ký tự.'; return true;
        },
      },
      onCreate: updateControls, onTransaction: updateControls, ...options,
    });
    element.dataset.editorState = 'ready';
  }
  function renderPublic(state) {
    if (!alive()) return;
    const note = state.snapshot?.notes.find(note=>note.id === noteId);
    const content = publicContent(note?.content), signature = JSON.stringify(content);
    if (!editor) create({content});
    else if (signature !== lastPublic) editor.commands.setContent(content,{emitUpdate:false});
    lastPublic = signature;
    for (const checkbox of element.querySelectorAll('input[type=checkbox]')) checkbox.disabled = true;
  }
  async function start() {
    try {
      const doc = await client.getDocument(noteId); if (!writable()) return;
      awareness = await client.getAwareness(noteId); if (!writable()) return;
      awareness.setLocalState({});
      presence = presenceSession(client); presence.owners++;
      presence.containers.set(noteId,element);
      create({extensions:[...extensions,Collaboration.configure({document:doc,field:'body'}),
        CollaborationCaret.configure({provider:{awareness},user:{name:null,color:null}})]});
      localChange = ({added,updated,removed})=> {
        if (!writable() || ![...added,...updated,...removed].includes(doc.clientID)) return;
        const cursor = awareness.getLocalState()?.cursor;
        presence.editors.set(noteId,{noteId,yClientId:doc.clientID,
          anchor:cursor?.anchor ? Y.createRelativePositionFromJSON(cursor.anchor) : null,
          head:cursor?.head ? Y.createRelativePositionFromJSON(cursor.head) : null});
        presence.schedule();
      };
      awareness.on('change',localChange); localChange({added:[doc.clientID],updated:[],removed:[]});
      element.addEventListener('focusin',()=>presence.schedule(),{signal:controller.signal});
      element.addEventListener('focusout',()=>presence.schedule(),{signal:controller.signal});
      message.textContent = '';
    } catch (error) { report(error); }
  }
  function cleanup() {
    if (disposed) return; disposed = true; controller.abort(); unsubscribe();
    if (awareness && localChange) awareness.off('change',localChange);
    editor?.destroy(); editor = null;
    awareness?.setLocalState(null);
    if (presence) { presence.editors.delete(noteId);presence.containers.delete(noteId); if(client.getState().writable)presence.schedule();presence.release();presence=null; }
    signal?.removeEventListener('abort',cleanup); element.replaceChildren(); delete element.dataset.editorState;
  }
  const api = {cleanup,undo,redo};
  if (signal?.aborted) {disposed=true;return api;}
  element.replaceChildren(content,message); element.dataset.editorState = 'loading';
  if (!readOnly) {
    for (const row of [['B','In đậm','toggleBold','bold'],['I','In nghiêng','toggleItalic','italic'],['U','Gạch dưới','toggleUnderline','underline'],['•','Danh sách chấm','toggleBulletList','bulletList'],['1.','Danh sách số','toggleOrderedList','orderedList'],['☑','Danh sách việc','toggleTaskList','taskList'],['↶','Hoàn tác văn bản','undo'],['↷','Làm lại văn bản','redo']]) addButton(...row);
    const palette = document.createElement('select'); palette.className = 'note-format-color'; palette.setAttribute('aria-label','Màu chữ');
    for (const [index,color] of colors.entries()) {const option=document.createElement('option');option.value=color;option.textContent=['Mực nâu','Hồng','Xanh lá','Xanh dương','Tím'][index];palette.append(option);}
    palette.addEventListener('change',()=>{if(writable()&&editor)editor.chain().focus().setColor(palette.value).run();},{signal:controller.signal});toolbar.append(palette);element.prepend(toolbar);
    element.addEventListener('keydown',event=>{
      if (event.defaultPrevented || event.isComposing || !(event.ctrlKey||event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {event.preventDefault();event.stopPropagation();if(writable())client.flush().catch(report);}
      if (key === 'z' || key === 'y') {event.preventDefault();event.stopPropagation();if(event.shiftKey || key === 'y')redo();else undo();}
    }, {signal:controller.signal});
    unsubscribe = client.subscribe(state=>{if(!state.writable){cleanup();return;}if(alive()&&state.error)report(state.error);});
    if (alive()) start();
  } else unsubscribe = client.subscribe(renderPublic);
  signal?.addEventListener('abort',cleanup,{once:true});
  return api;
}

export function mountBoardNoteEditor(element, { note, client, signal }) {
  return mountNoteEditor(element,{noteId:note.id,client,signal,readOnly:!client.getState().writable}).cleanup;
}

export function mountBoardPresence(viewport, { client, signal, worldPoint }) {
  const session = presenceSession(client); session.owners++;
  const layer = document.createElement('div'); layer.className = 'notes-peer-pointers'; viewport.querySelector('.notes-world').append(layer);
  const pointers = new Map(); let disposed = false;
  function move(event) {if(!client.getState().writable)return;session.pointer=worldPoint(event.clientX,event.clientY);session.schedule();}
  function leave() {if(!client.getState().writable)return;session.pointer=null;session.schedule();}
  viewport.addEventListener('pointermove',move); viewport.addEventListener('pointerleave',leave);
  const unsubscribe = client.subscribe(state=> {
    if(disposed)return;
    const peers = state.writable ? state.presence.filter(peer=>peer.clientId!==client.clientId && peer.pointer) : [];
    const ids = new Set(peers.map(peer=>peer.clientId));
    for(const [id,node] of pointers)if(!ids.has(id)){node.remove();pointers.delete(id);}
    for(const peer of peers) {let node=pointers.get(peer.clientId);if(!node){node=document.createElement('span');node.className='notes-peer-pointer';layer.append(node);pointers.set(peer.clientId,node);}node.textContent=peer.displayName;node.style.color=peer.color;node.style.left=`${peer.pointer.x}px`;node.style.top=`${peer.pointer.y}px`;}
    if(!state.writable){session.pointer=null;session.editors.clear();}
  });
  function cleanup() {if(disposed)return;disposed=true;viewport.removeEventListener('pointermove',move);viewport.removeEventListener('pointerleave',leave);unsubscribe();session.pointer=null;session.schedule();session.release();layer.remove();signal?.removeEventListener('abort',cleanup);}
  signal?.addEventListener('abort',cleanup,{once:true});return cleanup;
}
