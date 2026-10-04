# Runtime cho bảng ghi chú

Stack editor/cộng tác, bảng ghi chú, notes API và pipeline media đã chạy local; xem [interfaces.md](interfaces.md) cho hợp đồng. Giữ HTML/CSS/ES modules, backend Node native; không dùng React, CDN runtime hoặc dịch vụ cộng tác trả phí. Backend import trực tiếp package `yjs` (không qua bundle) nên host cần `npm ci`.

## Cài đặt và build

Dùng Node **22.x** và `npm ci`. Dependency trực tiếp được pin chính xác trong package.json; package-lock.json khóa cả dependency gián tiếp.

| Package | Phiên bản | Vai trò |
| --- | --- | --- |
| `@tiptap/core`, `@tiptap/pm` và các extension bên dưới | 3.31.4 | Editor vanilla và ProseMirror |
| `@tiptap/y-tiptap` | 3.0.9 | Binding ProseMirror–Yjs dùng bởi Tiptap 3 |
| `yjs` | 13.6.33 | Tài liệu và hợp nhất rich text |
| `y-protocols` | 1.0.7 | Awareness tạm thời cho carets |
| `y-indexeddb` | 9.0.12 | Persistence cục bộ cho Y.Doc |
| `esbuild` | 0.28.2 | Build dependency, không chạy trong trình duyệt |

Extension được cài: document, paragraph, text, bold, italic, underline, text-style (chỉ dùng TextStyle/Color/FontSize), list (bullet/ordered/list-item/list-keymap/task-list/task-item), collaboration và collaboration-caret. Không cài StarterKit hoặc UndoRedo: Collaboration đã sở hữu lịch sử undo theo origin. Các peer dependency đã được kiểm tra bằng `npm ls --depth=0`; lock chỉ có một bản Yjs.

`npm run dev` tự build vendor trước khi mở HTTP server tại 127.0.0.1:8000, nên checkout mới không cần tạo asset thủ công. `npm run build:notes` tạo riêng vendor. `npm run build` tạo vendor rồi copy vào dist cùng frontend. Không sửa dist hoặc vendor bằng tay; cả hai là output được gitignore.

`scripts/build-notes.js` tạo `assets/vendor/notes.js` dưới dạng một ESM bundle tự chứa, target ES2022, dùng được bằng import tương đối trên dev HTTP và dist. Không có bare import hoặc request CDN lúc runtime. Bundle local đo ngày 2026-10-04: **456,703 byte**, gzip **141,372 byte** (zlib mặc định của Node); notices **31,659 byte**. `js/notes/editor.js` import bundle, nên bundle tải khi dashboard mount editor.

Các package JavaScript được khóa đều có license MIT. Build tạo `assets/vendor/notes.LICENSES.txt` từ LICENSE của những package thực sự nằm trong bundle, gồm đầy đủ copyright và điều khoản MIT; file này đi cùng dist. [Tiptap](https://github.com/ueberdosis/tiptap), [Yjs](https://github.com/yjs/yjs), [y-indexeddb](https://github.com/yjs/y-indexeddb), [esbuild](https://github.com/evanw/esbuild) là các nguồn upstream.

## API vendor cho editor và client

Import từ `../assets/vendor/notes.js` trong module ở thư mục js. Các named export:

- Editor: `Editor`, `Extension`.
- Schema/marks: `Document`, `Paragraph`, `Text`, `Bold`, `Italic`, `Underline`, `TextStyle`, `Color`, `FontSize`.
- Lists: `BulletList`, `OrderedList`, `ListItem`, `ListKeymap`, `TaskList`, `TaskItem`.
- Binding: `Collaboration`, `CollaborationCaret`, `ySyncPluginKey`, `yUndoPluginKey`.
- Persistence và document: `Y` (namespace Yjs đầy đủ), `IndexeddbPersistence`.
- Presence: `Awareness`, `encodeAwarenessUpdate`, `applyAwarenessUpdate`, `removeAwarenessStates`.

Tạo editor với Document/Paragraph/Text và các extension cần dùng. `Collaboration.configure({ document: ydoc, field: 'body' })` gắn phần chữ của một note; dùng field thống nhất ở mọi client. Nội dung đầu tiên chỉ tạo một lần khi tạo note, không setContent lại ở mỗi lần kết nối. `TaskItem.configure({ nested: true })` hỗ trợ checklist lồng nhau. `CollaborationCaret.configure({ provider: { awareness }, user: { name, color } })` nhận Awareness từ client; không bắt buộc Hocuspocus/hosted provider. Tên presence phải lấy từ session được server xác minh, không dùng để xác định tác giả note.

`editor.commands.undo()`/`redo()` dùng lịch sử origin-local của binding. Không đăng ký UndoRedo song song. Lịch sử chỉ trong phiên editor; destroy editor và awareness khi cleanup, rồi destroy tài liệu/provider theo ownership của client. Một bundle bảo đảm editor, awareness và IndexedDB dùng cùng instance Yjs. Việc phân quyền hoặc tách hàng đợi theo tài khoản thuộc client/server, không được thực hiện bằng Yjs hoặc chỉ khóa UI.

## FFmpeg và pipeline media

backend/note-media.js gọi `ffprobe`/`ffmpeg` trong PATH hoặc theo `FFMPEG_PATH`/`FFPROBE_PATH` (server env). FFmpeg không phải npm dependency, cần cài riêng trên host backend; không chạy trong frontend. Backend không probe công cụ lúc khởi động: thiếu executable thì request xem trước trả 503 `media_unavailable`, phần còn lại của notes vẫn chạy. Render native Node runtime không có FFmpeg; xem [deployment.md](deployment.md). Binary Homebrew đã dùng (9.0.1) có GPL enabled; license của binary tùy cách build. Đọc [FFmpeg legal](https://ffmpeg.org/legal.html) trước khi phân phối binary.

Luồng upload: client gửi file thô kèm SHA-256 với `?preview=1`; server kiểm tra chữ ký file, kích thước PNG trong header, ffprobe codec/kích thước/thời lượng/fps/số khung, rồi chuyển đổi và giữ bản xem trước 5 phút theo session. Người dùng xem bản chuyển đổi thật rồi xác nhận; lúc đó server lưu source (`<id>.source`), bản chuyển đổi và poster PNG vào `note-media/` (hoặc bucket Supabase) trước, rồi mới ghi asset vào snapshot notes. PNG/GIF (kể cả PNG spritesheet) xuất GIF lặp, WebM/MP4 xuất WebM VP9 có alpha; mọi asset có poster PNG lấy từ khung đầu của bản chuyển đổi, dùng khi giảm chuyển động.

Giới hạn server (`MEDIA_LIMITS`): 10 MiB cho source và bản chuyển đổi; tối đa 4096 px mỗi cạnh và 16 triệu pixel; 30 giây, 60 fps; spritesheet tối đa 256 khung và phải khớp lưới. Chỉ nhận PNG, GIF, WebM (VP8/VP9/AV1), MP4 (H.264/HEVC/AV1/MPEG-4), một video stream; không nhận SVG/URL remote. Hai job đồng thời, tối đa 8 job chờ và 16 preview đang giữ (vượt trả 429), timeout 30 giây (408), FFmpeg chạy một thread. Chi phí vận hành gồm cài binary, CPU/RAM cho decode/encode và dung lượng source/output/poster; không có phí dịch vụ.

Filter GIF: `palettegen=reserve_transparent=1:stats_mode=full` rồi `paletteuse=alpha_threshold=128`; spritesheet cắt ô bằng `loop`+`crop` theo thứ tự hàng. Proof ở bước stack (PNG RGBA 12×8, thêm `-gifflags -offsetting`) xác nhận alpha 255/128/0 thành 255/255/0. Lệnh server hiện không truyền `-gifflags -offsetting`.

GIF chỉ có tối đa 256 màu và alpha nhị phân; bán trong suốt hoặc gradient mép có thể đổi rõ rệt. Poster lấy từ bản chuyển đổi, không khôi phục alpha nguồn. Thư viện hiện câu: **“PNG/JPG/GIF/WebM/MP4 · tối đa 10 MiB, 4096 px, 16 triệu pixel, 30 giây và 60 fps. GIF dùng bảng màu và alpha nhị phân; hãy xem bản chuyển đổi trước khi xác nhận.”** PNG tĩnh không tự thành animation.

## Chạy proof

`npm run test:notes-stack` dùng node:test và Chrome/Chromium headless thật, không DOM mock. Đặt CHROME_PATH nếu browser không ở đường dẫn chuẩn. Test phục vụ ESM bằng HTTP cục bộ trên port tự cấp và tự dọn browser, profile, server, IndexedDB, Y.Doc/editor và fixture media.

Test xác minh hai editor đồng thời thêm chữ tiếng Việt, thêm marks trên cùng từ, hội tụ sau trao đổi updates; undo/redo của A giữ thay đổi B và undo B giữ A. Test cũng xác minh caret tên peer, lists/checklist, khôi phục IndexedDB, import bundle trên dev/dist và license notices.

Bảng, SSE/session, offline, presence và upload được kiểm tra bằng `npm run test:notes-browser` (tests/browser-notes*.mjs, browser-note-media.mjs) và các test node trong `npm test` (notes-api, notes-store, notes-client, note-media). Test media gọi `ffmpeg`/`ffprobe` trong PATH hoặc theo `FFMPEG_PATH`/`FFPROBE_PATH`. IME chỉ được mô phỏng bằng CDP composition, chưa thử bộ gõ thật. SSE qua proxy Vercel→Render đã kiểm chứng trên production (2026-10-04).
