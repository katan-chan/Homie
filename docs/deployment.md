# Deploy frontend trên Vercel, backend trên Render

Frontend hiện là website tĩnh. Backend Node.js mới chỉ cung cấp `GET /api/health`, chưa có lưu dữ liệu hoặc xác thực. Không cần cài thư viện bên ngoài. Dùng Node.js 22.

## 1. Render

Đẩy thư mục dự án lên GitHub, rồi tạo Blueprint trên Render từ repo đó; Render đọc `render.yaml` tại root.

Điền `FRONTEND_ORIGINS` bằng URL frontend, ví dụ `https://your-project.vercel.app`. Có thể điền sau khi tạo project Vercel rồi restart backend. Nhiều origin cách nhau bằng dấu phẩy, không có dấu `/` cuối URL. Chỉ thêm URL preview cụ thể khi cần, không mở toàn bộ `*.vercel.app`.

Nếu tạo Web Service thủ công: Root Directory để trống, Runtime Node, Build Command `node --check backend/server.js`, Start Command `npm start`, Health Check Path `/api/health`. Render tự cấp `PORT`; server lắng nghe trên `0.0.0.0`.

Lưu URL thực tế Render cấp, ví dụ `https://your-api.onrender.com`, và kiểm tra `/api/health` trả `{"status":"ok"}`. Không giả định URL từ tên service vì Render có thể thêm hậu tố.

## 2. Vercel

Import cùng repo, Root Directory để mặc định (root). `vercel.json` chọn Other, chạy `npm run build` và xuất bản `dist/`.

Có thể deploy frontend trước mà chưa đặt URL backend; `API_BASE_URL` sẽ rỗng trên Vercel và giao diện hiện chưa gọi API. Khi backend sẵn sàng, trong Environment Variables đặt `PUBLIC_API_BASE_URL` bằng URL Render thực tế, không có `/api` phía sau. Chọn các môi trường cần dùng, rồi redeploy. Biến này công khai với trình duyệt; không dùng để chứa secret.

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

Giao diện hiện chưa gọi API vì chưa có tính năng cần dữ liệu.

## Chạy local

Sao chép `.env.example` thành `.env`, chạy `npm run dev:backend` và `npm run dev` trong hai terminal. Mở `http://localhost:8000/`. `npm run build` dùng biến môi trường của tiến trình; nó không tự đọc `.env`. Để build với `.env`, chạy `node --env-file=.env scripts/build.js`.

Kiểm tra build bằng `npm run build` và backend bằng `GET /api/health`.

Tham khảo: [Render Blueprint](https://render.com/docs/blueprint-spec), [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json).
