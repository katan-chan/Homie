# Hướng dẫn làm việc trong Homie

Đọc tài liệu theo thứ tự: [phạm vi](docs/features.md), [kiến trúc](docs/architecture.md), [interface](docs/interfaces.md). Khi viết code, áp dụng [quy tắc và kiểm tra](docs/contributing.md). [Danh mục skills](docs/skills.md) giúp chọn quy trình phù hợp.

## Phạm vi và trải nghiệm

- Chỉ triển khai yêu cầu đã được người dùng chốt. Dashboard đang giữ chỗ; không tự thêm ghi chú mẫu, CRUD note, tài khoản khác hoặc đồng bộ.
- Đã triển khai local hai tài khoản minhle (Minh Lê), haiyen (Hải Yến), đăng nhập bằng mật khẩu. Garden và hai tab hồ sơ công khai; dashboard riêng tư. Chỉ owner sửa tên hiển thị/bio của mình bằng Edit; bố cục/ảnh chỉnh trong module code riêng. Xem docs/authentication.md. Không thêm đăng ký; không đưa mật khẩu thật vào code, tài liệu hoặc test được commit.
- Giữ homepage vườn hoa vẽ tay, tông hồng hoàng hôn và hai Loopy đã duyệt. Không tự thay asset hoặc bố cục. Không tạo hoa bằng SVG.
- Tab nằm trong sidebar trái; chọn tab giữ sidebar mở. Không blur nền. Logo chỉ nhận diện, không liên kết về trang chủ.
- Giữ focus bàn phím, touch target ít nhất 44 px, responsive và prefers-reduced-motion.

## Ranh giới code

- Giữ HTML/CSS/JavaScript ES modules và Node.js native hiện tại. Thêm dependency hoặc framework phải có nhu cầu cụ thể và giải thích chi phí.
- Registry duy nhất: js/tabs.js. Tab xuất render(container, { signal }) và trả cleanup. Không viết nhánh riêng cho một tab trong router.
- App sở hữu hash, panel, focus và việc abort/dispose. Tab chỉ sở hữu DOM bên trong container và tài nguyên của chính nó.
- Cleanup phải an toàn khi gọi lại. Callback bất đồng bộ không được cập nhật DOM/canvas sau abort hoặc cleanup.
- Asset dùng đường dẫn tương đối hoặc new URL(..., import.meta.url). Không sửa dist/ bằng tay; build tạo lại thư mục này.
- Backend có health/auth/profile API. Mọi write hồ sơ phải kiểm tra session, owner và CSRF; registry requiresAuth chỉ khóa UI, không thay quyền server. Không coi CORS là xác thực. Không đưa secret hoặc dữ liệu riêng tư vào frontend. Profile là nội dung công khai.
- .env và .data/ là local runtime, không commit hoặc copy vào dist/. Session RAM một instance; file profile cần storage bền trước production. Không tự đổi free service sang gói trả phí.

## Cách thực hiện

1. Đọc luồng code bị ảnh hưởng và tài liệu tương ứng; nêu giả định nếu yêu cầu chưa đủ rõ.
2. Thay đổi nhỏ nhất đáp ứng yêu cầu. Không refactor ngoài phạm vi, xóa dữ liệu hoặc triển khai công khai nếu chưa được yêu cầu.
3. Khi đổi interface, tìm mọi caller, cập nhật cùng lúc code, ví dụ và tài liệu. Nếu ý định thay đổi chưa rõ, trình bày lựa chọn trước khi triển khai phần phụ thuộc.
4. Chạy kiểm tra phù hợp trong docs/contributing.md. Báo đúng lệnh, kết quả và phần chưa kiểm tra; không nói đạt khi chưa chạy.
5. Cập nhật tài liệu khi thay đổi phạm vi, interface, UX hoặc cách vận hành. Không ghi phiên bản mong muốn như thể đã triển khai.

Các quy tắc này áp dụng cho cả agent và người phát triển. Skills hỗ trợ thực hiện; không thay thế interface hoặc tự mở rộng phạm vi. Chỉ dẫn trực tiếp mới nhất của người dùng được ưu tiên.
