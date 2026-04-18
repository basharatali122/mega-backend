
// require('dotenv').config();
// const express    = require('express');
// const http       = require('http');
// const { Server } = require('socket.io');
// const cors       = require('cors');
// const helmet     = require('helmet');
// const rateLimit  = require('express-rate-limit');
// const path       = require('path');
// const fs         = require('fs');

// const { verifyToken, verifyFirebaseToken } = require('./middleware/auth');
// const accountRoutes    = require('./routes/accounts');
// const processingRoutes = require('./routes/processing');
// const { proxyRouter, statsRouter } = require('./routes/other');
// const BotManager       = require('./botManager');

// const app    = express();
// const server = http.createServer(app);

// // ── CORS Configuration ────────────────────────────────────────────────
// // Support multiple origins from environment variable or fallback to localhost
// const allowedOrigins = process.env.ALLOWED_ORIGINS 
//   ? process.env.ALLOWED_ORIGINS.split(',')
//   : [process.env.FRONTEND_URL || 'http://localhost:5173'];

// console.log('✅ CORS allowed origins:', allowedOrigins);
// console.log('🌍 FRONTEND_URL:', process.env.FRONTEND_URL || 'not set');
// console.log('📋 ALLOWED_ORIGINS:', process.env.ALLOWED_ORIGINS || 'not set (using FRONTEND_URL)');

// const io = new Server(server, {
//   cors: {
//     origin: function(origin, callback) {
//       // Allow requests with no origin (like mobile apps, curl, Postman)
//       if (!origin) return callback(null, true);
      
//       if (allowedOrigins.includes(origin)) {
//         callback(null, true);
//       } else {
//         console.log(`❌ Socket.IO CORS blocked origin: ${origin}`);
//         callback(new Error('CORS not allowed for this origin'));
//       }
//     },
//     methods: ['GET', 'POST'],
//     credentials: true,
//   },
//   pingInterval: 25000,
//   pingTimeout: 60000,
// });

// // ── Data directory ─────────────────────────────────────────────────────────────
// const dataDir = process.env.DATA_DIR || './data';
// if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// // ── Middleware ─────────────────────────────────────────────────────────────────
// app.use(helmet({ contentSecurityPolicy: false }));
// app.use(cors({ 
//   origin: function(origin, callback) {
//     // Allow requests with no origin (like mobile apps, curl, Postman)
//     if (!origin) return callback(null, true);
    
//     if (allowedOrigins.includes(origin)) {
//       callback(null, true);
//     } else {
//       console.log(`❌ Express CORS blocked origin: ${origin}`);
//       callback(new Error('CORS not allowed for this origin'));
//     }
//   },
//   credentials: true 
// }));
// app.use(express.json({ limit: '10mb' }));

// const defaultLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true });
// const authLimiter    = rateLimit({ windowMs: 60 * 1000, max: 30 });
// app.use('/api/', defaultLimiter);

// // ── Bot Manager ────────────────────────────────────────────────────────────────
// const botManager = new BotManager(io);
// app.set('botManager', botManager);

// // ── Routes ─────────────────────────────────────────────────────────────────────
// app.use('/api/accounts',   verifyToken, accountRoutes);
// app.use('/api/processing', verifyToken, processingRoutes);
// app.use('/api/proxy',      verifyToken, proxyRouter);
// app.use('/api/stats',      verifyToken, statsRouter);

// app.get('/health', (req, res) => {
//   const stats = botManager.getServerStats();
//   res.json({ status: 'ok', uptime: process.uptime(), ...stats, corsOrigins: allowedOrigins });
// });

// // ── Socket Auth ────────────────────────────────────────────────────────────────
// io.use(async (socket, next) => {
//   try {
//     const token = socket.handshake.auth.token;
//     if (!token) return next(new Error('No token'));
//     const decoded = await verifyFirebaseToken(token);
//     socket.userId    = decoded.uid;
//     socket.userEmail = decoded.email;
//     socket.tabId     = socket.handshake.query.tabId || 'unknown';
//     next();
//   } catch { next(new Error('Unauthorized')); }
// });

// io.on('connection', (socket) => {
//   console.log(`🔌 ${socket.userEmail} [tab:${socket.tabId}] connected [${socket.id}]`);

//   let currentProfileRoom = null;

//   socket.on('subscribe:profile', (profileName) => {
//     if (currentProfileRoom && currentProfileRoom !== profileName) {
//       socket.leave(currentProfileRoom);
//     }
//     const room = `profile:${socket.userId}:${profileName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
//     socket.join(room);
//     currentProfileRoom = room;
//     console.log(`📡 ${socket.userEmail} subscribed to ${profileName}`);
//   });

//   socket.on('unsubscribe:profile', () => {
//     if (currentProfileRoom) {
//       socket.leave(currentProfileRoom);
//       currentProfileRoom = null;
//     }
//   });

//   socket.on('disconnect', (reason) => {
//     console.log(`🔌 ${socket.userEmail} disconnected: ${reason}`);
//   });
// });

// // ── Start ──────────────────────────────────────────────────────────────────────
// const PORT = process.env.PORT || 3001;
// server.listen(PORT, () => {
//   console.log(`\n🔥 FireKirin Web Backend running on :${PORT}`);
//   console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
//   console.log(`🔒 CORS enabled for: ${allowedOrigins.join(', ')}`);
//   console.log(`📁 Data dir: ${path.resolve(dataDir)}\n`);
// });

// // ── Graceful shutdown ──────────────────────────────────────────────────────────
// process.on('SIGTERM', async () => {
//   console.log('SIGTERM received — shutting down...');
//   await botManager.shutdownAll();
//   server.close(() => process.exit(0));
// });
// process.on('SIGINT', async () => {
//   await botManager.shutdownAll();
//   server.close(() => process.exit(0));
// });




require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const fs         = require('fs');

const { verifyToken, verifyFirebaseToken } = require('./middleware/auth');
const accountRoutes    = require('./routes/accounts');
const processingRoutes = require('./routes/processing');
const { proxyRouter, statsRouter } = require('./routes/other');
const BotManager       = require('./botManager');

const app    = express();
const server = http.createServer(app);

// ── Trust Render's reverse proxy ───────────────────────────────────────────────
// CRITICAL FIX: Without this, ALL users share one rate-limit bucket because
// Express sees Render's internal proxy IP instead of each user's real IP.
app.set('trust proxy', 1);

// ── CORS Configuration ─────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : [process.env.FRONTEND_URL || 'http://localhost:5173'];

console.log('✅ CORS allowed origins:', allowedOrigins);
console.log('🌍 FRONTEND_URL:', process.env.FRONTEND_URL || 'not set');
console.log('📋 ALLOWED_ORIGINS:', process.env.ALLOWED_ORIGINS || 'not set (using FRONTEND_URL)');

const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log(`❌ Socket.IO CORS blocked origin: ${origin}`);
        callback(new Error('CORS not allowed for this origin'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // ── WebSocket tuning for 200+ concurrent users ─────────────────────────────
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 1e6,    // 1MB max payload — prevents memory abuse
  transports: ['websocket'], // FIX: WebSocket only — skip long-polling fallback.
                             // Polling creates 2-3x more HTTP requests under load
                             // and eats into your rate limit quota very quickly.
});

// ── Data directory ─────────────────────────────────────────────────────────────
const dataDir = process.env.DATA_DIR || './data';
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`❌ Express CORS blocked origin: ${origin}`);
      callback(new Error('CORS not allowed for this origin'));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ── Rate Limiting ──────────────────────────────────────────────────────────────
// ROOT CAUSE OF YOUR BUG:
// The old limiter had no keyGenerator, so express-rate-limit used req.ip.
// On Render, req.ip = Render's internal proxy IP for ALL users.
// Result: all 200 users shared one bucket and hit 1000 req/15min together.
//
// FIX: Extract the Firebase UID from the JWT token and use that as the key.
// Each logged-in user now gets their own independent rate limit bucket.
// We decode the JWT payload (no signature verify — just reading the key).
function extractUidFromToken(req) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return req.ip;
    const token = authHeader.slice(7);
    const parts  = token.split('.');
    if (parts.length < 2) return req.ip;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return payload.user_id || payload.sub || payload.uid || req.ip;
  } catch {
    return req.ip;
  }
}

// General API limiter — 2000 requests per 15 min per user
// 200 concurrent users doing account add/fetch = well within this
const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractUidFromToken,
  skip: (req) => req.path === '/health',
  handler: (req, res) => {
    console.warn(`⚠️  Rate limit hit — user: ${extractUidFromToken(req)}`);
    res.status(429).json({ error: 'Too many requests, please try again later.' });
  },
});

// Strict limiter for sensitive routes
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractUidFromToken,
});

app.use('/api/', defaultLimiter);

// ── Bot Manager ────────────────────────────────────────────────────────────────
const botManager = new BotManager(io);
app.set('botManager', botManager);

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/accounts',   verifyToken, accountRoutes);
app.use('/api/processing', verifyToken, processingRoutes);
app.use('/api/proxy',      verifyToken, proxyRouter);
app.use('/api/stats',      verifyToken, statsRouter);

app.get('/health', (req, res) => {
  const stats = botManager.getServerStats();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage(),   // monitor this in Render dashboard
    ...stats,
    corsOrigins: allowedOrigins,
  });
});

// ── Socket Auth ────────────────────────────────────────────────────────────────
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('No token'));
    const decoded = await verifyFirebaseToken(token);
    socket.userId    = decoded.uid;
    socket.userEmail = decoded.email;
    socket.tabId     = socket.handshake.query.tabId || 'unknown';
    next();
  } catch { next(new Error('Unauthorized')); }
});

io.on('connection', (socket) => {
  console.log(`🔌 ${socket.userEmail} [tab:${socket.tabId}] connected [${socket.id}]`);

  let currentProfileRoom = null;

  socket.on('subscribe:profile', (profileName) => {
    if (currentProfileRoom && currentProfileRoom !== profileName) {
      socket.leave(currentProfileRoom);
    }
    const room = `profile:${socket.userId}:${profileName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    socket.join(room);
    currentProfileRoom = room;
    console.log(`📡 ${socket.userEmail} subscribed to ${profileName}`);
  });

  socket.on('unsubscribe:profile', () => {
    if (currentProfileRoom) {
      socket.leave(currentProfileRoom);
      currentProfileRoom = null;
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`🔌 ${socket.userEmail} disconnected: ${reason}`);
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🔥 FireKirin Web Backend running on :${PORT}`);
  console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  console.log(`🔒 CORS enabled for: ${allowedOrigins.join(', ')}`);
  console.log(`📁 Data dir: ${path.resolve(dataDir)}`);
  console.log(`👥 Rate limiting: per Firebase UID (200+ concurrent users supported)\n`);
});

// ── Graceful shutdown ──────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('SIGTERM received — shutting down...');
  await botManager.shutdownAll();
  server.close(() => process.exit(0));
});
process.on('SIGINT', async () => {
  await botManager.shutdownAll();
  server.close(() => process.exit(0));
});