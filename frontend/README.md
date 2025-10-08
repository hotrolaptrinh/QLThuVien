# Library Management Frontend

Giao diện React tải qua CDN, tương tác với REST API của backend.

## Sử dụng

1. Chạy backend bằng `node backend/src/server.js` ở thư mục gốc.
2. Thiết lập biến môi trường `BACKEND_URL` nếu triển khai frontend (mặc định `http://localhost:4000`).
3. Chạy `npm install` (nếu cần) và `npm run build` trong thư mục `frontend` để sinh thư mục `dist/` chứa các tệp tĩnh.
4. Triển khai nội dung `dist/` lên dịch vụ tĩnh như Vercel hoặc chạy `npm start` để xem thử bằng máy chủ tĩnh cục bộ.
5. Đăng nhập bằng tài khoản quản lý mặc định hoặc tài khoản được cấp.

## Các phần chính

- **Đăng nhập JWT**: Lưu token trong LocalStorage và gửi kèm khi gọi API.
- **Quản lý sách**: Tìm kiếm, thêm sách mới, phân loại theo thể loại/nhà xuất bản.
- **Thể loại & Nhà xuất bản**: Tạo nhanh các phân loại phục vụ quản lý sách.
- **Mượn/Trả sách**: Người dùng đăng ký mượn, quản lý phê duyệt/trả sách.
