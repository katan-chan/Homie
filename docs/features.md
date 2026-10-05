# Phạm vi hiện tại

Đã triển khai local: vườn hoa, hai hồ sơ công khai và bảng ghi chú dùng chung trong Góc ghi chép. Garden và hồ sơ xem công khai; bảng ghi chú chọn ai xem được (chỉ mình tôi, hai đứa mình hoặc công khai); mọi thao tác ghi cần đăng nhập. Chỉ minhle sửa chữ hồ sơ Minh Lê, haiyen sửa chữ hồ sơ Hải Yến; bố cục/ảnh chỉnh code trong module riêng. Xem [tài khoản](authentication.md). Không có đăng ký công khai.

Không tự thêm backlog ngoài các không gian và tính năng đã yêu cầu.

| Tab | ID | Hướng thiết kế |
| --- | --- | --- |
| Vườn hoa | `garden` | Homepage gardening: vườn hoa nhiều loài, Loopy hải ly hồng trong Pororo và các element vườn. Nền dịu, hoa là điểm nhấn nhiều màu. |
| Góc ghi chép | `dashboard` | Nhiều bảng ghi chú; mỗi bảng chọn ai xem được. minhle và haiyen sửa chung realtime và offline. Chi tiết bên dưới. |
| Minh Lê | `minhle` | Hồ sơ công khai; owner dùng Edit sửa tên hiển thị/giới thiệu. |
| Hải Yến | `haiyen` | Hồ sơ công khai; owner dùng Edit sửa tên hiển thị/giới thiệu. |

## Bảng ghi chú (Góc ghi chép)

Đã triển khai:

- Bảng: tab theo bảng, nút "+" tạo bảng, đổi tên, bỏ vào thùng rác và khôi phục qua "Bảng đã xóa". Ghi nhớ bảng xem gần nhất trên thiết bị. Không có bảng/note mẫu.
- Cột và note tự do trên mặt phẳng: tạo, kéo, đổi kích thước (note nhỏ nhất 5×5px, cột 240×240px, tối đa 2400px), đổi tên cột, sáu màu giấy cho note, thùng rác theo bảng và khôi phục. Di chuyển góc nhìn bằng cách kéo nền (chuột trái, một ngón) hoặc giữ chuột phải ở bất kỳ đâu; cuộn hoặc hai ngón để zoom; "Vừa màn hình". Hoàn tác/Làm lại vị trí.
- Văn bản: đậm/nghiêng/gạch chân, màu chữ, cỡ chữ 10–72px (mặc định 28px, bằng tên cột và tên tác giả ở note cỡ mặc định 360×320; tên tác giả và nhãn trên đầu note co giãn theo cạnh ngắn của note, 4–96px), danh sách và checklist; một hàng định dạng chung cho mỗi bảng; tối đa 100.000 ký tự/note. Font Patrick Hand tự host.
- Cộng tác: hai tài khoản sửa cùng lúc (Yjs + SSE), thấy con trỏ và caret của người kia; tác giả note lấy từ session.
- Offline: bản nháp và hàng đợi thao tác lưu IndexedDB theo tài khoản+bảng, gửi lại khi có mạng; trạng thái lưu hiển thị riêng, Ctrl/⌘+S hoặc Lưu đẩy hàng đợi. File chờ upload tối đa 50 MiB tổng trên thiết bị.
- Thư viện hình (nút "Thư viện hình"): upload PNG, JPG/JPEG, GIF, WebM, MP4 và PNG spritesheet; server chuyển PNG/JPG/GIF thành GIF; ô "Tự khử nền" (bật sẵn, ảnh tĩnh PNG/JPG) khử phần nền một màu nối với mép ảnh và chừa một viền ~2% quanh hình như sticker bế, giữ nguyên vùng cùng màu nằm trong hình; ảnh nền phức tạp (ảnh chụp) được giữ nguyên, video thành WebM, tạo poster PNG; xem bản chuyển đổi trước khi xác nhận; đổi tên, gỡ. Nút Chèn hình trong hàng định dạng chỉ duyệt thư viện để chèn hình trang trí lên bảng, gắn vào note đang viết; sticker kéo đi khắp bảng, nằm trên note và cột, không bị cắt ở mép note. Thả lên note thì đi theo note, thả trong cột thì đi theo cột, thả ra chỗ trống thì đứng riêng; note/cột vào thùng rác thì sticker gắn theo ẩn cùng. Bấm vào hình để chọn (không có khối phủ lên hình): kéo bằng chuột trái hoặc giữ chuột phải, kéo chấm tròn ở góc phải dưới để đổi cỡ (giữ tỉ lệ); hàng định dạng đổi sang nhóm Trang trí (dời, to/nhỏ, xoay, ra trước/sau, gỡ, xong); bàn phím: mũi tên dời, Delete gỡ, Esc bỏ chọn. Giảm chuyển động dùng poster.
- Ai xem được: mỗi bảng có ô "Ai xem" trên thanh công cụ: Chỉ mình tôi (mặc định khi tạo bảng mới), Hai đứa mình, Công khai (khách cũng xem). Chỉ người tạo bảng đổi được, và chỉ đổi thành riêng của chính mình. Tab bảng có nhãn "riêng" hoặc "công khai"; mỗi note luôn hiện huy hiệu ai xem được nó thực tế (Công khai / Hai đứa mình / Chỉ mình tôi, lấy mức hẹp hơn giữa bảng và note). Mỗi note có thể thu hẹp thêm trong ô "Ai xem" của note: Theo bảng (mặc định), Hai đứa mình hoặc Chỉ mình tôi; chỉ tác giả note đổi được. Note bị ẩn cũng ẩn sticker gắn theo nó, nội dung chữ, con trỏ đang sửa và mọi thao tác của người không được xem (server trả 404 như không tồn tại). Bảng có từ trước giữ Công khai.
- Nhãn: mỗi note có tối đa 12 nhãn tự đặt (1–32 ký tự, không trùng khi khác hoa/thường), hiện ngay trên đầu note; nút "+ Kỷ niệm" gắn nhanh nhãn Kỷ niệm. Ai xem được note thì sửa được nhãn. Gõ nhãn đã có trên bảng với khác hoa/thường sẽ dùng lại cách viết sẵn có. Ô lọc "Mọi ghi chú / Nhãn: …" (cả khách cũng dùng) làm mờ các note không có nhãn đã chọn.
- Khách xem danh sách bảng công khai, nội dung note và hình đã chèn; không thấy thùng rác, presence hoặc hình chưa chèn.

Hoàn tác chỉ trong phiên tab hiện tại. Thùng rác, cột và di chuyển cột vẫn tác động cả note bị ẩn với mình (ví dụ bỏ cột thì note riêng của người kia trong cột cũng ẩn theo, khôi phục cột thì hiện lại).

## Giao diện và triển khai

Ưu tiên điện thoại: các tab dễ chạm trong sidebar trái bật/tắt. Chọn tab giữ menu mở, nền không blur; nội dung có transition nhẹ và hỗ trợ giảm chuyển động. Logo riêng chỉ để nhận diện; trang có favicon từ logo. Homepage là vườn hoa toàn cảnh và vùng chữ không bị che.

Nguồn frontend ở index.html đã tách CSS và ES modules, giữ homepage thành vườn hoa với hai Loopy. Không thêm tưới, lời thoại, bộ lọc hoặc ghi chép mẫu. Repository có cấu hình Vercel/Render, backend health/auth/profile/notes và storage Supabase tùy chọn. SSE qua proxy Vercel→Render đã kiểm chứng trên production; upload hình trên production vẫn cần FFmpeg trên Render; xem [deployment.md](deployment.md).

Đề xuất năm tab trước đây đã được giữ ở [archive/features-proposal.md](archive/features-proposal.md) để tham khảo, không còn là phạm vi hiện tại.
