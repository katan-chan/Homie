# Bộ skills đề xuất

AGENTS.md đặt quy tắc bắt buộc của repository; skill là quy trình dùng khi gặp một loại công việc. Người viết code vẫn dùng được các tài liệu mà không cần cài plugin.

Đây là danh mục và phạm vi đề xuất, không phải thông báo đã cài hoặc đã tạo SKILL.md. Tên skill bên dưới tham chiếu các skill hiện có trong môi trường Codex của người dùng; máy khác có thể không có.

## Chọn theo nhiệm vụ

| Skill/quy trình | Khi dùng | Kết quả cần có |
| --- | --- | --- |
| brainstorming | Yêu cầu kiến trúc/tính năng chưa rõ hoặc có nhiều lựa chọn | Scope, các lựa chọn và quyết định có lý do |
| ponytail | Viết/sửa/review code | Giải pháp nhỏ nhất đáp ứng interface, không dependency thừa |
| systematic-debugging | Lỗi, test fail, hành vi bất ngờ | Tái hiện, nguyên nhân gốc, sửa và kiểm tra lại |
| verification-before-completion | Trước khi báo hoàn thành | Bằng chứng từ kiểm tra đã chạy, giới hạn nêu rõ |
| design-taste-frontend | Thiết kế hoặc chỉnh giao diện đáng kể | Đánh giá giao diện hiện tại, responsive, capture và review |
| imagegen | Tạo/chỉnh ảnh raster được yêu cầu | Asset nguồn, prompt, alpha khi cần, bản tối ưu production |
| writing-plans | Công việc nhiều bước hoặc thay đổi nhiều ranh giới | Kế hoạch có file liên quan, thứ tự và cách xác minh |
| requesting-code-review / receiving-code-review | Thay đổi interface, lifecycle hoặc thay đổi quan trọng | Finding cụ thể và xử lý có kiểm chứng |
| dispatching-parallel-agents / subagent-driven-development | Có yêu cầu hoặc quy trình phù hợp cho công việc độc lập | Ownership file rõ, tránh sửa cùng file, kiểm tra sau tích hợp |

Không chạy toàn bộ danh mục cho mọi task. Sửa một nhãn chỉ cần đọc scope và kiểm tra nhãn; thay lifecycle cần trace, test và review. Skills cần tuân theo chỉ dẫn người dùng và môi trường, không tự yêu cầu thêm tính năng hoặc triển khai.

## Skills riêng của dự án nên có gì?

Chưa cần đóng gói tất cả tài liệu thành nhiều skill. Ba workflow riêng chỉ đáng tạo khi các tác vụ đó thực sự lặp lại:

1. **homie-tab-module**: thêm/tắt/bỏ tab đã được yêu cầu; đọc interfaces.md; giữ registry-only, ownership và cleanup; xác minh routing/mobile.
2. **homie-garden-assets**: tạo/thay asset đã được yêu cầu; giữ hoa vẽ tay, palette, connectivity, lớp sâu và vùng trống; lưu nguồn/prompt; tối ưu WebP; kiểm tra desktop/mobile.
3. **homie-api-change**: chỉ khi có tính năng backend được chốt; thiết kế method/path/request/response/auth/error; cập nhật consumer và contract; test HTTP.

Các workflow này là đề xuất, chưa phải skill đã phát hành. Khi tạo skill thật, dùng skill-creator/writing-skills, giữ SKILL.md ngắn với trigger rõ và link về tài liệu canonical. Không sao chép interface vào nhiều nơi. Kiểm chứng bằng một tác vụ mẫu và trường hợp lỗi trước khi coi skill sẵn dùng.

## Những quyết định còn mở

- Giữ JSDoc như hiện tại hay bổ sung typecheck cho JavaScript bằng checkJs? Đề xuất bắt đầu JSDoc, bổ sung checkJs khi interface mở rộng; chưa cần chuyển toàn bộ sang TypeScript.
- Khi nào cần CI? Bộ test Node và browser đã có; đề xuất CI chạy Node test + build khi người dùng chốt workflow. Browser cần môi trường riêng; hiện chưa tạo workflow CI.
- Dữ liệu, auth và quyền riêng tư của ghi chép: người dùng chưa chốt. Không chọn database, viết repository layer hay thiết kế schema trước yêu cầu thực tế.

Các mục này cần được bàn và quyết định riêng; không làm điều kiện chặn sửa đổi nhỏ đã được yêu cầu.
