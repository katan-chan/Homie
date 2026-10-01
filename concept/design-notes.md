# Homepage là toàn bộ khu vườn

Vườn là cảnh toàn viewport: mọi khóm hoa mọc từ thảm lá ở chân cảnh, mảng cao hai mép có thân nối xuống dưới. Không đặt khóm độc lập ở góc trên hoặc treo hoa giữa khoảng trống. Loopy đứng trong vườn. Không có banner ảnh hoặc khung cảnh nhỏ riêng bên dưới nội dung.

Hoa chuyển sang PNG minh họa chì màu và gouache, tạo bằng imagegen với alpha, thay cho hoa hiện thực. Hai mảng lấy cảm hứng từ cúc trắng, cosmos, thanh cúc, hoa chuông, lavender, phi yến, mao địa hoàng, allium, cúc La Mã, anh túc, mõm sói, lưu ly, dianthus và cỏ thi. Đây là minh họa AI dựa trên loài thật, không phải kiểm kê thực vật được xác minh. Ảnh hiện thực cũ được giữ làm reference nhưng homepage không còn tải chúng.

Canvas ghép mảng hoa rộng với chân lá liên tục, các tâm mảng cách đều và mép chồng ít nhất 38%. Đường bao theo dáng lưỡi liềm bất đối xứng: mép trái cao và đầy hơn, đầu phải thấp và thuôn dần, không mô phỏng chính xác mặt trăng. Một dải hoa liền thay cho hai luống tách tầng. Chỉ giữ hai Loopy trang trí: ngồi cầm hoa bên trái và ngủ bên phải. Đã bỏ hai Loopy ở giữa theo yêu cầu; khoảng giữa dành cho hoa. Nền sage, kem và hồng phấn giữ độ dịu. Không dùng SVG hoặc vẽ cánh hoa hình học.

Prompt vẽ tay và quy tắc nối mảng: [assets/handdrawn-prompts.md](assets/handdrawn-prompts.md). Prompt asset cũ: [assets/generated-additions.md](assets/generated-additions.md).

Homepage chỉ có tiêu đề, cảnh hoa và Loopy. Đã bỏ nút tưới, lời thoại, nút CTA, bộ lọc, các bài ghi chép mẫu và hộp thoại. Chỉ có hai nút điều hướng từ registry; tab Góc ghi chép giữ chỗ, người dùng sẽ tự thiết kế sau.

## Chữ và hoàng hôn

Nền chuyển sang hồng nhạt ở trên, đào ấm ở giữa và sage nhẹ dưới thảm lá. Màu chữ và tab được chuyển sang mận/rose dịu. Tiêu đề giữa trang dùng lettering PNG alpha “Vườn của chúng mình.”, nét serif vẽ tay đan hoa và lá; nội dung h1 tiếng Việt vẫn có dưới dạng text cho trình đọc màn hình. Ba bảng concept chữ hoa, chữ thường và dấu thanh được lưu ở [typography.html](typography.html): Title hoa lá, Header serif mềm, Normal text sans-serif ấm. Đây là mẫu raster để chọn phong cách, chưa phải font chữ có thể gõ. Font HTML của Header và văn bản vẫn là font sẵn trên máy. [Prompt và asset](assets/typography/README.md).

Kiểm tra bản chữ: 46 kiểm tra homepage đạt ở bốn viewport; gallery có ba bảng, mỗi bảng HTML đối chiếu có 29 chữ hoa và 29 chữ thường, ảnh tải được và không tràn ngang ở 390/1440 px. Tiêu đề đọc được dưới dạng h1 và lettering tải thành công. Ảnh bảng chữ đã xem trực tiếp; chưa chứng nhận độ chính xác glyph của một font thực tế.

## Chiều sâu của cảnh

Canvas nền chứa hoa xa nhỏ hơn, alpha 44% và blur 0,7 px. Loopy ngồi được vẽ trước mảng hoa cao bên trái để lấp ló sau hoa; Loopy ngủ nằm trên canvas tiền cảnh z-index 3, vẽ sau hoa thấp. Tiêu đề ở z-index 4. Hai nhân vật nằm ở hai đầu của cung lưỡi liềm. Hai canvas không nhận pointer; hoa vẫn mọc từ chân cảnh, không có khóm góc trên.

Kiểm tra bản chỉ còn hai Loopy: 46/46 kiểm tra Chrome đạt ở bốn kích thước nêu dưới, bao gồm việc bỏ Loopy giữa, kích thước lớp tiền cảnh, thứ tự z-index và pointer-events.

## Điện thoại

Cảnh phủ toàn màn hình theo viewport thực tế; hoa được bố trí lại theo chiều rộng. Mobile giữ Loopy ngồi ở 22% và Loopy ngủ ở 83% chiều rộng; kích thước bị giới hạn theo chiều rộng để không phình trên điện thoại dài. Hoa hai mép và tiền cảnh giảm kích thước. Thanh hai tab ở dưới có safe-area và nút cao 50 px. Desktop dùng thanh trên. Không có animation liên tục.

## Kiểm tra

Ngày 01/10/2026, sau khi đổi sang vẽ tay: 34 kiểm tra Chrome đều đạt ở 320 × 740, 390 × 844, 768 × 1024 và 1440 × 1000. Đã tải và decode hai PNG hoa cùng Loopy trước khi kiểm tra; xác nhận canvas phủ đúng toàn viewport, không tràn ngang, không có điều khiển tự thêm trong nội dung, nút tab ít nhất 44 px, hash lạ quay về homepage và không có JavaScript exception. Đã xem capture homepage 390 và 1440 px, agent visual_review_v4 cũng xem trực tiếp và không phát hiện vấn đề quan trọng. Chưa kiểm tra Safari hoặc điện thoại thật.
