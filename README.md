# 📚 QLThuVien

Dự án mẫu quản lý thư viện theo đặc tả trong `PROJECT_SPEC.md`. Hệ thống chia thành hai phần `backend/` và `frontend/` hoạt động độc lập thông qua REST API và xác thực JWT tự quản lý.

## Kiến trúc

```
QLThuVien/
├── backend/   # API Node.js thuần, lưu dữ liệu Supabase, xác thực JWT
└── frontend/  # Giao diện React tải qua CDN, gọi API REST
```

- **Người dùng quản lý**: Có toàn quyền thêm/sửa/xóa sách, thể loại, nhà xuất bản, tài khoản người dùng, phê duyệt phiếu mượn/trả.
- **Bạn đọc**: Đăng nhập, xem danh mục sách, tạo yêu cầu mượn, theo dõi trạng thái phiếu mượn.

## Bắt đầu

1. Cài đặt Node.js >= 18.
2. Cấu hình Supabase cho backend theo hướng dẫn trong `backend/README.md` (tạo bảng và biến môi trường `.env`).
3. Cài đặt phụ thuộc và chạy backend: `cd backend && npm install && node src/server.js`.
4. Triển khai frontend: `cd frontend && npm install && npm run build` để tạo thư mục `dist/`, đặt biến môi trường `BACKEND_URL` khi cần và triển khai `dist/` lên dịch vụ tĩnh (VD: Vercel) hoặc chạy `npm start` để xem thử.
5. Đăng nhập tài khoản quản lý mặc định `admin@library.local` / `Admin123!`.

## Tính năng nổi bật

- Token JWT tự sinh/kiểm tra bằng Node.js `crypto`.
- CRUD sách, thể loại, nhà xuất bản, người dùng được lưu trên Supabase PostgreSQL.
- Quy trình mượn/trả sách với trạng thái chờ duyệt, duyệt, đã trả.
- Giao diện responsive, cập nhật dữ liệu theo thời gian thực qua Fetch API.

Thư mục con chứa tài liệu chi tiết hơn trong `backend/README.md` và `frontend/README.md`.
