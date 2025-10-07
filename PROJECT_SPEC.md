# 📚 Library Management System

Ứng dụng quản lý thư viện dành cho hai nhóm người dùng: **Quản lý** và **Người dùng**. Cho phép quản lý sách, thể loại, nhà xuất bản, người dùng, và quá trình mượn/trả sách.

---

## 🚀 Công nghệ sử dụng

| Công nghệ     | Mô tả |
|---------------|------|
| **ReactJS**   | Xây dựng giao diện người dùng hiện đại, responsive |
| **ExpressJS** | API backend xử lý logic nghiệp vụ |
| **Supabase**  | Cơ sở dữ liệu PostgreSQL + xác thực người dùng |
| **Vercel**    | Triển khai frontend nhanh chóng và miễn phí |

---

## 👥 Nhóm người dùng

- **Quản lý**: Toàn quyền thêm/sửa/xóa sách, thể loại, nhà xuất bản, người dùng, duyệt mượn/trả sách
- **Người dùng**: Xem sách, tìm kiếm, đăng ký mượn/trả, xem lịch sử

---

## 🧩 Chức năng chính

### 📚 Quản lý sách
- Thêm/sửa/xóa sách
- Gắn thể loại, nhà xuất bản
- Quản lý số lượng tồn

### 🗂️ Quản lý thể loại & nhà xuất bản
- Thêm/sửa/xóa thể loại
- Thêm/sửa/xóa nhà xuất bản

### 👥 Quản lý người dùng
- Tạo tài khoản, phân quyền
- Xem lịch sử mượn/trả

### 🔄 Quản lý mượn/trả
- Đăng ký mượn sách
- Duyệt yêu cầu mượn
- Ghi nhận trả sách, cảnh báo quá hạn

---

## 🗃️ Cấu trúc cơ sở dữ liệu (Supabase)

```sql
-- Người dùng
users (id, name, email, role)

-- Sách
books (id, title, author, category_id, publisher_id, quantity)

-- Thể loại
categories (id, name)

-- Nhà xuất bản
publishers (id, name, address)

-- Phiếu mượn
borrowings (id, user_id, borrow_date, return_date, status)

-- Chi tiết phiếu mượn
borrowing_details (id, borrowing_id, book_id, quantity)
