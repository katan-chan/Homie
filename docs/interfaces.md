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

Các ID hiện có theo thứ tự menu: garden, dashboard, jar (Hũ), calendar (Lịch), seminar (Gợi ý chủ đề seminar), activity (Hoạt động chung), minhle, haiyen. Bốn tab jar/calendar/seminar/activity đặt requiresAuth: true; hiện là stub hiện "Đang làm" cho tới khi phần sở hữu làm thật (xem Feature APIs). Dashboard công khai, tự ẩn thao tác ghi khi chưa đăng nhập. Thêm/tắt tab chỉ đổi registry cùng module tương ứng. Bỏ tab không đồng nghĩa xóa dữ liệu hoặc asset dùng chung. requiresAuth bảo vệ trải nghiệm UI, API riêng vẫn phải kiểm tra session ở server.

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
| js/tabs/dashboard.js | Danh sách/tab bảng, tạo bảng, thùng rác bảng, mở Thư viện hình; sở hữu client của bảng đang chọn |
| js/notes/*.js, styles/notes*.css | Bảng, editor, thư viện và client ghi chú (chi tiết bên dưới) |
| styles.css | Theme chung, responsive, trạng thái menu và transition |
| assets/ | Asset production; giữ PNG/prompt nguồn khi có |
| scripts/build.js | Tạo dist/ và thay cấu hình API public |

Garden chỉ redraw khi tải ảnh hoặc resize. Giữ thứ tự lớp xa/giữa/tiền cảnh và khoảng trống tiêu đề. Không thêm vòng animation liên tục nếu chưa có yêu cầu.

Shell mount nền một lần bằng mountBackground(container, { signal }) trong js/background.js. Hàm trả cleanup có phương thức update(background); app truyền field background của mục registry đang chọn vào đó. Không khai báo background thì vẫn có vườn hoa toàn viewport, showCharacters mặc định false. Homepage khai báo background: { showCharacters: true } để giữ hai Loopy đã duyệt. Tab mới không cần import renderer, thêm canvas hoặc khai báo nền riêng. Không có chế độ tắt nền.

Nền tồn tại qua chuyển tab, cả màn hình yêu cầu đăng nhập và lỗi tải module; cleanup của tab chỉ dọn nội dung tab. Signal nền thuộc vòng đời shell, không dùng signal của tab. ResizeObserver cập nhật canvas khi cửa sổ thay đổi, không resize bằng vòng lặp. CSS panel flow-root ngăn margin thẻ hồ sơ tạo scrollbar thừa; viewport có scrollbar thật vẫn được vẽ theo clientWidth.

## Cấu hình và backend

js/config.js xuất API_BASE_URL. Local mặc định http://localhost:3001; build lấy PUBLIC_API_BASE_URL, chỉ chấp nhận HTTP(S) origin không credentials, path, query hoặc hash. Frontend deploy Vercel không cấu hình API thì giá trị rỗng. Không tự gọi fetch với giá trị rỗng khi cần một backend riêng; UI phải xử lý trạng thái chưa cấu hình nếu tính năng đó được bổ sung.

Backend xuất createBackend(frontendOrigins?, options?), trả Node http.Server chưa listen. Entry point đọc PORT và listen; import module để test không mở port. FRONTEND_ORIGINS là danh sách origin phân cách bằng dấu phẩy, so khớp chính xác. options hỗ trợ credentials, dataDir, production, sessionTtlMs, sameSite, remote (storage Supabase giả hoặc null), ffmpegPath, ffprobePath cho test; không nhận options từ HTTP request. Server env: PORT, FRONTEND_ORIGINS, PROFILE_DATA_DIR (mặc định `.data`, dùng cho cả notes và media khi không có Supabase), SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_BUCKET (mặc định `note-media`), SUPABASE_PREFIX (namespace cho test), FFMPEG_PATH, FFPROBE_PATH (mặc định tìm `ffmpeg`/`ffprobe` trong PATH); không biến nào là PUBLIC_*. Auth/profile contract chính thức tại [authentication.md](authentication.md).

| Request hiện có | Kết quả |
| --- | --- |
| GET /api/health, HEAD /api/health | 200, JSON { "status": "ok" }; HEAD không có body trên wire |
| OPTIONS /api/health | 204 |
| Method khác tại /api/health | 405, Allow: GET, HEAD, OPTIONS |
| Path khác | 404, JSON { "error": "Not found" } |
| Origin gửi lên ngoài allowlist | 403, JSON { "error": "Origin not allowed" } |

CORS check chạy trước route. Public GET/HEAD không yêu cầu Origin; mutation POST/PUT luôn yêu cầu allowlisted Origin và X-Requested-With: Homie. CORS cho phép credentials, GET/HEAD/POST/PUT/OPTIONS và Content-Type/X-Requested-With (route notes thêm X-Note-Metadata). Auth cookie/session quyết định danh tính; PUT profile so owner với ID lấy từ session. Notes khởi tạo lazily ở request notes đầu tiên; lỗi khởi tạo trả 503 `storage_unavailable` cho route notes và được thử lại ở request sau, không ảnh hưởng health/auth/profile.

## Notes API

Route trong backend/notes-api.js (`notesRoute`). Mọi lỗi trả JSON `{ error, code }`; ID là UUID, sai trả 400. POST/PUT cần session, Origin allowlist và X-Requested-With: Homie (thiếu 401/403); `accountId` trong body phải bằng session, khác trả 403 `account_mismatch`. Method sai trả 405 kèm Allow; mọi route nhận OPTIONS 204.

| Request | Quyền | Kết quả |
| --- | --- | --- |
| GET/HEAD /api/boards | Công khai | `{ boards }` đang hoạt động mà người xem (khách hoặc session) được xem |
| GET/HEAD /api/boards/events | Công khai, SSE | `boards` theo người xem (hoặc `boards-refresh` khi frame quá lớn); stream có session đóng bằng `auth-required` khi session hết, client mở lại khi đổi tài khoản |
| GET/HEAD /api/boards/trash | Session | `{ boards }` đã bỏ vào thùng rác |
| GET/HEAD /api/boards/:id | Công khai | `{ board }` projection đã lọc theo người xem; 404 nếu không còn hoạt động hoặc không được xem |
| GET/HEAD /api/boards/:id/collaboration | Session | `{ board }` riêng: text Yjs base64 và mục trong thùng rác |
| GET/HEAD /api/boards/:id/events?clientId= | Công khai, SSE | `snapshot`, `projection`, `projection-refresh`; có session thêm `text-update`, `refresh`, `presence`, kết thúc bằng `auth-required` khi session hết |
| POST /api/boards/commands | Session | `{ command: { operationId, accountId, boardId, baseRevision, type, payload }, clientId, leaseTokens? }`, tối đa 16 KiB |
| POST /api/notes/:id/text | Session | `{ accountId, operationId, update }`, update là Yjs base64 tối đa 256 KiB |
| POST /api/boards/:id/leases | Session | `{ accountId, clientId, action: acquire\|renew\|release, target \| leaseToken }` → `{ leaseToken, expiresAt }` hoặc `{ released: true }`; lease 10 giây |
| POST /api/boards/:id/presence | Session | `{ accountId, clientId, pointer, editors }` (≤16 editor, ≤8 KiB) → `{ expiresAt }`; hết hạn sau 15 giây |
| GET/HEAD /api/note-assets | Session | `{ assets }` thư viện |
| POST /api/note-assets[?preview=1] | Session | Body `application/octet-stream` ≤10 MiB, header X-Note-Metadata là JSON base64 `{ accountId, operationId, hash, name, mimeType, spritesheet?, removeBackground?, previewId? }` (`removeBackground` chỉ cho PNG/JPG tĩnh, không spritesheet). `preview=1` trả `{ previewId, expiresAt, asset }`; xác nhận cần previewId còn hạn của cùng session, nếu không 409 `preview_required` |
| PUT /api/note-assets/:id | Session | `{ accountId, operationId, action: "rename", name }` hoặc `action: "remove"` |
| GET/HEAD /api/note-assets/:id/file\|poster | Khách: chỉ asset đang được chèn vào note còn hoạt động; session: mọi asset | Stream file, `X-Content-Type-Options: nosniff` |
| GET/HEAD /api/note-assets/previews/:id/file\|poster | Session đã tạo preview | Bản chuyển đổi chờ xác nhận, hết hạn sau 5 phút |

Command `type`: `board.create|rename|share|trash|restore`, `column.create|update|trash|restore`, `note.create|update|move|trash|restore`, `decoration.add|update|remove`, `command.undo`. Decoration (sticker) nằm trên bảng theo tọa độ bảng: `{ id, boardId, noteId|null, columnId|null, assetId, x, y, width, height, rotation, z }`; `noteId`/`columnId` (tối đa một) là thứ sticker đi theo: kéo note/cột thì sticker gắn vào dời theo, bỏ note/cột vào thùng rác thì sticker ẩn theo; `null` cả hai là sticker tự do. `decoration.add|update` nhận `noteId`/`columnId` tùy chọn; client gắn theo note trên cùng chứa tâm sticker khi thả, rồi tới cột. Lease note/cột tranh chấp với sticker gắn vào nó. Ai xem: board có `authorId` và `visibility` (`public`, `shared` hoặc account ID); `board.create` nhận `visibility` tùy chọn (mặc định account tạo), `board.share { visibility }` chỉ cho tác giả và chỉ `public|shared|<chính mình>`. Note có `visibility` (`null` theo bảng, `shared` hoặc account tác giả; chỉ tác giả đổi) và `labels` (≤12 chuỗi 1–32 ký tự sau khi trim/gộp khoảng trắng, không trùng không phân biệt hoa/thường), qua `note.create|update`. Người xem thấy note khi cả bảng lẫn note cho phép (`canSee` trong js/notes/model.js); sticker theo note thì theo note. Mọi đọc, SSE (`projection`, `text-update`, presence editors), text, lease và command lọc theo session; entity bị ẩn trả 404 `not_found`. Snapshot notes ở `formatVersion` 5 (bản 4 thêm: board Công khai với tác giả là người chạy `board.create` đầu tiên, note theo bảng, chưa nhãn); bản 2 (sticker theo note, tọa độ trong note) giữ note và đổi sang tọa độ bảng, bản 3 gắn theo vị trí tâm; lịch sử undo cũ bị bỏ. Server lấy tác giả từ session, từ chối field lạ; đổi geometry cần lease của chính client. Lặp lại cùng operationId và nội dung trả kết quả gốc; khác nội dung trả 409 `operation_conflict`.

Mã trạng thái chính: 400 dữ liệu sai; 401 `unauthorized`; 403 `forbidden`/`account_mismatch`; 404 `not_found`; 408 `media_timeout`; 409 `lease_conflict`, `lease_required`, `deleted`, `undo_conflict`, `wrong_board`, `preview_required`, `presence_conflict`; 413 `body_too_large`/`media_too_large`; 415 sai Content-Type; 429 `stream_limit`, `lease_limit`, `presence_limit`, `media_busy`; 503 `storage_unavailable`, `durability_uncertain` (đã có thể ghi, thử lại cùng operationId), `store_closed`, `media_unavailable` (thiếu FFmpeg/ffprobe). SSE gửi `retry: 1000`, heartbeat 3 giây và header `X-Accel-Buffering: no`; mỗi session tối đa 16 stream, toàn server 128.

## Feature APIs

Các tính năng v5 thêm API qua `backend/features.js`: mảng module, mỗi module xuất `route(path) -> boolean` và `create(deps) -> { handle(req, res), close?() }` (có thể trả Promise). `server.js` chạy kiểm tra Origin allowlist và CORS chung trước, rồi dispatch module đầu tiên có `route` khớp, trước các route lõi. OPTIONS trên route feature trả 204. Mỗi module được tạo lazily ở request đầu tiên của nó, chỉ một lần; `create` lỗi trả 503 `storage_unavailable` và được thử lại ở request sau. Khi server dừng, các module được `close()` trước notes. Không sửa `server.js` hay `features.js` để thêm route: phần sở hữu chỉ sửa file module của mình.

`deps = { auth, allowedOrigins, dataDir, remote, notesStore }`: `allowedOrigins` là Set origin; `remote` là storage Supabase hoặc null; `notesStore()` trả Promise tới notes store đang chạy (khởi tạo notes nếu chưa, cùng cơ chế thử lại với Notes API).

| Prefix | Module | Phần sở hữu |
| --- | --- | --- |
| /api/jar | backend/jar-api.js | A Hũ |
| /api/calendar, /api/cycles | backend/calendar-api.js | B Lịch, dịp, chu kỳ |
| /api/ideas | backend/ideas-api.js | C Seminar, Hoạt động chung |
| /api/rules | backend/rules-api.js | E Nội quy |
| /api/garden | backend/garden-api.js | G Hoa kỷ niệm |

Prefix khớp đúng ranh giới path (`/api/jar` và `/api/jar/...`, không khớp `/api/jarx`). Stub hiện trả 404 `{ error: "Not implemented", code: "not_implemented" }` cho mọi path thuộc prefix.

Hợp đồng chung cho mọi feature API:

- Lỗi là JSON `{ error, code }`; response luôn có `Cache-Control: no-store`.
- Đọc cần session thành viên (401 `unauthorized`), trừ khi phần đó ghi rõ là công khai (`/api/garden` trả danh sách rỗng cho khách).
- Ghi (POST/PUT) cần Origin allowlist và `X-Requested-With: Homie` (403 `forbidden`), rồi session (401). Account lấy từ session, không bao giờ từ body.
- Lệnh tạo nhận `requestId` (UUID): gửi lại cùng requestId trả kết quả gốc, không tạo bản ghi trùng. Lệnh sửa nhận `version`; lệch thì 409 `version_conflict`.
- Nội dung riêng tư không lộ ra: thứ người xem không được thấy trả 404 như không tồn tại, không có số đếm ẩn, không log nội dung.
- Thời điểm lưu ISO UTC; ngày địa phương tính theo `Asia/Ho_Chi_Minh`.

Helper dùng chung (giữ signature; cần đổi thì báo F0/phiên chính):

- `backend/http.js`: `httpError(status, code, message = code)`; `sendJson(res, status, body)`; `readJson(req, { limit = 32768 } = {}) -> Promise<any>` (415 `unsupported_media_type`, 413 `body_too_large`, 400 `invalid_body`); `requireMember(req, auth) -> 'minhle' | 'haiyen'` (401); `requireWrite(req, { auth, allowedOrigins }) -> account id` (403 rồi 401); `handleErrors(res, fn)` chạy `fn` và chuyển lỗi có `status` thành `{ error, code }`, lỗi khác thành 500 `internal_error` không kèm message.
- `backend/doc-store.js`: `createDocStore({ key, dataDir, remote, empty, validate }) -> { read(), update(mutator), close() }`. Một JSON document mỗi domain: `remote.getDocument/putDocument(key)` (`public.documents`) hoặc `<dataDir>/<key>.json` (ghi file tạm rồi rename). `empty()` tạo document đầu tiên; `validate(saved)` trả document (có thể migrate) hoặc throw, khi đó store trả 503 `storage_unavailable` và không ghi đè dữ liệu cũ. `read()` trả bản sao. `update(mutator)` chạy tuần tự, `mutator(draft)` sửa bản nháp và trả kết quả; mutator throw thì document giữ nguyên; ghi lỗi thì 503 và lần sau đọc lại storage (phòng trường hợp ghi đã tới nhưng mất response). Sau `close()` thì 503 `store_closed`. `rememberRequest(doc, requestId, value)` / `recalled(doc, requestId)` lưu kết quả lệnh tạo trong `doc.requests` (500 requestId gần nhất); `validate` phải giữ field này.
- `backend/dates.js`: `ZONE`, `localDate(iso) -> 'YYYY-MM-DD'`, `localTime(iso) -> 'HH:MM'`, `isDate(value)`, `addDays(date, n)`, `parseRange(from, to, { maxDays = 400 } = {}) -> { from, to }` (khoảng gồm cả hai đầu; sai định dạng, ngược hoặc dài quá thì 400 `invalid_range`).
- `backend/notes-memories.js` (phần D làm thật): `listMemories(store, viewerId, { from, to, gardenOnly } = {}) -> [{ noteId, boardId, title, memoryDate, garden }]`, đồng bộ, chỉ gồm note `viewerId` (account hoặc null cho khách) được xem, bỏ note trong thùng rác. Stub trả `[]`.

Frontend dùng chung:

- `js/notes/rules-panel.js` (phần E): `mountRulesPanel(container, { signal }) -> cleanup`; dashboard mount nó thay mặt bảng khi chọn tab "Nội quy".
- Mở một note từ tab khác: ghi `sessionStorage['homie-notes:focus'] = JSON.stringify({ boardId, noteId })` rồi đặt `location.hash = 'dashboard'`. Dashboard đọc giá trị một lần rồi xoá (phần D).
- CSS có phạm vi theo phần: `styles/jar.css`, `styles/calendar.css`, `styles/roulette.css`, `styles/rules.css`, `styles/garden-flowers.css`, đã link trong `index.html`.
- Browser test của từng phần đặt tên `tests/browser-feature-<phần>.mjs`; `npm run test:features` chạy lần lượt và bỏ qua khi chưa có file nào.

## Thay đổi interface

Trước khi đổi signature, field registry, route hoặc config export: tìm tất cả nơi sử dụng; nêu tác động; cập nhật producer, consumer, tài liệu và kiểm tra trong cùng thay đổi. Giữ ID/hash ổn định nếu không được yêu cầu đổi. Không thêm abstraction chỉ để dự phòng một consumer chưa tồn tại.


## Client ghi chép local

`js/notes/client.js` xuất `openBoardClient({boardId,accountId=null,signal,transport?,storage?,session?}) -> Promise<Client>`, `createNotesTransport(options?)`, `createNotesStorage()` và `subscribeBoards({signal,transport?},fn) -> cleanup`. Promise mở client hoàn tất sau khi đọc cache; `subscribe(fn)` gọi ngay và tiếp tục báo `{snapshot,connection,writable,pending,durability,error,leaseState,leases,presence,history}`. Không coi mở client là đã kết nối hoặc đã ACK. `API_BASE_URL` rỗng dùng `/api` cùng origin theo proxy hiện tại.

`Client` có `command(command)`, `applyText(noteId,Uint8Array)`, `flush()`, `close()`, `reconnect()`, `refresh()`, `getState()`, `getPending()`, `discardPending(operationId)`, `getDocument(noteId)`, `getAwareness(noteId)`, `acquireLease(target)`, `renewLease(target)`, `releaseLease(target)`, `publishPresence({pointer,editors})`, `undo()`, `redo()`, `listTrash()`, `authenticatedRequest(path,options)`, `queueUpload({path,file,name,fields,operationId})` và `getUploadReceipt(operationId)`. Command nhận envelope đầy đủ hoặc `{type,payload,operationId?,baseRevision?}`; client bổ sung account/board hiện tại. Offline trả `{operationId,pending:true}` sau khi persist; ACK trả result server. Receipt ACK và fingerprint được lưu cùng queue theo account+board; retry cùng ID/cùng nội dung trả result gốc, khác nội dung bị `operation_conflict`. `flush()` trả state, không bảo đảm mọi queue item đã được ACK: kiểm tra `pending` và `error`. `close()` idempotent, chờ các write local đã bắt đầu, giữ draft/queue.

`getDocument` chỉ cho account gốc đang live, trả per-note Y.Doc có root `body`. Editor dùng chính document này qua bundle vendor, không seed từ public JSON. Authenticated SSE được mở trước GET collaboration; mọi snapshot/delta merge bằng Yjs. `js/auth.js` bổ sung read-only `getAuthGeneration()`; signature cũ của `apiRequest` giữ nguyên. 401 ở mọi helper request được xử lý chung theo generation; response lỗi muộn từ generation cũ trả `stale_client`, không expire session mới. Logout/401 dừng write/presence/upload, dọn private UI state rồi lấy public projection mới; không đổi account của client cũ. Chỉ login lại cùng account với generation mới mới tiếp tục queue.

Queue namespace gồm account+board; database note y-indexeddb thêm note ID. `durability` khởi đầu là `unknown` khi chỉ có cache/chưa xác nhận server, sau đó là `saving`, `local` (persist local, chưa ACK), `saved` (không pending), hoặc `unsaved` (write local thất bại). Guest chỉ cache projection công khai. Lease mất khi offline, geometry replay phải acquire token mới và defer khi peer giữ. Undo chỉ nhận operation thuộc history của chính client; server vẫn kiểm tra revision/lease. Text vẫn có thể ACK dưới tombstone mà không restore note.

`queueUpload` nhận file tối đa 10 MiB, tính SHA-256 rồi persist Blob vào hàng đợi; tổng file chờ trên thiết bị tối đa 50 MiB (`upload_quota`). Khi gửi, body là file thô và metadata nằm trong X-Note-Metadata như bảng Notes API; mặc định path `/api/note-assets`, thư viện dùng `?preview=1` trước khi xác nhận. `getUploadReceipt(operationId)` trả kết quả ACK đã lưu. Blob giữ account gốc qua logout; không cache cookie/mật khẩu.

## Editor ghi chú và presence

`js/notes/editor.js` xuất `mountNoteEditor(element,{noteId,client,signal,readOnly=false,formatRow=null}) -> {cleanup,undo,redo}` đồng bộ. Khởi tạo editor private chờ `client.getDocument(noteId)` và `getAwareness(noteId)`; mọi continuation kiểm tra signal, disposal và writable. `undo()`/`redo()` trả boolean theo history Yjs origin của editor hiện tại, không đảo update peer. Cleanup đồng bộ, idempotent, destroy editor và gỡ observer nhưng không close client hoặc destroy document/awareness do client sở hữu.

`mountBoardNoteEditor(element,{note,client,signal,formatRow}) -> cleanup` là adapter hook thực tế của dashboard. Board giữ keyed slot khi geometry/projection đổi; chỉ tạo lại hook khi visibility/writable đổi. Guest chỉ nhận JSON công khai đã lọc qua schema; không gọi document, awareness hoặc pending queue. Khi expire/logout, board gỡ subtree private trước khi mount nội dung công khai, kể cả draft chưa ACK đang được client giữ trên thiết bị.

Schema gồm paragraph/text; bold/italic/underline/color/cỡ chữ (`fontSize` 10–72px, mặc định 28px, bằng tên cột và tên tác giả ở note cỡ mặc định 360×320; tên tác giả và nhãn trên đầu note co giãn theo cạnh ngắn của note, 4–96px; nhập số, nút −/+, Ctrl/⌘+Shift+>/< ±2, Ctrl/⌘+]/[ ±1); bullet/ordered list và checklist. Font Patrick Hand tự host và OFL trong `assets/fonts/`, chỉ áp dụng nội dung ghi chú. Mỗi board có đúng một hàng định dạng `.notes-format-row` do board.js tạo dưới toolbar; editor ghi được đăng ký vào một controller theo hàng đó (WeakMap trong editor.js) và cleanup tự gỡ đăng ký. Nút tác động lên editor có focus gần nhất (vẫn giữ sau blur); khi không có editor nào active thì nút bị vô hiệu và hiện gợi ý. Hàng có B/I/U, danh sách, hoàn tác/làm lại văn bản, Màu chữ (5 màu nhanh, chế độ RGB và Vòng màu, chỉ ghi khi bấm Áp dụng, luôn xuất `#rrggbb` chữ thường) và Chèn hình. Chế độ công khai không tạo control. Control tối thiểu 44px và xuống dòng thay vì cuộn ngang. `js/notes/library.js` xuất thêm `openAssetPicker(container,{client,noteId,signal}) -> cleanup`: dialog chỉ duyệt thư viện và chèn bằng `decoration.add`; upload/đổi tên/gỡ vẫn nằm trong `openLibrary` (nút Thư viện hình). Note không còn nút + Hình riêng. Text cuộn trong `.note-text`; decorations vẫn ở layer riêng. Nhập/dán text qua UI giới hạn 100.000 ký tự; validation byte/schema/depth/node phía server vẫn là giới hạn authoritative cho mọi update, gồm IME và API editor.

`mountBoardPresence(viewport,{client,signal,worldPoint}) -> cleanup` dùng chung một coordinator theo client với các editor, hợp nhất pointer world và relative cursor từ Awareness thành `publishPresence({pointer,editors})`, throttle ít nhất 50ms và không publish song song. Chỉ gửi caret của note chứa focus (hàng định dạng chung nằm ngoài note nên focus ở đó không gửi caret) và có cặp relative position non-null; focus trên board không gửi caret editor. Các cursor cũ của note không active không chiếm giới hạn 16 editor của server. Helper client vẫn sở hữu ACK-before-caret, retry và xác thực. Tên/màu peer chỉ lấy từ state presence do server xác thực; không gửi raw awareness blob. Guest không publish hoặc render presence. Unmount withdraw cursor/pointer; cleanup sau auth downgrade không publish private dữ liệu.

Ctrl/Cmd+S và Lưu gọi `flush()`, không mở Save Page và không tự suy ra saved từ Promise resolve. Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z hoặc Ctrl/Cmd+Y trong editor/toolbar dùng text history; trên handle/board dùng `client.undo/redo` với history own-tab và revision guard phía server. Các nút Hoàn tác/Làm lại vị trí dùng history metadata của client. Chuyển tab vẫn do shell/dashboard sở hữu client và lifecycle.
