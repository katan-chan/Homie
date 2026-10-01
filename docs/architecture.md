# Kiến trúc hiện tại

Frontend có bốn tab: garden, dashboard, minhle và haiyen. Garden và hai hồ sơ công khai; dashboard giữ chỗ riêng tư. Chỉ người đăng nhập đúng tài khoản sửa phần chữ trong hồ sơ của mình; ảnh/bố cục chỉnh bằng code riêng. Tính năng ghi chép sẽ do người dùng thiết kế sau.

Frontend dùng **HTML + CSS + JavaScript ES modules**. Backend Node.js native có auth/session và public profile API; session RAM và file profile cho một process. Một registry và một module cho mỗi tab đủ để thêm/bỏ các góc vườn; chưa cần framework hoặc hệ plugin. Auth dùng EventTarget riêng để cập nhật UI danh tính, không phải event bus tổng quát.

Quy tắc thực hiện nằm trong [AGENTS.md](../AGENTS.md), [interface](interfaces.md), [quy tắc code và kiểm tra](contributing.md), [bộ skills đề xuất](skills.md). Tài liệu này mô tả cấu trúc; interfaces.md là nguồn chi tiết cho hợp đồng module.

## Cấu trúc đang chạy

```text
index.html
styles.css
js/
  app.js                  # hash routing, render và cleanup
  routing.js              # resolver và fallback
  config.js               # API origin public, thay khi build
  auth.js                 # cookie API client và trạng thái danh tính
  login.js                # form đăng nhập
  profile.js              # UI chữ công khai + owner edit dùng chung
  tabs.js                 # registry duy nhất
  tabs/
    garden.js
    dashboard.js
    minhle.js              # cấu hình bố cục/ảnh Minh Lê bằng code
    haiyen.js              # cấu hình bố cục/ảnh Hải Yến bằng code
assets/
  flowers/                # WebP từ PNG đã duyệt, giữ alpha
  characters/             # atlas Loopy WebP
  typography/             # lettering WebP
  brand/                  # logo raster, nguồn và prompt
backend/server.js         # HTTP health/auth/profiles, CORS/CSRF
backend/auth.js           # scrypt, session và rate limit
backend/profiles.js       # validate text và ghi file atomic
tests/                    # Node HTTP và browser CDP
scripts/build.js          # xuất frontend vào dist/
```

Chỉ thêm tệp dữ liệu khi đã chốt nội dung và cách lưu. `index.html` ở root là nguồn frontend; `concept/index.html` cùng PNG gốc trong `concept/assets/` giữ làm reference. Local chạy trực tiếp qua HTTP; build tạo `dist/` để deploy, không chỉnh output bằng tay.

## Registry

```js
export const tabs = [
  { id: 'garden', label: 'Vườn hoa', enabled: true,
    load: () => import('./tabs/garden.js') },
  { id: 'dashboard', label: 'Góc ghi chép', enabled: true, requiresAuth: true,
    load: () => import('./tabs/dashboard.js') },
  { id: 'minhle', label: 'Minh Lê', enabled: true,
    load: () => import('./tabs/minhle.js') },
  { id: 'haiyen', label: 'Hải Yến', enabled: true,
    load: () => import('./tabs/haiyen.js') },
];
```

ID ổn định, không dấu và duy nhất. Thứ tự mảng là thứ tự điều hướng. Module xuất `render(container, { signal })`; quy ước module mới là trả cleanup đồng bộ, app hiện cũng hỗ trợ Promise. Xem chữ ký và ownership tại [interfaces.md](interfaces.md). Không cần nhiều loại plugin hoặc một framework registry riêng.

**Thêm:** tạo module, thêm một mục registry. **Tắt:** đặt `enabled: false`. **Bỏ:** xóa mục registry và module giao diện nếu không còn dùng. Giữ dữ liệu và asset cho đến khi có quyết định xóa riêng.

## Điều hướng và vòng đời

Dùng `#garden` và `#dashboard`; Back/Forward hoạt động qua hash. Hash trống, sai hoặc trỏ tới tab tắt được sửa bằng `history.replaceState` về garden nếu bật, nếu không về tab bật đầu tiên. Nếu tất cả đều tắt, hiển thị trạng thái trống.

Khi chuyển tab, app abort tab cũ và chờ disposal của session ngay trước nó. Đây không phải serialization toàn cục của các cleanup bất đồng bộ khi đổi nhanh nhiều tab; module mới ưu tiên render/cleanup đồng bộ. Async render phải settle sớm khi abort, cleanup chỉ chạm tài nguyên của session. Chi tiết tại interfaces.md. Với import bất đồng bộ, kiểm tra số lần điều hướng trước khi render để tránh tab tải chậm ghi đè tab vừa chọn. Lỗi tải có thông báo và nút thử lại. Listener hash của app chỉ đăng ký một lần.

Module tải lazy bằng import. `garden.render` dựng DOM và trả cleanup ngay, ảnh tải độc lập không chặn đổi tab. Image error có retry; lettering error hiện h1 text. Retry lỗi import reload trang, giữ hash để xóa module failure cache; lỗi render thử render lại. Panel nhận focus bằng Tab, skip link focus main và không đổi hash.

Homepage là cảnh trang trí toàn viewport; canvas ghép ảnh WebP từ PNG đã duyệt, không vẽ cánh hoa SVG hoặc hình học. Hai canvas tạo lớp xa/giữa và tiền cảnh; Loopy ngồi phía sau hoa trái và Loopy ngủ phía trước ở phải. ResizeObserver và requestAnimationFrame chỉ vẽ khi resize/tải ảnh, được dọn khi rời tab. Không animation loop, logic tưới, bộ lọc, nhập liệu hoặc ghi chép mẫu.

## Mobile

Hai tab lấy nhãn từ registry, nằm trong sidebar bên trái trên cả desktop và điện thoại. Nút menu mở native dialog; chọn tab giữ menu mở. Nút đóng, Escape hoặc bấm backdrop đóng menu và trả focus về nút mở. Điều hướng dọc bằng ArrowUp/ArrowDown, Home/End; Tab giữ focus trong dialog. Nội dung tab hiện dần trong 320 ms, màu tab đổi trong 220 ms; tắt hiệu ứng khi prefers-reduced-motion được bật. Nút chạm cao ít nhất 44 px, có safe-area trên điện thoại. Logo raster vẽ tay ở `assets/brand/` đi cùng tên vườn và không có thao tác điều hướng. Bố cục dashboard chưa chốt, sẽ do người dùng thiết kế sau.

## Dữ liệu và xuất bản

Ghi chép chưa có lưu trữ hoặc đồng bộ. Hồ sơ có API thực: public GET, PUT chỉ owner, cookie HttpOnly; text lưu file trong PROFILE_DATA_DIR ngoài dist. Session RAM mất khi backend restart. File local tồn tại qua restart, nhưng deploy phải chọn storage bền thực tế; xem [authentication.md](authentication.md).

GitHub Pages phục vụ tệp tĩnh; project site thường có đường dẫn `https://<owner>.github.io/<repository>/`. Dùng asset tương đối như `./assets/flowers/example.png`, tránh đường dẫn bắt đầu bằng `/`. Không đưa secret vào tệp tải về trình duyệt. Ẩn tab không tạo quyền truy cập riêng tư. [GitHub Docs: What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [GitHub Docs: Creating a site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

Frontend được cấu hình deploy trên Vercel; backend Node.js tối thiểu trên Render. Build xuất frontend vào `dist/` và truyền URL API qua biến môi trường. Xem [hướng dẫn deploy](deployment.md).
