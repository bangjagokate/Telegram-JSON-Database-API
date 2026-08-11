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

// Middleware Keamanan & Body Parsing
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Layani File Statis Web Admin & Dokumentasi
app.use(express.static(path.join(__dirname, '../public')));

// Inisialisasi Telegram Bot
let bot = null;
try {
  bot = initBot();
} catch (botErr) {
  console.error('[Telegram Bot Warning] Gagal menginisialisasi bot:', botErr.message);
  console.warn('[Telegram Bot Warning] Server tetap berjalan dalam mode REST API Lokal.');
}

// Jalankan Pemulihan Database Otomatis
runStartupRecovery(bot)
  .then(() => {
    console.log('[Recovery System] Inisialisasi sistem pemulihan selesai.');
  })
  .catch((recErr) => {
    console.error('[Recovery System Error] Gagal menjalankan pemulihan awal:', recErr.message);
  });

// Endpoint Public Health Check (Digunakan PieHost untuk verifikasi status app)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    telegram: !!bot,
    storage: true,
    database: true,
    uptime: Math.floor(process.uptime())
  });
});

// Import Router API
const dbRoutes = require('./api/database')(bot);
const recordRoutes = require('./api/records')(bot);

// Pasang Auth & Rate Limit pada Endpoint /api
app.use('/api', apiLimiter, apiKeyAuth, dbRoutes);
app.use('/api', apiLimiter, apiKeyAuth, recordRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err.stack || err.message);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// Jalankan Server
app.listen(PORT, () => {
  console.log(`==========================================`);
  console.log(`🚀 Telegram JSON Database API is running`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`📑 API Docs: http://localhost:${PORT}/docs.html`);
  console.log(`🖥️ Admin Panel: http://localhost:${PORT}/admin.html`);
  console.log(`==========================================`);
});
