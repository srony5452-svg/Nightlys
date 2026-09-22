const express = require('express');
const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const db = new Database('demotrade.db');

app.use(express.json());

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax'
  }
});

app.use(sessionMiddleware);

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE,
  email TEXT UNIQUE,
  password TEXT,
  balance REAL DEFAULT 10000,
  admin INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trades(
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  side TEXT,
  amount REAL,
  price REAL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages(
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  username TEXT,
  message TEXT,
  created_at TEXT
);
`);

if (!db.prepare('SELECT 1 FROM users WHERE admin=1').get()) {
  const hash = bcrypt.hashSync(
    process.env.ADMIN_PASSWORD || 'admin123',
    10
  );

  db.prepare(`
    INSERT INTO users(username,email,password,balance,admin)
    VALUES(?,?,?,?,1)
  `).run(
    'admin',
    'admin@example.com',
    hash,
    100000
  );
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'index.html'))
);

function auth(req, res, next) {
  if (!req.session.uid) {
    return res.status(401).json({
      error: 'Login required'
    });
  }

  next();
}

/* =========================
   REGISTER
========================= */

app.post('/api/register', (req, res) => {
  let { username, email, password } = req.body || {};

  if (
    !username ||
    !email ||
    !password ||
    password.length < 6
  ) {
    return res.status(400).json({
      error: 'Username, email and 6+ character password required'
    });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);

    const result = db.prepare(`
      INSERT INTO users(username,email,password)
      VALUES(?,?,?)
    `).run(username, email, hash);

    req.session.uid = result.lastInsertRowid;

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({
      error: 'Username or email already exists'
    });
  }
});

/* =========================
   LOGIN
========================= */

app.post('/api/login', (req, res) => {
  const user = db.prepare(
    'SELECT * FROM users WHERE email=?'
  ).get(req.body.email);

  if (
    !user ||
    !bcrypt.compareSync(req.body.password, user.password)
  ) {
    return res.status(401).json({
      error: 'Invalid login'
    });
  }

  req.session.uid = user.id;

  res.json({ ok: true });
});

/* =========================
   LOGOUT
========================= */

app.post('/api/logout', (req, res) => {
  req.session.destroy(() =>
    res.json({ ok: true })
  );
});

/* =========================
   CURRENT USER
========================= */

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare(`
    SELECT id,username,email,balance,admin
    FROM users
    WHERE id=?
  `).get(req.session.uid);

  const trades = db.prepare(`
    SELECT side,amount,price,created_at
    FROM trades
    WHERE user_id=?
    ORDER BY id DESC
    LIMIT 50
  `).all(user.id);

  res.json({
    user,
    trades
  });
});

/* =========================
   TRADE
========================= */

app.post('/api/trade', auth, (req, res) => {
  let { side, amount, price } = req.body;

  amount = Number(amount);
  price = Number(price);

  if (
    !['buy', 'sell'].includes(side) ||
    amount <= 0 ||
    price <= 0
  ) {
    return res.status(400).json({
      error: 'Invalid trade'
    });
  }

  const user = db.prepare(
    'SELECT * FROM users WHERE id=?'
  ).get(req.session.uid);

  if (side === 'buy' && amount > user.balance) {
    return res.status(400).json({
      error: 'Insufficient demo balance'
    });
  }

  const newBalance =
    user.balance +
    (side === 'buy' ? -amount : amount);

  db.prepare(
    'UPDATE users SET balance=? WHERE id=?'
  ).run(newBalance, user.id);

  db.prepare(`
    INSERT INTO trades(
      user_id,side,amount,price,created_at
    )
    VALUES(?,?,?,?,?)
  `).run(
    user.id,
    side,
    amount,
    price,
    new Date().toISOString()
  );

  res.json({ ok: true });
});

/* =========================
   ADMIN USERS
========================= */

app.get('/api/admin/users', auth, (req, res) => {
  const user = db.prepare(
    'SELECT admin FROM users WHERE id=?'
  ).get(req.session.uid);

  if (!user.admin) {
    return res.status(403).json({
      error: 'Admin only'
    });
  }

  res.json(
    db.prepare(`
      SELECT id,username,email,balance,admin
      FROM users
      ORDER BY id DESC
    `).all()
  );
});

/* =========================
   ADMIN BALANCE
========================= */

app.post('/api/admin/balance', auth, (req, res) => {
  const admin = db.prepare(
    'SELECT admin FROM users WHERE id=?'
  ).get(req.session.uid);

  if (!admin.admin) {
    return res.status(403).json({
      error: 'Admin only'
    });
  }

  const id = Number(req.body.userId);
  const balance = Number(req.body.balance);

  if (balance < 0) {
    return res.status(400).json({
      error: 'Invalid balance'
    });
  }

  db.prepare(
    'UPDATE users SET balance=? WHERE id=?'
  ).run(balance, id);

  res.json({ ok: true });
});

/* =========================
   SOCKET.IO LIVE CHAT
========================= */

io.use((socket, next) => {
  sessionMiddleware(
    socket.request,
    {},
    next
  );
});

io.on('connection', (socket) => {

  const session = socket.request.session;

  if (!session || !session.uid) {
    socket.disconnect(true);
    return;
  }

  const user = db.prepare(`
    SELECT id,username,admin
    FROM users
    WHERE id=?
  `).get(session.uid);

  if (!user) {
    socket.disconnect(true);
    return;
  }

  socket.user = user;

  /* Send previous messages */

  const oldMessages = db.prepare(`
    SELECT username,message,created_at
    FROM chat_messages
    ORDER BY id DESC
    LIMIT 50
  `).all().reverse();

  socket.emit('chat history', oldMessages);

  /* Online user count */

  io.emit(
    'online count',
    io.engine.clientsCount
  );

  /* New message */

  socket.on('chat message', (message) => {

    if (typeof message !== 'string') return;

    message = message.trim();

    if (!message) return;

    if (message.length > 500) {
      message = message.substring(0, 500);
    }

    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO chat_messages(
        user_id,
        username,
        message,
        created_at
      )
      VALUES(?,?,?,?)
    `).run(
      user.id,
      user.username,
      message,
      createdAt
    );

    io.emit('chat message', {
      username: user.username,
      message,
      created_at: createdAt
    });
  });

  socket.on('disconnect', () => {
    io.emit(
      'online count',
      io.engine.clientsCount
    );
  });

});

/* =========================
   START SERVER
========================= */

server.listen(
  process.env.PORT || 3000,
  () => {
    console.log('Nightlys TradeX running');
  }
);
