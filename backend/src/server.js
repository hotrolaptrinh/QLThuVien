const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-library-key';
const TOKEN_EXPIRY_SECONDS = 60 * 60 * 8; // 8 hours

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      users: [],
      categories: [],
      publishers: [],
      books: [],
      borrowings: [],
      borrowingDetails: [],
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
  }
}

function readDb() {
  ensureDataFile();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(raw);
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

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

function loadUserFromRequest(req) {
  const auth = req.headers['authorization'];
  if (!auth) return null;
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  const payload = verifyToken(parts[1]);
  if (!payload) return null;
  const db = readDb();
  return db.users.find((user) => user.id === payload.id) || null;
}

function ensureAdminUser() {
  const db = readDb();
  if (db.users.length === 0) {
    const admin = {
      id: crypto.randomUUID(),
      name: 'Thư viện Admin',
      email: 'admin@library.local',
      role: 'admin',
      password: hashPassword('Admin123!'),
      createdAt: new Date().toISOString(),
    };
    db.users.push(admin);
    writeDb(db);
    console.log('📘 Created default admin account: admin@library.local / Admin123!');
  }
}

function paginate(array, query) {
  const page = Number(query.page || 1);
  const pageSize = Math.min(Number(query.pageSize || 20), 50);
  const start = (page - 1) * pageSize;
  const items = array.slice(start, start + pageSize);
  return {
    page,
    pageSize,
    total: array.length,
    items,
  };
}

function handleAuthRoutes(req, res, pathname) {
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    return parseBody(req)
      .then((body) => {
        const { email, password } = body;
        if (!email || !password) {
          send(res, 400, { message: 'Email và mật khẩu là bắt buộc.' });
          return;
        }
        const db = readDb();
        const user = db.users.find((u) => u.email === email.toLowerCase());
        if (!user || !verifyPassword(password, user.password)) {
          send(res, 401, { message: 'Email hoặc mật khẩu không đúng.' });
          return;
        }
        const token = signToken({ id: user.id, role: user.role });
        send(res, 200, {
          token,
          user: { id: user.id, name: user.name, email: user.email, role: user.role },
          expiresIn: TOKEN_EXPIRY_SECONDS,
        });
      })
      .catch((error) => {
        send(res, 400, { message: error.message });
      });
  }

  if (req.method === 'POST' && pathname === '/api/auth/register') {
    const currentUser = loadUserFromRequest(req);
    return parseBody(req)
      .then((body) => {
        const { name, email, password, role = 'user' } = body;
        if (!name || !email || !password) {
          send(res, 400, { message: 'Thiếu thông tin bắt buộc.' });
          return;
        }
        const db = readDb();
        const existing = db.users.find((u) => u.email === email.toLowerCase());
        if (existing) {
          send(res, 409, { message: 'Email đã tồn tại.' });
          return;
        }
        if (db.users.length > 0) {
          if (!currentUser || currentUser.role !== 'admin') {
            send(res, 403, { message: 'Chỉ quản lý mới có thể tạo người dùng.' });
            return;
          }
        }
        const user = {
          id: crypto.randomUUID(),
          name,
          email: email.toLowerCase(),
          role: role === 'admin' ? 'admin' : 'user',
          password: hashPassword(password),
          createdAt: new Date().toISOString(),
        };
        db.users.push(user);
        writeDb(db);
        send(res, 201, {
          user: { id: user.id, name: user.name, email: user.email, role: user.role },
        });
      })
      .catch((error) => send(res, 400, { message: error.message }));
  }

  return false;
}

function handleUsers(req, res, pathname, currentUser) {
  if (!currentUser || currentUser.role !== 'admin') {
    send(res, 403, { message: 'Yêu cầu quyền quản lý.' });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/users') {
    const db = readDb();
    const users = db.users.map(({ password, ...rest }) => rest);
    send(res, 200, users);
    return true;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/users/')) {
    const id = pathname.split('/')[3];
    const db = readDb();
    const index = db.users.findIndex((u) => u.id === id);
    if (index === -1) {
      send(res, 404, { message: 'Không tìm thấy người dùng.' });
      return true;
    }
    db.users.splice(index, 1);
    writeDb(db);
    send(res, 204);
    return true;
  }

  return false;
}

function handleSimpleResource(req, res, pathname, currentUser, key) {
  const collectionName = key;
  const basePath = `/api/${collectionName}`;
  if (req.method === 'GET' && pathname === basePath) {
    const db = readDb();
    const search = url.parse(req.url, true).query.search || '';
    const items = db[collectionName]
      .filter((item) =>
        !search || item.name?.toLowerCase().includes(search.toLowerCase()) || item.title?.toLowerCase().includes(search.toLowerCase())
      )
      .sort((a, b) => a.name?.localeCompare?.(b.name || '') || 0);
    send(res, 200, paginate(items, url.parse(req.url, true).query));
    return true;
  }

  if (req.method === 'POST' && pathname === basePath) {
    if (!currentUser || currentUser.role !== 'admin') {
      send(res, 403, { message: 'Yêu cầu quyền quản lý.' });
      return true;
    }
    return parseBody(req)
      .then((body) => {
        const db = readDb();
        const item = {
          id: crypto.randomUUID(),
          ...body,
          createdAt: new Date().toISOString(),
        };
        db[collectionName].push(item);
        writeDb(db);
        send(res, 201, item);
      })
      .catch((error) => send(res, 400, { message: error.message }));
  }

  if (req.method === 'PUT' && pathname.startsWith(`${basePath}/`)) {
    if (!currentUser || currentUser.role !== 'admin') {
      send(res, 403, { message: 'Yêu cầu quyền quản lý.' });
      return true;
    }
    const id = pathname.split('/')[3];
    return parseBody(req)
      .then((body) => {
        const db = readDb();
        const index = db[collectionName].findIndex((item) => item.id === id);
        if (index === -1) {
          send(res, 404, { message: 'Không tìm thấy bản ghi.' });
          return;
        }
        db[collectionName][index] = {
          ...db[collectionName][index],
          ...body,
          updatedAt: new Date().toISOString(),
        };
        writeDb(db);
        send(res, 200, db[collectionName][index]);
      })
      .catch((error) => send(res, 400, { message: error.message }));
  }

  if (req.method === 'DELETE' && pathname.startsWith(`${basePath}/`)) {
    if (!currentUser || currentUser.role !== 'admin') {
      send(res, 403, { message: 'Yêu cầu quyền quản lý.' });
      return true;
    }
    const id = pathname.split('/')[3];
    const db = readDb();
    const index = db[collectionName].findIndex((item) => item.id === id);
    if (index === -1) {
      send(res, 404, { message: 'Không tìm thấy bản ghi.' });
      return true;
    }
    db[collectionName].splice(index, 1);
    writeDb(db);
    send(res, 204);
    return true;
  }

  return false;
}

function handleBooks(req, res, pathname, currentUser) {
  if (handleSimpleResource(req, res, pathname, currentUser, 'books')) {
    return true;
  }
  if (req.method === 'GET' && pathname.startsWith('/api/books/')) {
    const id = pathname.split('/')[3];
    const db = readDb();
    const book = db.books.find((b) => b.id === id);
    if (!book) {
      send(res, 404, { message: 'Không tìm thấy sách.' });
      return true;
    }
    send(res, 200, book);
    return true;
  }
  return false;
}

function handleBorrowings(req, res, pathname, currentUser) {
  if (!currentUser) {
    send(res, 401, { message: 'Yêu cầu đăng nhập.' });
    return true;
  }
  const db = readDb();

  if (req.method === 'GET' && pathname === '/api/borrowings') {
    const results = db.borrowings
      .filter((b) => currentUser.role === 'admin' || b.userId === currentUser.id)
      .map((borrow) => ({
        ...borrow,
        items: db.borrowingDetails.filter((detail) => detail.borrowingId === borrow.id),
      }))
      .sort((a, b) => new Date(b.borrowDate) - new Date(a.borrowDate));
    send(res, 200, results);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/borrowings') {
    return parseBody(req)
      .then((body) => {
        const { items } = body;
        if (!Array.isArray(items) || items.length === 0) {
          send(res, 400, { message: 'Yêu cầu ít nhất một sách.' });
          return;
        }
        const borrowId = crypto.randomUUID();
        const now = new Date().toISOString();

        for (const item of items) {
          const book = db.books.find((b) => b.id === item.bookId);
          if (!book) {
            send(res, 404, { message: `Không tìm thấy sách với id ${item.bookId}.` });
            return;
          }
          if (book.quantity < item.quantity) {
            send(res, 400, { message: `Sách ${book.title} không đủ số lượng.` });
            return;
          }
        }

        const borrowing = {
          id: borrowId,
          userId: currentUser.id,
          borrowDate: now,
          expectedReturnDate: body.expectedReturnDate || null,
          status: 'pending',
          notes: body.notes || '',
          createdAt: now,
        };
        db.borrowings.push(borrowing);

        for (const item of items) {
          const detail = {
            id: crypto.randomUUID(),
            borrowingId: borrowId,
            bookId: item.bookId,
            quantity: item.quantity,
          };
          db.borrowingDetails.push(detail);
          const book = db.books.find((b) => b.id === item.bookId);
          book.quantity -= item.quantity;
        }
        writeDb(db);
        send(res, 201, {
          ...borrowing,
          items: db.borrowingDetails.filter((d) => d.borrowingId === borrowId),
        });
      })
      .catch((error) => send(res, 400, { message: error.message }));
  }

  if (req.method === 'PATCH' && pathname.startsWith('/api/borrowings/')) {
    if (currentUser.role !== 'admin') {
      send(res, 403, { message: 'Chỉ quản lý mới được cập nhật phiếu mượn.' });
      return true;
    }
    const id = pathname.split('/')[3];
    return parseBody(req)
      .then((body) => {
        const index = db.borrowings.findIndex((b) => b.id === id);
        if (index === -1) {
          send(res, 404, { message: 'Không tìm thấy phiếu mượn.' });
          return;
        }
        const borrowing = db.borrowings[index];
        if (body.status === 'approved' || body.status === 'rejected') {
          borrowing.status = body.status;
          borrowing.processedAt = new Date().toISOString();
        }
        if (body.status === 'returned') {
          if (borrowing.status !== 'approved') {
            send(res, 400, { message: 'Chỉ phiếu đã duyệt mới có thể trả.' });
            return;
          }
          borrowing.status = 'returned';
          borrowing.returnedAt = new Date().toISOString();
          const details = db.borrowingDetails.filter((detail) => detail.borrowingId === id);
          for (const detail of details) {
            const book = db.books.find((b) => b.id === detail.bookId);
            if (book) {
              book.quantity += detail.quantity;
            }
          }
        }
        borrowing.notes = body.notes ?? borrowing.notes;
        writeDb(db);
        send(res, 200, {
          ...borrowing,
          items: db.borrowingDetails.filter((detail) => detail.borrowingId === id),
        });
      })
      .catch((error) => send(res, 400, { message: error.message }));
  }

  return false;
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    handleOptions(req, res);
    return;
  }
  ensureDataFile();
  ensureAdminUser();
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const currentUser = loadUserFromRequest(req);

  if (handleAuthRoutes(req, res, pathname) !== false) {
    return;
  }

  if (pathname.startsWith('/api/users')) {
    if (handleUsers(req, res, pathname, currentUser)) {
      return;
    }
  }

  if (pathname.startsWith('/api/books')) {
    if (handleBooks(req, res, pathname, currentUser)) {
      return;
    }
  }

  if (pathname.startsWith('/api/categories')) {
    if (handleSimpleResource(req, res, pathname, currentUser, 'categories')) {
      return;
    }
  }

  if (pathname.startsWith('/api/publishers')) {
    if (handleSimpleResource(req, res, pathname, currentUser, 'publishers')) {
      return;
    }
  }

  if (pathname.startsWith('/api/borrowings')) {
    if (handleBorrowings(req, res, pathname, currentUser)) {
      return;
    }
  }

  notFound(res);
});

server.listen(PORT, () => {
  ensureDataFile();
  ensureAdminUser();
  console.log(`📚 Library API chạy tại http://localhost:${PORT}`);
});
