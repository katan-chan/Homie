# Phạm vi hiện tại

Đã triển khai local: vườn hoa và cả hai hồ sơ công khai. Dashboard yêu cầu đăng nhập. Chỉ minhle sửa chữ hồ sơ Minh Lê, haiyen sửa chữ hồ sơ Hải Yến; bố cục/ảnh chỉnh code trong module riêng. Auth và profile API đã có; xem [tài khoản](authentication.md). Không có đăng ký công khai. Tính năng dashboard vẫn chưa được thiết kế.

Tính năng ghi chép chi tiết sẽ do người dùng tự thiết kế sau. Không tự thêm backlog ngoài các không gian và tính năng đã yêu cầu.

| Tab | ID | Hướng thiết kế |
| --- | --- | --- |
| Vườn hoa | `garden` | Homepage gardening: vườn hoa nhiều loài, Loopy hải ly hồng trong Pororo và các element vườn. Nền dịu, hoa là điểm nhấn nhiều màu. |
| Góc ghi chép | `dashboard` | Dashboard cho ghi chú, kỷ niệm và nhật ký. Nội dung và thao tác thật chưa được chốt. |
| Minh Lê | `minhle` | Hồ sơ công khai; owner dùng Edit sửa tên hiển thị/giới thiệu. |
| Hải Yến | `haiyen` | Hồ sơ công khai; owner dùng Edit sửa tên hiển thị/giới thiệu. |

Ưu tiên điện thoại: các tab dễ chạm trong sidebar trái bật/tắt. Chọn tab giữ menu mở, nền không blur; nội dung có transition nhẹ và hỗ trợ giảm chuyển động. Logo riêng chỉ để nhận diện. Homepage là vườn hoa toàn cảnh và vùng chữ không bị che. Bố cục dashboard chưa chốt.

Nguồn frontend ở index.html đã tách CSS và ES modules, giữ homepage thành vườn hoa với hai Loopy. Không thêm tưới, lời thoại, bộ lọc hoặc ghi chép mẫu. Repository có cấu hình Vercel/Render, health/auth/profile API; chưa có backend ghi chép. Chưa publish thay đổi auth/profile. Cần cookie topology và storage bền trước deploy; xem deployment.md.

Đề xuất năm tab trước đây đã được giữ ở [archive/features-proposal.md](archive/features-proposal.md) để tham khảo, không còn là phạm vi hiện tại.
