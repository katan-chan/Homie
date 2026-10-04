# Phạm vi hiện tại

Đã triển khai local: vườn hoa, hai hồ sơ công khai và bảng ghi chú dùng chung trong Góc ghi chép. Garden, hồ sơ và bảng ghi chú đều xem công khai; mọi thao tác ghi cần đăng nhập. Chỉ minhle sửa chữ hồ sơ Minh Lê, haiyen sửa chữ hồ sơ Hải Yến; bố cục/ảnh chỉnh code trong module riêng. Xem [tài khoản](authentication.md). Không có đăng ký công khai.

Không tự thêm backlog ngoài các không gian và tính năng đã yêu cầu.

| Tab | ID | Hướng thiết kế |
| --- | --- | --- |
| Vườn hoa | `garden` | Homepage gardening: vườn hoa nhiều loài, Loopy hải ly hồng trong Pororo và các element vườn. Nền dịu, hoa là điểm nhấn nhiều màu. |
| Góc ghi chép | `dashboard` | Nhiều bảng ghi chú công khai để xem; minhle và haiyen sửa chung realtime và offline. Chi tiết bên dưới. |
| Minh Lê | `minhle` | Hồ sơ công khai; owner dùng Edit sửa tên hiển thị/giới thiệu. |
| Hải Yến | `haiyen` | Hồ sơ công khai; owner dùng Edit sửa tên hiển thị/giới thiệu. |

## Bảng ghi chú (Góc ghi chép)

Đã triển khai:

- Bảng: tab theo bảng, nút "+" tạo bảng, đổi tên, bỏ vào thùng rác và khôi phục qua "Bảng đã xóa". Ghi nhớ bảng xem gần nhất trên thiết bị. Không có bảng/note mẫu.
- Cột và note tự do trên mặt phẳng: tạo, kéo, đổi kích thước, đổi tên cột, sáu màu giấy cho note, thùng rác theo bảng và khôi phục. Di chuyển/zoom camera và "Vừa màn hình". Hoàn tác/Làm lại vị trí.
- Văn bản: đậm/nghiêng/gạch chân, màu chữ, cỡ chữ 10–72px (mặc định 28px, bằng tên tác giả và tên cột), danh sách và checklist; một hàng định dạng chung cho mỗi bảng; tối đa 100.000 ký tự/note. Font Patrick Hand tự host.
- Cộng tác: hai tài khoản sửa cùng lúc (Yjs + SSE), thấy con trỏ và caret của người kia; tác giả note lấy từ session.
- Offline: bản nháp và hàng đợi thao tác lưu IndexedDB theo tài khoản+bảng, gửi lại khi có mạng; trạng thái lưu hiển thị riêng, Ctrl/⌘+S hoặc Lưu đẩy hàng đợi. File chờ upload tối đa 50 MiB tổng trên thiết bị.
- Thư viện hình (nút "Thư viện hình"): upload PNG, JPG/JPEG, GIF, WebM, MP4 và PNG spritesheet; server chuyển PNG/JPG/GIF thành GIF; ô "Tự khử nền" (bật sẵn, ảnh tĩnh PNG/JPG) khử phần nền một màu nối với mép ảnh và chừa một viền ~2% quanh hình như sticker bế, giữ nguyên vùng cùng màu nằm trong hình; ảnh nền phức tạp (ảnh chụp) được giữ nguyên, video thành WebM, tạo poster PNG; xem bản chuyển đổi trước khi xác nhận; đổi tên, gỡ. Nút Chèn hình trong hàng định dạng chỉ duyệt thư viện để chèn hình trang trí lên bảng, gắn vào note đang viết; sticker kéo đi khắp bảng, nằm trên note và cột, không bị cắt ở mép note. Thả lên note thì đi theo note, thả trong cột thì đi theo cột, thả ra chỗ trống thì đứng riêng; note/cột vào thùng rác thì sticker gắn theo ẩn cùng. Bấm vào hình để chọn (không có khối phủ lên hình): kéo bằng chuột trái hoặc giữ chuột phải, kéo chấm tròn ở góc phải dưới để đổi cỡ (giữ tỉ lệ); hàng định dạng đổi sang nhóm Trang trí (dời, to/nhỏ, xoay, ra trước/sau, gỡ, xong); bàn phím: mũi tên dời, Delete gỡ, Esc bỏ chọn. Giảm chuyển động dùng poster.
- Khách xem danh sách bảng, nội dung note và hình đã chèn; không thấy thùng rác, presence hoặc hình chưa chèn.

Hoàn tác chỉ trong phiên tab hiện tại. Mọi bảng dùng chung cho hai tài khoản và công khai để xem; không có bảng riêng tư.

## Giao diện và triển khai

Ưu tiên điện thoại: các tab dễ chạm trong sidebar trái bật/tắt. Chọn tab giữ menu mở, nền không blur; nội dung có transition nhẹ và hỗ trợ giảm chuyển động. Logo riêng chỉ để nhận diện; trang có favicon từ logo. Homepage là vườn hoa toàn cảnh và vùng chữ không bị che.

Nguồn frontend ở index.html đã tách CSS và ES modules, giữ homepage thành vườn hoa với hai Loopy. Không thêm tưới, lời thoại, bộ lọc hoặc ghi chép mẫu. Repository có cấu hình Vercel/Render, backend health/auth/profile/notes và storage Supabase tùy chọn. SSE qua proxy Vercel→Render đã kiểm chứng trên production; upload hình trên production vẫn cần FFmpeg trên Render; xem [deployment.md](deployment.md).

Đề xuất năm tab trước đây đã được giữ ở [archive/features-proposal.md](archive/features-proposal.md) để tham khảo, không còn là phạm vi hiện tại.
