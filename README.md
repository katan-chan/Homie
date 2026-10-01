# Vườn của chúng mình

Vườn hoa vẽ tay toàn màn hình, hai Loopy, tiêu đề hoa lá và nền hồng hoàng hôn. Registry quản lý bốn tab: vườn, góc ghi chép, Minh Lê và Hải Yến. Garden và hồ sơ công khai; đăng nhập mới sửa phần chữ trong hồ sơ của chính mình hoặc mở góc ghi chép.

## Chạy local

Không cần npm install hoặc build. Với Python 3 trên máy:

```sh
npm run dev
# Hoặc:
python3 -m http.server 8000 --bind 127.0.0.1
```

Mở **http://127.0.0.1:8000/**. ES modules cần HTTP; không mở index.html trực tiếp bằng file://. Sau khi sửa file, reload trang; hard refresh nếu trình duyệt còn giữ mã cũ.

Để đăng nhập/tải và lưu hồ sơ, chạy thêm `npm run dev:backend` trong terminal khác. Backend đọc `.env` local bị Git ignore; phiên hiện dùng cookie và credential salted hash của hai tài khoản đã cấu hình. Clone mới cần provision hai hash theo [hướng dẫn tài khoản](docs/authentication.md), không commit mật khẩu. Không ghi đè `.env` đã cấu hình bằng template rỗng.

## Cấu trúc

```text
index.html                  shell, metadata, navigation
styles.css                  theme và responsive
js/app.js                   hash routing, focus, lifecycle, error/retry
js/routing.js               chọn tab và fallback
js/tabs.js                  registry
js/tabs/garden.js           canvas và image loading
js/tabs/dashboard.js        chỗ dành cho thiết kế ghi chép sau
js/auth.js                  auth client dùng cookie, trạng thái danh tính
js/login.js                 form đăng nhập
js/profile.js               hồ sơ public, edit text chỉ owner
js/tabs/minhle.js            bố cục/ảnh của Minh Lê chỉnh code
js/tabs/haiyen.js            bố cục/ảnh của Hải Yến chỉnh code
assets/                     WebP production có alpha
backend/server.js           API health, auth và profiles
backend/auth.js             hash scrypt, session, rate limit
backend/profiles.js         validation và lưu profile file atomic
tests/                      Node HTTP + browser CDP
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

Góc ghi chép vẫn giữ chỗ; chưa có CRUD note hoặc đồng bộ. Hai tài khoản cố định minhle/haiyen đã có auth local, profile riêng và quyền sửa theo owner. Nút Edit chỉ sửa tên hiển thị/giới thiệu; bố cục, hình và trang trí chỉnh bằng code. Cả hai hồ sơ có nền vườn hoa theo viewport và ResizeObserver. Homepage giữ cảnh đã duyệt.

[Ba bảng chữ](concept/typography.html) là concept PNG, chưa phải font. Tiêu đề dùng lettering đã duyệt, chữ giao diện dùng font có sẵn trên máy.

## Deploy

Frontend cấu hình Vercel, backend cấu hình Render. Node.js 22, không có dependency ngoài. `npm run build` tạo dist/ không chứa backend, .env hoặc .data. Chưa publish auth/profile: cần topology cookie cùng site/proxy và storage bền; Render free hiện tại không đủ giữ profile qua thay thế instance. Xem [deploy](docs/deployment.md).

## Kiểm tra và nhánh

`npm test` chạy test Node HTTP/auth/profile bằng credential fixture. `npm run test:browser` cần Chrome CDP 9333, hai server local và AUTH_TEST_PASSWORD cung cấp riêng; `npm run test:layout` kiểm tra resize hồ sơ ở sáu kích thước.

Hai nhánh local `minhle` và `haiyen` dành cho thay đổi code riêng. File profile tương ứng nằm trong js/tabs/; nhánh Git không quyết định quyền sửa trên website. Chưa push/deploy các nhánh này.

## Tài liệu

- [Đăng nhập và hai hồ sơ](docs/authentication.md) — contract đã triển khai local và giới hạn deploy.

- Người phát triển và agent bắt đầu tại [AGENTS.md](AGENTS.md).
- [Interface module/API](docs/interfaces.md), [quy tắc code và kiểm tra](docs/contributing.md), [bộ skills đề xuất](docs/skills.md).

- [Kiến trúc](docs/architecture.md), [phạm vi](docs/features.md), [thiết kế](concept/design-notes.md).
- [Deploy Render + Vercel](docs/deployment.md).
- [Prompt hoa](concept/assets/handdrawn-prompts.md), [prompt chữ](concept/assets/typography/README.md), [prompt Loopy](concept/assets/generated-additions.md).
- [Concept gốc](concept/index.html), [ba bảng chữ](concept/typography.html).

WebP được encode từ PNG đã duyệt, giữ kích thước và alpha; bốn ảnh khoảng 1,85 MB so với 8,37 MB PNG. PNG gốc vẫn trong concept/assets.
