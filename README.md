# 📚 QLThuVien

Dự án mẫu quản lý thư viện theo đặc tả trong `PROJECT_SPEC.md`. Hệ thống chia thành hai phần `backend/` và `frontend/` hoạt động độc lập thông qua REST API và xác thực JWT tự quản lý.

## Kiến trúc

```
QLThuVien/
├── backend/   # API Node.js thuần, lưu dữ liệu JSON, xác thực JWT
└── frontend/  # Giao diện React tải qua CDN, gọi API REST
```

- **Người dùng quản lý**: Có toàn quyền thêm/sửa/xóa sách, thể loại, nhà xuất bản, tài khoản người dùng, phê duyệt phiếu mượn/trả.
- **Bạn đọc**: Đăng nhập, xem danh mục sách, tạo yêu cầu mượn, theo dõi trạng thái phiếu mượn.

## Bắt đầu

1. Cài đặt Node.js >= 18.
2. Chạy backend: `cd backend && node src/server.js`.
3. Mở frontend: dùng Live Server mở `frontend/index.html` hoặc bất kỳ server tĩnh nào.
4. Đăng nhập tài khoản quản lý mặc định `admin@library.local` / `Admin123!`.

## Tính năng nổi bật

- Token JWT tự sinh/kiểm tra bằng Node.js `crypto`.
- CRUD sách, thể loại, nhà xuất bản, người dùng.
- Quy trình mượn/trả sách với trạng thái chờ duyệt, duyệt, đã trả.
- Giao diện responsive, cập nhật dữ liệu theo thời gian thực qua Fetch API.

Thư mục con chứa tài liệu chi tiết hơn trong `backend/README.md` và `frontend/README.md`.
