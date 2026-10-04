import { Editor, Extension, Document, Paragraph, Text, Bold, Italic, Underline, TextStyle, Color, FontSize,
  BulletList, OrderedList, ListItem, ListKeymap, TaskList, TaskItem,
  Collaboration, CollaborationCaret, Y, yUndoPluginKey } from '../../assets/vendor/notes.js';
import { openAssetPicker } from './library.js';

const colors = [['#654c51','Mực nâu'], ['#9a3456','Hồng'], ['#37664c','Xanh lá'], ['#345d85','Xanh dương'], ['#79549a','Tím']];
const formatButtons = [['B','In đậm','toggleBold','bold'],['I','In nghiêng','toggleItalic','italic'],['U','Gạch dưới','toggleUnderline','underline'],['•','Danh sách chấm','toggleBulletList','bulletList'],['1.','Danh sách số','toggleOrderedList','orderedList'],['☑','Danh sách việc','toggleTaskList','taskList'],['↶','Hoàn tác văn bản','undo'],['↷','Làm lại văn bản','redo']];
// Note text defaults to 23px; validFontSize mirrors the backend text-mark check.
const defaultFontSize = 23, minFontSize = 10, maxFontSize = 72;
const validFontSize = value => /^\d{2}px$/.test(value || '') && parseInt(value) >= minFontSize && parseInt(value) <= maxFontSize;
const fontSizeOf = editor => {const size = editor.getAttributes('textStyle').fontSize; return validFontSize(size) ? parseInt(size) : defaultFontSize;};
// With only a caret (no selected text) the size applies to the whole note, like resizing a sticky note; the caret is kept.
function setFontSize(editor, size) {
  const value = Math.min(maxFontSize, Math.max(minFontSize, Math.round(size))), {from, to, empty} = editor.state.selection;
  const apply = chain => value === defaultFontSize ? chain.unsetFontSize() : chain.setFontSize(`${value}px`);
  // The second apply at the restored caret also sets the stored mark, so new typing (even in an empty note) uses the size.
  return (empty ? apply(apply(editor.chain().selectAll()).setTextSelection({from, to})) : apply(editor.chain())).run();
}
// Word-style shortcuts: Mod+Shift+> / Mod+Shift+< step by 2, Mod+] / Mod+[ step by 1.
const FontSizeKeys = Extension.create({name:'fontSizeKeys', addKeyboardShortcuts() {
  const step = delta => () => this.editor.isEditable && setFontSize(this.editor, fontSizeOf(this.editor)+delta);
  return {'Mod->':step(2),'Mod-Shift-.':step(2),'Mod-<':step(-2),'Mod-Shift-,':step(-2),'Mod-]':step(1),'Mod-[':step(-1)};
}});
const extensions = [Document, Paragraph, Text, Bold, Italic, Underline, TextStyle, Color, FontSize, FontSizeKeys,
  BulletList, OrderedList, ListItem, ListKeymap, TaskList, TaskItem.configure({ nested: true, a11y: { checkboxLabel: node => `Đánh dấu việc: ${node.textContent || 'Việc chưa có tên'}` } })];
const maximumCharacters = 100000;
// Lowercase #rrggbb passes publicContent, model and backend cssColor text-mark validation.
const hex = rgb => '#'+rgb.map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');
const hsvToRgb = ([h,s,v]) => [5,3,1].map(n=>{const k=(n+h/60)%6;return Math.round(255*v*(1-s*Math.max(0,Math.min(k,4-k,1))));});
function rgbToHsv([r,g,b], hue = 0) {
  const max = Math.max(r,g,b), d = max-Math.min(r,g,b);
  return [!d ? hue : max===r ? 60*(((g-b)/d+6)%6) : max===g ? 60*((b-r)/d+2) : 60*((r-g)/d+4), max ? d/max : 0, max/255];
}
const parseHex = value => value.match(/[\da-f]{2}/gi).map(part=>parseInt(part,16));
const make = (tag, className, text) => {const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const formatRows = new WeakMap();
let panelSerial = 0;
// One controller per board format row; buttons act on the note editor that last had focus.
function formatControls(row) {
  let tools = formatRows.get(row); if (tools) return tools;
  const controller = new AbortController(), on = (node,type,fn) => node.addEventListener(type,fn,{signal:controller.signal});
  const entries = new Set(), controls = [];
  let active = null, closePicker = null, rgb = hsvToRgb([0,0,.4]), hsv = rgbToHsv(rgb), mode = 'rgb';
  const current = () => active?.editor() || null;
  const hint = make('p','notes-format-hint','Chọn một ghi chú để định dạng');
  function control(label, title, command, mark) {
    const node = make('button','notes-format-button',label); node.type = 'button'; node.title = title; node.setAttribute('aria-label',title); node.dataset.format = command;
    on(node,'mousedown',event=>event.preventDefault()); controls.push({node,command,mark}); return node;
  }
  const buttons = formatButtons.map(([label,title,command,mark])=>{const node=control(label,title,command,mark);on(node,'click',()=>{current()?.chain().focus()[command]().run();refresh();});return node;});
  const colorButton = control('Màu chữ','Màu chữ','color'), swatch = make('span','notes-format-swatch'); swatch.setAttribute('aria-hidden','true'); colorButton.prepend(swatch);
  // Size field: typing applies each valid value without stealing focus; Enter returns to the note.
  const sizeGroup = make('div','notes-format-size'); sizeGroup.setAttribute('role','group'); sizeGroup.setAttribute('aria-label','Cỡ chữ');
  const sizeInput = make('input'); sizeInput.type = 'number'; sizeInput.min = String(minFontSize); sizeInput.max = String(maxFontSize); sizeInput.step = '1'; sizeInput.inputMode = 'numeric';
  sizeInput.dataset.format = 'fontSize'; sizeInput.title = `Cỡ chữ (${minFontSize}–${maxFontSize}px). Phím tắt: Ctrl/⌘ + Shift + > hoặc <, Ctrl/⌘ + ] hoặc [`; sizeInput.setAttribute('aria-label',`Cỡ chữ, ${minFontSize} đến ${maxFontSize} px`);
  const sizeDown = control('−','Giảm cỡ chữ','fontSizeDown'), sizeUp = control('+','Tăng cỡ chữ','fontSizeUp'), sizeUnit = make('span','notes-format-size-unit','px'); sizeUnit.setAttribute('aria-hidden','true');
  controls.push({node:sizeInput,command:'fontSize'}); sizeGroup.append(sizeDown,sizeInput,sizeUnit,sizeUp);
  on(sizeDown,'click',()=>{const editor=current();if(editor){setFontSize(editor,fontSizeOf(editor)-1);refresh();}});
  on(sizeUp,'click',()=>{const editor=current();if(editor){setFontSize(editor,fontSizeOf(editor)+1);refresh();}});
  on(sizeInput,'input',()=>{const editor=current(),value=Number(sizeInput.value);if(editor&&Number.isInteger(value)&&value>=minFontSize&&value<=maxFontSize)setFontSize(editor,value);});
  on(sizeInput,'change',()=>{const editor=current();if(!editor)return;const value=Number(sizeInput.value);if(sizeInput.value!==''&&Number.isFinite(value))setFontSize(editor,value);sizeInput.value=String(fontSizeOf(editor));});
  on(sizeInput,'keydown',event=>{if(event.key==='Enter'){event.preventDefault();sizeInput.dispatchEvent(new Event('change'));current()?.commands.focus();}});
  const imageButton = control('Chèn hình','Chèn hình vào ghi chú','image');
  const panel = make('div','notes-color-panel'); panel.id = `notes-color-panel-${++panelSerial}`; panel.hidden = true; panel.setAttribute('role','group'); panel.setAttribute('aria-label','Chọn màu chữ');
  colorButton.setAttribute('aria-expanded','false'); colorButton.setAttribute('aria-controls',panel.id);
  const presets = make('div','notes-color-presets');
  for (const [value,name] of colors) {const node=make('button','notes-color-preset');node.type='button';node.style.background=value;node.title=name;node.setAttribute('aria-label',name);node.dataset.color=value;on(node,'click',()=>{setRgb(parseHex(value));apply();});presets.append(node);}
  const modes = make('div','notes-color-modes'), sections = {rgb:make('div','notes-color-rgb'), wheel:make('div','notes-color-wheel-section')};
  const modeButtons = [['rgb','RGB'],['wheel','Vòng màu']].map(([key,label])=>{const node=make('button','notes-format-button',label);node.type='button';node.dataset.colorMode=key;on(node,'click',()=>{mode=key;render();});modes.append(node);return node;});
  const channels = ['R','G','B'].map((label,index)=>{
    const wrapper = make('div','notes-color-channel'), name = make('label','',label), range = make('input'), number = make('input');
    range.type = 'range'; number.type = 'number'; for (const input of [range,number]) {input.min='0';input.max='255';input.step='1';}
    range.id = `${panel.id}-${label}`; name.htmlFor = range.id; number.setAttribute('aria-label',`${label} (0–255)`); range.dataset.channel = number.dataset.channel = label;
    for (const input of [range,number]) on(input,'input',()=>{const value=Number(input.value);if(!Number.isFinite(value))return;const next=[...rgb];next[index]=Math.min(255,Math.max(0,Math.round(value)));setRgb(next);});
    wrapper.append(name,range,number); sections.rgb.append(wrapper); return {range,number};
  });
  const wheel = make('div','notes-color-wheel'), marker = make('span','notes-color-marker'); wheel.tabIndex = 0; wheel.setAttribute('role','slider'); wheel.setAttribute('aria-label','Vòng màu: trái/phải đổi sắc màu, lên/xuống đổi độ đậm'); wheel.setAttribute('aria-valuemin','0'); wheel.setAttribute('aria-valuemax','359'); wheel.append(marker);
  const lightLabel = make('label','notes-color-light','Độ sáng '), light = make('input'); light.type = 'range'; light.min = '0'; light.max = '100'; lightLabel.append(light); sections.wheel.append(wheel,lightLabel);
  const preview = make('div','notes-color-preview'), previewSwatch = make('span','notes-format-swatch'), output = make('output','notes-color-hex'); previewSwatch.setAttribute('aria-hidden','true'); preview.append(previewSwatch,output);
  const applyButton = make('button','notes-format-button','Áp dụng'), closeButton = make('button','notes-format-button','Đóng'); applyButton.type = closeButton.type = 'button'; applyButton.dataset.colorAction = 'apply'; closeButton.dataset.colorAction = 'close';
  const actions = make('div','notes-color-actions'); actions.append(applyButton,closeButton);
  panel.append(presets,modes,sections.rgb,sections.wheel,preview,actions);
  function setRgb(next) {rgb = next; hsv = rgbToHsv(rgb,hsv[0]); render();}
  function setHsv(next) {hsv = next; rgb = hsvToRgb(hsv); render();}
  function render() {
    const value = hex(rgb);
    channels.forEach(({range,number},index)=>{range.value=number.value=String(rgb[index]);});
    for (const node of modeButtons) node.setAttribute('aria-pressed',String(node.dataset.colorMode===mode));
    sections.rgb.hidden = mode !== 'rgb'; sections.wheel.hidden = mode !== 'wheel';
    const angle = hsv[0]*Math.PI/180; marker.style.left = `${50+50*hsv[1]*Math.sin(angle)}%`; marker.style.top = `${50-50*hsv[1]*Math.cos(angle)}%`;
    wheel.style.setProperty('--wheel-dim',String(1-hsv[2])); light.value = String(Math.round(hsv[2]*100));
    wheel.setAttribute('aria-valuenow',String(Math.round(hsv[0])%360)); wheel.setAttribute('aria-valuetext',`Sắc màu ${Math.round(hsv[0])%360}°, độ đậm ${Math.round(hsv[1]*100)}%`);
    for (const node of [swatch,previewSwatch,marker]) node.style.background = value;
    output.value = value; panel.dataset.color = value;
  }
  function pick(event) {const box=wheel.getBoundingClientRect(),x=event.clientX-box.left-box.width/2,y=event.clientY-box.top-box.height/2;setHsv([(Math.atan2(x,-y)*180/Math.PI+360)%360,Math.min(1,Math.hypot(x,y)/(box.width/2)),hsv[2]]);}
  on(wheel,'pointerdown',event=>{if(event.button!==0)return;event.preventDefault();wheel.focus();wheel.setPointerCapture(event.pointerId);pick(event);});
  on(wheel,'pointermove',event=>{if(wheel.hasPointerCapture(event.pointerId))pick(event);});
  on(wheel,'keydown',event=>{
    const step = event.shiftKey ? 3 : 1, change = {ArrowLeft:[-5,0],ArrowRight:[5,0],ArrowUp:[0,.05],ArrowDown:[0,-.05]}[event.key]; if (!change) return;
    event.preventDefault(); event.stopPropagation(); setHsv([(hsv[0]+change[0]*step+360)%360,Math.min(1,Math.max(0,hsv[1]+change[1]*step)),hsv[2]]);
  });
  on(light,'input',()=>setHsv([hsv[0],hsv[1],Number(light.value)/100]));
  function openPanel() {
    const color = current()?.getAttributes('textStyle').color;
    if (/^#[\da-f]{6}$/i.test(color || '')) setRgb(parseHex(color)); else render();
    panel.hidden = false; colorButton.setAttribute('aria-expanded','true'); modeButtons.find(node=>node.dataset.colorMode===mode).focus();
  }
  function closePanel(returnFocus) {
    if (panel.hidden) return; panel.hidden = true; colorButton.setAttribute('aria-expanded','false');
    if (returnFocus && !colorButton.disabled) colorButton.focus();
  }
  function apply() {current()?.chain().focus().setColor(hex(rgb)).run();closePanel(false);refresh();}
  on(colorButton,'click',()=>{if(!current())return;if(panel.hidden)openPanel();else closePanel(true);});
  on(applyButton,'click',apply); on(closeButton,'click',()=>closePanel(true));
  on(panel,'keydown',event=>{if(event.key!=='Escape')return;event.preventDefault();event.stopPropagation();closePanel(true);});
  on(imageButton,'click',()=>{
    const entry = active; if (!entry?.editor()) return;
    closePicker?.(); closePicker = openAssetPicker(row.closest('.notes-board') || document.body,{client:entry.client,noteId:entry.noteId,signal:entry.signal});
  });
  // Text history shortcuts stay with the active note while focus is on the shared row.
  on(row,'keydown',event=>{
    const key = event.key.toLowerCase(); if (event.defaultPrevented || !(event.ctrlKey||event.metaKey) || !['z','y'].includes(key) || !current()) return;
    event.preventDefault(); event.stopPropagation(); current().commands[event.shiftKey || key === 'y' ? 'redo' : 'undo']();
  });
  function refresh() {
    const editor = current(); hint.hidden = !!editor;
    for (const {node,command,mark} of controls) {
      node.disabled = !editor;
      if (mark) node.setAttribute('aria-pressed',String(!!editor?.isActive(mark)));
      if (command === 'fontSize' && document.activeElement !== node) node.value = editor ? String(fontSizeOf(editor)) : '';
      if (editor && (command === 'undo' || command === 'redo')) {const manager = yUndoPluginKey.getState(editor.state)?.undoManager; node.disabled = !manager || !(command === 'undo' ? manager.undoStack : manager.redoStack).length;}
    }
    if (!editor) closePanel(false);
  }
  function destroy() {controller.abort();closePicker?.();row.replaceChildren();formatRows.delete(row);}
  tools = {
    add(entry) {entries.add(entry);refresh();return ()=>{if(!entries.delete(entry))return;if(active===entry)active=null;if(entries.size)refresh();else destroy();};},
    activate(entry) {active = entry; refresh();},
    refresh(entry) {if (entry === active) refresh();},
  };
  row.replaceChildren(hint,...buttons,sizeGroup,colorButton,imageButton,panel); render(); formatRows.set(row,tools);
  return tools;
}
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
  async function withdraw() {
    dirty = false; inFlight = true; lastSent = performance.now();
    try { if (client.getState().writable) await client.publishPresence({pointer:null,editors:[]}); }
    catch { /* Cleanup can outlive the client's authenticated connection. */ }
    finally {
      inFlight = false;
      if (session.owners) schedule();
      else if (presenceSessions.get(client) === session) presenceSessions.delete(client);
    }
  }
  function release() {
    session.owners--;
    if (!session.owners) { clearTimeout(timer); timer = null; session.editors.clear(); session.containers.clear(); session.pointer = null; if (!inFlight) withdraw(); }
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
        if (mark.type !== 'textStyle') return [];
        const color = mark.attrs?.color || '', attrs = {};
        if (/^#[\da-f]{3,8}$/i.test(color) || /^rgb\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}\s*\)$/.test(color) && color.match(/\d+/g).every(n=>Number(n)<=255)) attrs.color = color;
        if (validFontSize(mark.attrs?.fontSize)) attrs.fontSize = mark.attrs.fontSize;
        return Object.keys(attrs).length ? [{type:'textStyle',attrs}] : [];
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

export function mountNoteEditor(element, { noteId, client, signal, readOnly = false, formatRow = null }) {
  let disposed = false, editor = null, awareness = null, presence = null, unsubscribe = () => {}, lastPublic = '', localChange = null, format = null, unregister = null;
  const controller = new AbortController();
  const content = document.createElement('div'); content.className = 'note-editor';
  const message = document.createElement('p'); message.className = 'note-editor-status'; message.setAttribute('role','status');
  const entry = {noteId, client, signal: controller.signal, editor: () => writable() ? editor : null};
  function alive() { return !disposed && !signal?.aborted && !controller.signal.aborted; }
  function writable() { return alive() && !readOnly && client.getState().writable; }
  function report(error) { if (alive()) message.textContent = error?.message || 'Chưa thể mở văn bản. Hãy thử lại.'; }
  function undo() { return writable() && !!editor?.commands.undo(); }
  function redo() { return writable() && !!editor?.commands.redo(); }
  function updateControls() { if (editor && alive()) format?.refresh(entry); }
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
    if (disposed) return; disposed = true; controller.abort(); unsubscribe(); unregister?.();
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
    // A click anywhere on the note body edits: caret at the nearest text position, or the end when below the text.
    element.addEventListener('mousedown',event=>{
      if (event.button !== 0 || !editor || !writable() || editor.view.dom.contains(event.target) || event.target.closest('button,input,a,label')) return;
      event.preventDefault();
      const box = editor.view.dom.getBoundingClientRect(), clamp = (value,min,max) => Math.min(max,Math.max(min,value));
      const hit = event.clientY <= box.bottom && editor.view.posAtCoords({left:clamp(event.clientX,box.left+1,box.right-1),top:clamp(event.clientY,box.top+1,box.bottom-1)});
      hit ? editor.chain().focus().setTextSelection(hit.pos).run() : editor.commands.focus('end');
    },{signal:controller.signal});
    if (formatRow) {format = formatControls(formatRow); unregister = format.add(entry); element.addEventListener('focusin',()=>format.activate(entry),{signal:controller.signal});}
    element.addEventListener('keydown',event=>{
      if (event.defaultPrevented || event.isComposing || !(event.ctrlKey||event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {event.preventDefault();event.stopPropagation();if(writable())client.flush().catch(report);}
      if (key === 'z' || key === 'y') {event.preventDefault();event.stopPropagation();if(event.shiftKey || key === 'y')redo();else undo();}
    }, {signal:controller.signal});
    // Sync errors clear once the client recovers (a later save succeeds), so a fixed failure does not linger on the note.
    let syncError = false;
    unsubscribe = client.subscribe(state=>{if(!state.writable){cleanup();return;}if(!alive())return;if(state.error){report(state.error);syncError=true;}else if(syncError){message.textContent='';syncError=false;}});
    if (alive()) start();
  } else unsubscribe = client.subscribe(renderPublic);
  signal?.addEventListener('abort',cleanup,{once:true});
  return api;
}

export function mountBoardNoteEditor(element, { note, client, signal, formatRow }) {
  return mountNoteEditor(element,{noteId:note.id,client,signal,readOnly:!client.getState().writable,formatRow}).cleanup;
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
