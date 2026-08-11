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

// Security & Body Parsers
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static Files
app.use(express.static(path.join(__dirname, '../public')));

// Inisialisasi Telegram Bot & Recovery System
const bot = initBot();

runStartupRecovery(bot).then(() => {
  console.log('[Recovery System] Initialization complete.');
});

// Health Check Endpoint (Public)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    telegram: !!bot,
    storage: true,
    database: true,
    uptime: Math.floor(process.uptime())
  });
});

// Route REST API dengan Authentication & Rate Limiting
const dbRoutes = require('./api/database')(bot);
const recordRoutes = require('./api/records')(bot);

app.use('/api', apiLimiter, apiKeyAuth, dbRoutes);
app.use('/api', apiLimiter, apiKeyAuth, recordRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err.stack);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`==========================================`);
  console.log(`🚀 Telegram JSON Database API is running`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`📑 API Docs: http://localhost:${PORT}/docs.html`);
  console.log(`🖥️ Admin Panel: http://localhost:${PORT}/admin.html`);
  console.log(`==========================================`);
});
