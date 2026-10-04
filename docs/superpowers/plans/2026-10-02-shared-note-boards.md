# Shared Note Boards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Execution method must be selected by the user before implementation.

**Goal:** Xây dựng nhiều bảng note công khai để xem, hai tài khoản sửa chung realtime và offline, với cột tự do và thư viện trang trí.

**Architecture:** Giữ shell, registry và backend Node HTTP hiện tại. Yjs hợp nhất rich text; server giữ metadata có thẩm quyền và lưu bền trước khi xác nhận. HTTP mutation cùng SSE truyền cập nhật, IndexedDB giữ bản offline; khách nhận projection công khai, không nhận tài liệu cộng tác chứa thùng rác.

**Tech Stack:** HTML/CSS/ES modules, Node 22.x, node:test; đề xuất Yjs, y-indexeddb, Tiptap core và các extension cần thiết, esbuild build dependency; FFmpeg/ffprobe cho media. Không React, framework backend, hosted collaboration hoặc dịch vụ trả phí.

**Spec:** [Thiết kế đã duyệt](../specs/2026-10-02-shared-note-boards-design.md).

## Global Constraints

- Chỉ minhle và haiyen; mọi bảng dùng chung; khách xem công khai, mutation yêu cầu session.
- Homepage, asset đã duyệt và sidebar trái giữ nguyên; không thêm note mẫu.
- Registry duy nhất js/tabs.js; render(container, { signal }) và cleanup idempotent; không thêm nhánh dashboard trong router.
- Touch target ít nhất 44 px; focus, responsive và prefers-reduced-motion.
- Không sửa dist thủ công, không ghi credential thật, không push/deploy hoặc đổi gói hosting.
- Mỗi task có chu kỳ test thất bại → implementation → test đạt; commit nhỏ khi quyền Git cho phép. Không báo đạt nếu chưa chạy.

## Review Focus

1. Xóa note/cột trong lúc client offline: đồng bộ giữ thùng rác, không làm sống lại nội dung (Task 3, 4).
2. Đổi tài khoản khi còn bản nháp offline: không gửi thao tác của người trước dưới danh tính mới (Task 4).
3. Guest đọc stream/document/media: không lộ thùng rác, presence hoặc thư viện chưa chèn (Task 3, 7).
4. Tiếng Việt đang nhập bằng IME khi peer sửa/undo: không mất dấu hay caret (Task 6, 8).
5. PNG alpha, spritesheet sai kích thước, file giả định dạng: không mất transparency âm thầm hoặc tiêu tốn tài nguyên không giới hạn (Task 7).

## Quyết định kỹ thuật và hành vi biên đề xuất

Đây là lựa chọn triển khai để người dùng duyệt cùng kế hoạch, chưa phải code đang chạy.

- Một backend process, thư mục NOTES_DATA_DIR bền chứa snapshots, metadata và media; không dùng file profiles.json. Không hỗ trợ multi-instance cùng ghi. Local dùng .data/notes; production chỉ bật sau khi có volume/storage bền thật.
- SSE GET có cookie và CORS origin chính xác; POST có session, Origin và X-Requested-With: Homie. SSE được chọn để đi qua HTTP proxy hiện tại, tránh phụ thuộc WebSocket upgrade. Kiểm chứng streaming proxy trước khi coi production sẵn sàng.
- Server metadata là nguồn cho tác giả, tombstone, quyền giữ và revision. Client không được dùng Yjs update để thay chúng. Yjs dùng cho phần rich text của từng note; metadata dùng command có idempotency key.
- Mutation metadata offline có operationId/accountId/baseRevision. Server lấy tác giả từ session, accountId chỉ dùng kiểm tra hàng đợi. Với vị trí/màu/kích thước/lớp xung đột, command được server chấp nhận sau cùng thắng; báo xung đột cho client. Tombstone thắng command di chuyển/sửa; dữ liệu vẫn được giữ để khôi phục.
- Giữ đối tượng online 10 giây, gia hạn mỗi 3 giây. Server kiểm tra leaseToken khi thay geometry online; mất lease dừng kéo và lấy vị trí server. Offline không có lease.
- Undo văn bản dùng cơ chế origin-local của Yjs/editor; Undo metadata gửi command đảo có điều kiện revision để không ghi đè sửa mới của peer. Nếu revision đã đổi, bỏ qua hoàn tác đó và báo lý do. Lịch sử undo chỉ trong phiên tab hiện tại.
- Note nhỏ hơn vùng trang trí sẽ clip hình ngoài biên, không đổi tọa độ; kéo lớn lại hiện hình. Cột bỏ bằng thùng rác, không tự biến thành note rời.
- Khi thêm cột đầu tiên vào bảng đang có note rời, giữ chúng ở vùng không cột. Thả ra ngoài cột trở thành note rời; dùng cùng tọa độ thế giới. Vừa màn hình bao phủ cột và note hiện hành.
- Autosave debounce 500 ms; nút/phím Lưu flush hàng đợi. ACK chỉ sau lưu atomic thành công. SSE gửi sự kiện revision; reconnect tải snapshot nếu không thể replay.
- Upload offline giữ file chờ trong IndexedDB, tối đa 50 MiB tổng; quota lỗi phải báo, không hiện đã lưu. Chưa tải được media thì giữ placeholder có tên.
- Giới hạn đề xuất: upload 10 MiB/file, ảnh tối đa 4096×4096 và 16 triệu pixel, animation tối đa 30 giây/60 fps, spritesheet tối đa 256 khung. Nhận PNG, GIF, WebM, MP4; nhận PNG spritesheet với cấu hình rõ ràng. Không nhận SVG hoặc URL remote.
- PNG tĩnh xuất GIF một khung; spritesheet PNG chuyển GIF nhiều khung. Giữ source ngoài public directory để tái xử lý. Tạo poster PNG cho animation/reduced motion. GIF giới hạn palette và alpha nhị phân; preview phải cho thấy kết quả chuyển đổi trước khi xác nhận upload.

## Cấu trúc và interface chung

Mỗi task chỉ tạo file khi nhiệm vụ cần nó; không dựng scaffold rỗng.

- js/notes/model.js: hàm geometry/projection phía UI, không chứa quyền server.
- backend/notes-store.js: metadata, Yjs text, snapshot atomic, tombstone, operation deduplication.
- backend/notes-api.js: HTTP commands, stream, lease và session checks; server.js delegate route trong backend, không đổi router frontend.
- js/notes/client.js: fetch/SSE, flush, offline, account isolation và event state.
- js/notes/board.js: DOM bảng, camera, columns, gestures và keyboard controls.
- js/notes/editor.js: Tiptap vanilla và Yjs binding.
- backend/note-media.js và js/notes/library.js: chuyển đổi/upload và thư viện.
- js/tabs/dashboard.js: mount UI và wiring lifecycle; styles/notes.css: style có phạm vi.

Board {id, name, revision, deletedAt}; Column {id, boardId, name, x, y, width, height, deletedAt}; Note {id, boardId, columnId|null, authorId, x, y, width, height, color, revision, deletedAt}; Decoration {id, noteId, assetId, x, y, width, height, rotation, z}. ID UUID, tọa độ finite, width/height dương; authorId bất biến và server cấp. Tên tác giả hiển thị từ public profiles.

Commands: create/rename/trash/restore board; create/update/trash/restore column; create/update/move/trash/restore note; add/update/remove decoration; lease acquire/renew/release. Envelope {operationId, accountId, boardId, baseRevision, type, payload}; server từ chối unknown fields và dùng session cho quyền.

HTTP: GET /api/boards (active public list); GET /api/boards/:id (public projection); GET /api/boards/:id/events (SSE public projection events, authenticated presence nếu có); POST /api/boards/commands; GET /api/boards/:id/collaboration (authenticated text snapshot và trash); POST /api/notes/:id/text (base64 Yjs update, operationId, accountId); POST /api/boards/:id/leases. GET/HEAD/OPTIONS đúng method, lỗi 400/401/403/404/409/413/503 có JSON; SSE errors sau headers gửi event lỗi và đóng stream.

Client openBoardClient({boardId, accountId, signal}) → Promise<Client>; Client {subscribe(fn)→unsubscribe, command(command)→Promise, applyText(noteId, update)→Promise, flush()→Promise, close()}. Trạng thái snapshot/connection/pending/durability; guest không khởi tạo editor writable hoặc IndexedDB mutation queue.

## Task 1: Kiểm chứng stack cộng tác, media và build

**Files:** Create tests/notes-stack.test.js, scripts/build-notes.js; modify package.json, scripts/build.js; create docs/notes-runtime.md.
**Interfaces:** Produce bộ vendor ESM tại assets/vendor/notes.js (generated), API editor/Yjs dùng ở Task 4/6; ffmpeg/ffprobe runtime được kiểm tra lúc khởi động tính năng media.

- [ ] Viết test dùng hai Y.Doc với editor binding thật: đồng thời thêm chữ tiếng Việt/format, trao đổi updates hai chiều, assert nội dung hội tụ; undo A giữ phần B. Test chuyển PNG alpha thành GIF một khung và poster; preview ghi nhận giới hạn alpha.
- [ ] Chạy node --test tests/notes-stack.test.js; ghi nhận FAIL trước implementation/dependency.
- [ ] Chọn các phiên bản tương thích hiện hành, pin package lock và chỉ extension document/paragraph/text, marks, lists/checklist, collaboration/caret cần thiết. Build esbuild vendor ESM cho cả dev HTTP và dist; không CDN runtime. Ghi license, bundle size và chi phí FFmpeg vào notes-runtime.md.
- [ ] Chạy test stack, npm run build và mở local để xác minh không còn bare imports. Không chuyển sang tự viết rich-text merge nếu binding thất bại; giải quyết proof trước task phụ thuộc.
- [ ] Commit file task nếu được phép. Các dependency chỉ thêm sau khi kế hoạch này được duyệt.

## Task 2: Store và model có thể khôi phục

**Files:** Create backend/notes-store.js, js/notes/model.js, tests/notes-store.test.js, tests/notes-model.test.js.
**Interfaces:** createNotesStore({dataDir}) → Promise<Store>; Store {list(), publicBoard(id), privateBoard(id), applyCommand(userId, command), applyText(userId,noteId,update,operationId), close()}; mutations → Promise<{revision}> sau persist.

- [ ] Viết test: server cấp authorId; reject sửa tác giả; command lặp chỉ chạy một lần; move giữa cột giữ world position; move cột kéo nhóm; trash/restore cây; corrupt snapshot không ghi đè; lỗi rename không ACK; mở lại store khôi phục chữ và metadata.
- [ ] Chạy node --test tests/notes-store.test.js tests/notes-model.test.js, xác minh FAIL.
- [ ] Implement serialized writes atomic temp/rename, schema version và validation. Yjs update chỉ tác động fragment chữ của note chỉ định; apply trên candidate, validate node/mark allowlist trước persist. Persist operationId cùng thay đổi để reconnect không tạo bản sao. Không overwrite snapshot sai schema.
- [ ] Chạy lại tests, assert publicBoard không chứa deleted entities/presence/library; privateBoard giữ bản sửa tombstoned.
- [ ] Commit task.

## Task 3: Public API, realtime và giữ đối tượng

**Files:** Create backend/notes-api.js, tests/notes-api.test.js; modify backend/server.js, backend/auth.js chỉ khi cần export session accessor hiện có.
**Interfaces:** createNotesApi({store, auth, allowedOrigins}) → {handle(req,res)→Promise<boolean>,close()}; handle trả true nếu đã xử lý route. Lease API trả {leaseToken,expiresAt}; token không broadcast.

- [ ] Viết HTTP tests server port 0: guest GET thành công, mutations 401, sai Origin 403; hai account sửa được; spoof author rejected; SSE guest không thấy presence/trash; session hết hạn bị cắt quyền; A giữ object thì B geometry 409 nhưng text vẫn được; timer hết lease giải phóng; persist lỗi không ACK.
- [ ] Chạy node --test tests/notes-api.test.js, xác minh FAIL.
- [ ] Implement routes đã định nghĩa và SSE bounded queues/heartbeat/reconnect snapshot; auth kiểm tra mỗi mutation, presence publish và refresh stream. Giữ existing health/profile behavior. Server close giải phóng stream/timers/store; createBackend import không listen.
- [ ] Chạy tests task và npm test; dùng hai HTTP clients kiểm chứng concurrent text update và delete/offline text giữ tombstone.
- [ ] Commit task.

## Task 4: Client offline, durability và auth isolation

**Files:** Create js/notes/client.js, tests/notes-client.test.js, tests/browser-notes-offline.mjs; modify js/auth.js chỉ để bổ sung helper binary/stream nếu cần, không đổi apiRequest contract cũ.
**Interfaces:** openBoardClient và Client theo interface chung; y-indexeddb cache key accountId+boardId, guest cache chỉ public projection.

- [ ] Viết tests injectable transport/storage: disconnect→edit→flush cục bộ→reconnect→ACK; duplicate retry không lặp; 401 giữ queue; login account khác không gửi queue cũ; store quota lỗi báo chưa lưu; tab cleanup không mất pending đã persist.
- [ ] Chạy node --test tests/notes-client.test.js để thấy FAIL; browser IndexedDB/reload test trước implementation.
- [ ] Implement fetch POST commands/text và EventSource credentials; subscribe cập nhật reactive snapshot. Logout dừng writable client, presence và uploads, chuyển public mode. Không cache cookie/password. Lease mất khi offline, báo state rõ.
- [ ] Chạy node tests/browser-notes-offline.mjs trên HTTP/CDP test fixture; assert reload offline vẫn giữ sửa và deletion conflict không hồi sinh note. Chạy unit tests.
- [ ] Commit task.

## Task 5: Bảng, tab, cột và camera

**Files:** Modify js/tabs/dashboard.js, js/tabs.js, js/app.js, js/login.js nếu cần mount login hiện tại; create js/notes/board.js, styles/notes.css, tests/browser-notes-board.mjs; modify index.html để load stylesheet.
**Interfaces:** mountBoard(container,{client,signal}) → cleanup; board consumes Client.subscribe/command. App giữ navigation/hash; login mở qua shell action chung, không nhánh dashboard riêng.

- [ ] Viết browser assertions: guest mở dashboard, chuyển board tab, không có mutation controls; login button vẫn hoạt động khi không còn requiresAuth tabs; tạo bảng trống, local last-viewed fallback, move note across column, move column+notes, guest camera được.
- [ ] Chạy node tests/browser-notes-board.mjs, xác minh FAIL.
- [ ] Remove dashboard requiresAuth; sửa mọi caller đăng nhập đang suy ra tab bằng requiresAuth. Dựng DOM free positioning, camera world/screen conversion, right-drag, wheel context, pinch/touch; keyboard/nút cho thao tác geometry. Clamp kích thước hợp lý trong model, clip decoration như quyết định trên.
- [ ] Chạy browser tests tại 320×740, 390×844, 768×1024, 1440×1000 và 844×390; kiểm tra focus sidebar, không blur, Back/Forward, pointer capture/cancel và touch không kéo khi gõ.
- [ ] Commit task.

## Task 6: Rich text, presence và Undo/Redo

**Files:** Create js/notes/editor.js, tests/browser-notes-collaboration.mjs; modify js/notes/board.js, styles/notes.css.
**Interfaces:** mountNoteEditor(element,{noteId,client,signal,readOnly}) → {cleanup,undo,redo}; một editor chỉ bind text fragment note tương ứng. Local origins không coi remote update là thao tác undo của mình.

- [ ] Viết two-client browser tests: hai người nhập cùng note hội tụ; bold/underline/checklist giữ cấu trúc; A undo giữ B; Ctrl/Cmd+S flush không mở save-page; IME tiếng Việt không mất dấu/caret; rich-text paste không chạy script; guest read-only.
- [ ] Chạy node tests/browser-notes-collaboration.mjs, xác minh FAIL.
- [ ] Implement vanilla Tiptap schema đã giới hạn; font tự host có license và glyph Việt kiểm chứng trước khi chọn, không thay garden typography. Dựng toolbar nút 44 px; caret và board pointer dùng authenticated presence, throttle tối đa 20 Hz; guest không nhận names/cursors qua presence.
- [ ] Kiểm chứng browser tests, session expire downgrade, peer disconnect và cleanup editor sau chuyển tab. Metadata Undo dùng revision guard, không đảo thay đổi peer.
- [ ] Commit task.

## Task 7: Thư viện, chuyển đổi và trang trí

**Files:** Create backend/note-media.js, js/notes/library.js, tests/note-media.test.js, tests/browser-note-media.mjs; modify backend/notes-api.js và store, styles/notes.css.
**Interfaces:** createNoteMedia({dataDir,ffmpegPath,ffprobePath}) → {ingest({stream,metadata,signal}),list(),rename(id,name),remove(id),resolvePublicAsset(id)}; authenticated POST /api/note-assets upload raw binary với metadata được validate, PUT /api/note-assets/:id đổi tên/gỡ bằng action; GET library authenticated, GET /api/note-assets/:id/file public chỉ khi có reference trên active note. Poster cùng policy.

- [ ] Viết tests alpha PNG→static GIF, animated GIF/WebM/MP4, spritesheet grid/FPS không hợp lệ, giả extension, quá size/pixel/duration, path traversal; remove library giữ inserted references; guest không tải asset chưa chèn hoặc chỉ nằm trash.
- [ ] Chạy node --test tests/note-media.test.js, xác minh FAIL.
- [ ] Implement temp files ngoài public, ffprobe+ffmpeg spawn argument arrays không shell; xử lý tối đa hai job, timeout 30 giây, cleanup fail/abort. Chuẩn hóa đầu ra, strip audio, tạo poster; source spritesheet không công khai. Library rename/removal không thay asset identity. IndexedDB giữ pending uploads như Task 4, preview trước publish.
- [ ] Dựng UI library upload/config spritesheet; decoration drag/resize/rotate/z controls và lease. Test reduced-motion dùng poster, animation chỉ chạy khi note visible, chữ cuộn không dịch hình; unmount dừng video/timers.
- [ ] Chạy node --test tests/note-media.test.js và node tests/browser-note-media.mjs; commit task.

## Task 8: Tích hợp, tài liệu và khả năng vận hành

**Files:** Update docs/features.md, architecture.md, interfaces.md, authentication.md, contributing.md, deployment.md, notes-runtime.md; package.json thêm test:notes-browser chạy các browser scripts tuần tự; tests/backend.test.js và browser-auth/layout điều chỉnh expectations dashboard công khai.
**Interfaces:** Không thêm signature mới; ghi lại routes/options và schema thực sự đã triển khai. NOTES_DATA_DIR, FFMPEG_PATH, FFPROBE_PATH là server env, không PUBLIC_*.

- [ ] Bổ sung regression tests: error retry giữ draft; rapid tab switch sau fetch/upload; deleted last-viewed board; restore board tree; reload IndexedDB; native dialog focus; absence backend có thông báo chưa cấu hình, không fake save.
- [ ] Chạy từng test mới để xác nhận FAIL rồi sửa tối thiểu các lỗi tích hợp.
- [ ] Chạy npm test, npm run test:browser, npm run test:layout, npm run test:notes-browser và npm run build. node --check mọi JS đã đổi. Browser tests dùng HTTP local và credential fixture, không credential thật trong file/log. Nếu CDP không sẵn có, thiết lập local test session trước khi báo UI đạt.
- [ ] Kiểm tra build chứa vendor/font/CSS/asset tương đối, không backend/secret/source media; hai trình duyệt, mất mạng, restart server và fallback poster. Kiểm chứng SSE qua proxy deployment bằng môi trường review nếu đã được cấp; chưa được kiểm chứng thì ghi rõ giới hạn, không tự deploy.
- [ ] Tài liệu vận hành ghi volume bền là điều kiện, single-process limitation, FFmpeg requirement và backup/restore snapshot+media đồng bộ. Không sửa Render thành gói trả phí.
- [ ] Review toàn diff với spec; báo đúng lệnh/kết quả/phần chưa kiểm tra. Commit nếu được phép; không push.

## Trình tự và điểm dừng

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Mỗi task có thể kiểm chứng riêng; cùng model và persistence khiến tách thành các dự án triển khai độc lập dễ lệch interface. Task 1 là feasibility gate bắt buộc trước phần phụ thuộc, không được thay một yêu cầu đã chốt bằng phiên bản ít chức năng hơn khi gặp khó.

Chưa triển khai sau khi viết plan. Người dùng duyệt các lựa chọn kỹ thuật/hành vi biên và chọn thực hiện trực tiếp hoặc theo sub-agent. Đặc tả/kế hoạch ở docs/superpowers hiện bị Git ignore; cần quyết định đưa tài liệu dự án vào Git khi thực hiện, không âm thầm force-add cả thư mục artifact khác. Sandbox hiện không cho ghi .git; nếu còn hạn chế, báo rõ việc commit chưa thực hiện.

## Nguồn kỹ thuật đã tham khảo

- [Yjs và Tiptap](https://docs.yjs.dev/ecosystem/editor-bindings/tiptap2)
- [Tiptap Collaboration extension](https://tiptap.dev/docs/editor/extensions/functionality/collaboration)
- [esbuild API](https://esbuild.github.io/api/)
- [FFmpeg formats](https://ffmpeg.org/ffmpeg-formats.html)

Kế hoạch đề xuất các công cụ trên; compatibility và phiên bản cụ thể phải được test bằng Task 1 trước khi coi là nền tảng đã hoạt động.
