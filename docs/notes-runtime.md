# Runtime cho bảng ghi chú

Đã kiểm chứng stack editor/cộng tác và build cục bộ; giao diện bảng, API đồng bộ và pipeline upload chưa được triển khai trong bước này. Giữ HTML/CSS/ES modules, backend Node native; không dùng React, CDN runtime hoặc dịch vụ cộng tác trả phí.

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

Extension được cài: document, paragraph, text, bold, italic, underline, text-style (chỉ dùng TextStyle/Color), list (bullet/ordered/list-item/list-keymap/task-list/task-item), collaboration và collaboration-caret. Không cài StarterKit hoặc UndoRedo: Collaboration đã sở hữu lịch sử undo theo origin. Các peer dependency đã được kiểm tra bằng `npm ls --depth=0`; lock chỉ có một bản Yjs.

`npm run dev` tự build vendor trước khi mở HTTP server tại 127.0.0.1:8000, nên checkout mới không cần tạo asset thủ công. `npm run build:notes` tạo riêng vendor. `npm run build` tạo vendor rồi copy vào dist cùng frontend. Không sửa dist hoặc vendor bằng tay; cả hai là output được gitignore.

`scripts/build-notes.js` tạo `assets/vendor/notes.js` dưới dạng một ESM bundle tự chứa, target ES2022, dùng được bằng import tương đối trên dev HTTP và dist. Không có bare import hoặc request CDN lúc runtime. Bundle đo ngày 2026-10-02: **456,688 byte**, gzip **142,994 byte** (gzip mặc định của Node); notices **31,659 byte**. Bundle chưa được import bởi dashboard giữ chỗ; editor sẽ được tải khi module ghi chú dùng nó.

Các package JavaScript được khóa đều có license MIT. Build tạo `assets/vendor/notes.LICENSES.txt` từ LICENSE của những package thực sự nằm trong bundle, gồm đầy đủ copyright và điều khoản MIT; file này đi cùng dist. [Tiptap](https://github.com/ueberdosis/tiptap), [Yjs](https://github.com/yjs/yjs), [y-indexeddb](https://github.com/yjs/y-indexeddb), [esbuild](https://github.com/evanw/esbuild) là các nguồn upstream.

## API vendor cho editor và client

Import từ `../assets/vendor/notes.js` trong module ở thư mục js. Các named export:

- Editor: `Editor`, `Extension`.
- Schema/marks: `Document`, `Paragraph`, `Text`, `Bold`, `Italic`, `Underline`, `TextStyle`, `Color`.
- Lists: `BulletList`, `OrderedList`, `ListItem`, `ListKeymap`, `TaskList`, `TaskItem`.
- Binding: `Collaboration`, `CollaborationCaret`, `ySyncPluginKey`, `yUndoPluginKey`.
- Persistence và document: `Y` (namespace Yjs đầy đủ), `IndexeddbPersistence`.
- Presence: `Awareness`, `encodeAwarenessUpdate`, `applyAwarenessUpdate`, `removeAwarenessStates`.

Tạo editor với Document/Paragraph/Text và các extension cần dùng. `Collaboration.configure({ document: ydoc, field: 'body' })` gắn phần chữ của một note; dùng field thống nhất ở mọi client. Nội dung đầu tiên chỉ tạo một lần khi tạo note, không setContent lại ở mỗi lần kết nối. `TaskItem.configure({ nested: true })` hỗ trợ checklist lồng nhau. `CollaborationCaret.configure({ provider: { awareness }, user: { name, color } })` nhận Awareness từ client; không bắt buộc Hocuspocus/hosted provider. Tên presence phải lấy từ session được server xác minh, không dùng để xác định tác giả note.

`editor.commands.undo()`/`redo()` dùng lịch sử origin-local của binding. Không đăng ký UndoRedo song song. Lịch sử chỉ trong phiên editor; destroy editor và awareness khi cleanup, rồi destroy tài liệu/provider theo ownership của client. Một bundle bảo đảm editor, awareness và IndexedDB dùng cùng instance Yjs. Việc phân quyền hoặc tách hàng đợi theo tài khoản thuộc client/server, không được thực hiện bằng Yjs hoặc chỉ khóa UI.

## FFmpeg và giới hạn PNG/GIF

Proof đã chạy bằng FFmpeg/ffprobe **9.0.1** trên máy local. Bộ test tìm `ffmpeg`/`ffprobe` trong PATH hoặc nhận `FFMPEG_PATH`/`FFPROBE_PATH` là đường dẫn executable. FFmpeg không phải npm dependency, cần cài riêng trên host backend; không chạy trong frontend. Binary Homebrew được kiểm tra có GPL enabled; license của binary tùy cách build. Đọc [FFmpeg legal](https://ffmpeg.org/legal.html) trước khi phân phối binary.

Khi bật tính năng media ở bước pipeline, backend phải probe cả hai executable khi khởi động tính năng và kiểm tra codec/filter cần dùng; thiếu công cụ phải báo lỗi rõ và không nhận upload để xử lý. Bước stack hiện chỉ kiểm chứng công cụ qua thực thi conversion, chưa tạo server media hoặc startup guard. Chi phí vận hành gồm cài binary, CPU/RAM cho decode/encode, dung lượng source/output/poster và storage bền; không có phí dịch vụ. Pipeline cần timeout, giới hạn đồng thời và giới hạn tài nguyên trước khi nhận file không tin cậy.

Proof chuyển PNG RGBA 12×8 thành GIF **một khung** rồi lấy chính GIF làm poster PNG. Lệnh filter: `[0:v]split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128`, kèm `-gifflags -offsetting -frames:v 1`. Tắt offsetting tránh GIF encoder cắt mất vùng màu trùng màu nền ở khung đầu trong fixture có transparency. ffprobe xác nhận một khung và kích thước; decode RGBA xác nhận alpha gốc 255/128/0 trở thành **255/255/0** ở cả GIF và poster.

GIF chỉ có tối đa 256 màu và alpha nhị phân; bán trong suốt hoặc gradient mép có thể đổi rõ rệt. Poster lấy từ GIF phản ánh chính kết quả chuyển đổi, không khôi phục alpha nguồn. Preview upload phải cho xem GIF/poster thực tế trước khi xác nhận, kèm câu: **“GIF giới hạn 256 màu và chỉ hỗ trợ trong suốt hoàn toàn hoặc màu đục; vùng bán trong suốt của PNG có thể thay đổi.”** PNG tĩnh không tự thành animation. Thư viện preview chưa được triển khai trong bước stack.

Giới hạn đã chọn cho bước media: 10 MiB/file; ảnh tối đa 4096×4096 và 16 triệu pixel; animation tối đa 30 giây/60 fps; spritesheet tối đa 256 khung. Chỉ nhận PNG, GIF, WebM, MP4 và PNG spritesheet có cấu hình hợp lệ; không nhận SVG/URL remote. Những giới hạn này là yêu cầu pipeline sắp triển khai, chưa phải validation của server hiện tại.

## Chạy proof

`npm run test:notes-stack` dùng node:test và Chrome/Chromium headless thật, không DOM mock. Đặt CHROME_PATH nếu browser không ở đường dẫn chuẩn. Test phục vụ ESM bằng HTTP cục bộ trên port tự cấp và tự dọn browser, profile, server, IndexedDB, Y.Doc/editor và fixture media.

Test xác minh hai editor đồng thời thêm chữ tiếng Việt, thêm marks trên cùng từ, hội tụ sau trao đổi updates; undo/redo của A giữ thay đổi B và undo B giữ A. Test cũng xác minh caret tên peer, lists/checklist, khôi phục IndexedDB, import bundle trên dev/dist và license notices. Chưa kiểm chứng nhập liệu IME native, mạng SSE/session/offline thật, video/spritesheet hoặc giao diện upload; các proof này thuộc những bước tiếp theo của kế hoạch.
