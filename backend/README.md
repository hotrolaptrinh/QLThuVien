# Library Management Backend

Backend REST API viết bằng Node.js thuần, lưu dữ liệu trong tệp JSON và xác thực JWT tự quản lý.

## Chạy dự án

```bash
node src/server.js
```

API khởi chạy tại `http://localhost:4000`. Tài khoản quản lý mặc định:

- **Email:** `admin@library.local`
- **Mật khẩu:** `Admin123!`

## Các nhóm endpoint chính

- `POST /api/auth/login` – Đăng nhập nhận JWT
- `POST /api/auth/register` – Tạo người dùng (chỉ quản lý hoặc lần đầu khởi tạo)
- `GET/POST/PUT/DELETE /api/books` – Quản lý sách
- `GET/POST/PUT/DELETE /api/categories` – Quản lý thể loại
- `GET/POST/PUT/DELETE /api/publishers` – Quản lý nhà xuất bản
- `GET/POST/PATCH /api/borrowings` – Quản lý mượn trả
- `GET/DELETE /api/users` – Quản lý người dùng (quản lý)

JWT đính kèm qua header `Authorization: Bearer <token>`.
