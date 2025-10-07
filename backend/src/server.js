const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

const PORT = process.env.PORT || 4000;
const DATABASE_URL =
  process.env.SUPABASE_DB_URL ||
  process.env.SUPABASE_CONNECTION_STRING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_CONNECTION_STRING;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-library-key';
const TOKEN_EXPIRY_SECONDS = 60 * 60 * 8; // 8 hours

if (!DATABASE_URL) {
  console.error(
    '❌ Missing Supabase Postgres connection string. Set SUPABASE_DB_URL (e.g. postgresql://postgres.rayvltpeewuofefeasxc:[YOUR-PASSWORD]@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres).'
  );
  process.exit(1);
}

const sslConfig = DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1')
  ? false
  : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfig,
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL error:', error);
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
    searchColumns: ['name', 'email'],
    defaultSort: 'created_at',
  },
  categories: {
    columns: {
      id: 'id',
      name: 'name',
      description: 'description',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    searchColumns: ['name', 'description'],
    defaultSort: 'created_at',
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
    searchColumns: ['name', 'address', 'phone'],
    defaultSort: 'created_at',
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
    searchColumns: ['title', 'author'],
    defaultSort: 'created_at',
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
    defaultSort: 'borrow_date',
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
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(data).digest();
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

async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

async function querySingle(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

function buildInsert(table, record) {
  const keys = Object.keys(record);
  if (keys.length === 0) throw new Error('No fields to insert');
  const columns = keys.join(', ');
  const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
  const values = keys.map((key) => record[key]);
  const text = `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`;
  return { text, values };
}

function buildUpdate(table, record, idValue, idColumn = 'id') {
  const keys = Object.keys(record);
  if (keys.length === 0) throw new Error('No fields to update');
  const assignments = keys.map((key, idx) => `${key} = $${idx + 1}`).join(', ');
  const values = keys.map((key) => record[key]);
  const text = `UPDATE ${table} SET ${assignments} WHERE ${idColumn} = $${keys.length + 1} RETURNING *`;
  return { text, values: [...values, idValue] };
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
  const user = await querySingle('SELECT * FROM users WHERE id = $1', [payload.id]);
  if (!user) return null;
  return fromDbRecord('users', user);
}

async function ensureAdminUser() {
  const adminEmail = 'admin@library.local';
  try {
    const existing = await querySingle('SELECT id FROM users WHERE email = $1', [adminEmail]);
    if (existing) {
      return;
    }
    const now = new Date().toISOString();
    const admin = {
      id: crypto.randomUUID(),
      name: 'Thư viện Admin',
      email: adminEmail,
      role: 'admin',
      password: hashPassword('Admin123!'),
      createdAt: now,
      updatedAt: now,
    };
    const payload = toDbRecord('users', admin);
    const { text, values } = buildInsert('users', payload);
    await query(text, values);
    console.log('📘 Created default admin account: admin@library.local / Admin123!');
  } catch (error) {
    console.error('❌ Unable to ensure default admin user:', error.message);
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
      const user = await querySingle('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
      if (!user || !verifyPassword(password, user.password_hash)) {
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
      const passwordValue = String(password);
      if (passwordValue.length < 6) {
        send(res, 400, { message: 'Mật khẩu phải có ít nhất 6 ký tự.' });
        return true;
      }
      const requester = await loadUserFromRequest(req);
      const lowerEmail = String(email).trim().toLowerCase();
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        send(res, 400, { message: 'Tên không được để trống.' });
        return true;
      }
      const existing = await querySingle('SELECT id FROM users WHERE email = $1', [lowerEmail]);
      if (existing) {
        send(res, 409, { message: 'Email đã tồn tại.' });
        return true;
      }
      let assignedRole = 'user';
      if (String(role).toLowerCase() === 'admin') {
        if (!requester || requester.role !== 'admin') {
          send(res, 403, { message: 'Chỉ quản lý mới được tạo tài khoản quản trị.' });
          return true;
        }
        assignedRole = 'admin';
      }
      const now = new Date().toISOString();
      const user = {
        id: crypto.randomUUID(),
        name: trimmedName,
        email: lowerEmail,
        role: assignedRole,
        password: hashPassword(passwordValue),
        createdAt: now,
        updatedAt: now,
      };
      const payload = toDbRecord('users', user);
      const { text, values } = buildInsert('users', payload);
      const inserted = await query(text, values);
      const createdUser = fromDbRecord('users', inserted.rows[0]);
      const token = signToken({ id: createdUser.id, role: createdUser.role });
      send(res, 201, { token, user: createdUser, expiresIn: TOKEN_EXPIRY_SECONDS });
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
    try {
      const result = await query(
        'SELECT id, name, email, role, created_at, updated_at FROM users ORDER BY created_at ASC'
      );
      send(res, 200, mapDbList('users', result.rows));
      return true;
    } catch (error) {
      send(res, 500, { message: 'Không thể lấy danh sách người dùng.' });
      return true;
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/users/')) {
    const id = pathname.split('/')[3];
    try {
      const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
      if (result.rowCount === 0) {
        send(res, 404, { message: 'Không tìm thấy người dùng.' });
        return true;
      }
      send(res, 204);
      return true;
    } catch (error) {
      send(res, 500, { message: 'Không thể xóa người dùng.' });
      return true;
    }
  }

  return false;
}

async function handleSimpleResource(req, res, pathname, currentUser, tableName) {
  const config = TABLES[tableName];
  if (!config) return false;
  const basePath = `/api/${tableName}`;

  if (req.method === 'GET' && pathname === basePath) {
    try {
      const queryParams = url.parse(req.url, true).query;
      const search = queryParams.search ? String(queryParams.search).trim() : '';
      const pageRaw = parseInt(queryParams.page, 10);
      const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
      const pageSizeRaw = parseInt(queryParams.pageSize, 10);
      const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(pageSizeRaw, 50) : 20;
      const offset = (page - 1) * pageSize;

      const filters = [];
      const values = [];
      if (search && config.searchColumns && config.searchColumns.length > 0) {
        const like = `%${search.toLowerCase()}%`;
        const clauses = config.searchColumns.map((column, idx) => {
          values.push(like);
          return `LOWER(${column}) LIKE $${values.length}`;
        });
        filters.push(`(${clauses.join(' OR ')})`);
      }

      const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const countResult = await query(
        `SELECT COUNT(*)::int AS count FROM ${tableName} ${whereClause}`,
        values
      );
      const total = Number(countResult.rows[0]?.count || 0);

      const dataValues = [...values, pageSize, offset];
      const limitIndex = dataValues.length - 1;
      const selectQuery = `SELECT * FROM ${tableName} ${whereClause} ORDER BY ${
        config.defaultSort || 'created_at'
      } ASC LIMIT $${limitIndex} OFFSET $${limitIndex + 1}`;
      const dataResult = await query(selectQuery, dataValues);
      send(res, 200, paginateResponse(mapDbList(tableName, dataResult.rows), total, page, pageSize));
      return true;
    } catch (error) {
      console.error(`Failed to fetch ${tableName}:`, error);
      send(res, 500, { message: `Không thể lấy danh sách ${tableName}.` });
      return true;
    }
  }

  if (req.method === 'POST' && pathname === basePath) {
    if (!currentUser || currentUser.role !== 'admin') {
      send(res, 403, { message: 'Yêu cầu quyền quản lý.' });
      return true;
    }
    try {
      const body = await parseBody(req);
      const now = new Date().toISOString();
      const record = {
        id: crypto.randomUUID(),
        ...body,
        createdAt: now,
        updatedAt: now,
      };
      const payload = toDbRecord(tableName, record);
      const { text, values } = buildInsert(tableName, payload);
      const inserted = await query(text, values);
      send(res, 201, fromDbRecord(tableName, inserted.rows[0]));
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
      if (Object.keys(payload).length === 0) {
        send(res, 400, { message: 'Không có dữ liệu để cập nhật.' });
        return true;
      }
      const { text, values } = buildUpdate(tableName, payload, id);
      const updated = await query(text, values);
      if (updated.rowCount === 0) {
        send(res, 404, { message: 'Không tìm thấy bản ghi.' });
        return true;
      }
      send(res, 200, fromDbRecord(tableName, updated.rows[0]));
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
    try {
      const result = await query(`DELETE FROM ${tableName} WHERE id = $1 RETURNING id`, [id]);
      if (result.rowCount === 0) {
        send(res, 404, { message: 'Không tìm thấy bản ghi.' });
        return true;
      }
      send(res, 204);
      return true;
    } catch (error) {
      send(res, 500, { message: `Không thể xóa ${tableName}.` });
      return true;
    }
  }

  return false;
}

async function handleBooks(req, res, pathname, currentUser) {
  if (await handleSimpleResource(req, res, pathname, currentUser, 'books')) {
    return true;
  }
  if (req.method === 'GET' && pathname.startsWith('/api/books/')) {
    const id = pathname.split('/')[3];
    try {
      const book = await querySingle('SELECT * FROM books WHERE id = $1', [id]);
      if (!book) {
        send(res, 404, { message: 'Không tìm thấy sách.' });
        return true;
      }
      send(res, 200, fromDbRecord('books', book));
      return true;
    } catch (error) {
      send(res, 500, { message: 'Không thể lấy thông tin sách.' });
      return true;
    }
  }
  return false;
}

async function handleBorrowings(req, res, pathname, currentUser) {
  if (!currentUser) {
    send(res, 401, { message: 'Yêu cầu đăng nhập.' });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/borrowings') {
    try {
      const params = [];
      let queryText = 'SELECT * FROM borrowings';
      if (currentUser.role !== 'admin') {
        params.push(currentUser.id);
        queryText += ' WHERE user_id = $1';
      }
      queryText += ' ORDER BY borrow_date DESC';
      const borrowingsResult = await query(queryText, params);
      const borrowings = borrowingsResult.rows;
      const ids = borrowings.map((b) => b.id);
      let details = [];
      if (ids.length > 0) {
        const detailResult = await query(
          'SELECT * FROM borrowing_details WHERE borrowing_id = ANY($1::uuid[])',
          [ids]
        );
        details = detailResult.rows;
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
    } catch (error) {
      console.error('Failed to list borrowings:', error);
      send(res, 500, { message: 'Không thể lấy danh sách phiếu mượn.' });
      return true;
    }
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
      const now = new Date().toISOString();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const bookResult = await client.query(
          'SELECT id, quantity FROM books WHERE id = ANY($1::uuid[]) FOR UPDATE',
          [bookIds]
        );
        const bookMap = new Map(bookResult.rows.map((row) => [row.id, row]));
        for (const item of items) {
          const book = bookMap.get(item.bookId);
          if (!book) {
            await client.query('ROLLBACK');
            send(res, 404, { message: `Không tìm thấy sách với id ${item.bookId}.` });
            return true;
          }
          if (book.quantity < item.quantity) {
            await client.query('ROLLBACK');
            send(res, 400, { message: `Sách ${item.bookId} không đủ số lượng.` });
            return true;
          }
        }
        const borrowingId = crypto.randomUUID();
        const borrowingRecord = toDbRecord('borrowings', {
          id: borrowingId,
          userId: currentUser.id,
          borrowDate: now,
          expectedReturnDate,
          status: 'pending',
          notes,
          createdAt: now,
          updatedAt: now,
        });
        const insertBorrow = await client.query(
          'INSERT INTO borrowings (id, user_id, borrow_date, expected_return_date, status, notes, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
          [
            borrowingRecord.id,
            borrowingRecord.user_id,
            borrowingRecord.borrow_date,
            borrowingRecord.expected_return_date,
            borrowingRecord.status,
            borrowingRecord.notes,
            borrowingRecord.created_at,
            borrowingRecord.updated_at,
          ]
        );
        const detailRows = [];
        for (const item of items) {
          const detailId = crypto.randomUUID();
          const detailRecord = toDbRecord('borrowingDetails', {
            id: detailId,
            borrowingId: borrowingId,
            bookId: item.bookId,
            quantity: item.quantity,
            createdAt: now,
          });
          const insertedDetail = await client.query(
            'INSERT INTO borrowing_details (id, borrowing_id, book_id, quantity, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING *',
            [
              detailRecord.id,
              detailRecord.borrowing_id,
              detailRecord.book_id,
              detailRecord.quantity,
              detailRecord.created_at,
            ]
          );
          detailRows.push(insertedDetail.rows[0]);
        }
        for (const item of items) {
          await client.query(
            'UPDATE books SET quantity = quantity - $1, updated_at = $3 WHERE id = $2',
            [item.quantity, item.bookId, now]
          );
        }
        await client.query('COMMIT');
        const borrowing = insertBorrow.rows[0];
        send(res, 201, {
          ...fromDbRecord('borrowings', borrowing),
          items: detailRows.map((row) => fromDbRecord('borrowingDetails', row)),
        });
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Failed to create borrowing:', error);
        send(res, 500, { message: 'Không thể tạo phiếu mượn.' });
        return true;
      } finally {
        client.release();
      }
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
      const client = await pool.connect();
      let cachedDetails = null;
      try {
        await client.query('BEGIN');
        const borrowResult = await client.query('SELECT * FROM borrowings WHERE id = $1 FOR UPDATE', [id]);
        if (borrowResult.rowCount === 0) {
          await client.query('ROLLBACK');
          send(res, 404, { message: 'Không tìm thấy phiếu mượn.' });
          return true;
        }
        const borrowing = borrowResult.rows[0];
        let status = borrowing.status;
        let processedAt = borrowing.processed_at;
        let returnedAt = borrowing.returned_at;
        let notes = borrowing.notes;
        const now = new Date().toISOString();

        if (body.status === 'approved' || body.status === 'rejected') {
          status = body.status;
          processedAt = now;
        }

        if (body.status === 'returned') {
          if (borrowing.status !== 'approved') {
            await client.query('ROLLBACK');
            send(res, 400, { message: 'Chỉ phiếu đã duyệt mới có thể trả.' });
            return true;
          }
          status = 'returned';
          returnedAt = now;
          const detailResult = await client.query(
            'SELECT * FROM borrowing_details WHERE borrowing_id = $1',
            [id]
          );
          const details = detailResult.rows;
          cachedDetails = details;
          for (const detail of details) {
            await client.query(
              'UPDATE books SET quantity = quantity + $1, updated_at = $3 WHERE id = $2',
              [detail.quantity, detail.book_id, now]
            );
          }
        }

        if (body.notes !== undefined) {
          notes = body.notes;
        }

        const updates = {
          status,
          updatedAt: now,
        };
        if (processedAt !== borrowing.processed_at) {
          updates.processedAt = processedAt;
        }
        if (returnedAt !== borrowing.returned_at) {
          updates.returnedAt = returnedAt;
        }
        if (notes !== borrowing.notes) {
          updates.notes = notes;
        }
        const payload = toDbRecord('borrowings', updates);
        if (Object.keys(payload).length === 0) {
          await client.query('ROLLBACK');
          send(res, 400, { message: 'Không có thay đổi để cập nhật.' });
          return true;
        }
        const { text, values } = buildUpdate('borrowings', payload, id);
        const updated = await client.query(text, values);
        await client.query('COMMIT');
        const updatedBorrowing = updated.rows[0];
        const detailRows =
          cachedDetails || (await query('SELECT * FROM borrowing_details WHERE borrowing_id = $1', [id])).rows;
        send(res, 200, {
          ...fromDbRecord('borrowings', updatedBorrowing),
          items: detailRows.map((detail) => fromDbRecord('borrowingDetails', detail)),
        });
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Failed to update borrowing:', error);
        send(res, 500, { message: 'Không thể cập nhật phiếu mượn.' });
        return true;
      } finally {
        client.release();
      }
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
