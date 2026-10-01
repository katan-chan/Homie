# Vườn của chúng mình

Frontend tĩnh từ concept đã duyệt: vườn hoa vẽ tay toàn màn hình, hai Loopy, tiêu đề hoa lá và nền hồng hoàng hôn. Hai tab được quản lý bởi registry.

## Chạy local

Không cần npm install hoặc build. Với Python 3 trên máy:

```sh
npm run dev
# Hoặc:
python3 -m http.server 8000 --bind 127.0.0.1
```

Mở **http://127.0.0.1:8000/**. ES modules cần HTTP; không mở index.html trực tiếp bằng file://. Sau khi sửa file, reload trang; hard refresh nếu trình duyệt còn giữ mã cũ.

## Cấu trúc

```text
index.html                  shell, metadata, navigation
styles.css                  theme và responsive
js/app.js                   hash routing, focus, lifecycle, error/retry
js/routing.js               chọn tab và fallback
js/tabs.js                  registry
js/tabs/garden.js           canvas và image loading
js/tabs/dashboard.js        chỗ dành cho thiết kế ghi chép sau
assets/                     WebP production có alpha
backend/server.js           backend Node.js tối thiểu
scripts/build.js            đóng gói frontend cho Vercel
concept/                    bản mẫu và bảng chữ để tham khảo
docs/                       phạm vi, kiến trúc và deploy
```

## Thêm hoặc bỏ tab

Tạo module xuất `render(container, { signal })`, trả về cleanup; signal dừng listener/tác vụ khi rời tab. Thêm vào `js/tabs.js`:

```js
{
  id: 'ten-tab',
  label: 'Tên tab',
  enabled: true,
  load: () => import('./tabs/ten-tab.js'),
}
```

ID không dấu, duy nhất, ổn định. Thứ tự registry là thứ tự navigation. Tắt bằng enabled: false; bỏ bằng cách xóa mục và module. Không sửa router. Reload sau khi thay registry. Nếu garden bị tắt, hash lạ về tab bật đầu tiên; tất cả tắt thì hiện trạng thái trống.

## Phạm vi hiện tại

Góc ghi chép giữ chỗ cho bố cục/tính năng bạn sẽ thiết kế. Chưa có CRUD note, tài khoản hoặc lưu/đồng bộ dữ liệu. Homepage là cảnh trang trí; nút thử lại chỉ xuất hiện khi tải lỗi.

[Ba bảng chữ](concept/typography.html) là concept PNG, chưa phải font. Tiêu đề dùng lettering đã duyệt, chữ giao diện dùng font có sẵn trên máy.

## Deploy

Frontend trên Vercel, backend trên Render. Dùng Node.js 22, không có dependency ngoài. Xem [hướng dẫn deploy](docs/deployment.md) để cấu hình URL và CORS. `npm run build` tạo frontend trong `dist/`; backend hiện chỉ có `/api/health`, chưa lưu dữ liệu.

## Tài liệu

- [Kiến trúc](docs/architecture.md), [phạm vi](docs/features.md), [thiết kế](concept/design-notes.md).
- [Deploy Render + Vercel](docs/deployment.md).
- [Prompt hoa](concept/assets/handdrawn-prompts.md), [prompt chữ](concept/assets/typography/README.md), [prompt Loopy](concept/assets/generated-additions.md).
- [Concept gốc](concept/index.html), [ba bảng chữ](concept/typography.html).

WebP được encode từ PNG đã duyệt, giữ kích thước và alpha; bốn ảnh khoảng 1,85 MB so với 8,37 MB PNG. PNG gốc vẫn trong concept/assets.
