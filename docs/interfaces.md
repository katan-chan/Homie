# Interface và quyền sở hữu

Tài liệu mô tả code hiện tại, kèm quy ước cho module mới. Các type bên dưới là JSDoc, chưa được compiler kiểm tra. Không có hệ plugin, DI container hoặc event bus.

## Registry và resolver

```js
/**
 * @typedef {Object} TabDefinition
 * @property {string} id ID duy nhất, ổn định; dùng chữ thường ASCII và dấu gạch ngang.
 * @property {string} label Nhãn tiếng Việt hiển thị trong sidebar.
 * @property {boolean} enabled Có tham gia điều hướng hay không.
 * @property {boolean} [requiresAuth] Chỉ render UI sau khi app xác minh session; mặc định false.
 * @property {{showCharacters?: boolean}} [background] Tùy chỉnh nền chung; mặc định vườn hoa không Loopy.
 * @property {() => Promise<TabModule>} load Import module khi cần.
 *
 * @typedef {Object} TabModule
 * @property {(container: HTMLElement, context: {signal: AbortSignal}) =>
 *   void | (() => void | Promise<void>) |
 *   Promise<void | (() => void | Promise<void>)>} render
 */
```

js/tabs.js xuất mảng tabs. Thứ tự mảng là thứ tự menu; load không tạo DOM hoặc tác vụ nền trước khi render. Import module không có side effect làm thay đổi UI.

resolveTab(tabs, hash) trong js/routing.js là hàm thuần: chọn ID được bật; fallback garden được bật, rồi mục bật đầu tiên; trả null nếu tất cả tắt. Không sửa hash, DOM hoặc lịch sử bên trong resolver. App chuẩn hóa hash bằng history.replaceState.

Các ID hiện có: garden, dashboard, minhle, haiyen. Chỉ dashboard có requiresAuth; hai hồ sơ và garden công khai. Thêm/tắt tab chỉ đổi registry cùng module tương ứng. Bỏ tab không đồng nghĩa xóa dữ liệu hoặc asset dùng chung. requiresAuth bảo vệ trải nghiệm UI, API riêng vẫn phải kiểm tra session ở server.

## Tab render và cleanup

App gọi render với panel thuộc tab và AbortSignal mới cho mỗi lần mount. Context chỉ có signal; chưa có services, router hoặc store truyền vào.

Quy ước module mới: dựng UI đồng bộ và trả cleanup đồng bộ khi có thể. App hiện cũng hỗ trợ render trả Promise và cleanup bất đồng bộ; không dùng chúng chỉ để chờ tải ảnh. Kiểm tra signal.aborted trước khi bắt đầu.

Ví dụ hợp đồng, không phải tính năng cần thêm:

```js
export function render(container, { signal }) {
  if (signal.aborted) return () => {};
  const section = document.createElement('section');
  section.className = 'example-page';
  container.replaceChildren(section);

  let disposed = false;
  function cleanup() {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', cleanup);
    section.remove();
  }
  signal.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}
```

Tab được thay nội dung container, nhưng không được xóa panel do app tạo, sửa #tabs, header, hash hoặc listener toàn ứng dụng. Mọi timer, observer, requestAnimationFrame và listener ngoài subtree phải có đường dọn rõ ràng. Listener có thể dùng { signal }; fetch phải nhận signal nếu request thuộc vòng đời tab. Image không hỗ trợ AbortSignal trực tiếp: gỡ handler và chặn callback muộn bằng cờ disposed/định danh request.

Mỗi lần điều hướng, app abort và chờ disposal của session ngay trước nó trước khi render module mới. Đây không phải hàng đợi cleanup toàn cục: khi đổi nhanh A → B → C, C có thể render trong khi cleanup bất đồng bộ của A chưa hoàn tất. Cleanup chỉ được chạm tài nguyên/subtree của chính session, không được giả định các mount luôn tuần tự hoặc sửa DOM dùng chung.

App dùng số thứ tự điều hướng và signal để chặn import cũ ghi đè tab mới. Async render tùy chỉnh phải settle sớm khi abort, tự chặn callback muộn và giải phóng tài nguyên đã cấp phát; Promise không settle có thể làm lần điều hướng đang chờ nó bị treo. App không thể tự dọn tài nguyên chưa được module trả về khi render lỗi: module phải giải phóng phần đã cấp phát trong đường abort/lỗi của mình. Module mới nên dùng render và cleanup đồng bộ, tải tài nguyên độc lập như garden hiện tại.

## UI và tài nguyên

| Chủ sở hữu | Trách nhiệm |
| --- | --- |
| index.html + js/app.js | Shell, nền mặc định, dialog/sidebar, tabpanel, lựa chọn tab, focus, loading và lỗi import/render |
| js/background.js | Hai canvas dùng chung, tải ảnh độc lập, image retry, resize và cleanup của shell |
| js/tabs/garden.js | Tiêu đề, lettering fallback và cleanup nội dung homepage |
| js/profile.js | Nội dung hồ sơ công khai và form sửa chữ của owner |
| js/tabs/dashboard.js | UI giữ chỗ của dashboard |
| styles.css | Theme chung, responsive, trạng thái menu và transition |
| assets/ | Asset production; giữ PNG/prompt nguồn khi có |
| scripts/build.js | Tạo dist/ và thay cấu hình API public |

Garden chỉ redraw khi tải ảnh hoặc resize. Giữ thứ tự lớp xa/giữa/tiền cảnh và khoảng trống tiêu đề. Không thêm vòng animation liên tục nếu chưa có yêu cầu.

Shell mount nền một lần bằng mountBackground(container, { signal }) trong js/background.js. Hàm trả cleanup có phương thức update(background); app truyền field background của mục registry đang chọn vào đó. Không khai báo background thì vẫn có vườn hoa toàn viewport, showCharacters mặc định false. Homepage khai báo background: { showCharacters: true } để giữ hai Loopy đã duyệt. Tab mới không cần import renderer, thêm canvas hoặc khai báo nền riêng. Không có chế độ tắt nền.

Nền tồn tại qua chuyển tab, cả màn hình yêu cầu đăng nhập và lỗi tải module; cleanup của tab chỉ dọn nội dung tab. Signal nền thuộc vòng đời shell, không dùng signal của tab. ResizeObserver cập nhật canvas khi cửa sổ thay đổi, không resize bằng vòng lặp. CSS panel flow-root ngăn margin thẻ hồ sơ tạo scrollbar thừa; viewport có scrollbar thật vẫn được vẽ theo clientWidth.

## Cấu hình và backend

js/config.js xuất API_BASE_URL. Local mặc định http://localhost:3001; build lấy PUBLIC_API_BASE_URL, chỉ chấp nhận HTTP(S) origin không credentials, path, query hoặc hash. Frontend deploy Vercel không cấu hình API thì giá trị rỗng. Không tự gọi fetch với giá trị rỗng khi cần một backend riêng; UI phải xử lý trạng thái chưa cấu hình nếu tính năng đó được bổ sung.

Backend xuất createBackend(frontendOrigins?, options?), trả Node http.Server chưa listen. Entry point đọc PORT và listen; import module để test không mở port. FRONTEND_ORIGINS là danh sách origin phân cách bằng dấu phẩy, so khớp chính xác. options hỗ trợ credentials, dataDir, production, sessionTtlMs, sameSite cho test; không nhận options từ HTTP request. Auth/profile contract chính thức tại [authentication.md](authentication.md).

| Request hiện có | Kết quả |
| --- | --- |
| GET /api/health, HEAD /api/health | 200, JSON { "status": "ok" }; HEAD không có body trên wire |
| OPTIONS /api/health | 204 |
| Method khác tại /api/health | 405, Allow: GET, HEAD, OPTIONS |
| Path khác | 404, JSON { "error": "Not found" } |
| Origin gửi lên ngoài allowlist | 403, JSON { "error": "Origin not allowed" } |

CORS check chạy trước route. Public GET/HEAD không yêu cầu Origin; mutation POST/PUT luôn yêu cầu allowlisted Origin và X-Requested-With: Homie. CORS cho phép credentials, GET/HEAD/POST/PUT/OPTIONS và Content-Type/X-Requested-With. Auth cookie/session quyết định danh tính; PUT profile so owner với ID lấy từ session. Chưa có notes API hoặc database. Hồ sơ lưu file atomic, một process; không tự suy ra schema ghi chép từ dashboard.

## Thay đổi interface

Trước khi đổi signature, field registry, route hoặc config export: tìm tất cả nơi sử dụng; nêu tác động; cập nhật producer, consumer, tài liệu và kiểm tra trong cùng thay đổi. Giữ ID/hash ổn định nếu không được yêu cầu đổi. Không thêm abstraction chỉ để dự phòng một consumer chưa tồn tại.
