# Library Management Backend

Backend REST API viết bằng Node.js thuần, lưu dữ liệu trong Supabase PostgreSQL và xác thực JWT tự quản lý.

## Cấu hình môi trường

Tạo file `.env` trong thư mục `backend/` với các biến sau:

```env
PORT=4000
JWT_SECRET=your-jwt-secret
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

> ⚠️ Chỉ sử dụng Service Role Key ở môi trường backend (không commit lên git, không dùng phía client). Bạn có thể đặt `SUPABASE_SERVICE_ROLE_KEY` trong biến môi trường khi triển khai thay vì ghi trực tiếp vào file.

## Thiết lập cơ sở dữ liệu Supabase

Tạo các bảng với cấu trúc tối thiểu sau (có thể dùng SQL Editor của Supabase):

```sql
create extension if not exists "uuid-ossp";

create table if not exists public.users (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text not null unique,
  role text not null default 'user',
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.publishers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.books (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  author text,
  category_id uuid references public.categories(id) on delete set null,
  publisher_id uuid references public.publishers(id) on delete set null,
  quantity integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.borrowings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  borrow_date timestamptz not null,
  expected_return_date timestamptz,
  status text not null default 'pending',
  notes text,
  processed_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.borrowing_details (
  id uuid primary key default uuid_generate_v4(),
  borrowing_id uuid not null references public.borrowings(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  quantity integer not null,
  created_at timestamptz not null default now()
);
```

Tắt RLS cho các bảng trên hoặc cấu hình chính sách phù hợp với server key.

## Chạy dự án

```bash
npm install
node src/server.js
```

API khởi chạy tại `http://localhost:4000`. Tài khoản quản lý mặc định sẽ được tạo ở lần chạy đầu tiên:

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
