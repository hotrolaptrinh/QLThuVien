const { useState, useEffect } = React;

const API_BASE = window.API_BASE_URL || 'http://localhost:4000';

function useApi(token) {
  const apiFetch = React.useCallback(
    async (path, options = {}) => {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
      });
      if (response.status === 204) {
        return null;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'Có lỗi xảy ra');
      }
      return data;
    },
    [token]
  );
  return apiFetch;
}

function Login({ onLoggedIn, loading }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('admin@library.local');
  const [password, setPassword] = useState('Admin123!');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setError('');
    if (mode === 'register') {
      setName('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
    } else {
      setEmail('admin@library.local');
      setPassword('Admin123!');
      setConfirmPassword('');
    }
  }, [mode]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setError('');
    if (mode === 'register' && password !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }
    setSubmitting(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload = mode === 'login' ? { email, password } : { name, email, password };
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || (mode === 'login' ? 'Đăng nhập thất bại' : 'Đăng ký thất bại'));
      }
      onLoggedIn(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const formChildren = [];
  const isProcessing = loading || submitting;
  if (mode === 'register') {
    formChildren.push(
      React.createElement('label', { key: 'name-label' }, 'Họ và tên'),
      React.createElement('input', {
        key: 'name-input',
        value: name,
        onChange: (e) => setName(e.target.value),
        type: 'text',
        placeholder: 'Nguyễn Văn A',
        required: true,
        disabled: isProcessing,
      })
    );
  }
  formChildren.push(
    React.createElement('label', { key: 'email-label' }, 'Email'),
    React.createElement('input', {
      key: 'email-input',
      value: email,
      onChange: (e) => setEmail(e.target.value),
      type: 'email',
      placeholder: 'you@example.com',
      required: true,
      disabled: isProcessing,
    }),
    React.createElement('label', { key: 'password-label' }, 'Mật khẩu'),
    React.createElement('input', {
      key: 'password-input',
      value: password,
      onChange: (e) => setPassword(e.target.value),
      type: 'password',
      placeholder: '••••••••',
      required: true,
      minLength: 6,
      disabled: isProcessing,
    })
  );
  if (mode === 'register') {
    formChildren.push(
      React.createElement('label', { key: 'confirm-label' }, 'Xác nhận mật khẩu'),
      React.createElement('input', {
        key: 'confirm-input',
        value: confirmPassword,
        onChange: (e) => setConfirmPassword(e.target.value),
        type: 'password',
        placeholder: 'Nhập lại mật khẩu',
        required: true,
        minLength: 6,
        disabled: isProcessing,
      })
    );
  }
  formChildren.push(
    React.createElement('button', {
      key: 'submit',
      type: 'submit',
      disabled: isProcessing,
    }, isProcessing ? 'Đang xử lý...' : mode === 'login' ? 'Đăng nhập' : 'Đăng ký')
  );

  return (
    React.createElement('div', { className: 'login-wrapper' },
      React.createElement('div', { className: 'card login-card' },
        React.createElement('h2', null, mode === 'login' ? 'Đăng nhập quản lý thư viện' : 'Tạo tài khoản thư viện'),
        React.createElement('div', { className: 'auth-tabs' },
          React.createElement('button', {
            type: 'button',
            className: `tab ${mode === 'login' ? 'active' : ''}`,
            onClick: () => setMode('login'),
            disabled: submitting,
          }, 'Đăng nhập'),
          React.createElement('button', {
            type: 'button',
            className: `tab ${mode === 'register' ? 'active' : ''}`,
            onClick: () => setMode('register'),
            disabled: submitting,
          }, 'Đăng ký')
        ),
        error && React.createElement('div', { className: 'alert' }, error),
        React.createElement('form', { onSubmit: handleSubmit }, formChildren),
        mode === 'login' ?
          React.createElement('p', { style: { fontSize: 13, color: '#64748b', marginTop: 12 } },
            'Tài khoản mặc định: admin@library.local / Admin123!'
          ) :
          React.createElement('p', { style: { fontSize: 13, color: '#64748b', marginTop: 12 } },
            'Sau khi đăng ký bạn có thể đăng nhập và gửi yêu cầu mượn sách.'
          )
      )
    )
  );
}

function BooksSection({ api, user, categories, publishers, onRefresh }) {
  const [pageData, setPageData] = useState({ items: [], total: 0, page: 1 });
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ title: '', author: '', categoryId: '', publisherId: '', quantity: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchBooks = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = search ? `?search=${encodeURIComponent(search)}` : '';
      const data = await api(`/api/books${query}`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
      setPageData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [api, search]);

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/books', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          author: form.author,
          categoryId: form.categoryId || null,
          publisherId: form.publisherId || null,
          quantity: Number(form.quantity) || 0,
        }),
      });
      setForm({ title: '', author: '', categoryId: '', publisherId: '', quantity: 1 });
      await fetchBooks();
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    React.createElement('div', { className: 'card' },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
        React.createElement('h2', null, 'Danh sách sách'),
        React.createElement('input', {
          placeholder: 'Tìm kiếm theo tên...',
          value: search,
          onChange: (e) => setSearch(e.target.value),
          style: { maxWidth: 240 },
        })
      ),
      error && React.createElement('div', { className: 'alert', style: { marginBottom: 16 } }, error),
      loading ? React.createElement('p', null, 'Đang tải...') :
        React.createElement('table', { className: 'table' },
          React.createElement('thead', null,
            React.createElement('tr', null,
              ['Tên sách', 'Tác giả', 'Thể loại', 'Nhà XB', 'Số lượng'].map((header) => React.createElement('th', { key: header }, header))
            )
          ),
          React.createElement('tbody', null,
            pageData.items.length === 0 ?
              React.createElement('tr', null, React.createElement('td', { colSpan: 5 }, 'Chưa có dữ liệu.')) :
              pageData.items.map((book) => {
                const category = categories.find((c) => c.id === book.categoryId);
                const publisher = publishers.find((p) => p.id === book.publisherId);
                return React.createElement('tr', { key: book.id },
                  React.createElement('td', null, book.title),
                  React.createElement('td', null, book.author || '—'),
                  React.createElement('td', null, category ? category.name : '—'),
                  React.createElement('td', null, publisher ? publisher.name : '—'),
                  React.createElement('td', null, book.quantity)
                );
              })
          )
        ),
      user?.role === 'admin' && (
        React.createElement('div', { style: { marginTop: 24 } },
          React.createElement('h3', null, 'Thêm sách mới'),
          React.createElement('form', { onSubmit: handleSubmit },
            React.createElement('input', {
              placeholder: 'Tên sách',
              value: form.title,
              onChange: (e) => setForm({ ...form, title: e.target.value }),
              required: true,
            }),
            React.createElement('input', {
              placeholder: 'Tác giả',
              value: form.author,
              onChange: (e) => setForm({ ...form, author: e.target.value }),
            }),
            React.createElement('select', {
              value: form.categoryId,
              onChange: (e) => setForm({ ...form, categoryId: e.target.value }),
            },
              React.createElement('option', { value: '' }, 'Chọn thể loại'),
              categories.map((category) => React.createElement('option', { key: category.id, value: category.id }, category.name))
            ),
            React.createElement('select', {
              value: form.publisherId,
              onChange: (e) => setForm({ ...form, publisherId: e.target.value }),
            },
              React.createElement('option', { value: '' }, 'Chọn nhà xuất bản'),
              publishers.map((publisher) => React.createElement('option', { key: publisher.id, value: publisher.id }, publisher.name))
            ),
            React.createElement('input', {
              type: 'number',
              min: 0,
              placeholder: 'Số lượng',
              value: form.quantity,
              onChange: (e) => setForm({ ...form, quantity: e.target.value }),
              required: true,
            }),
            React.createElement('button', { type: 'submit' }, 'Lưu sách')
          )
        )
      )
    )
  );
}

function SimpleManager({ title, placeholder, items, onCreate, onUpdate, onDelete }) {
  const [value, setValue] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [pendingAction, setPendingAction] = useState(null);

  const handleCreate = async (event) => {
    event.preventDefault();
    const nextValue = value.trim();
    if (!nextValue) return;
    try {
      setPendingAction('create');
      await onCreate(nextValue);
      setValue('');
    } catch (err) {
      alert(err.message);
    } finally {
      setPendingAction(null);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditingValue(item.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingValue('');
  };

  const saveEdit = async (id) => {
    const nextValue = editingValue.trim();
    if (!nextValue) return;
    try {
      setPendingAction('update');
      await onUpdate(id, nextValue);
      cancelEdit();
    } catch (err) {
      alert(err.message);
    } finally {
      setPendingAction(null);
    }
  };

  const removeItem = async (item) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xoá "${item.name}"?`)) {
      return;
    }
    try {
      setPendingAction('delete');
      await onDelete(item.id);
      if (editingId === item.id) {
        cancelEdit();
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setPendingAction(null);
    }
  };

  const isBusy = pendingAction !== null;

  const listContent =
    items.length === 0
      ? [React.createElement('p', { className: 'empty', key: 'empty' }, 'Chưa có dữ liệu.')]
      : items.map((item) => {
          if (editingId === item.id) {
            return React.createElement(
              'div',
              { className: 'manager-item', key: item.id },
              React.createElement('input', {
                value: editingValue,
                onChange: (e) => setEditingValue(e.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    saveEdit(item.id);
                  }
                },
                disabled: isBusy,
              }),
              React.createElement(
                'div',
                { className: 'manager-actions' },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: () => saveEdit(item.id),
                    disabled: isBusy,
                  },
                  pendingAction === 'update' ? 'Đang lưu...' : 'Lưu'
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'secondary',
                    onClick: cancelEdit,
                    disabled: isBusy,
                  },
                  'Huỷ'
                )
              )
            );
          }
          return React.createElement(
            'div',
            { className: 'manager-item', key: item.id },
            React.createElement('span', null, item.name),
            React.createElement(
              'div',
              { className: 'manager-actions' },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'secondary',
                  onClick: () => startEdit(item),
                  disabled: isBusy,
                },
                'Sửa'
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'danger',
                  onClick: () => removeItem(item),
                  disabled: isBusy,
                },
                pendingAction === 'delete' ? 'Đang xoá...' : 'Xoá'
              )
            )
          );
        });

  return (
    React.createElement(
      'div',
      { className: 'card' },
      React.createElement('h3', null, title),
      React.createElement(
        'form',
        { onSubmit: handleCreate },
        React.createElement(
          'div',
          { className: 'manager-create' },
          React.createElement('input', {
            value: value,
            onChange: (e) => setValue(e.target.value),
            placeholder,
            required: true,
            disabled: isBusy,
          }),
          React.createElement(
            'button',
            { type: 'submit', disabled: isBusy },
            pendingAction === 'create' ? 'Đang lưu...' : 'Thêm'
          )
        )
      ),
      React.createElement('div', { className: 'manager-list' }, listContent)
    )
  );
}

function BorrowingsSection({ api, user, books }) {
  const [borrowings, setBorrowings] = useState([]);
  const [selectedBook, setSelectedBook] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');

  const refresh = React.useCallback(async () => {
    try {
      const data = await api('/api/borrowings');
      setBorrowings(data);
    } catch (err) {
      console.error(err);
    }
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submitBorrow = async (event) => {
    event.preventDefault();
    if (!selectedBook) return;
    await api('/api/borrowings', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ bookId: selectedBook, quantity: Number(quantity) || 1 }],
        notes,
      }),
    });
    setSelectedBook('');
    setQuantity(1);
    setNotes('');
    refresh();
  };

  const updateBorrowing = async (id, status) => {
    await api(`/api/borrowings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    refresh();
  };

  return (
    React.createElement('div', { className: 'card' },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
        React.createElement('h2', null, 'Quản lý mượn / trả')
      ),
      user.role === 'user' && (
        React.createElement('form', { onSubmit: submitBorrow, style: { marginBottom: 24 } },
          React.createElement('h3', null, 'Đăng ký mượn sách'),
          React.createElement('select', {
            value: selectedBook,
            onChange: (e) => setSelectedBook(e.target.value),
            required: true,
          },
            React.createElement('option', { value: '' }, 'Chọn sách'),
            books.map((book) => React.createElement('option', { key: book.id, value: book.id }, `${book.title} (${book.quantity} quyển còn lại)`))
          ),
          React.createElement('input', {
            type: 'number',
            min: 1,
            value: quantity,
            onChange: (e) => setQuantity(e.target.value),
            placeholder: 'Số lượng',
            required: true,
          }),
          React.createElement('textarea', {
            value: notes,
            onChange: (e) => setNotes(e.target.value),
            placeholder: 'Ghi chú (tuỳ chọn)'
          }),
          React.createElement('button', { type: 'submit' }, 'Gửi yêu cầu')
        )
      ),
      React.createElement('div', { className: 'grid' },
        borrowings.map((borrow) => (
          React.createElement('div', { className: 'card', key: borrow.id, style: { marginBottom: 0 } },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement('div', null,
                React.createElement('h3', null, `Phiếu #${borrow.id.slice(0, 6)}`),
                React.createElement('p', { style: { margin: '4px 0', color: '#64748b' } }, new Date(borrow.borrowDate).toLocaleString('vi-VN'))
              ),
              React.createElement('span', { className: `status ${borrow.status}` },
                borrow.status === 'pending' ? 'Chờ duyệt' :
                  borrow.status === 'approved' ? 'Đã duyệt' :
                    borrow.status === 'returned' ? 'Đã trả' :
                      'Từ chối'
              )
            ),
            React.createElement('ul', null,
              borrow.items.map((item) => {
                const book = books.find((b) => b.id === item.bookId);
                return React.createElement('li', { key: item.id }, `${book ? book.title : 'Sách'} • ${item.quantity} quyển`);
              })
            ),
            user.role === 'admin' && (
              React.createElement('div', { style: { display: 'flex', gap: 12 } },
                borrow.status === 'pending' && React.createElement('button', { onClick: () => updateBorrowing(borrow.id, 'approved') }, 'Duyệt'),
                borrow.status === 'pending' && React.createElement('button', { className: 'secondary', onClick: () => updateBorrowing(borrow.id, 'rejected') }, 'Từ chối'),
                borrow.status === 'approved' && React.createElement('button', { onClick: () => updateBorrowing(borrow.id, 'returned') }, 'Xác nhận trả')
              )
            )
          )
        ))
      )
    )
  );
}

function AdminManagement({ api, categories, publishers, refresh }) {
  const addCategory = async (name) => {
    await api('/api/categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    await refresh();
  };

  const updateCategory = async (id, name) => {
    await api(`/api/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
    await refresh();
  };

  const removeCategory = async (id) => {
    await api(`/api/categories/${id}`, {
      method: 'DELETE',
    });
    await refresh();
  };

  const addPublisher = async (name) => {
    await api('/api/publishers', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    await refresh();
  };

  const updatePublisher = async (id, name) => {
    await api(`/api/publishers/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
    await refresh();
  };

  const removePublisher = async (id) => {
    await api(`/api/publishers/${id}`, {
      method: 'DELETE',
    });
    await refresh();
  };

  return (
    React.createElement('div', { className: 'grid two' },
      React.createElement(SimpleManager, {
        title: 'Thể loại',
        placeholder: 'Nhập tên thể loại',
        items: categories,
        onCreate: addCategory,
        onUpdate: updateCategory,
        onDelete: removeCategory,
      }),
      React.createElement(SimpleManager, {
        title: 'Nhà xuất bản',
        placeholder: 'Nhập tên nhà xuất bản',
        items: publishers,
        onCreate: addPublisher,
        onUpdate: updatePublisher,
        onDelete: removePublisher,
      })
    )
  );
}

function App() {
  const [auth, setAuth] = useState(() => {
    const stored = localStorage.getItem('library.auth');
    return stored ? JSON.parse(stored) : null;
  });
  const loading = false;
  const token = auth?.token;
  const user = auth?.user;
  const api = useApi(token);
  const [categories, setCategories] = useState([]);
  const [publishers, setPublishers] = useState([]);
  const [books, setBooks] = useState([]);

  const loadTaxonomies = React.useCallback(async () => {
    if (!token) return;
    try {
      const [categoryResponse, publisherResponse, booksResponse] = await Promise.all([
        api('/api/categories'),
        api('/api/publishers'),
        api('/api/books'),
      ]);
      setCategories(categoryResponse.items || []);
      setPublishers(publisherResponse.items || []);
      setBooks(booksResponse.items || []);
    } catch (err) {
      console.error(err);
    }
  }, [api, token]);

  useEffect(() => {
    loadTaxonomies();
  }, [loadTaxonomies]);

  const handleLoggedIn = (data) => {
    const payload = { token: data.token, user: data.user, expiresIn: data.expiresIn };
    setAuth(payload);
    localStorage.setItem('library.auth', JSON.stringify(payload));
  };

  const logout = () => {
    localStorage.removeItem('library.auth');
    setAuth(null);
    setBooks([]);
    setCategories([]);
    setPublishers([]);
  };

  if (!auth) {
    return React.createElement(Login, { onLoggedIn: handleLoggedIn, loading });
  }

  return (
    React.createElement('div', { className: 'container' },
      React.createElement('header', null,
        React.createElement('div', null,
          React.createElement('h1', null, '📚 Quản lý thư viện'),
          React.createElement('p', { style: { margin: 0, color: '#64748b' } }, `Xin chào, ${user.name} (${user.role === 'admin' ? 'Quản lý' : 'Bạn đọc'})`)
        ),
        React.createElement('button', { className: 'secondary', onClick: logout }, 'Đăng xuất')
      ),
      React.createElement('div', { className: 'grid' },
        React.createElement(BooksSection, {
          api,
          user,
          categories,
          publishers,
          onRefresh: loadTaxonomies,
        }),
        user.role === 'admin' && React.createElement(AdminManagement, {
          api,
          categories,
          publishers,
          refresh: loadTaxonomies,
        }),
        React.createElement(BorrowingsSection, {
          api,
          user,
          books,
        })
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
