# Đăng nhập và hai hồ sơ

Đã triển khai local: garden và hai tab hồ sơ công khai; dashboard yêu cầu đăng nhập. Chỉ chủ tài khoản được sửa phần chữ trong hồ sơ của mình. Không có đăng ký, tài khoản thứ ba, quản trị tài khoản hoặc đăng nhập Google.

## Danh tính và quyền

| Tên đăng nhập / ID | Tên hiển thị ban đầu | Quyền |
| --- | --- | --- |
| minhle | Minh Lê | Sửa tên hiển thị và giới thiệu của minhle |
| haiyen | Hải Yến | Sửa tên hiển thị và giới thiệu của haiyen |
| Chưa đăng nhập | — | Xem garden và cả hai hồ sơ; không chỉnh sửa |

Tên đăng nhập so khớp chính xác; không đổi qua UI. displayName có thể chỉnh, không thay ID/ownership. Hai hồ sơ chứa nội dung công khai: không nhập dữ liệu cần giữ riêng vào bio.

Bố cục, hình và trang trí chỉ chỉnh trong code. Mỗi tab có module riêng: js/tabs/minhle.js và js/tabs/haiyen.js; phần form/lưu dùng chung trong js/profile.js. Registry có bốn tab; dashboard giữ chỗ, không có chức năng ghi chép mới.

## Credential và session

Mật khẩu ban đầu được người dùng chỉ định riêng, không chép vào repo hoặc test. Local đã provision hai salted hash khác nhau trong .env bị Git ignore. Server đọc MINHLE_PASSWORD_HASH và HAIYEN_PASSWORD_HASH, định dạng salt:hash hex. Thiếu/sai hash làm login trả 503; không có mật khẩu fallback.

hashPassword(password) trong backend/auth.js sử dụng scrypt N=131072, r=8, p=1, maxmem=256MiB, salt ngẫu nhiên 16 byte, hash 64 byte; đối chiếu timingSafeEqual. Hai scrypt tối đa chạy đồng thời. [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Cookie homie_session: HttpOnly, Path=/, Max-Age=86400, SameSite=Lax mặc định; Secure khi NODE_ENV=production. Session token ngẫu nhiên 32 byte, giữ trong RAM server, không trả qua JSON hoặc localStorage. Login thay session cũ của cookie; logout hủy session. Restart backend làm mất phiên, người dùng đăng nhập lại. [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

Request POST/PUT yêu cầu Origin chính xác trong FRONTEND_ORIGINS và X-Requested-With: Homie; body JSON, tối đa 8192 byte. Rate limit 10 lần/account/15 phút, 30 lần/socket IP/15 phút; số bucket/session và tác vụ hash có giới hạn. Không tin X-Forwarded-For từ client. Sau reverse proxy, nhiều client có thể cùng socket IP; cần cấu hình trust proxy/rate limit hạ tầng khi triển khai thực tế. [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

## API đã triển khai

| Endpoint | Quyền / kết quả |
| --- | --- |
| POST /api/auth/login | { accountId, password } → 200 { user: { id, displayName, bio } } và cookie; sai credential 401 chung |
| GET /api/auth/session | 200 { user } nếu phiên hợp lệ; 401 nếu thiếu/hết hạn |
| POST /api/auth/logout | 204, hủy session và cookie; chấp nhận không body hoặc {} |
| GET /api/profiles/minhle | Công khai → 200 { profile: { id, displayName, bio } } |
| GET /api/profiles/haiyen | Công khai → cùng schema |
| PUT /api/profiles/:id | Chỉ owner → { displayName, bio }, trả { profile }; thiếu session 401, người khác 403 |
| GET /api/health | Công khai → { status: "ok" } |

GET route hỗ trợ HEAD; route biết trước hỗ trợ OPTIONS. ID hồ sơ ngoài hai ID trả 404. Không nhận role, userId, avatar hoặc field không được chốt. displayName trim, dài 1–80 ký tự; bio trim, tối đa 500. Không dùng cookie frontend/userId trong body để quyết định owner; backend luôn lấy ID từ session.

CORS cho origin chính xác, credentials true và Content-Type/X-Requested-With. Public read không cần Origin khi gọi trực tiếp. Khi gửi Origin, origin ngoài allowlist bị chặn; đó không biến hồ sơ công khai thành dữ liệu riêng.

## Lưu dữ liệu và deployment

PROFILE_DATA_DIR mặc định .data; profiles.json chỉ có ID, displayName, bio, không credential/session. Backend đọc dữ liệu lúc khởi động; file sai schema trả lỗi, không tự ghi đè bằng default. Ghi xếp hàng trong một process, file tạm rồi rename. File vẫn còn sau restart local; không hỗ trợ nhiều backend process cùng ghi một file.

Cấu hình Render free hiện tại không có volume bền: chưa đủ để lưu hồ sơ production. Cần storage bền thực tế trước khi bật chỉnh sửa trên deploy. Không đặt data directory trong assets/ hoặc dist/.

Vercel và Render mặc định khác site: SameSite=Lax không đủ cho fetch có session giữa hai site. Ưu tiên proxy /api cùng origin hoặc domain cùng site. SESSION_SAME_SITE=None chỉ chấp nhận với Secure production, vẫn phụ thuộc browser có cho cookie cross-site hay không. Không khẳng định config hiện tại đã giải quyết auth trên production; xem deployment.md.

## Chạy và kiểm tra

Local: npm run dev:backend đọc .env, npm run dev phục vụ frontend. API hostname localhost/127.0.0.1 khớp hostname frontend. Mở http://127.0.0.1:8000/.

npm test chạy bộ Node HTTP/auth/profile bằng credential fixture khác credential thật. npm run test:browser cần Chrome CDP ở port 9333, frontend/API local đang chạy và AUTH_TEST_PASSWORD do người chạy cung cấp riêng; không ghi giá trị vào repo/log. Browser test thay bio để kiểm tra rồi khôi phục.

Đã kiểm tra 14 trường hợp backend và 18 kiểm tra browser, gồm quyền owner, session/logout, hồ sơ public, persist restart, validation, cookie/CSRF, mobile và giữ bản nháp qua hết phiên/đăng nhập lại cùng người.

## Nhánh phát triển

Hai nhánh local minhle và haiyen dành cho chỉnh code. Nhánh Git không phải cơ chế phân quyền webapp; cookie/session phía server mới quyết định người được sửa hồ sơ. Không tự push, deploy hoặc chọn nhánh main khác với yêu cầu người dùng.
