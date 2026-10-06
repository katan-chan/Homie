# Phạm vi hiện tại

Đã triển khai local: vườn hoa, hai hồ sơ công khai, bảng ghi chú dùng chung trong Góc ghi chép (kèm tab Nội quy), Hũ, Lịch, Gợi ý chủ đề seminar và Hoạt động chung. Garden và hồ sơ xem công khai; bảng ghi chú chọn ai xem được (chỉ mình tôi, hai đứa mình hoặc công khai); Hũ, Lịch, Seminar, Hoạt động chung và Nội quy chỉ dành cho hai thành viên đã đăng nhập; mọi thao tác ghi cần đăng nhập. Chỉ minhle sửa chữ hồ sơ Minh Lê, haiyen sửa chữ hồ sơ Hải Yến; bố cục/ảnh chỉnh code trong module riêng. Xem [tài khoản](authentication.md). Không có đăng ký công khai.

Không tự thêm backlog ngoài các không gian và tính năng đã yêu cầu.

| Tab | ID | Hướng thiết kế |
| --- | --- | --- |
| Vườn hoa | `garden` | Homepage gardening: vườn hoa nhiều loài, Loopy hải ly hồng trong Pororo và các element vườn. Nền dịu, hoa là điểm nhấn nhiều màu. |
| Góc ghi chép | `dashboard` | Nhiều bảng ghi chú; mỗi bảng chọn ai xem được. minhle và haiyen sửa chung realtime và offline. Tab Nội quy nằm cuối dải bảng. Chi tiết bên dưới. |
| Hũ | `jar` | Ba bình: nụ hôn, lời xin lỗi, cảm xúc. Chi tiết bên dưới. |
| Lịch | `calendar` | Lịch tháng gom viên trong bình, dịp, kỷ niệm, hoạt động; kỳ riêng của Hải Yến. Chi tiết bên dưới. |
| Gợi ý chủ đề seminar | `seminar` | Kho chủ đề và lượt bốc chung để hai đứa tìm hiểu rồi kể cho nhau nghe. Chi tiết bên dưới. |
| Hoạt động chung | `activity` | Kho ý tưởng theo bảy loại và lượt bốc chung. Chi tiết bên dưới. |
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
- Nhật ký: khi tạo bảng có thể chọn "Nhật ký"; trên bảng nhật ký, note mới mặc định Chỉ mình tôi. Chỉ người tạo bảng bật/tắt ô "Note mới: Chỉ mình tôi"; người kia mở nhật ký chưa được chia sẻ trang nào thì thấy lời nhắn thay vì bảng trống.
- Kỷ niệm: note có nhãn Kỷ niệm có thêm ô "Ngày kỷ niệm" (gắn nhãn thì mặc định hôm nay) và nút "🌱 Trồng vào vườn" / "Nhổ khỏi vườn"; đầu note hiện ngày và huy hiệu "Trong vườn". Bỏ nhãn Kỷ niệm thì note tự ra khỏi vườn. Trồng vào vườn thì chọn loài hoa (Cosmos, Daisy, Poppy, Lavender, Allium) và "Cỡ hoa" có xem trước; trong Vườn hoa, kỷ niệm thành bông hoa có ruy băng hồng, bấm vào mở tấm kỷ niệm và nút "Mở trong Góc ghi chép"; "Đổi hoa" đổi loài/cỡ. Khách không thấy hoa kỷ niệm. Kỷ niệm có ngày hiện trong Lịch.
- Mở note từ trang khác: chạm kỷ niệm trong Lịch mở đúng bảng, căn note vào giữa và làm nổi note vài giây.
- Nội quy (tab cuối dải bảng, chỉ khi đã đăng nhập): đề xuất nội quy, đề xuất sửa kèm lý do; một bản chỉ có hiệu lực khi cả hai đồng ý, bản cũ vẫn áp dụng tới lúc đó. Lưu trữ cần một người đề nghị và người kia xác nhận; ai cũng rút hoặc giữ lại được. Có lịch sử các bản.
- Khách xem danh sách bảng công khai, nội dung note và hình đã chèn; không thấy thùng rác, presence, Nội quy hoặc hình chưa chèn.

Hoàn tác chỉ trong phiên tab hiện tại. Thùng rác, cột và di chuyển cột vẫn tác động cả note bị ẩn với mình (ví dụ bỏ cột thì note riêng của người kia trong cột cũng ẩn theo, khôi phục cột thì hiện lại).

## Hũ

Ba bình trên kệ (điện thoại: một bình mỗi lần, vuốt ngang để đổi): nụ hôn, lời xin lỗi gửi người kia và cảm xúc. Một chạm thả viên vào bình kèm Hoàn tác. Cảm xúc chọn trên ô dễ chịu × năng lượng (hoặc hai thanh trượt), tên gợi ý theo góc, ghi chú tùy chọn, mặc định Chỉ mình tôi; chủ viên sửa hoặc chia sẻ được. Nụ hôn và lời xin lỗi hai đứa cùng thấy; cảm xúc riêng của người kia không bao giờ hiện. Lọc 7 ngày, 30 ngày, Mọi lúc; danh sách theo ngày; chủ viên lấy viên ra khỏi bình (có Hoàn tác). Màu viên dùng chung với Lịch.

## Lịch

Lưới tháng (tháng trước/sau, Hôm nay) và bảng chi tiết ngày: số nụ hôn và lời xin lỗi, chấm màu cảm xúc trung bình trong ngày của từng người (không gồm cảm xúc riêng của người kia), dịp, kỷ niệm có ngày từ Góc ghi chép và các lần seminar/hoạt động đã làm. Dịp có ba loại (Dịp đặc biệt, Kỷ niệm ngày, Cột mốc), hai đứa cùng thấy, chỉ người tạo sửa hoặc lưu trữ. Chu kỳ chỉ Hải Yến thấy và ghi (bắt đầu, kết thúc hoặc đang diễn ra, ghi chú, kết thúc hôm nay, lưu trữ); Minh không thấy gì về chu kỳ. Không dự đoán, không lời khuyên y tế, không thông báo. Trên điện thoại cả tháng nằm gọn một màn hình, không cuộn trang; chạm một ngày mở bảng chi tiết dạng popup. Để trang mở qua nửa đêm thì "hôm nay" tự chuyển sang ngày mới.

## Gợi ý chủ đề seminar và Hoạt động chung

Hai trang cùng một kiểu: kho ý tưởng (mặt bảng giấy kéo đổi chỗ hoặc danh sách), lượt bốc chung cho cả hai máy, lịch sử đã làm. Seminar là chủ đề để hai đứa tìm hiểu rồi kể cho nhau nghe; Hoạt động chung có bảy loại (Trò chuyện, Sáng tạo, Khám phá, Chơi, Tự làm, Tụi mình, Nhảm nhí) và lọc theo loại. Bốc ngẫu nhiên đều trong các mục chưa bỏ qua và chưa làm trong 14 ngày; có thể bỏ qua, đặt lại các mục đã bỏ qua hoặc cho bốc cả mục vừa làm. "Xong rồi" ghi ngày, vài dòng và điểm 1–5 cho niềm vui của chính mình; người kia tự chấm phần mình. Chỉ người tạo sửa hoặc lưu trữ ý tưởng; lưu trữ giữ lịch sử.

## Thông báo trên điện thoại

Chỉ trong app Android: sau khi đăng nhập app xin quyền thông báo một lần. Người kia nhận thông báo khi có nụ hôn, lời xin lỗi hoặc cảm xúc được chia sẻ trong Hũ (sau vài giây, Hoàn tác thì không báo), và khi có note mới hoặc bảng vừa được chia sẻ trong Góc ghi chép mà người kia xem được (gom trong một phút thành một thông báo, kèm dòng đầu của note). Không báo cảm xúc riêng, trang nhật ký riêng, bảng riêng hay note đã xóa. Chạm thông báo mở Hũ hoặc đúng note. Không có thông báo trên web; tắt bằng cài đặt thông báo của Android.

## Giao diện và triển khai

Ưu tiên điện thoại: các tab dễ chạm trong sidebar trái bật/tắt. Chọn tab giữ menu mở, nền không blur; nội dung có transition nhẹ và hỗ trợ giảm chuyển động. Logo riêng chỉ để nhận diện; trang có favicon từ logo. Homepage là vườn hoa toàn cảnh và vùng chữ không bị che.

Nguồn frontend ở index.html đã tách CSS và ES modules, giữ homepage thành vườn hoa với hai Loopy. Không thêm tưới, lời thoại, bộ lọc hoặc ghi chép mẫu. Repository có cấu hình Vercel/Render, backend health/auth/profile/notes cùng feature API Hũ, Lịch, ý tưởng, Nội quy và hoa kỷ niệm, và storage Supabase tùy chọn. SSE qua proxy Vercel→Render đã kiểm chứng trên production; upload hình trên production vẫn cần FFmpeg trên Render; xem [deployment.md](deployment.md).

Đề xuất năm tab trước đây đã được giữ ở [archive/features-proposal.md](archive/features-proposal.md) để tham khảo, không còn là phạm vi hiện tại.
