# Thiết kế bảng ghi chú dùng chung

Ngày: 2026-10-02. Trạng thái: ba phần thiết kế đã được người dùng duyệt trong hội thoại; tài liệu tổng hợp chờ duyệt. Chưa triển khai tính năng.

## Mục tiêu và phạm vi

Góc ghi chép là nhiều bảng dùng chung, lấy cảm hứng thao tác từ Miro nhưng mang diện mạo giấy thủ công của Homie. Khách xem công khai; hai tài khoản minhle và haiyen cùng chỉnh sửa mọi bảng và note. Không có bảng riêng, đăng ký hay tài khoản mới. Homepage, asset vườn hoa và sidebar hiện tại được giữ nguyên.

Thiết kế này thay quyết định cũ rằng dashboard chỉ được xem sau đăng nhập. Khi triển khai phải cập nhật registry, kiểm tra quyền server và tài liệu liên quan đồng thời. Đây là phạm vi tương lai, không phải mô tả hệ thống đang chạy.

## Bảng, cột và điều hướng

- Có nhiều bảng có tên; hàng tab bên trong Góc ghi chép chuyển bảng. Sidebar trái tiếp tục chuyển các mục của Homie.
- Mở bảng vừa xem gần nhất trên thiết bị. Nếu bảng không còn tồn tại, mở bảng khả dụng đầu tiên; nếu chưa có bảng, hiện trạng thái trống, không tạo dữ liệu mẫu.
- Bảng mới mặc định trống, có thể thêm cột hoặc dùng không cột.
- Cột chứa note. Note đặt tự do bên trong cột, không tự xếp hàng; di chuyển cột mang các note đi cùng.
- Thả note vào cột khác sẽ đổi cột và giữ vị trí thả tương ứng trong cột mới. Bảng không cột cho đặt note tự do.
- Desktop: giữ chuột phải kéo góc nhìn; chuột trái kéo đối tượng. Chặn menu chuột phải trong vùng bảng khi dùng thao tác này.
- Cuộn chuột trên nền bảng thu/phóng quanh con trỏ; cuộn trong phần chữ note đọc nội dung. Có nút giảm/tăng zoom và vừa màn hình.
- Điện thoại: hai ngón di chuyển/thu phóng; một ngón kéo đối tượng; chạm chữ để sửa. Tách cử chỉ di chuyển khỏi thao tác sửa và cuộn chữ.
- Khách được chuyển bảng, di chuyển góc nhìn và thu/phóng.

## Note và diện mạo

- Nền hồng kem, texture giấy nhẹ, note pastel có bóng mềm; cột là vùng giấy được đánh dấu.
- Note đổi màu giấy và kéo đổi cả chiều rộng, chiều cao. Chữ dài thì cuộn bên trong.
- Font viết tay hỗ trợ đầy đủ dấu tiếng Việt và tiếng Anh; có màu chữ, đậm, nghiêng, gạch chân, danh sách và checklist.
- Mỗi note hiện tên người tạo từ danh tính session lúc tạo. Người khác sửa không thay tác giả ban đầu; client không được tự khai báo tác giả.
- Sticker/icon cố định trên mặt giấy; chỉ chữ cuộn. Đổi kích thước giấy không tự scale sticker/icon. Giữ tọa độ từ góc trên trái là đề xuất được ghi trong hội thoại, cần xác nhận hành vi khi thu nhỏ giấy khiến hình vượt biên trong kế hoạch UX.

## Sticker và icon

- Thư viện chung cho cả hai tài khoản. Cả hai được upload, đổi tên và gỡ mục; khách không duyệt thư viện hoặc dùng API quản lý.
- Gỡ mục khỏi thư viện không xóa những bản đã chèn. Giữ tài nguyên được các bản này tham chiếu.
- Khách xem tài nguyên đã chèn công khai; việc ẩn thư viện không ngăn lưu hình đang hiển thị bằng trình duyệt.
- PNG thông thường chuyển sang GIF hoặc WebM nhưng vẫn tĩnh. Không tự tạo hiệu ứng animation cho PNG.
- GIF nhiều khung, WebM/video và spritesheet có animation được phát động. GIF một khung vẫn tĩnh.
- Upload spritesheet có bước khai báo kích thước khung, số khung và tốc độ phát; kiểm tra cấu hình khớp ảnh.
- Đối tượng có thể di chuyển, đổi kích thước, xoay và đổi lớp trước/sau trong note.
- prefers-reduced-motion hiển thị khung tĩnh thay animation.
- Danh sách định dạng video, giới hạn upload, codec đầu ra và công cụ chuyển đổi phải được kiểm chứng và ghi cụ thể trong kế hoạch trước khi triển khai pipeline. Không coi mọi file có đuôi liên quan là định dạng hỗ trợ.

## Cộng tác và quyền

- Khách chỉ đọc các bảng đang hoạt động. Chỉnh sửa, quản lý thư viện và thùng rác yêu cầu session của một trong hai tài khoản.
- Hai người cùng sửa chữ trong một note, hợp nhất thao tác thay vì ghi đè toàn bộ nội dung theo lần lưu cuối.
- Chỉ người đăng nhập thấy con trỏ kèm tên và dấu hiệu người đang sửa. Presence là trạng thái tạm thời, không phải nội dung note.
- Kéo, xoay hoặc resize online: người bắt đầu giữ đối tượng đến lúc kết thúc. Người kia vẫn sửa chữ được. Server cấp quyền giữ có thời hạn, gia hạn trong thao tác và giải phóng khi kết thúc/mất kết nối.
- Giữ đối tượng không có hiệu lực offline. Cách giải quyết hai thay đổi vị trí/thuộc tính offline trùng nhau cần quy tắc xác định rõ trong kế hoạch; không hứa rằng hợp nhất văn bản tự giải quyết được các thuộc tính này.
- Cập nhật trực tiếp cho người xem đang kết nối; dữ liệu presence chỉ gửi đến người có quyền.

## Lưu, offline và hoàn tác

- Tự động lưu; có nút Lưu và Ctrl+S/Cmd+S để gửi ngay thay đổi còn chờ. Chỉ chặn phím tắt khi đang ở Góc ghi chép.
- Hiện đang lưu, đã lưu, mất kết nối hoặc chưa đồng bộ. Chỉ báo đã lưu khi server xác nhận lưu bền; không đồng nhất gửi thành công với lưu bền.
- Khi offline, người đã đăng nhập tiếp tục sửa phần đã tải và giữ thay đổi trên thiết bị. Nút/phím tắt Lưu lúc này chỉ lưu cục bộ. Nội dung chưa tải không được hứa truy cập offline.
- Kết nối lại hợp nhất rồi gửi thay đổi sau khi xác minh session. Session hết hạn không xóa bản nháp; chỉ đồng bộ sau khi đăng nhập lại đúng tài khoản. Không gửi hàng đợi của người trước dưới danh tính người vừa đăng nhập khác.
- Undo/Redo có nút, Ctrl+Z và Ctrl+Shift+Z, tương ứng Cmd trên macOS. Mỗi người hoàn tác thao tác của mình, không đảo thay đổi của người kia. Phạm vi lịch sử qua reload cần chọn trong kế hoạch.
- Upload offline không được coi là đã xuất bản tài nguyên; cần thiết kế trạng thái chờ và giới hạn lưu cục bộ khi lập kế hoạch.

## Thùng rác

- Xóa bảng, cột hoặc note đưa vào thùng rác để khôi phục. Xóa cột đưa các note bên trong đi cùng; khôi phục cột khôi phục nhóm đó. Xóa/khôi phục bảng bảo toàn cây nội dung tương ứng.
- Nếu người khác đã xóa note trong lúc sửa offline, giữ note trong thùng rác và hợp nhất phần sửa vào bản có thể khôi phục. Hiện thông báo, không tự hồi sinh note trên bảng.
- Không bổ sung tự động xóa vĩnh viễn hoặc thời hạn giữ nếu chưa được người dùng chốt.

## Hướng kiến trúc để lập kế hoạch

Giữ HTML/CSS/JavaScript ES modules và backend Node native. Registry duy nhất vẫn là js/tabs.js; app sở hữu hash, panel, focus và vòng đời. Tab chỉ sở hữu subtree và tài nguyên của nó, xuất render(container, { signal }) và cleanup an toàn khi gọi lại.

Tách trách nhiệm theo luồng thực tế: giao diện bảng và rich text; tài liệu cộng tác và hàng đợi offline; server xác thực, đồng bộ và lưu bền; thư viện và chuyển đổi media. Chưa chọn thư viện cộng tác hay storage. Yêu cầu hợp nhất rich text đồng thời cần đánh giá CRDT/OT hiện có trước khi chọn dependency; không tự viết thuật toán hợp nhất để tránh dependency.

Mô hình cần thể hiện bảng, cột, note, tác giả bất biến, văn bản cộng tác, tọa độ/kích thước, đối tượng trang trí, tài nguyên thư viện và trạng thái thùng rác. Presence và quyền giữ là dữ liệu tạm; góc nhìn và bảng gần nhất thuộc thiết bị. Không nhét schema notes vào file hồ sơ hiện tại.

Server kiểm tra quyền mọi mutation, upload và kết nối cộng tác; CORS hoặc tab ẩn không thay xác thực. Nội dung người dùng được render an toàn. File upload phải kiểm tra nội dung, kích thước và tài nguyên xử lý. Không đưa credential hoặc session vào frontend/storage nội dung.

Storage production phải bền cho cả tài liệu và media; cấu hình Render không có volume hiện tại chưa đáp ứng. Kế hoạch phải giải quyết đường đi cookie/session thực tế giữa frontend và backend trước khi khẳng định cộng tác hoạt động trên deploy. Không tự deploy.

Callback bất đồng bộ không cập nhật DOM sau abort/cleanup. Dọn kết nối, listener, observer và animation của tab; hàng đợi đã lưu cục bộ không bị mất khi rời tab.

## Accessibility và kiểm chứng dự kiến

Giữ focus rõ, touch target ít nhất 44 px, responsive và reduced motion. Có thao tác bằng nút/bàn phím thay cho kéo để di chuyển, chuyển cột, resize và sắp lớp; không phụ thuộc chuột phải để tiếp cận chức năng.

Kế hoạch kiểm tra phải bao gồm: quyền khách/hai tài khoản; tác giả không bị giả mạo; hai client sửa chữ cùng lúc; quyền giữ và mất kết nối; offline/reconnect và session hết hạn; xóa trong lúc offline; Undo riêng từng người; lưu bền sau restart; tài nguyên đã chèn còn sau khi gỡ thư viện; chuyển đổi PNG, phát spritesheet và reduced motion; desktop/mobile, zoom, cuộn chữ, focus và cleanup khi đổi tab. Dùng credential fixture, không commit mật khẩu thật.

## Bước tiếp theo

Người dùng duyệt tài liệu tổng hợp này trước khi lập kế hoạch triển khai. Kế hoạch cần chọn và kiểm chứng cơ chế hợp nhất, lưu bền, media pipeline và các hành vi biên đã chỉ rõ phía trên. Chưa sửa tài liệu mô tả hệ thống hiện tại thành lời khẳng định các tính năng đã triển khai.
