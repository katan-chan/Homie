# Kiến trúc frontend

Frontend đã triển khai gồm hai tab: `garden` (vườn hoa toàn cảnh có hai Loopy) và `dashboard` (Góc ghi chép giữ chỗ). Tính năng chi tiết sẽ do người dùng thiết kế sau.

Ưu tiên **HTML + CSS + JavaScript ES modules**. Chưa cần framework, event bus, hệ plugin hoặc backend. Một registry và một module cho mỗi tab đủ để thêm/bỏ các góc vườn.

## Cấu trúc đang chạy

```text
index.html
styles.css
js/
  app.js                  # hash routing, render và cleanup
  routing.js              # resolver và fallback
  tabs.js                 # registry duy nhất
  tabs/
    garden.js
    dashboard.js
assets/
  flowers/                # WebP từ PNG đã duyệt, giữ alpha
  characters/             # atlas Loopy WebP
  typography/             # lettering WebP
```

Chỉ thêm tệp dữ liệu khi đã chốt nội dung và cách lưu. `index.html` ở root là frontend production; `concept/index.html` cùng PNG gốc trong `concept/assets/` giữ làm reference. Không cần framework hoặc build.

## Registry

```js
export const tabs = [
  { id: 'garden', label: 'Vườn hoa', enabled: true,
    load: () => import('./tabs/garden.js') },
  { id: 'dashboard', label: 'Góc ghi chép', enabled: true,
    load: () => import('./tabs/dashboard.js') },
];
```

ID ổn định, không dấu và duy nhất. Thứ tự mảng là thứ tự điều hướng. Module xuất `render(container, { signal })` và trả về một hàm cleanup. Không cần nhiều loại plugin hoặc một framework registry riêng.

**Thêm:** tạo module, thêm một mục registry. **Tắt:** đặt `enabled: false`. **Bỏ:** xóa mục registry và module giao diện nếu không còn dùng. Giữ dữ liệu và asset cho đến khi có quyết định xóa riêng.

## Điều hướng và vòng đời

Dùng `#garden` và `#dashboard`; Back/Forward hoạt động qua hash. Hash trống, sai hoặc trỏ tới tab tắt được sửa bằng `history.replaceState` về garden nếu bật, nếu không về tab bật đầu tiên. Nếu tất cả đều tắt, hiển thị trạng thái trống.

Khi chuyển tab, abort listener/fetch của tab cũ, gọi cleanup cho timer, observer hoặc chuyển động rồi render tab mới. Với import bất đồng bộ, kiểm tra số lần điều hướng trước khi render để tránh tab tải chậm ghi đè tab vừa chọn. Lỗi tải có thông báo và nút thử lại. Listener hash của app chỉ đăng ký một lần.

Module tải lazy bằng import. `garden.render` dựng DOM và trả cleanup ngay, ảnh tải độc lập không chặn đổi tab. Image error có retry; lettering error hiện h1 text. Retry lỗi import reload trang, giữ hash để xóa module failure cache; lỗi render thử render lại. Panel nhận focus bằng Tab, skip link focus main và không đổi hash.

Homepage là cảnh trang trí toàn viewport; canvas ghép ảnh WebP từ PNG đã duyệt, không vẽ cánh hoa SVG hoặc hình học. Hai canvas tạo lớp xa/giữa và tiền cảnh; Loopy ngồi phía sau hoa trái và Loopy ngủ phía trước ở phải. ResizeObserver và requestAnimationFrame chỉ vẽ khi resize/tải ảnh, được dọn khi rời tab. Không animation loop, logic tưới, bộ lọc, nhập liệu hoặc ghi chép mẫu.

## Mobile

Hai tab lấy nhãn từ registry. Điện thoại dùng thanh dưới có safe-area; desktop dùng thanh trên. Nút chạm cao ít nhất 44 px, hai nhãn nằm trên một hàng, vùng cuối nội dung chừa đủ khoảng trống để thanh điều hướng không che thao tác. Bố cục dashboard chưa chốt, sẽ do người dùng thiết kế sau.

## Dữ liệu và xuất bản

Website tĩnh không tự lưu note hoặc đồng bộ hai người. Chưa chọn nơi lưu dữ liệu trong giai đoạn bố cục này. Khi cần, phân biệt nội dung repository, trạng thái chỉ trên trình duyệt và nội dung có backend/xác thực thật.

GitHub Pages phục vụ tệp tĩnh; project site thường có đường dẫn `https://<owner>.github.io/<repository>/`. Dùng asset tương đối như `./assets/flowers/example.png`, tránh đường dẫn bắt đầu bằng `/`. Không đưa secret vào tệp tải về trình duyệt. Ẩn tab không tạo quyền truy cập riêng tư. [GitHub Docs: What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [GitHub Docs: Creating a site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

Frontend được cấu hình deploy trên Vercel; backend Node.js tối thiểu trên Render. Build xuất frontend vào `dist/` và truyền URL API qua biến môi trường. Xem [hướng dẫn deploy](deployment.md).
