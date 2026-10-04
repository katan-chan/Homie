# Interface và quyền sở hữu

Tài liệu mô tả code hiện tại, kèm quy ước cho module mới. Các type bên dưới là JSDoc, chưa được compiler kiểm tra. Không có hệ plugin, DI container hoặc event bus.

## Registry và resolver

```js
/**
 * @typedef {Object} TabDefinition
 * @property {string} id ID duy nhất, ổn định; dùng chữ thường ASCII và dấu gạch ngang.
 * @property {string} label Nhãn tiếng Việt hiển thị trong sidebar.
 * @property {boolean} enabled Có tham gia điều hướng hay không.
 * @property {boolean} [requiresAuth] Chỉ render UI sau khi app xác minh session; mặc định false.
 * @property {{showCharacters?: boolean}} [background] Tùy chỉnh nền chung; mặc định vườn hoa không Loopy.
 * @property {() => Promise<TabModule>} load Import module khi cần.
 *
 * @typedef {Object} TabModule
 * @property {(container: HTMLElement, context: {signal: AbortSignal}) =>
 *   void | (() => void | Promise<void>) |
 *   Promise<void | (() => void | Promise<void>)>} render
 */
```

js/tabs.js xuất mảng tabs. Thứ tự mảng là thứ tự menu; load không tạo DOM hoặc tác vụ nền trước khi render. Import module không có side effect làm thay đổi UI.

resolveTab(tabs, hash) trong js/routing.js là hàm thuần: chọn ID được bật; fallback garden được bật, rồi mục bật đầu tiên; trả null nếu tất cả tắt. Không sửa hash, DOM hoặc lịch sử bên trong resolver. App chuẩn hóa hash bằng history.replaceState.

Các ID hiện có: garden, dashboard, minhle, haiyen. Chỉ dashboard có requiresAuth; hai hồ sơ và garden công khai. Thêm/tắt tab chỉ đổi registry cùng module tương ứng. Bỏ tab không đồng nghĩa xóa dữ liệu hoặc asset dùng chung. requiresAuth bảo vệ trải nghiệm UI, API riêng vẫn phải kiểm tra session ở server.

## Tab render và cleanup

App gọi render với panel thuộc tab và AbortSignal mới cho mỗi lần mount. Context chỉ có signal; chưa có services, router hoặc store truyền vào.

Quy ước module mới: dựng UI đồng bộ và trả cleanup đồng bộ khi có thể. App hiện cũng hỗ trợ render trả Promise và cleanup bất đồng bộ; không dùng chúng chỉ để chờ tải ảnh. Kiểm tra signal.aborted trước khi bắt đầu.

Ví dụ hợp đồng, không phải tính năng cần thêm:

```js
export function render(container, { signal }) {
  if (signal.aborted) return () => {};
  const section = document.createElement('section');
  section.className = 'example-page';
  container.replaceChildren(section);

  let disposed = false;
  function cleanup() {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', cleanup);
    section.remove();
  }
  signal.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}
```

Tab được thay nội dung container, nhưng không được xóa panel do app tạo, sửa #tabs, header, hash hoặc listener toàn ứng dụng. Mọi timer, observer, requestAnimationFrame và listener ngoài subtree phải có đường dọn rõ ràng. Listener có thể dùng { signal }; fetch phải nhận signal nếu request thuộc vòng đời tab. Image không hỗ trợ AbortSignal trực tiếp: gỡ handler và chặn callback muộn bằng cờ disposed/định danh request.

Mỗi lần điều hướng, app abort và chờ disposal của session ngay trước nó trước khi render module mới. Đây không phải hàng đợi cleanup toàn cục: khi đổi nhanh A → B → C, C có thể render trong khi cleanup bất đồng bộ của A chưa hoàn tất. Cleanup chỉ được chạm tài nguyên/subtree của chính session, không được giả định các mount luôn tuần tự hoặc sửa DOM dùng chung.

App dùng số thứ tự điều hướng và signal để chặn import cũ ghi đè tab mới. Async render tùy chỉnh phải settle sớm khi abort, tự chặn callback muộn và giải phóng tài nguyên đã cấp phát; Promise không settle có thể làm lần điều hướng đang chờ nó bị treo. App không thể tự dọn tài nguyên chưa được module trả về khi render lỗi: module phải giải phóng phần đã cấp phát trong đường abort/lỗi của mình. Module mới nên dùng render và cleanup đồng bộ, tải tài nguyên độc lập như garden hiện tại.

## UI và tài nguyên

| Chủ sở hữu | Trách nhiệm |
| --- | --- |
| index.html + js/app.js | Shell, nền mặc định, dialog/sidebar, tabpanel, lựa chọn tab, focus, loading và lỗi import/render |
| js/background.js | Hai canvas dùng chung, tải ảnh độc lập, image retry, resize và cleanup của shell |
| js/tabs/garden.js | Tiêu đề, lettering fallback và cleanup nội dung homepage |
| js/profile.js | Nội dung hồ sơ công khai và form sửa chữ của owner |
| js/tabs/dashboard.js | UI giữ chỗ của dashboard |
| styles.css | Theme chung, responsive, trạng thái menu và transition |
| assets/ | Asset production; giữ PNG/prompt nguồn khi có |
| scripts/build.js | Tạo dist/ và thay cấu hình API public |

Garden chỉ redraw khi tải ảnh hoặc resize. Giữ thứ tự lớp xa/giữa/tiền cảnh và khoảng trống tiêu đề. Không thêm vòng animation liên tục nếu chưa có yêu cầu.

Shell mount nền một lần bằng mountBackground(container, { signal }) trong js/background.js. Hàm trả cleanup có phương thức update(background); app truyền field background của mục registry đang chọn vào đó. Không khai báo background thì vẫn có vườn hoa toàn viewport, showCharacters mặc định false. Homepage khai báo background: { showCharacters: true } để giữ hai Loopy đã duyệt. Tab mới không cần import renderer, thêm canvas hoặc khai báo nền riêng. Không có chế độ tắt nền.

Nền tồn tại qua chuyển tab, cả màn hình yêu cầu đăng nhập và lỗi tải module; cleanup của tab chỉ dọn nội dung tab. Signal nền thuộc vòng đời shell, không dùng signal của tab. ResizeObserver cập nhật canvas khi cửa sổ thay đổi, không resize bằng vòng lặp. CSS panel flow-root ngăn margin thẻ hồ sơ tạo scrollbar thừa; viewport có scrollbar thật vẫn được vẽ theo clientWidth.

## Cấu hình và backend

js/config.js xuất API_BASE_URL. Local mặc định http://localhost:3001; build lấy PUBLIC_API_BASE_URL, chỉ chấp nhận HTTP(S) origin không credentials, path, query hoặc hash. Frontend deploy Vercel không cấu hình API thì giá trị rỗng. Không tự gọi fetch với giá trị rỗng khi cần một backend riêng; UI phải xử lý trạng thái chưa cấu hình nếu tính năng đó được bổ sung.

Backend xuất createBackend(frontendOrigins?, options?), trả Node http.Server chưa listen. Entry point đọc PORT và listen; import module để test không mở port. FRONTEND_ORIGINS là danh sách origin phân cách bằng dấu phẩy, so khớp chính xác. options hỗ trợ credentials, dataDir, production, sessionTtlMs, sameSite cho test; không nhận options từ HTTP request. Auth/profile contract chính thức tại [authentication.md](authentication.md).

| Request hiện có | Kết quả |
| --- | --- |
| GET /api/health, HEAD /api/health | 200, JSON { "status": "ok" }; HEAD không có body trên wire |
| OPTIONS /api/health | 204 |
| Method khác tại /api/health | 405, Allow: GET, HEAD, OPTIONS |
| Path khác | 404, JSON { "error": "Not found" } |
| Origin gửi lên ngoài allowlist | 403, JSON { "error": "Origin not allowed" } |

CORS check chạy trước route. Public GET/HEAD không yêu cầu Origin; mutation POST/PUT luôn yêu cầu allowlisted Origin và X-Requested-With: Homie. CORS cho phép credentials, GET/HEAD/POST/PUT/OPTIONS và Content-Type/X-Requested-With. Auth cookie/session quyết định danh tính; PUT profile so owner với ID lấy từ session. Chưa có notes API hoặc database. Hồ sơ lưu file atomic, một process; không tự suy ra schema ghi chép từ dashboard.

## Thay đổi interface

Trước khi đổi signature, field registry, route hoặc config export: tìm tất cả nơi sử dụng; nêu tác động; cập nhật producer, consumer, tài liệu và kiểm tra trong cùng thay đổi. Giữ ID/hash ổn định nếu không được yêu cầu đổi. Không thêm abstraction chỉ để dự phòng một consumer chưa tồn tại.


## Client ghi chép local

`js/notes/client.js` xuất `openBoardClient({boardId,accountId=null,signal,transport?,storage?,session?}) -> Promise<Client>`, `createNotesTransport(options?)`, `createNotesStorage()` và `subscribeBoards({signal,transport?},fn) -> cleanup`. Promise mở client hoàn tất sau khi đọc cache; `subscribe(fn)` gọi ngay và tiếp tục báo `{snapshot,connection,writable,pending,durability,error,leaseState,leases,presence,history}`. Không coi mở client là đã kết nối hoặc đã ACK. `API_BASE_URL` rỗng dùng `/api` cùng origin theo proxy hiện tại.

`Client` có `command(command)`, `applyText(noteId,Uint8Array)`, `flush()`, `close()`, `reconnect()`, `refresh()`, `getState()`, `getPending()`, `discardPending(operationId)`, `getDocument(noteId)`, `getAwareness(noteId)`, `acquireLease(target)`, `renewLease(target)`, `releaseLease(target)`, `publishPresence({pointer,editors})`, `undo()`, `redo()`, `listTrash()`, `authenticatedRequest(path,options)` và `queueUpload({path,file,name,fields,operationId})`. Command nhận envelope đầy đủ hoặc `{type,payload,operationId?,baseRevision?}`; client bổ sung account/board hiện tại. Offline trả `{operationId,pending:true}` sau khi persist; ACK trả result server. Receipt ACK và fingerprint được lưu cùng queue theo account+board; retry cùng ID/cùng nội dung trả result gốc, khác nội dung bị `operation_conflict`. `flush()` trả state, không bảo đảm mọi queue item đã được ACK: kiểm tra `pending` và `error`. `close()` idempotent, chờ các write local đã bắt đầu, giữ draft/queue.

`getDocument` chỉ cho account gốc đang live, trả per-note Y.Doc có root `body`. Editor dùng chính document này qua bundle vendor, không seed từ public JSON. Authenticated SSE được mở trước GET collaboration; mọi snapshot/delta merge bằng Yjs. `js/auth.js` bổ sung read-only `getAuthGeneration()`; signature cũ của `apiRequest` giữ nguyên. 401 ở mọi helper request được xử lý chung theo generation; response lỗi muộn từ generation cũ trả `stale_client`, không expire session mới. Logout/401 dừng write/presence/upload, dọn private UI state rồi lấy public projection mới; không đổi account của client cũ. Chỉ login lại cùng account với generation mới mới tiếp tục queue.

Queue namespace gồm account+board; database note y-indexeddb thêm note ID. `durability` khởi đầu là `unknown` khi chỉ có cache/chưa xác nhận server, sau đó là `saving`, `local` (persist local, chưa ACK), `saved` (không pending), hoặc `unsaved` (write local thất bại). Guest chỉ cache projection công khai. Lease mất khi offline, geometry replay phải acquire token mới và defer khi peer giữ. Undo chỉ nhận operation thuộc history của chính client; server vẫn kiểm tra revision/lease. Text vẫn có thể ACK dưới tombstone mà không restore note.

Upload helper persist Blob tối đa 50 MiB, tên và fields dạng string; khi gửi tạo multipart gồm accountId, operationId, fields và file. Endpoint `/api/assets` và media protocol thuộc Task 7, chưa được helper này triển khai server. Blob giữ account gốc qua logout; không cache cookie/mật khẩu. Chi tiết wire và handoff producer nằm trong report Task 3/4.

## Editor ghi chú và presence

`js/notes/editor.js` xuất `mountNoteEditor(element,{noteId,client,signal,readOnly=false}) -> {cleanup,undo,redo}` đồng bộ. Khởi tạo editor private chờ `client.getDocument(noteId)` và `getAwareness(noteId)`; mọi continuation kiểm tra signal, disposal và writable. `undo()`/`redo()` trả boolean theo history Yjs origin của editor hiện tại, không đảo update peer. Cleanup đồng bộ, idempotent, destroy editor và gỡ observer nhưng không close client hoặc destroy document/awareness do client sở hữu.

`mountBoardNoteEditor(element,{note,client,signal}) -> cleanup` là adapter hook thực tế của dashboard. Board giữ keyed slot khi geometry/projection đổi; chỉ tạo lại hook khi visibility/writable đổi. Guest chỉ nhận JSON công khai đã lọc qua schema; không gọi document, awareness hoặc pending queue. Khi expire/logout, board gỡ subtree private trước khi mount nội dung công khai, kể cả draft chưa ACK đang được client giữ trên thiết bị.

Schema gồm paragraph/text; bold/italic/underline/color; bullet/ordered list và checklist. Font Patrick Hand tự host và OFL trong `assets/fonts/`, chỉ áp dụng nội dung ghi chú. Toolbar có target tối thiểu 44px, cuộn ngang bên trong paper. Text cuộn trong `.note-text`; decorations vẫn ở layer riêng. Nhập/dán text qua UI giới hạn 100.000 ký tự; validation byte/schema/depth/node phía server vẫn là giới hạn authoritative cho mọi update, gồm IME và API editor.

`mountBoardPresence(viewport,{client,signal,worldPoint}) -> cleanup` dùng chung một coordinator theo client với các editor, hợp nhất pointer world và relative cursor từ Awareness thành `publishPresence({pointer,editors})`, throttle ít nhất 50ms và không publish song song. Chỉ gửi caret của note chứa focus (kể cả toolbar/palette) và có cặp relative position non-null; focus trên board không gửi caret editor. Các cursor cũ của note không active không chiếm giới hạn 16 editor của server. Helper client vẫn sở hữu ACK-before-caret, retry và xác thực. Tên/màu peer chỉ lấy từ state presence do server xác thực; không gửi raw awareness blob. Guest không publish hoặc render presence. Unmount withdraw cursor/pointer; cleanup sau auth downgrade không publish private dữ liệu.

Ctrl/Cmd+S và Lưu gọi `flush()`, không mở Save Page và không tự suy ra saved từ Promise resolve. Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z hoặc Ctrl/Cmd+Y trong editor/toolbar dùng text history; trên handle/board dùng `client.undo/redo` với history own-tab và revision guard phía server. Các nút Hoàn tác/Làm lại vị trí dùng history metadata của client. Chuyển tab vẫn do shell/dashboard sở hữu client và lifecycle.
