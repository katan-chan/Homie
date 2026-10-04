# Deploy frontend trên Vercel, backend trên Render

Frontend production: [homie-ecru.vercel.app](https://homie-ecru.vercel.app). Project Vercel `pp-5f37/homie` kết nối với `katan-chan/Homie`, production branch `main`.

Backend Render: [homie-api-vd9v.onrender.com](https://homie-api-vd9v.onrender.com), service `srv-davgrouk1f9s73a977vg`, region Singapore, plan Free. Auto deploy cấu hình trigger `commit` trên `main`; cần kết nối GitHub deployment credential trước khi Render nhận sự kiện push. URL repo công khai đơn thuần không kích hoạt auto deploy.

Production frontend gọi `/api/...` cùng origin. `vercel.json` proxy các request này tới backend Render; không đặt `PUBLIC_API_BASE_URL` thành origin Render trong project Vercel khi dùng proxy. Cookie `HttpOnly; Secure; SameSite=Lax` không cần đổi sang cookie cross-site. Backend cho phép origin `https://homie-ecru.vercel.app`.

Frontend là website tĩnh; backend có health, auth/session và public profile API. Không cần thư viện ngoài, dùng Node.js 22. Xem [contract](authentication.md).

## Điều kiện trước khi deploy auth/profile

- Đặt MINHLE_PASSWORD_HASH và HAIYEN_PASSWORD_HASH trong secret environment server; không đặt ở Vercel frontend/public env. Local .env không được tự gửi lên hosting.
- Chọn proxy /api cùng origin hoặc domain frontend/API cùng site để cookie SameSite=Lax hoạt động. Vercel mặc định và Render mặc định khác site: chỉ đặt PUBLIC_API_BASE_URL chưa đủ. SESSION_SAME_SITE=None yêu cầu Secure production và browser cho phép cookie cross-site; không là đảm bảo tương thích mọi browser.
- Storage bền: đặt `SUPABASE_URL` và `SUPABASE_SECRET_KEY` trên Render (Environment). Khi có hai biến này, hồ sơ và notes lưu trong bảng `public.documents` (mỗi khóa là một tài liệu JSON) và hình note lưu trong bucket private `note-media` của Supabase; thiếu biến thì backend dùng file trong `PROFILE_DATA_DIR` như local. Bảng tạo một lần bằng SQL Editor (`create table public.documents (key text primary key, value jsonb not null, updated_at timestamptz not null default now()); alter table public.documents enable row level security; revoke all on public.documents from anon, authenticated;`). Secret key chỉ ở server; publishable key không dùng. Kiểm tra với project thật bằng `npm run test:supabase` (ghi dưới tiền tố `test-…` rồi tự xóa). Chuyển đổi hình vẫn cần `ffmpeg`/`ffprobe` trên host backend; Render Node runtime hiện chưa có. Không tự đổi gói trả phí.
- Session giữ RAM một instance; restart cần đăng nhập lại. Profile file chỉ hỗ trợ một process ghi. Rate limit socket-IP sau reverse proxy cần đánh giá trước production.

## 1. Render

Service hiện được tạo qua CLI từ URL repo. Trong [Account Settings](https://dashboard.render.com/u/settings), thêm GitHub ở Git Deployment Credentials và cấp quyền cho repo `katan-chan/Homie`. Sau đó tại [service Settings](https://dashboard.render.com/web/srv-davgrouk1f9s73a977vg/settings), chọn Git Credentials vừa kết nối. Khi kết nối hoàn tất, push vào `main` kích hoạt build/redeploy trên Render; Vercel đã được xác nhận hoạt động từ push. Không tạo thêm Blueprint cho cùng repo nếu chỉ muốn cập nhật service hiện hữu; dùng Dashboard hoặc `render services update` khi đổi cấu hình service. `render.yaml` ghi lại cấu hình để tạo lại bằng Blueprint nếu cần.

Điền `FRONTEND_ORIGINS` bằng URL frontend, ví dụ `https://your-project.vercel.app`. Có thể điền sau khi tạo project Vercel rồi restart backend. Nhiều origin cách nhau bằng dấu phẩy, không có dấu `/` cuối URL. Chỉ thêm URL preview cụ thể khi cần, không mở toàn bộ `*.vercel.app`.

Nếu tạo Web Service thủ công: Root Directory để trống, Runtime Node, Build Command `node --check backend/server.js`, Start Command `npm start`, Health Check Path `/api/health`. Render tự cấp `PORT`; server lắng nghe trên `0.0.0.0`.

Lưu URL thực tế Render cấp, ví dụ `https://your-api.onrender.com`, và kiểm tra `/api/health` trả `{"status":"ok"}`. Không giả định URL từ tên service vì Render có thể thêm hậu tố.

## 2. Vercel

Import cùng repo, Root Directory để mặc định (root). `vercel.json` chọn Other, chạy `npm run build` và xuất bản `dist/`.

Có thể deploy garden tĩnh trước; hồ sơ/login cần backend. API_BASE_URL rỗng gọi /api trên origin frontend, nên phải có proxy khi dùng cấu hình đó. Khi chọn API origin riêng, đặt PUBLIC_API_BASE_URL bằng origin HTTPS thực tế, không có /api; xử lý cookie topology như phần trên và redeploy. Biến này công khai; không chứa secret.

Kết nối project Vercel với repository GitHub và đặt Production Branch là `main`. Mỗi lần push hoặc merge vào `main`, Vercel tự build và cập nhật website production; không cần GitHub Actions riêng. Trang đã mở trên trình duyệt cần refresh để nhận bản mới.

Sau khi có domain Vercel, cập nhật `FRONTEND_ORIGINS` trên Render. Nếu dùng domain riêng, thêm origin đó. CORS chỉ giới hạn đọc qua trình duyệt, không thay thế xác thực.

Build chỉ sao chép `index.html`, `styles.css`, `js/`, `assets/` vào `dist/`; backend, tài liệu và `.env` không được xuất bản. Hash routing `#garden`/`#dashboard` không cần SPA rewrite.

## Kết nối API khi thêm tính năng

URL được xuất từ `js/config.js`; build tạo phiên bản theo biến môi trường:

```js
import { API_BASE_URL } from './config.js';
const response = await fetch(`${API_BASE_URL}/api/health`);
if (!response.ok) throw new Error(`API returned ${response.status}`);
const health = await response.json();
```

js/auth.js gọi API với credentials: include. Mutation gửi X-Requested-With: Homie và JSON nếu có body. Profile GET công khai, PUT chỉ owner. Không dùng fetch mặc định không credentials cho session hoặc mutation.

## Chạy local

Nếu chưa có .env, dùng .env.example làm cấu trúc và provision hai salted hash bằng hashPassword trong backend/auth.js; không ghi đè .env đang chứa hash. Chạy npm run dev:backend và npm run dev trong hai terminal. Mở http://localhost:8000/ hoặc http://127.0.0.1:8000/; source config local chọn API hostname khớp frontend. npm run build không tự đọc .env; node --env-file=.env scripts/build.js đọc env nhưng chỉ xuất config API public vào dist.

Kiểm tra build bằng `npm run build` và backend bằng `GET /api/health`.

Tham khảo: [Render Blueprint](https://render.com/docs/blueprint-spec), [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json).
