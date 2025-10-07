const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const PORT = process.env.PORT || 4000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-library-key';
const TOKEN_EXPIRY_SECONDS = 60 * 60 * 8; // 8 hours

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const TABLES = {
  users: {
    columns: {
      id: 'id',
      name: 'name',
      email: 'email',
      role: 'role',
      password: 'password_hash',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    omitOnReturn: ['password'],
  },
  categories: {
    columns: {
      id: 'id',
      name: 'name',
      description: 'description',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  publishers: {
    columns: {
      id: 'id',
      name: 'name',
      address: 'address',
      phone: 'phone',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  books: {
    columns: {
      id: 'id',
      title: 'title',
      author: 'author',
      categoryId: 'category_id',
      publisherId: 'publisher_id',
      quantity: 'quantity',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  borrowings: {
    columns: {
      id: 'id',
      userId: 'user_id',
      borrowDate: 'borrow_date',
      expectedReturnDate: 'expected_return_date',
      status: 'status',
      notes: 'notes',
      processedAt: 'processed_at',
      returnedAt: 'returned_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  borrowingDetails: {
    columns: {
      id: 'id',
      borrowingId: 'borrowing_id',
      bookId: 'book_id',
      quantity: 'quantity',
      createdAt: 'created_at',
    },
  },
};

const REVERSE_TABLES = Object.fromEntries(
  Object.entries(TABLES).map(([name, config]) => [
    name,
    Object.fromEntries(Object.entries(config.columns).map(([apiKey, dbKey]) => [dbKey, apiKey])),
  ])
);

function base64UrlEncode(buffer) {
  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const timestamp = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: timestamp, exp: timestamp + TOKEN_EXPIRY_SECONDS };

  const headerEncoded = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadEncoded = base64UrlEncode(Buffer.from(JSON.stringify(fullPayload)));
  const data = `${headerEncoded}.${payloadEncoded}`;
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest();
  const signatureEncoded = base64UrlEncode(signature);
  return `${data}.${signatureEncoded}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerEncoded, payloadEncoded, signatureProvided] = parts;
  const data = `${headerEncoded}.${payloadEncoded}`;
  const expectedSignature = base64UrlEncode(
    crypto.createHmac('sha256', JWT_SECRET).update(data).digest()
  );
  if (expectedSignature !== signatureProvided) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadEncoded, 'base64').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch (error) {
    return null;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return verifyHash === hash;
}

function toDbRecord(table, data) {
  const config = TABLES[table];
  if (!config) throw new Error(`Unknown table mapping for ${table}`);
  const result = {};
  for (const [apiKey, dbKey] of Object.entries(config.columns)) {
    if (data[apiKey] !== undefined) {
      result[dbKey] = data[apiKey];
    }
  }
  return result;
}

function fromDbRecord(table, record, { includeInternal = false } = {}) {
  if (!record) return null;
  const config = TABLES[table];
  if (!config) throw new Error(`Unknown table mapping for ${table}`);
  const result = {};
  const omit = new Set(includeInternal ? [] : config.omitOnReturn || []);
  for (const [dbKey, apiKey] of Object.entries(REVERSE_TABLES[table])) {
    if (!omit.has(apiKey) && record[dbKey] !== undefined) {
      result[apiKey] = record[dbKey];
    }
  }
  return result;
}

function mapDbList(table, records, options) {
  return (records || []).map((record) => fromDbRecord(table, record, options));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
  });
}

function send(res, statusCode, data, headers = {}) {
  const payload = data === undefined ? '' : JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    ...headers,
  });
  res.end(payload);
}

function notFound(res) {
  send(res, 404, { message: 'Not found' });
}

function handleOptions(req, res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  });
  res.end();
}

async function loadUserFromRequest(req) {
  const auth = req.headers['authorization'];
  if (!auth) return null;
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  const payload = verifyToken(parts[1]);
  if (!payload) return null;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', payload.id)
    .maybeSingle();
  if (error || !data) return null;
  return fromDbRecord('users', data);
}

async function ensureAdminUser() {
  const adminEmail = 'admin@library.local';
  const { data: existing, error } = await supabase
    .from('users')
    .select('id')
    .eq('email', adminEmail)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') {
    console.error('❌ Unable to verify default admin user:', error.message);
    return;
  }
  if (existing) {
    return;
  }
  const admin = {
    id: crypto.randomUUID(),
    name: 'Thư viện Admin',
    email: adminEmail,
    role: 'admin',
    password: hashPassword('Admin123!'),
    createdAt: new Date().toISOString(),
  };
  const payload = toDbRecord('users', admin);
  const { error: insertError } = await supabase.from('users').insert(payload);
  if (insertError) {
    console.error('❌ Failed to create default admin user:', insertError.message);
  } else {
    console.log('📘 Created default admin account: admin@library.local / Admin123!');
  }
}

function paginateResponse(items, total, page, pageSize) {
  return {
    page,
    pageSize,
    total,
    items,
  };
}

async function handleAuthRoutes(req, res, pathname) {
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    try {
      const body = await parseBody(req);
      const { email, password } = body;
      if (!email || !password) {
        send(res, 400, { message: 'Email và mật khẩu là bắt buộc.' });
        return true;
      }
      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email.toLowerCase())
        .maybeSingle();
      if (error || !user || !verifyPassword(password, user.password_hash)) {
        send(res, 401, { message: 'Email hoặc mật khẩu không đúng.' });
        return true;
      }
      const apiUser = fromDbRecord('users', user);
      const token = signToken({ id: apiUser.id, role: apiUser.role });
      send(res, 200, {
        token,
        user: apiUser,
        expiresIn: TOKEN_EXPIRY_SECONDS,
      });
      return true;
    } catch (error) {
      send(res, 400, { message: error.message });
      return true;
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/register') {
    try {
      const body = await parseBody(req);
      const { name, email, password, role = 'user' } = body;
      if (!name || !email || !password) {
        send(res, 400, { message: 'Thiếu thông tin bắt buộc.' });
        return true;
      }
      const { count, error: countError } = await supabase
        .from('users')
        .select('id', { head: true, count: 'exact' });
      if (countError) {
        send(res, 500, { message: 'Không thể kiểm tra người dùng hiện có.' });
        return true;
      }
      const requester = await loadUserFromRequest(req);
      if (count > 0 && (!requester || requester.role !== 'admin')) {
        send(res, 403, { message: 'Chỉ quản lý mới có thể tạo người dùng.' });
        return true;
      }
      const lowerEmail = email.toLowerCase();
      const { data: existing, error: existingError } = await supabase
        .from('users')
        .select('id')
        .eq('email', lowerEmail)
        .maybeSingle();
      if (existingError && existingError.code !== 'PGRST116') {
        send(res, 500, { message: 'Không thể kiểm tra email.' });
        return true;
      }
      if (existing) {
        send(res, 409, { message: 'Email đã tồn tại.' });
        return true;
      }
      const user = {
        id: crypto.randomUUID(),
        name,
        email: lowerEmail,
        role: role === 'admin' ? 'admin' : 'user',
        password: hashPassword(password),
        createdAt: new Date().toISOString(),
      };
      const payload = toDbRecord('users', user);
      const { data, error } = await supabase
        .from('users')
        .insert(payload)
        .select()
        .maybeSingle();
      if (error || !data) {
        send(res, 500, { message: 'Không thể tạo người dùng mới.' });
        return true;
      }
      send(res, 201, { user: fromDbRecord('users', data) });
      return true;
    } catch (error) {
      send(res, 400, { message: error.message });
      return true;
    }
  }

  return false;
}

async function handleUsers(req, res, pathname, currentUser) {
  if (!currentUser || currentUser.role !== 'admin') {
    send(res, 403, { message: 'Yêu cầu quyền quản lý.' });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/users') {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, role, created_at, updated_at')
      .order('created_at', { ascending: true });
    if (error) {
      send(res, 500, { message: 'Không thể lấy danh sách người dùng.' });
      return true;
    }
    send(res, 200, mapDbList('users', data));
    return true;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/users/')) {
    const id = pathname.split('/')[3];
    const { data: existing, error: existingError } = await supabase
      .from('users')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (existingError) {
      send(res, 500, { message: 'Không thể kiểm tra người dùng.' });
      return true;
    }
    if (!existing) {
      send(res, 404, { message: 'Không tìm thấy người dùng.' });
      return true;
    }
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) {
      send(res, 500, { message: 'Không thể xóa người dùng.' });
      return true;
    }
    send(res, 204);
    return true;
  }

  return false;
}

async function handleSimpleResource(req, res, pathname, currentUser, tableName) {
  const config = TABLES[tableName];
  if (!config) return false;
  const basePath = `/api/${tableName}`;

  if (req.method === 'GET' && pathname === basePath) {
    const queryParams = url.parse(req.url, true).query;
    const search = queryParams.search || '';
    const page = Math.max(Number(queryParams.page || 1), 1);
    const pageSize = Math.min(Number(queryParams.pageSize || 20), 50);
    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;

    let query = supabase
      .from(tableName)
      .select('*', { count: 'exact' })
      .range(start, end);

    if (search) {
      query = query.or(`name.ilike.%${search}%,title.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) {
      send(res, 500, { message: `Không thể lấy danh sách ${tableName}.` });
      return true;
    }
    send(res, 200, paginateResponse(mapDbList(tableName, data), count ?? 0, page, pageSize));
    return true;
  }

  if (req.method === 'POST' && pathname === basePath) {
    if (!currentUser || currentUser.role !== 'admin') {
      send(res, 403, { message: 'Yêu cầu quyền quản lý.' });
      return true;
    }
    try {
      const body = await parseBody(req);
      const record = {
        id: crypto.randomUUID(),
        ...body,
        createdAt: new Date().toISOString(),
      };
      const payload = toDbRecord(tableName, record);
      const { data, error } = await supabase
        .from(tableName)
        .insert(payload)
        .select()
        .maybeSingle();
      if (error || !data) {
        send(res, 500, { message: `Không thể tạo ${tableName}.` });
        return true;
      }
      send(res, 201, fromDbRecord(tableName, data));
      return true;
    } catch (error) {
      send(res, 400, { message: error.message });
      return true;
    }
  }

  if (req.method === 'PUT' && pathname.startsWith(`${basePath}/`)) {
    if (!currentUser || currentUser.role !== 'admin') {
      send(res, 403, { message: 'Yêu cầu quyền quản lý.' });
      return true;
    }
    const id = pathname.split('/')[3];
    try {
      const body = await parseBody(req);
      const payload = toDbRecord(tableName, {
        ...body,
        updatedAt: new Date().toISOString(),
      });
      const { data, error } = await supabase
        .from(tableName)
        .update(payload)
        .eq('id', id)
        .select()
        .maybeSingle();
      if (error) {
        send(res, 500, { message: `Không thể cập nhật ${tableName}.` });
        return true;
      }
      if (!data) {
        send(res, 404, { message: 'Không tìm thấy bản ghi.' });
        return true;
      }
      send(res, 200, fromDbRecord(tableName, data));
      return true;
    } catch (error) {
      send(res, 400, { message: error.message });
      return true;
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith(`${basePath}/`)) {
    if (!currentUser || currentUser.role !== 'admin') {
      send(res, 403, { message: 'Yêu cầu quyền quản lý.' });
      return true;
    }
    const id = pathname.split('/')[3];
    const { data: existing, error: existingError } = await supabase
      .from(tableName)
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (existingError) {
      send(res, 500, { message: `Không thể kiểm tra ${tableName}.` });
      return true;
    }
    if (!existing) {
      send(res, 404, { message: 'Không tìm thấy bản ghi.' });
      return true;
    }
    const { error } = await supabase.from(tableName).delete().eq('id', id);
    if (error) {
      send(res, 500, { message: `Không thể xóa ${tableName}.` });
      return true;
    }
    send(res, 204);
    return true;
  }

  return false;
}

async function handleBooks(req, res, pathname, currentUser) {
  if (await handleSimpleResource(req, res, pathname, currentUser, 'books')) {
    return true;
  }
  if (req.method === 'GET' && pathname.startsWith('/api/books/')) {
    const id = pathname.split('/')[3];
    const { data, error } = await supabase
      .from('books')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      send(res, 500, { message: 'Không thể lấy thông tin sách.' });
      return true;
    }
    if (!data) {
      send(res, 404, { message: 'Không tìm thấy sách.' });
      return true;
    }
    send(res, 200, fromDbRecord('books', data));
    return true;
  }
  return false;
}

async function handleBorrowings(req, res, pathname, currentUser) {
  if (!currentUser) {
    send(res, 401, { message: 'Yêu cầu đăng nhập.' });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/borrowings') {
    let query = supabase
      .from('borrowings')
      .select('*')
      .order('borrow_date', { ascending: false });
    if (currentUser.role !== 'admin') {
      query = query.eq('user_id', currentUser.id);
    }
    const { data: borrowings, error } = await query;
    if (error) {
      send(res, 500, { message: 'Không thể lấy danh sách phiếu mượn.' });
      return true;
    }
    const ids = (borrowings || []).map((b) => b.id);
    let details = [];
    if (ids.length > 0) {
      const { data: detailRows, error: detailError } = await supabase
        .from('borrowing_details')
        .select('*')
        .in('borrowing_id', ids);
      if (detailError) {
        send(res, 500, { message: 'Không thể lấy chi tiết phiếu mượn.' });
        return true;
      }
      details = detailRows || [];
    }
    const detailsByBorrow = details.reduce((acc, detail) => {
      const key = detail.borrowing_id;
      acc[key] = acc[key] || [];
      acc[key].push(fromDbRecord('borrowingDetails', detail));
      return acc;
    }, {});
    const payload = mapDbList('borrowings', borrowings).map((borrow) => ({
      ...borrow,
      items: detailsByBorrow[borrow.id] || [],
    }));
    send(res, 200, payload);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/borrowings') {
    try {
      const body = await parseBody(req);
      const { items, expectedReturnDate = null, notes = '' } = body;
      if (!Array.isArray(items) || items.length === 0) {
        send(res, 400, { message: 'Yêu cầu ít nhất một sách.' });
        return true;
      }
      const bookIds = items.map((item) => item.bookId);
      const { data: books, error: booksError } = await supabase
        .from('books')
        .select('id, quantity')
        .in('id', bookIds);
      if (booksError) {
        send(res, 500, { message: 'Không thể kiểm tra số lượng sách.' });
        return true;
      }
      const bookMap = new Map(books.map((book) => [book.id, book]));
      for (const item of items) {
        const book = bookMap.get(item.bookId);
        if (!book) {
          send(res, 404, { message: `Không tìm thấy sách với id ${item.bookId}.` });
          return true;
        }
        if (book.quantity < item.quantity) {
          send(res, 400, { message: `Sách ${item.bookId} không đủ số lượng.` });
          return true;
        }
      }
      const now = new Date().toISOString();
      const borrowingId = crypto.randomUUID();
      const borrowingRecord = toDbRecord('borrowings', {
        id: borrowingId,
        userId: currentUser.id,
        borrowDate: now,
        expectedReturnDate,
        status: 'pending',
        notes,
        createdAt: now,
      });
      const { error: insertError } = await supabase.from('borrowings').insert(borrowingRecord);
      if (insertError) {
        send(res, 500, { message: 'Không thể tạo phiếu mượn.' });
        return true;
      }
      const detailRecords = items.map((item) =>
        toDbRecord('borrowingDetails', {
          id: crypto.randomUUID(),
          borrowingId: borrowingId,
          bookId: item.bookId,
          quantity: item.quantity,
          createdAt: now,
        })
      );
      const { error: detailError } = await supabase.from('borrowing_details').insert(detailRecords);
      if (detailError) {
        send(res, 500, { message: 'Không thể lưu chi tiết phiếu mượn.' });
        return true;
      }
      for (const item of items) {
        const book = bookMap.get(item.bookId);
        const { error: updateError } = await supabase
          .from('books')
          .update({ quantity: book.quantity - item.quantity })
          .eq('id', item.bookId);
        if (updateError) {
          send(res, 500, { message: 'Không thể cập nhật số lượng sách.' });
          return true;
        }
      }
      send(res, 201, {
        ...fromDbRecord('borrowings', {
          ...borrowingRecord,
        }),
        items: detailRecords.map((record) => fromDbRecord('borrowingDetails', record)),
      });
      return true;
    } catch (error) {
      send(res, 400, { message: error.message });
      return true;
    }
  }

  if (req.method === 'PATCH' && pathname.startsWith('/api/borrowings/')) {
    if (currentUser.role !== 'admin') {
      send(res, 403, { message: 'Chỉ quản lý mới được cập nhật phiếu mượn.' });
      return true;
    }
    const id = pathname.split('/')[3];
    try {
      const body = await parseBody(req);
      const { data: borrowing, error: borrowError } = await supabase
        .from('borrowings')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (borrowError) {
        send(res, 500, { message: 'Không thể lấy phiếu mượn.' });
        return true;
      }
      if (!borrowing) {
        send(res, 404, { message: 'Không tìm thấy phiếu mượn.' });
        return true;
      }
      const updates = {};
      if (body.status === 'approved' || body.status === 'rejected') {
        updates.status = body.status;
        updates.processedAt = new Date().toISOString();
      }
      if (body.status === 'returned') {
        if (borrowing.status !== 'approved') {
          send(res, 400, { message: 'Chỉ phiếu đã duyệt mới có thể trả.' });
          return true;
        }
        updates.status = 'returned';
        updates.returnedAt = new Date().toISOString();
        const { data: details, error: detailError } = await supabase
          .from('borrowing_details')
          .select('*')
          .eq('borrowing_id', id);
        if (detailError) {
          send(res, 500, { message: 'Không thể lấy chi tiết phiếu mượn.' });
          return true;
        }
        for (const detail of details || []) {
          const { data: book, error: bookError } = await supabase
            .from('books')
            .select('quantity')
            .eq('id', detail.book_id)
            .maybeSingle();
          if (bookError || !book) {
            send(res, 500, { message: 'Không thể cập nhật sách khi trả.' });
            return true;
          }
          const { error: updateError } = await supabase
            .from('books')
            .update({ quantity: book.quantity + detail.quantity })
            .eq('id', detail.book_id);
          if (updateError) {
            send(res, 500, { message: 'Không thể hoàn kho sách.' });
            return true;
          }
        }
      }
      if (body.notes !== undefined) {
        updates.notes = body.notes;
      }
      updates.updatedAt = new Date().toISOString();
      const { data, error } = await supabase
        .from('borrowings')
        .update(toDbRecord('borrowings', updates))
        .eq('id', id)
        .select()
        .maybeSingle();
      if (error || !data) {
        send(res, 500, { message: 'Không thể cập nhật phiếu mượn.' });
        return true;
      }
      const { data: details } = await supabase
        .from('borrowing_details')
        .select('*')
        .eq('borrowing_id', id);
      send(res, 200, {
        ...fromDbRecord('borrowings', data),
        items: mapDbList('borrowingDetails', details || []),
      });
      return true;
    } catch (error) {
      send(res, 400, { message: error.message });
      return true;
    }
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      handleOptions(req, res);
      return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname || '/';

    if (await handleAuthRoutes(req, res, pathname)) {
      return;
    }

    const currentUser = await loadUserFromRequest(req);

    if (pathname.startsWith('/api/users')) {
      if (await handleUsers(req, res, pathname, currentUser)) {
        return;
      }
    }

    if (pathname.startsWith('/api/books')) {
      if (await handleBooks(req, res, pathname, currentUser)) {
        return;
      }
    }

    if (pathname.startsWith('/api/categories')) {
      if (await handleSimpleResource(req, res, pathname, currentUser, 'categories')) {
        return;
      }
    }

    if (pathname.startsWith('/api/publishers')) {
      if (await handleSimpleResource(req, res, pathname, currentUser, 'publishers')) {
        return;
      }
    }

    if (pathname.startsWith('/api/borrowings')) {
      if (await handleBorrowings(req, res, pathname, currentUser)) {
        return;
      }
    }

    notFound(res);
  } catch (error) {
    console.error('Unhandled error:', error);
    send(res, 500, { message: 'Lỗi máy chủ nội bộ.' });
  }
});

server.listen(PORT, () => {
  ensureAdminUser().catch((error) => {
    console.error('Failed to ensure admin user:', error);
  });
  console.log(`📚 Library API chạy tại http://localhost:${PORT}`);
});
