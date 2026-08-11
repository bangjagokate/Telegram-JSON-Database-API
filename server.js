require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initBot } = require('./telegram/bot');
const { runStartupRecovery } = require('./database/recovery');
const { apiKeyAuth } = require('./middleware/auth');
const { apiLimiter } = require('./middleware/rateLimit');

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Middleware Keamanan & Body Parsing
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Layani File Statis Web Admin & Docs
app.use(express.static(path.join(__dirname, 'public')));

// Root Endpoint -> Langsung Buka Web Admin
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    telegram: !!bot,
    storage: true,
    database: true,
    uptime: Math.floor(process.uptime())
  });
});

// Inisialisasi Telegram Bot (Non-blocking)
let bot = null;
try {
  bot = initBot();
} catch (botErr) {
  console.error('[Telegram Bot Warning]', botErr.message);
}

// Recovery System
runStartupRecovery(bot).catch((recErr) => {
  console.error('[Recovery Error]', recErr.message);
});

// Import Router API
const dbRoutes = require('./api/database')(bot);
const recordRoutes = require('./api/records')(bot);

// Pasang Auth & Rate Limiter pada /api
app.use('/api', apiLimiter, apiKeyAuth, dbRoutes);
app.use('/api', apiLimiter, apiKeyAuth, recordRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err.stack || err.message);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// Jalankan Server
app.listen(PORT, HOST, () => {
  console.log(`==========================================`);
  console.log(`🚀 Telegram JSON Database API Running`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`==========================================`);
});
