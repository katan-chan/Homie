# Quy tắc code và xác minh

## Quy ước

Giữ phong cách của file đang sửa. JavaScript dùng ES modules, const mặc định, let khi cần, camelCase cho biến/hàm, tên tệp rõ nghĩa. Không reformat toàn repo trong một sửa đổi chức năng. Khi thay phần CSS, ưu tiên selector có phạm vi theo trang/component; không làm ảnh hưởng tab khác.

Dùng DOM API và textContent cho nội dung người dùng; không ghép nội dung không tin cậy vào innerHTML. Chỉ thêm comment để giải thích lý do, điều kiện hoặc giới hạn khó thấy từ code. Không tạo wrapper, base class hoặc helper dùng một lần nếu code trực tiếp đủ rõ.

UI dùng semantic HTML, nhãn tiếng Việt, keyboard focus nhìn thấy, safe-area và nút chạm tối thiểu 44 px. Canvas trang trí không thay thế heading có thể đọc. Hiệu ứng phải hỗ trợ prefers-reduced-motion; không transform một wrapper nếu làm lệch canvas position:fixed.

Không log secret, token hoặc nội dung riêng tư. Biến PUBLIC_* là public. Không coi tab ẩn hoặc CORS là bảo vệ dữ liệu. Khi có API ghi dữ liệu trong tương lai, thiết kế validation/auth trước khi nối UI.

## Kiểm tra theo thay đổi

Khi thêm một tab đã được chốt: đọc interface, tạo `js/tabs/<id>.js`, đăng ký trong `js/tabs.js`, thêm CSS có phạm vi khi cần. Không sửa router cho tab mới. Kiểm tra vào/ra tab nhiều lần, chuyển nhanh khi đang tải, lỗi tải và mobile; cập nhật phạm vi. Ví dụ trong interfaces.md chỉ minh họa hợp đồng, không phải tab cần tự thêm.

Repo có npm test cho Node HTTP/auth/profile và npm run test:browser cho CDP với các điều kiện trong authentication.md. Chưa có lint/typecheck. Các script khác trong /private/tmp và kết quả cũ không phải bộ test portable; không báo chúng đạt nếu chưa chạy.

| Thay đổi | Kiểm tra tối thiểu |
| --- | --- |
| Tài liệu | So khớp interface với code, ví dụ và link local; tìm các mô tả mâu thuẫn |
| JavaScript | node --check trên file đã sửa; kiểm tra luồng thành công, lỗi và cleanup có liên quan |
| Frontend/build | npm run build; kiểm tra dist chứa file và config đúng; không chỉnh dist trực tiếp |
| Router/lifecycle | Hash sai/tắt/hết tab; Back/Forward; đổi nhanh tab; lỗi import/render; callback muộn sau unmount |
| Sidebar | Mở/đóng, Escape/backdrop; chọn tab giữ mở; Up/Down/Home/End; Tab/Shift+Tab; focus sau đóng |
| Visual/mobile | 320×740, 390×844, 768×1024, 1440×1000, 844×390; không overflow, tiêu đề/nút không bị che |
| Animation | Chuyển tab mượt và không lệch canvas; chế độ reduced motion không chạy hiệu ứng |
| Backend | Health/method/path/Origin; import không listen; build không lộ backend/secret |
| Auth/profile | npm test; guest public GET; session/CSRF; chỉ owner PUT; lỗi lưu/expired giữ draft; cookie/storage production |

Lệnh sẵn có:

```sh
npm run dev
npm run dev:backend
npm run build
node --check js/app.js
node --check backend/server.js
npm test
```

Chỉ chạy backend khi thay đổi liên quan. HTTP cần thiết cho ES modules; không kiểm tra bằng file://. Dùng URL mới hoặc reload thật khi kiểm tra để tránh navigation cùng URL giữ module cũ.

Với logic mới có nhánh quan trọng, thêm test nhỏ bằng node:test và node:assert/strict. Hàm thuần test không cần browser; HTTP dùng server listen port 0 và luôn close; UI cần browser cho focus/layout/native dialog. Không viết test chỉ chép lại implementation hoặc thêm framework test cho một assertion đơn giản.

## Hoàn tất và bàn giao

Báo hành vi đã đổi, lý do, kiểm tra thực sự chạy và giới hạn chưa xác minh. Không đồng nhất build thành công với UI đúng. Cập nhật docs/interfaces.md khi đổi hợp đồng, docs/features.md khi scope thay đổi, docs/deployment.md khi cách deploy thay đổi.

Không commit dữ liệu riêng tư, .env, artifact tạm hoặc dist nếu policy repo không yêu cầu. Không tự push/deploy. Chỉ có tài liệu không đảm bảo agent tuân thủ: review và test là lớp xác minh; lint/typecheck/CI chỉ bổ sung khi có quyết định riêng.
