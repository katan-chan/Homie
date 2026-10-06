# Kiến trúc hiện tại

Frontend có bốn tab: garden, dashboard, minhle và haiyen, đều xem công khai. Dashboard (Góc ghi chép) là các bảng ghi chú dùng chung: khách chỉ xem, minhle/haiyen sửa realtime và offline. Chỉ người đăng nhập đúng tài khoản sửa phần chữ trong hồ sơ của mình; ảnh/bố cục chỉnh bằng code riêng.

Frontend dùng **HTML + CSS + JavaScript ES modules**. Backend Node.js native có auth/session, profile API và notes API (command HTTP, SSE, media); session RAM, dữ liệu trên Supabase hoặc file local, luôn một process. Rich text dùng Yjs/Tiptap đóng gói sẵn bằng esbuild; xem [notes-runtime.md](notes-runtime.md). Một registry và một module cho mỗi tab đủ để thêm/bỏ các góc vườn; chưa cần framework hoặc hệ plugin. Auth dùng EventTarget riêng để cập nhật UI danh tính, không phải event bus tổng quát.

Quy tắc thực hiện nằm trong [AGENTS.md](../AGENTS.md), [interface](interfaces.md), [quy tắc code và kiểm tra](contributing.md), [bộ skills đề xuất](skills.md). Tài liệu này mô tả cấu trúc; interfaces.md là nguồn chi tiết cho hợp đồng module.

## Cấu trúc đang chạy

```text
index.html
styles.css
js/
  app.js                  # hash routing, render và cleanup
  background.js           # nền vườn chung của shell, canvas và resize
  routing.js              # resolver và fallback
  config.js               # API origin public, thay khi build
  auth.js                 # cookie API client và trạng thái danh tính
  login.js                # form đăng nhập
  profile.js              # UI chữ công khai + owner edit dùng chung
  tabs.js                 # registry duy nhất
  tabs/
    garden.js             # tiêu đề và lettering homepage
    dashboard.js          # danh sách bảng, tab bảng, thùng rác bảng, thư viện
    minhle.js              # cấu hình bố cục/ảnh Minh Lê bằng code
    haiyen.js              # cấu hình bố cục/ảnh Hải Yến bằng code
  notes/
    model.js              # schema, command metadata, dùng chung với backend
    client.js             # fetch/SSE, hàng đợi IndexedDB, lease, presence
    board.js              # DOM bảng, cột, note, camera, thùng rác
    editor.js             # Tiptap + Yjs, hàng định dạng, presence caret
    library.js            # thư viện hình, upload, trang trí note
styles/                   # notes.css, notes-format.css có phạm vi ghi chú
assets/
  flowers/                # WebP từ PNG đã duyệt, giữ alpha
  characters/             # atlas Loopy WebP
  typography/             # lettering WebP
  brand/                  # logo raster, favicon, nguồn và prompt
  fonts/                  # Playpen Sans (chữ giao diện, woff2 theo subset) và Patrick Hand (chữ viết tay), kèm OFL
  vendor/                 # notes.js bundle do build tạo, gitignored
backend/server.js         # HTTP health/auth/profiles, CORS/CSRF, delegate notes
backend/auth.js           # scrypt, session và rate limit
backend/profiles.js       # validate text, lưu Supabase hoặc file atomic
backend/notes-store.js    # snapshot notes, Yjs text, dedupe operation
backend/notes-api.js      # route /api/boards, /api/notes, /api/note-assets, SSE
backend/note-media.js     # ffprobe/FFmpeg, preview, lưu media
backend/supabase.js       # REST/Storage Supabase qua fetch
tests/                    # node:test, browser headless Chrome, live Supabase
scripts/build.js          # build vendor rồi xuất frontend vào dist/
scripts/build-notes.js    # esbuild assets/vendor/notes.js
```

Chỉ thêm tệp dữ liệu khi đã chốt nội dung và cách lưu. `index.html` ở root là nguồn frontend; `concept/index.html` cùng PNG gốc trong `concept/assets/` giữ làm reference. Local chạy trực tiếp qua HTTP; build tạo `dist/` để deploy, không chỉnh output bằng tay.

## Registry

```js
export const tabs = [
  { id: 'garden', label: 'Vườn hoa', enabled: true, background: { showCharacters: true },
    load: () => import('./tabs/garden.js') },
  { id: 'dashboard', label: 'Góc ghi chép', enabled: true,
    load: () => import('./tabs/dashboard.js') },
  { id: 'minhle', label: 'Minh Lê', enabled: true,
    load: () => import('./tabs/minhle.js') },
  { id: 'haiyen', label: 'Hải Yến', enabled: true,
    load: () => import('./tabs/haiyen.js') },
];
```

ID ổn định, không dấu và duy nhất. Thứ tự mảng là thứ tự điều hướng. Module xuất `render(container, { signal })`; quy ước module mới là trả cleanup đồng bộ, app hiện cũng hỗ trợ Promise. Mọi tab tự kế thừa nền vườn từ shell; field background chỉ tùy chỉnh showCharacters, mặc định false. Xem chữ ký và ownership tại [interfaces.md](interfaces.md). Không cần nhiều loại plugin hoặc một framework registry riêng.

**Thêm:** tạo module, thêm một mục registry. **Tắt:** đặt `enabled: false`. **Bỏ:** xóa mục registry và module giao diện nếu không còn dùng. Giữ dữ liệu và asset cho đến khi có quyết định xóa riêng.

## Điều hướng và vòng đời

Dùng `#garden` và `#dashboard`; Back/Forward hoạt động qua hash. Hash trống, sai hoặc trỏ tới tab tắt được sửa bằng `history.replaceState` về garden nếu bật, nếu không về tab bật đầu tiên. Nếu tất cả đều tắt, hiển thị trạng thái trống.

Khi chuyển tab, app abort tab cũ và chờ disposal của session ngay trước nó. Đây không phải serialization toàn cục của các cleanup bất đồng bộ khi đổi nhanh nhiều tab; module mới ưu tiên render/cleanup đồng bộ. Async render phải settle sớm khi abort, cleanup chỉ chạm tài nguyên của session. Chi tiết tại interfaces.md. Với import bất đồng bộ, kiểm tra số lần điều hướng trước khi render để tránh tab tải chậm ghi đè tab vừa chọn. Lỗi tải có thông báo và nút thử lại. Listener hash của app chỉ đăng ký một lần.

Module tải lazy bằng import. `garden.render` dựng DOM và trả cleanup ngay, ảnh tải độc lập không chặn đổi tab. Image error có retry; lettering error hiện h1 text. Retry lỗi import reload trang, giữ hash để xóa module failure cache; lỗi render thử render lại. Panel nhận focus bằng Tab, skip link focus main và không đổi hash.

Shell mount nền vườn một lần trong js/background.js, độc lập vòng đời từng tab. Hai canvas ghép ảnh WebP từ PNG đã duyệt thành lớp xa/giữa và tiền cảnh, không vẽ cánh hoa SVG hoặc hình học. Tab mới tự có nền này, kể cả màn hình đăng nhập hoặc lỗi tải module. Homepage bật hai Loopy qua registry: Loopy ngồi phía sau hoa trái và Loopy ngủ phía trước ở phải; module garden chỉ render tiêu đề. ResizeObserver và requestAnimationFrame chỉ vẽ khi resize/tải ảnh hoặc đổi cấu hình nền; canvas được giữ qua chuyển tab và dọn khi shell kết thúc. Không animation loop, logic tưới, bộ lọc, nhập liệu hoặc ghi chép mẫu.

## Mobile

Hai tab lấy nhãn từ registry, nằm trong sidebar bên trái trên cả desktop và điện thoại. Nút menu mở native dialog; chọn tab giữ menu mở. Nút đóng, Escape hoặc bấm backdrop đóng menu và trả focus về nút mở. Điều hướng dọc bằng ArrowUp/ArrowDown, Home/End; Tab giữ focus trong dialog. Nội dung tab hiện dần trong 320 ms, màu tab đổi trong 220 ms; tắt hiệu ứng khi prefers-reduced-motion được bật. Nút chạm cao ít nhất 44 px, có safe-area trên điện thoại. Logo raster vẽ tay ở `assets/brand/` đi cùng tên vườn và không có thao tác điều hướng.

## Dữ liệu và xuất bản

Hồ sơ: public GET, PUT chỉ owner, cookie HttpOnly. Ghi chú: server giữ metadata có thẩm quyền (tác giả, tombstone, revision, lease) và text Yjs từng note; ghi bền rồi mới ACK, phát cập nhật qua SSE. Client giữ bản offline trong IndexedDB. Khách nhận projection công khai, không nhận tài liệu cộng tác, thùng rác hay presence.

Storage chọn khi khởi động: có `SUPABASE_URL` và `SUPABASE_SECRET_KEY` thì hồ sơ và snapshot notes là tài liệu JSON trong bảng `public.documents` (khóa `profiles`, `notes`), media trong bucket private `note-media`, luôn phục vụ qua backend. Thiếu hai biến thì dùng file trong PROFILE_DATA_DIR (mặc định `.data/`: profiles.json, notes.json, note-media/). Snapshot notes được ghi lại toàn bộ mỗi mutation qua một hàng đợi trong process: không hỗ trợ nhiều instance backend cùng ghi. Session RAM mất khi backend restart. Xem [authentication.md](authentication.md), [deployment.md](deployment.md).

GitHub Pages phục vụ tệp tĩnh; project site thường có đường dẫn `https://<owner>.github.io/<repository>/`. Dùng asset tương đối như `./assets/flowers/example.png`, tránh đường dẫn bắt đầu bằng `/`. Không đưa secret vào tệp tải về trình duyệt. Ẩn tab không tạo quyền truy cập riêng tư. [GitHub Docs: What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [GitHub Docs: Creating a site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

Frontend được cấu hình deploy trên Vercel; backend Node.js tối thiểu trên Render. Build xuất frontend vào `dist/` và truyền URL API qua biến môi trường. Xem [hướng dẫn deploy](deployment.md).
