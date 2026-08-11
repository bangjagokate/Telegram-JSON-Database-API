require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { Telegraf } = require('telegraf');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');

// ==========================================
// 1. STORAGE & HELPER FUNCTIONS
// ==========================================
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {}
}

function generateRecordId(prefix = 'rec') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function getFilePath(dbName) {
  const clean = dbName.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
  if (!clean) throw new Error('Nama database tidak valid.');
  return path.join(DATA_DIR, `${clean}.json`);
}

async function listDatabases() {
  await ensureDataDir();
  const files = await fs.readdir(DATA_DIR);
  return files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
}

async function getDatabase(dbName) {
  await ensureDataDir();
  const filePath = getFilePath(dbName);
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function createDatabase(dbName, initialData = []) {
  await ensureDataDir();
  const filePath = getFilePath(dbName);
  try {
    await fs.access(filePath);
    throw new Error(`Database '${dbName}' sudah ada.`);
  } catch (e) {
    if (e.message.includes('sudah ada')) throw e;
  }

  const payload = {
    _meta: { database: dbName, version: 1, created_at: new Date().toISOString() },
    data: Array.isArray(initialData) ? initialData : []
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

// ==========================================
// 2. MIDDLEWARE & EXPRESS SETUP
// ==========================================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Public Root & Health Endpoint
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', telegram: !!bot, uptime: Math.floor(process.uptime()) });
});

// Authentication Middleware
function apiKeyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const configuredKey = process.env.API_KEY;

  if (!configuredKey) return next(); // Abaikan jika API_KEY belum diset agar server tak crash
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Format Authorization harus: Bearer API_KEY' });
  }
  if (authHeader.split(' ')[1] !== configuredKey) {
    return res.status(403).json({ success: false, error: 'API Key Salah' });
  }
  next();
}

// ==========================================
// 3. REST API ENDPOINTS
// ==========================================
app.get('/api/databases', apiKeyAuth, async (req, res) => {
  try {
    const databases = await listDatabases();
    res.json({ success: true, databases });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/:name', apiKeyAuth, async (req, res) => {
  try {
    const data = await getDatabase(req.params.name);
    res.json({ success: true, data });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

app.post('/api/db/:name', apiKeyAuth, async (req, res) => {
  try {
    const data = await createDatabase(req.params.name, req.body.data || []);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/db/:name/records', apiKeyAuth, async (req, res) => {
  try {
    const db = await getDatabase(req.params.name);
    const newRecord = {
      id: generateRecordId(req.params.name.substring(0, 3)),
      ...req.body,
      created_at: new Date().toISOString()
    };
    db.data.push(newRecord);
    await fs.writeFile(getFilePath(req.params.name), JSON.stringify(db, null, 2), 'utf8');
    res.status(201).json({ success: true, data: newRecord });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==========================================
// 4. SAFE TELEGRAM BOT INIT
// ==========================================
let bot = null;
if (process.env.BOT_TOKEN) {
  try {
    bot = new Telegraf(process.env.BOT_TOKEN);
    bot.start((ctx) => ctx.reply('🤖 Telegram JSON Database Bot Aktif!'));
    bot.command('database', async (ctx) => {
      const dbs = await listDatabases();
      ctx.reply(`📂 Total Database: ${dbs.length}\n` + dbs.map(d => `- ${d}`).join('\n'));
    });
    bot.launch().catch(err => console.error('[Bot Launch Warning]', err.message));
  } catch (err) {
    console.error('[Bot Init Error]', err.message);
  }
}

// ==========================================
// 5. SERVER BOOTSTRAP
// ==========================================
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

ensureDataDir().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`🚀 Server berjalan sempurna di http://${HOST}:${PORT}`);
  });
});
