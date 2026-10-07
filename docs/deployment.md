# Deploy frontend trên Vercel, backend trên Render

Frontend production: [homie-ecru.vercel.app](https://homie-ecru.vercel.app). Project Vercel `pp-5f37/homie` kết nối với `katan-chan/Homie`, production branch `main`.

Backend Render: [homie-api-vd9v.onrender.com](https://homie-api-vd9v.onrender.com), service `srv-davgrouk1f9s73a977vg`, region Singapore, plan Free. Auto deploy cấu hình trigger `commit` trên `main`; cần kết nối GitHub deployment credential trước khi Render nhận sự kiện push. URL repo công khai đơn thuần không kích hoạt auto deploy.

Production frontend gọi `/api/...` cùng origin. `vercel.json` proxy các request này tới backend Render; không đặt `PUBLIC_API_BASE_URL` thành origin Render trong project Vercel khi dùng proxy. Cookie `HttpOnly; Secure; SameSite=Lax` không cần đổi sang cookie cross-site. Backend cho phép origin `https://homie-ecru.vercel.app`.

Frontend là website tĩnh; backend có health, auth/session, profile API và notes API (SSE, media). Dùng Node.js 22. Backend import `yjs` từ dependencies nên host phải chạy `npm ci` (có thể `--omit=dev`) trước khi start; `node --check` không phát hiện thiếu package. Xem [contract](authentication.md) và [interfaces](interfaces.md#notes-api).

## Điều kiện trước khi deploy auth/profile/notes

- Đặt MINHLE_PASSWORD_HASH và HAIYEN_PASSWORD_HASH trong secret environment server; không đặt ở Vercel frontend/public env. Local .env không được tự gửi lên hosting.
- Chọn proxy /api cùng origin hoặc domain frontend/API cùng site để cookie SameSite=Lax hoạt động. Vercel mặc định và Render mặc định khác site: chỉ đặt PUBLIC_API_BASE_URL chưa đủ. SESSION_SAME_SITE=None yêu cầu Secure production và browser cho phép cookie cross-site; không là đảm bảo tương thích mọi browser.
- Storage bền: đặt `SUPABASE_URL` và `SUPABASE_SECRET_KEY` trên Render (Environment). Khi có hai biến này, hồ sơ và notes lưu trong bảng `public.documents` (mỗi khóa là một tài liệu JSON) và hình note lưu trong bucket private `note-media` của Supabase; thiếu biến thì backend dùng file trong `PROFILE_DATA_DIR` như local. Bảng tạo một lần bằng SQL Editor (`create table public.documents (key text primary key, value jsonb not null, updated_at timestamptz not null default now()); alter table public.documents enable row level security; revoke all on public.documents from anon, authenticated;`). Bucket private `note-media` cũng tạo một lần trong Storage (backend không tự tạo; đổi tên bằng `SUPABASE_BUCKET`). Media luôn đi qua backend, không dùng public URL. Secret key chỉ ở server; publishable key không dùng. `SUPABASE_PREFIX` chỉ dùng để tách dữ liệu test. Kiểm tra với project thật bằng `npm run test:supabase` (ghi dưới tiền tố `test-…` rồi tự xóa). Không tự đổi gói trả phí.
- FFmpeg/ffprobe: upload hình cần hai executable trên host backend (`FFMPEG_PATH`, `FFPROBE_PATH`, mặc định tìm trong PATH). Backend không kiểm tra lúc khởi động; thiếu công cụ thì xem trước upload trả 503 `media_unavailable`, phần còn lại của notes vẫn chạy. Render native Node runtime không có FFmpeg nên upload trên production sẽ lỗi cho tới khi backend chạy trong môi trường có FFmpeg (ví dụ Docker image tự cài). Chưa triển khai Dockerfile.
- Một process: phiên đăng nhập lưu trong document `sessions` nên restart không bắt đăng nhập lại. Snapshot notes được ghi lại toàn bộ mỗi mutation từ state trong RAM của process, nên không chạy nhiều instance hoặc scale ngang; hai process sẽ ghi đè lẫn nhau. Rate limit socket-IP sau reverse proxy cần đánh giá trước production.
- Realtime dùng SSE (`GET /api/boards/:id/events`, heartbeat 3 giây, `X-Accel-Buffering: no`). Đã kiểm chứng ngày 2026-10-04 trên production: `/api/boards/events` qua rewrite `/api` của Vercel và gọi thẳng Render đều nhận `retry`, sự kiện `boards` và heartbeat trong khoảng 0,3 giây, không bị buffer hay nén. Nếu sau này đổi proxy, kiểm tra lại bằng cách đọc stream và đo thời gian tới byte đầu tiên.
- Thông báo điện thoại (Firebase Cloud Messaging, gói Spark miễn phí): tạo project Firebase, thêm app Android `com.homie.app`. Khóa service account (Project settings → Service accounts → Generate new private key) đặt vào `FIREBASE_SERVICE_ACCOUNT` trên Render và trong `.env` (JSON một dòng hoặc base64); thiếu biến thì backend không gửi. `google-services.json` của app đặt vào secret GitHub `GOOGLE_SERVICES_JSON_BASE64` (base64) cho workflow APK, và vào `android/app/google-services.json` khi build local; cả hai file không commit (repo công khai, đã gitignore). Thêm plugin Capacitor hoặc đổi `android/` thì cần APK mới; đổi web thì không. Nhắc PSI 21:00 dùng `@capacitor/local-notifications` (thêm 2026-10-07): cần APK mới; không cần cấu hình server.

## 1. Render

Service hiện được tạo qua CLI từ URL repo. Trong [Account Settings](https://dashboard.render.com/u/settings), thêm GitHub ở Git Deployment Credentials và cấp quyền cho repo `katan-chan/Homie`. Sau đó tại [service Settings](https://dashboard.render.com/web/srv-davgrouk1f9s73a977vg/settings), chọn Git Credentials vừa kết nối. Khi kết nối hoàn tất, push vào `main` kích hoạt build/redeploy trên Render; Vercel đã được xác nhận hoạt động từ push. Không tạo thêm Blueprint cho cùng repo nếu chỉ muốn cập nhật service hiện hữu; dùng Dashboard hoặc `render services update` khi đổi cấu hình service. `render.yaml` ghi lại cấu hình để tạo lại bằng Blueprint nếu cần.

Điền `FRONTEND_ORIGINS` bằng URL frontend, ví dụ `https://your-project.vercel.app`. Có thể điền sau khi tạo project Vercel rồi restart backend. Nhiều origin cách nhau bằng dấu phẩy, không có dấu `/` cuối URL. Chỉ thêm URL preview cụ thể khi cần, không mở toàn bộ `*.vercel.app`.

Nếu tạo Web Service thủ công: Root Directory để trống, Runtime Node, Build Command `npm ci --omit=dev && node --check backend/server.js`, Start Command `npm start`, Health Check Path `/api/health`. `render.yaml` và service hiện tại vẫn ghi Build Command cũ chỉ có `node --check`; cần cập nhật trước khi deploy notes. Render tự cấp `PORT`; server lắng nghe trên `0.0.0.0`.

Lưu URL thực tế Render cấp, ví dụ `https://your-api.onrender.com`, và kiểm tra `/api/health` trả `{"status":"ok"}`. Không giả định URL từ tên service vì Render có thể thêm hậu tố.

## 2. Vercel

Import cùng repo, Root Directory để mặc định (root). `vercel.json` chọn Other, chạy `npm run build` và xuất bản `dist/`.

Có thể deploy garden tĩnh trước; hồ sơ/login cần backend. API_BASE_URL rỗng gọi /api trên origin frontend, nên phải có proxy khi dùng cấu hình đó. Khi chọn API origin riêng, đặt PUBLIC_API_BASE_URL bằng origin HTTPS thực tế, không có /api; xử lý cookie topology như phần trên và redeploy. Biến này công khai; không chứa secret.

Kết nối project Vercel với repository GitHub và đặt Production Branch là `main`. Mỗi lần push hoặc merge vào `main`, Vercel tự build và cập nhật website production; không cần GitHub Actions riêng. Trang đã mở trên trình duyệt cần refresh để nhận bản mới.

Sau khi có domain Vercel, cập nhật `FRONTEND_ORIGINS` trên Render. Nếu dùng domain riêng, thêm origin đó. CORS chỉ giới hạn đọc qua trình duyệt, không thay thế xác thực.

Build tạo `assets/vendor/notes.js` rồi chỉ sao chép `index.html`, `styles.css`, `styles/`, `js/`, `assets/` vào `dist/`; backend, tài liệu, `.env` và `.data/` (gồm media) không được xuất bản. Hash routing `#garden`/`#dashboard` không cần SPA rewrite.

## Kết nối API khi thêm tính năng

URL được xuất từ `js/config.js`; build tạo phiên bản theo biến môi trường:

```js
import { API_BASE_URL } from './config.js';
const response = await fetch(`${API_BASE_URL}/api/health`);
if (!response.ok) throw new Error(`API returned ${response.status}`);
const health = await response.json();
```

js/auth.js và js/notes/client.js gọi API với credentials: include. Mutation gửi X-Requested-With: Homie và JSON nếu có body. Profile và bảng ghi chú GET công khai; PUT profile chỉ owner, mutation notes cần session. Không dùng fetch mặc định không credentials cho session hoặc mutation.

## Chạy local

Nếu chưa có .env, dùng .env.example làm cấu trúc và provision hai salted hash bằng hashPassword trong backend/auth.js; không ghi đè .env đang chứa hash. Chạy npm run dev:backend và npm run dev trong hai terminal. Mở http://localhost:8000/ hoặc http://127.0.0.1:8000/; source config local chọn API hostname khớp frontend. npm run build không tự đọc .env; node --env-file=.env scripts/build.js đọc env nhưng chỉ xuất config API public vào dist.

Kiểm tra build bằng `npm run build` và backend bằng `GET /api/health`.

## Sao lưu và khôi phục

Snapshot notes tham chiếu media theo asset ID, nên phải sao lưu cùng lúc. Backend không xóa file media đã đăng ký (gỡ khỏi thư viện chỉ đánh dấu), vì vậy chép snapshot trước rồi media sau luôn cho bộ media đủ cho snapshot.

- Supabase: xuất các hàng `profiles` và `notes` của bảng `public.documents` (SQL Editor hoặc `pg_dump --table public.documents`), rồi tải toàn bộ object trong bucket `note-media`. Tốt nhất khi không có ai đang sửa.
- File: dừng backend, sao chép cùng lúc `.data/profiles.json`, `.data/notes.json` và `.data/note-media/`. Bỏ qua `.data/note-media-tmp/` (chỉ là file tạm).

Khôi phục khi backend đã dừng: đưa media vào trước (cùng tên file), rồi ghi snapshot/tài liệu, sau đó khởi động. Backend chỉ đọc snapshot lúc khởi tạo notes và ghi đè toàn bộ ở mutation kế tiếp, nên khôi phục khi đang chạy sẽ bị ghi đè.

Tham khảo: [Render Blueprint](https://render.com/docs/blueprint-spec), [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json).
