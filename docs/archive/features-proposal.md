# Tính năng — khu vườn của hai người

Đây là đề xuất phạm vi sản phẩm để cùng chọn trước khi xây dựng. Website dành cho bạn và người thương: một đồng cỏ hoa rực rỡ để trở về, xem những điều đã cùng trải qua và nuôi dưỡng những điều muốn làm tiếp. Có thể đặt trên GitHub và xuất bản thành website tĩnh; portfolio là lựa chọn thêm khi cần chia sẻ công việc.

Tên, ngày kỷ niệm, ảnh và câu chuyện thật chưa được cung cấp. Mọi ví dụ dưới đây là **nội dung demo**, không phải thông tin của hai bạn. Thành công của bản đầu: mở trên điện thoại thấy dễ chịu, tìm ảnh hoặc kỷ niệm trong vài thao tác, và thêm/bỏ một tab mà không phải sửa toàn bộ website.

## Phạm vi nên bắt đầu

Khuyến nghị mở **3 tab: Khu vườn, Kỷ niệm, Album**. Nếu danh sách điều muốn làm là thói quen thực tế của hai bạn, mở thêm **Điều muốn làm** thành tab thứ tư. Giữ Góc riêng (portfolio) trong cấu hình nhưng mặc định tắt. Nhiều tab có thể mở rộng về sau; không cần hiển thị tất cả ngay lần đầu.

| ID ổn định | Tên hiển thị | Hình ảnh trong khu vườn | Vai trò | Bản đầu |
|---|---|---|---|---|
| `garden` | Khu vườn | Đồng cỏ, lối đi và những cụm hoa | Trang chào và đường vào nội dung | Bật |
| `memories` | Kỷ niệm | Những bông hoa trên một lối đi | Dòng thời gian của câu chuyện chung | Bật |
| `album` | Album | Luống hoa và những ô ảnh | Xem lại các khoảnh khắc | Bật |
| `wishlist` | Điều muốn làm | Hạt giống chờ nảy mầm | Những việc muốn cùng làm | Bật nếu cần |
| `portfolio` | Góc riêng | Hai góc vườn có bảng tên | Công việc, dự án và liên kết của mỗi người | Tùy chọn |

Ẩn hoặc gỡ tab khỏi danh sách điều hướng **giữ nguyên dữ liệu và tài nguyên** của tab. Xóa nội dung là thao tác riêng, không phải hệ quả của việc đổi bố cục. Tab dùng ID ổn định dù tên hiển thị thay đổi.

## Ba loại hành vi cần phân biệt

- **Nội dung chung từ repository:** hai người đọc cùng một phiên bản đã xuất bản. Sửa ảnh, câu chuyện, trạng thái hoặc thứ tự bằng cách cập nhật dữ liệu trong repo rồi xuất bản lại. Website tĩnh không tự ghi thay đổi trở về GitHub.
- **Chỉ trên thiết bị:** tùy chọn giao diện, bộ lọc hoặc đánh dấu cá nhân có thể lưu trong trình duyệt. Cần ghi rõ “Chỉ lưu trên thiết bị này”; trình duyệt khác không thấy, xóa dữ liệu trình duyệt có thể làm mất trạng thái.
- **Đồng bộ thật giữa hai người:** cùng thêm nội dung, nhận thay đổi của nhau, tải ảnh và quản lý quyền từ website cần dịch vụ lưu trữ/xác thực hoặc backend bổ sung. Đây là giai đoạn tùy chọn, không nằm trong bản tĩnh đầu tiên.

Nút minh họa trong mẫu thiết kế phải ghi “Demo” nếu chưa lưu dữ liệu. Một thông báo “Đã lưu” chỉ xuất hiện khi đã lưu thật và phải nói rõ lưu ở đâu.

## Chi tiết năm tab

### 1. Khu vườn — `garden`

**Mục tiêu:** tạo cảm giác trở về một nơi của hai người, rồi dẫn đến điều đáng xem hôm nay. Một khoảng đồng cỏ nhiều màu làm nền; phần nội dung giữ độ tương phản rõ, hoa không che chữ.

- Bản đầu: lời chào ngắn, tên website do hai bạn chọn, ba lối vào các tab đang bật và một ảnh/kỷ niệm nổi bật lấy từ nội dung đã xuất bản.
- Ví dụ demo: mở website buổi tối, chạm vào cụm hoa “Kỷ niệm” để xem lại một chuyến đi.
- Repository: lời chào, ảnh nổi bật và các đường dẫn; không tự chọn thông tin riêng tư để đưa ra trang chào.
- Thiết bị: bật/tắt chuyển động; có thể nhớ tùy chọn này và tôn trọng cài đặt giảm chuyển động của máy.
- Đồng bộ tùy chọn: thay lời chào hoặc chọn kỷ niệm nổi bật ngay trên web. Không cần cho bản đầu.
- Khi chưa có nội dung: một lời mời nhẹ “Khu vườn đang chờ câu chuyện đầu tiên” và các lối đi còn hoạt động; không hiển thị số ngày yêu nhau khi chưa có ngày xác nhận.

### 2. Kỷ niệm — `memories`

**Mục tiêu:** lưu các dấu mốc có ý nghĩa, ít nhưng có câu chuyện, thay vì phải cập nhật mỗi ngày.

- Bản đầu: thẻ theo thời gian, mỗi thẻ có tiêu đề, ngày nếu đã biết, đoạn kể ngắn và ảnh tùy chọn. Có thể mở thẻ để đọc đầy đủ.
- Ví dụ demo: “Một buổi chiều bên hồ” đi cùng một ảnh và vài dòng; ngày demo ghi rõ là minh họa.
- Repository: thẻ và thứ tự do hai bạn biên tập. Không tự suy ra ngày bắt đầu mối quan hệ.
- Thiết bị: lọc theo năm hoặc giữ vị trí đang xem; đây là tiện ích cá nhân, không đổi dữ liệu chung.
- Đồng bộ tùy chọn: hai người cùng viết, sửa hoặc bình luận; cần xác định ai được sửa/xóa trước khi thêm chức năng này.
- Trống: hướng dẫn ngắn về việc thêm thẻ đầu tiên vào nội dung repo. Ảnh lỗi: giữ câu chuyện và một khung ảnh thay thế; không làm mất cả thẻ.

### 3. Album — `album`

**Mục tiêu:** tìm và xem ảnh nhanh trên điện thoại, giữ chú thích và bối cảnh của từng ảnh.

- Bản đầu: lưới ảnh, nhóm theo bộ ảnh/chuyến đi nếu có; mở ảnh lớn với chú thích và nút đóng rõ ràng. Ảnh tải khi cần để trang chào nhẹ.
- Ví dụ demo: mở bộ ảnh “Dạo chơi cuối tuần”, chạm một ảnh rồi vuốt/chọn ảnh tiếp theo.
- Repository: ảnh đã chọn và chú thích, tối ưu kích thước trước khi xuất bản; không hứa lưu ảnh gốc như một dịch vụ sao lưu.
- Thiết bị: bộ lọc bộ ảnh; nếu có đánh dấu ảnh yêu thích phải ghi “Yêu thích trên thiết bị này”. Có thể bỏ hoàn toàn tính năng yêu thích ở bản đầu.
- Đồng bộ tùy chọn: tải ảnh từ điện thoại lên, cùng đánh dấu yêu thích hoặc tạo bộ ảnh; cần lưu trữ riêng và quyền truy cập thực tế.
- Trống: khung album chờ ảnh đầu tiên. Đang tải: giữ ô ảnh đúng tỷ lệ để bố cục không nhảy. Lỗi: chú thích vẫn đọc được, có nút thử tải lại.

### 4. Điều muốn làm — `wishlist`

**Mục tiêu:** biến những ý tưởng nhỏ thành điều hai người có thể cùng thực hiện.

- Bản đầu tùy chọn: danh sách với tiêu đề, ghi chú ngắn và trạng thái “Muốn làm / Đã làm” lấy từ repository; liên kết một mục đã làm sang kỷ niệm tương ứng nếu có.
- Ví dụ demo: “Trồng một chậu hoa cùng nhau”; sau khi thực hiện, hai bạn cập nhật repo và thêm ảnh vào Album.
- Repository: danh sách và trạng thái là thông tin chung đã xuất bản. Không đặt checkbox có vẻ lưu chung nếu website chưa có nơi ghi dữ liệu.
- Thiết bị: có thể đánh dấu để tự nhắc mình, nhưng tách rõ “Đánh dấu cá nhân” khỏi trạng thái chung; bản đầu nên chỉ đọc để tránh nhầm.
- Đồng bộ tùy chọn: thêm mục và hoàn thành ngay trên web để người kia thấy. Khi lưu thất bại, giữ bản nháp và cho thử lại; không báo hoàn thành thành công trước khi được xác nhận.
- Trống: “Chưa có hạt giống nào — bắt đầu từ một điều nhỏ hai bạn muốn làm.”

### 5. Góc riêng — `portfolio`

**Mục tiêu:** có chỗ chia sẻ công việc khi hai bạn muốn dùng website như một trang giới thiệu; không làm trải nghiệm tình cảm trở thành hồ sơ nghề nghiệp mặc định.

- Bản đầu tùy chọn: bộ chuyển đơn giản giữa **hai hồ sơ**, tên do hai bạn cung cấp, giới thiệu ngắn và các thẻ dự án dẫn sang website công việc bên ngoài.
- Ví dụ demo: chọn “Người thứ nhất” rồi mở liên kết dự án minh họa; các tên này chỉ là nhãn demo, không phải danh tính thật.
- Repository: mô tả, ảnh dự án, liên kết và thứ tự. Mỗi liên kết nói rõ đích đến; không cần nhúng hệ thống quản lý dự án.
- Thiết bị: nhớ hồ sơ đang chọn nếu hữu ích. Không cần chức năng lưu cá nhân khác.
- Đồng bộ tùy chọn: chỉnh sửa hồ sơ trong web chỉ khi thực sự cần; không phải yêu cầu của portfolio.
- Chưa có dự án: lời giới thiệu vẫn hiện, không bịa dự án. Liên kết thiếu: không dựng nút trống. Nếu chỉ một người có portfolio, cho hiện hồ sơ đó mà không ép người còn lại tạo nội dung.

## Điều hướng và trải nghiệm trên điện thoại

Tab là các đích đến có nhãn chữ; hình hoa hỗ trợ nhận diện, không thay thế nhãn. Trên màn hình rộng, dùng một hàng điều hướng gọn. Trên điện thoại, 3–4 tab chính vừa một thanh; khi số tab tăng, đưa các tab phụ vào “Thêm” để tránh hàng biểu tượng quá nhỏ hoặc tràn ngang khó tìm.

Đường dẫn đến từng tab có thể chia sẻ và mở trực tiếp. Tab hiện tại được đánh dấu rõ; nút quay lại và thao tác đóng ảnh giữ người dùng ở vị trí cũ. Nếu một liên kết cũ trỏ đến tab đã tắt, đưa về Khu vườn với thông báo ngắn “Mục này hiện chưa mở”.

Chữ ưu tiên dễ đọc trên nền sáng, kích thước chạm thoải mái, tương tác có trạng thái bàn phím. Giới hạn hiệu ứng bay/lấp lánh; giảm chuyển động vẫn giữ được đồng cỏ nhiều màu. Âm thanh không tự phát. Mọi tab dùng cùng một bố cục cơ bản: tiêu đề, nội dung chính, trạng thái trống hoặc lỗi tương ứng.

## Cách mở rộng gọn

Một registry nhỏ quản lý ID, nhãn, thứ tự, trạng thái bật/tắt và phần nội dung của tab. Thêm tab là thêm mục vào registry cùng nội dung của nó; tắt tab chỉ loại nó khỏi điều hướng và đích mở hợp lệ. Cấu hình này do người duy trì repo chỉnh, chưa phải bảng quản trị trong trình duyệt. Tùy chọn ẩn tab trên thiết bị, nếu thêm sau, chỉ đổi giao diện cá nhân và không có tác dụng bảo vệ dữ liệu.

| Ý tưởng sau này | Hình ảnh | Khi nào đáng thêm | Repository / thiết bị / đồng bộ |
|---|---|---|---|
| Thư gửi nhau | Phong thư cạnh bông hoa | Hai bạn thật sự muốn đọc thư trên web | Repo: chỉ thư được phép công khai; thiết bị: bản nháp riêng có nguy cơ mất; đồng bộ: hộp thư riêng cần xác thực |
| Cột mốc / lịch | Vòng hoa theo mùa | Có ngày thật và cần xem lịch | Repo: ngày đã xác nhận; thiết bị: tùy chọn xem; đồng bộ: cùng sửa lịch. Nhắc lịch tự động là phạm vi riêng |
| Playlist | Tiếng gió / góc nghe nhạc | Có danh sách bài hát chung | Repo: liên kết playlist; thiết bị: âm lượng/tùy chọn; đồng bộ: dùng dịch vụ nhạc sẵn có nếu phù hợp, không xây trình phát mới |
| Hành trình / bản đồ | Lối đi giữa các luống hoa | Nhiều chuyến đi và muốn khám phá theo nơi chốn | Repo: danh sách địa điểm đủ dùng trước; thiết bị: bộ lọc; đồng bộ: cùng thêm chuyến đi. Không cần định vị trực tiếp |
| Nhật ký | Cuốn sổ bên ghế vườn | Có thói quen viết thường xuyên | Repo: bài đã chọn để xuất bản; thiết bị: bản nháp cá nhân; đồng bộ: nhật ký riêng cần lưu trữ và quyền |
| Hỏi thăm cảm xúc | Bông hoa hôm nay | Cả hai muốn và thấy thoải mái dùng | Repo: không phù hợp với cập nhật riêng hằng ngày; thiết bị: ghi chú cho mình; đồng bộ: chia sẻ tự nguyện, chọn rõ người xem |

Chỉ thêm một tab khi có nội dung và một tình huống sử dụng cụ thể. Không dùng streak, điểm tình yêu hoặc chỉ báo “người kia chưa trả lời” ở bản đầu; chúng dễ tạo nghĩa vụ cho một nơi vốn để thư giãn.

## Công khai hay riêng tư

Nếu xuất bản công khai, chỉ đưa lên những ảnh và câu chuyện cả hai đồng ý chia sẻ; portfolio và liên kết công việc rất phù hợp. Album riêng, thư, cảm xúc và lịch chi tiết nên để ngoài bản công khai. Repository riêng không tự làm website được xuất bản trở thành riêng tư.

Nếu cần một khu vườn chỉ hai người xem, chọn giải pháp có kiểm soát truy cập thật trước khi đưa nội dung nhạy cảm lên. Tab bị ẩn, URL khó đoán hoặc ô mật khẩu chạy hoàn toàn ở trình duyệt không bảo vệ nội dung đã được tải xuống. Nội dung từng công khai cũng không lập tức biến mất khỏi bản sao khi xóa khỏi trang.

Trong bản tĩnh, quyền chỉnh nội dung đi theo quyền repository; không đặt nút “Sửa / Xóa” như thể có quyền trong website. Trong phiên bản có đăng nhập, quyền xem/chỉnh và trạng thái hết phiên được giải thích tại nơi cần thao tác; lỗi quyền giữ nguyên nội dung đang soạn nếu có thể. Không cần màn hình quyền hay đăng nhập giả ở bản demo.

## Quyết định đề xuất

Bắt đầu bằng Khu vườn, Kỷ niệm và Album, nội dung được biên tập trong repo, vài ảnh được phép công khai và chuyển động nhẹ. Điều muốn làm là tab thứ tư nếu hữu ích ngay; Góc riêng chỉ bật khi có dự án thật. Hoàn thiện cảm giác đồng cỏ và việc xem nội dung trên điện thoại trước khi thêm nhập liệu hoặc đồng bộ giữa hai người.
