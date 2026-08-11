require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initBot } = require('./telegram/bot');
const { runStartupRecovery } = require('./database/recovery');
const { apiKeyAuth } = require('./middleware/auth');
const { apiLimiter } = require('./middleware/rateLimit');

const app = express();

// PieHost menyuntikkan PORT dinamis saat rollout. Jika tidak ada, gunakan 3000.
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.static(path.join(__dirname, '../public')));

// Root Endpoint agar Health Check PieHost / Rollout tidak 404
app.get('/', (req, res) => {
  res.status(200).send('Telegram JSON Database API is running.');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    telegram: !!bot,
    storage: true,
    database: true,
    uptime: Math.floor(process.uptime())
  });
});

let bot = null;
try {
  bot = initBot();
} catch (botErr) {
  console.error('[Telegram Bot Warning]', botErr.message);
}

runStartupRecovery(bot).catch((recErr) => {
  console.error('[Recovery Error]', recErr.message);
});

const dbRoutes = require('./api/database')(bot);
const recordRoutes = require('./api/records')(bot);

app.use('/api', apiLimiter, apiKeyAuth, dbRoutes);
app.use('/api', apiLimiter, apiKeyAuth, recordRoutes);

app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err.stack || err.message);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// Wajib bind ke HOST '0.0.0.0'
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
});
