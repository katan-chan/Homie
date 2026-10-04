# Task 6 report: collaborative text, authenticated presence and Undo/Redo

Status: implemented, ready for controller review. Base `6eb6db8`; worktree `/private/tmp/homie-notes-worktree`, branch `feature/shared-note-boards`. No main-workspace edits, agents, framework, new dependencies, media/sample data, push or deployment.

## Exact exports and dashboard wiring

```js
mountNoteEditor(element, {noteId,client,signal,readOnly=false})
  -> {cleanup,undo,redo}
mountBoardNoteEditor(element, {note,client,signal}) -> cleanup
mountBoardPresence(viewport, {client,signal,worldPoint}) -> cleanup
```

All return synchronously. Private editor initialization asynchronously awaits `client.getDocument(noteId)` and `client.getAwareness(noteId)`, checking disposal, abort and live writable state after each await. Before CollaborationCaret initialization the consumer calls `awareness.setLocalState({})`: Task4 intentionally initializes local awareness to null, and its `setLocalStateField` does not activate a null local state. There is no Yjs document replacement or public JSON seed.

Dashboard now passes `mountEditor:mountBoardNoteEditor` to the actual `mountBoard` call. The board's existing keyed `.note-text[data-note-id]` slot remains mounted through metadata geometry/projection updates. Visibility/tombstones and writable-mode changes retain Task5's signal-before-hook-cleanup contract. The board continues to own geometry/camera; dashboard owns closing its selected client; editor owns only its slot. Decorations remain untouched for Task7.

Every private editor imports Editor, schema extensions, Collaboration, CollaborationCaret and Yjs from the single existing `assets/vendor/notes.js`. Collaboration binds `{document:doc,field:'body'}`. Text schema is paragraph/text, bold/italic/underline/text color, bullet/ordered list and nested checklist. The existing Collaboration own-origin UndoManager is used; peer updates remain outside local undo history.

Guest mode does not call getDocument, getAwareness, getPending, applyText or publishPresence. It reads the server's public content JSON, filters node/mark/attribute/color/depth/count/text limits, and passes that JSON to a noneditable editor using only the restricted schema. Guest checkboxes are disabled. Updates replace only public editor content, never collaborative state. On auth downgrade board record cleanup removes private DOM before mounting fresh public content; an unacknowledged private draft is excluded from DOM while the client retains it in its account-isolated local queue.

## Controls, font and keys

Each paper has a horizontally scrolling formatting toolbar: bold, italic, underline, bullet, ordered list, checklist, text undo/redo and a five-color native palette. Buttons expose Vietnamese labels, aria-pressed formatting state and disabled history state, with minimum 44px dimensions and existing visible focus styling. Checklist labels are 44px click targets; actual checkbox glyph is 20px. The pinned TaskItem renders `li[data-checked]`, which is the CSS selector used for flex checkbox/text alignment. The checklist checkbox accessible label is Vietnamese.

Patrick Hand regular and its complete OFL notice are self-hosted at `assets/fonts/PatrickHand-Regular.ttf` and `PatrickHand-OFL.txt`. Source files were provided from official google/fonts `ofl/patrickhand`; controller's native cmap preflight checked the full U+1EA0..U+1EF9 range and Vietnamese sample with no missing glyphs. Copied font/license bytes match those preflighted files. Browser document.fonts.load/check and computed family verified actual loading; native IME and screenshots verify Vietnamese rendering. Only `.note-text .tiptap` gets this handwritten font; garden and shell typography/layout/assets remain unchanged. Bare-fixture board controls use their normal inherited font; actual app still loads its existing shell CSS.

Text and toolbar scroll within `.note-text`; decorations remain in the clipped non-scrolling note-local layer. Existing camera pointer/touch/wheel exclusions for text/input apply unchanged. Scope CSS preserves reduced motion. Standard text entry and plain-text clipboard length are limited to100000 characters; server byte/schema/depth/node validation remains authoritative for IME, API edits and updates. Retained validation errors remain visible in client/board UI.

Ctrl/Cmd+S and board Lưu call `client.flush()` and prevent Save Page. Promise resolution is not treated as ACK; existing unknown/saving/local/saved/unsaved status remains authoritative. Text editor/toolbar Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z and Ctrl/Cmd+Y use local text history. Geometry handles/board keys and the board Hoàn tác/Làm lại vị trí buttons use `client.undo()/redo()`; existing own-tab history, lease and server metadata revision guards remain intact. Browser tests wait for a geometry operation's accepted ACK before requesting its inverse, rather than treating optimistic projection as accepted history.

## Authenticated presence and lifecycle

A small WeakMap coordinator per client combines the board pointer and editor caret records. It serializes publication, uses a minimum50ms interval and coalesces bursts. Pointer coordinates are transformed to world coordinates; remote pointer labels and caret names/colors come only from server-authenticated `state.presence`/Task4's awareness bridge. No raw awareness blobs or caller-supplied identities are published.

Only the note container containing document.activeElement, including its toolbar/palette, may publish a non-null cursor pair. Board focus sends no editor caret. This excludes idle or stale non-null cursor records from the server's16-editor bound without modifying the pinned cursor plugin or Task4 client. Focus listeners schedule the next combined publication. Relative positions are converted from local Awareness with Y.createRelativePositionFromJSON; the client handles canonical encoding, text-flush-before-caret, null positions while awaiting ACK, invalid_presence retry and session checks.

Cleanup is synchronous and idempotent: abort local listeners, unsubscribe state, remove the local awareness listener, destroy the editor, set its local awareness state null, remove coordinator record/container, clear slot DOM and remove signal listener. It never destroys client-owned Doc/Awareness or closes the client. Last coordinator owner withdraws `{pointer:null,editors:[]}`; if a send is in flight it waits for that send to settle before withdrawing, so old caret publication cannot overwrite withdrawal. Client close/auth downgrade suppress further private publication. Timers and private DOM are released on tab/board cleanup. No media lifecycle code was implemented.

## Verification actually run

Node/npm checks used Node22.23.2 via `PATH=/Users/ad/.hermes/node/bin:$PATH`. Every browser used isolated Chrome profiles, shared native backend/proxy fixtures, fixture passwords and temporary data; no real credentials or user runtime data.

- Initial RED `node tests/browser-notes-collaboration.mjs`: missing `/js/notes/editor.js` dynamic module, `/private/tmp/task-6-red.log`.
- Caret integration RED identified null local Awareness; source inspection confirmed activation requirement. GREEN followed explicit local activation.
- Visual checklist RED: expected flex layout, actual list-item; `/private/tmp/task-6-checklist-red.log`. Correct pinned `data-checked` selector passed.
- Presence cleanup RED: unmount while client stayed open retained peer caret; `/private/tmp/task-6-presence-cleanup-red.log`. Final withdrawal passed without closing caller client.
- Active-caret fence RED with only that fence temporarily removed: board focus sent `[noteId]` instead of `[]`; `/private/tmp/task-6-active-cap-red.log`. Restored fence passed the exact outgoing-wire assertion.
- Final `node tests/browser-notes-collaboration.mjs`: exit0, `/private/tmp/task-6-browser-final.log`. Covers two real authenticated users editing the same note; matching JSON; editor CtrlZ preserving peer text; redo; all marks/colors/lists; actual checklist checked state; native CDP Input.imeSetComposition/Input.insertText Vietnamese with concurrent peer insertion and subsequent caret append; script/img/javascript-link clipboard stripping; public guest schema with private helper calls instrumented to fail; no guest presence/mutation DOM; font loading/rendering;44px formatting controls; no page overflow; metadata keyboard Undo; stable editor through geometry/ACK; CtrlS prevented; ≤20Hz pointer publication;18 actual mounted editors with17 stale non-null Awareness records and exact wire restricted to focused note; board focus sends no caret; unmount withdrawal with client still open; actual dashboard tab/rapid-tab cleanup, logout, expiry destroying private editor and excluding an offline unacknowledged draft from DOM.
- `node tests/browser-notes-board.mjs`: exit0, `/private/tmp/task-6-board.log`. Existing public/login/board/geometry/trash/lease/camera/gesture/keyed-hook/reduced-motion/cleanup checks across320×740,390×844,768×1024,1440×1000 and844×390 passed.
- `npm test`:113/113, zero failures/skips/cancellations, `/private/tmp/task-6-suite.log`. This full run precedes the final focused-note presence fence; per controller instruction it was not repeated for that bounded coordinator change. The final covering browser run and syntax checks include the fence.
- `npm run build`: exit0, `/private/tmp/task-6-build.log`. This build also precedes the final coordinator fence; generated vendor/dist remain ignored. Font/license/editor/CSS were verified in generated dist with no backend, .env or .data copied. Task8 will build/verify the final integrated tree.
- Final `node --check` for editor.js, board.js, dashboard.js and browser-notes-collaboration.mjs; `git diff --check`: clean.
- Final desktop/mobile screenshots `/private/tmp/task-6-1440.png` and `/private/tmp/task-6-390.png`,1440×900 and390×900, captured before teardown with handwritten Vietnamese, toolbar, checklist and peer caret visible. Worker and controller inspected them. The mobile fixture resizes the paper to260px via its inspector, preserving the editor; toolbar scrolls within paper, target dimensions remain44px.

Bounded HomieNotes index_status/search_graph checks confirmed worktree mapping, ready index and mountBoard structural record; index timestamp predates editor changes, so scoped direct source reads covered new files and omitted tests. Controller should refresh index after the commit.

The pre-existing unit-only duplicate Yjs-import warning remains in npm test; serialized update bytes alone cross its server/browser bundle boundary. No worker/API/interface gap remains known in Task6's requested scope. Task8 owns consolidated current-state scope docs and final integrated verification; docs/interfaces.md records the new exact editor/presence hooks now.
