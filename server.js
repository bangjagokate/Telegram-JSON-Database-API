require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { Telegraf, Markup } = require('telegraf');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const API_KEYS_FILE = path.join(DATA_DIR, '_api_keys.json');
const BASE_URL = 'https://databasetele.pie.host';

// ==========================================
// 1. HELPER STORAGE & API KEY MANAGEMENT
// ==========================================
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      await fs.access(API_KEYS_FILE);
    } catch (e) {
      const defaultKey = process.env.API_KEY || 'Jd8Kp2xQ9mV7sL4nR6tY3wA8zC5eF1uH';
      const initialKeys = { [defaultKey]: { app_name: 'Master Key Admin', created_at: new Date().toISOString() } };
      await fs.writeFile(API_KEYS_FILE, JSON.stringify(initialKeys, null, 2), 'utf8');
    }
  } catch (err) {}
}

async function getValidApiKeys() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(API_KEYS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

async function saveApiKey(key, appName) {
  const keys = await getValidApiKeys();
  keys[key] = { app_name: appName, created_at: new Date().toISOString() };
  await fs.writeFile(API_KEYS_FILE, JSON.stringify(keys, null, 2), 'utf8');
}

async function deleteApiKey(key) {
  const keys = await getValidApiKeys();
  if (keys[key]) {
    delete keys[key];
    await fs.writeFile(API_KEYS_FILE, JSON.stringify(keys, null, 2), 'utf8');
    return true;
  }
  return false;
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
  return files.filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => f.replace('.json', ''));
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

async function sendBackupToTelegramGroup(dbName) {
  if (!bot) return;
  const groupId = process.env.GROUP_ID;
  if (!groupId) return;

  const filePath = getFilePath(dbName);
  const content = await fs.readFile(filePath, 'utf8');
  const buffer = Buffer.from(content, 'utf8');

  const caption = `📦 *BACKUP DATABASE JSON*\n📄 Database: \`${dbName}\`\n🕒 Waktu: ${new Date().toLocaleString('id-ID')}`;
  
  await bot.telegram.sendDocument(groupId, {
    source: buffer,
    filename: `database_${dbName}.json`
  }, { caption, parse_mode: 'Markdown' });
}

// ==========================================
// 2. EXPRESS APP & AUTH
// ==========================================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', telegram: !!bot, uptime: Math.floor(process.uptime()) }));

async function apiKeyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Format Authorization harus: Bearer API_KEY' });
  }

  const clientKey = authHeader.split(' ')[1];
  const validKeys = await getValidApiKeys();

  if (!validKeys[clientKey]) {
    return res.status(403).json({ success: false, error: 'API Key tidak valid atau telah dicabut' });
  }

  req.appName = validKeys[clientKey].app_name;
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
    sendBackupToTelegramGroup(req.params.name).catch(() => {});
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/db/:name/records', apiKeyAuth, async (req, res) => {
  try {
    const db = await getDatabase(req.params.name);
    res.json({ success: true, total: db.data.length, data: db.data });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
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

    sendBackupToTelegramGroup(req.params.name).catch(() => {});
    res.status(201).json({ success: true, data: newRecord });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==========================================
// 4. BOT TELEGRAM WITH MENU BUTTONS
// ==========================================
let bot = null;
if (process.env.BOT_TOKEN) {
  try {
    bot = new Telegraf(process.env.BOT_TOKEN);

    const adminMiddleware = (ctx, next) => {
      const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
      const userId = ctx.from?.id?.toString();
      if (!adminIds.includes(userId)) {
        return ctx.reply('⛔ Akses Ditolak! Khusus Admin.');
      }
      return next();
    };

    // FUNGSI PANDUAN DENGAN TOMBOL MENU
    const sendMainMenu = (ctx) => {
      ctx.reply(
        '🤖 *PANEL UTAMA TELEGRAM JSON DB*\n\n' +
        'Silakan klik tombol di bawah atau ketik perintah manual jika diperlukan:',
        {
          parse_mode: 'Markdown',
          ...Markup.keyboard([
            ['🔑 Buat API Key', '📜 Lihat Semua API Key'],
            ['➕ Buat DB Baru', '📂 Daftar Database'],
            ['📖 Panduan & Endpoint URL']
          ]).resize()
        }
      );
    };

    bot.start(adminMiddleware, (ctx) => sendMainMenu(ctx));
    bot.hears('📖 Panduan & Endpoint URL', adminMiddleware, (ctx) => sendMainMenu(ctx));

    // TOMBOL: BUAT API KEY
    bot.hears('🔑 Buat API Key', adminMiddleware, (ctx) => {
      ctx.reply('⚠️ Silakan ketik perintah pembuatannya beserta nama aplikasinya:\n\n*Contoh:*\n`/makeapi Aplikasi Listrik`\natau\n`/makeapi Aplikasi Laundry`', { parse_mode: 'Markdown' });
    });

    // COMMAND MAKEAPI DENGAN TEMPLATE FORMAT LENGKAP
    bot.command('makeapi', adminMiddleware, async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      const appName = args.join(' ');
      if (!appName) return ctx.reply('⚠️ Masukkan nama aplikasi. Contoh: `/makeapi Aplikasi Listrik`', { parse_mode: 'Markdown' });

      const newKey = `key_${crypto.randomBytes(12).toString('hex')}`;
      await saveApiKey(newKey, appName);

      const dbExample = appName.toLowerCase().replace(/[^a-z0-9]/g, '');

      ctx.reply(
        `✅ *API KEY BERHASIL DIBUAT!*\n\n` +
        `📱 *Nama Aplikasi:* ${appName}\n` +
        `🔑 *API Key:* \`${newKey}\`\n\n` +
        `----------------------------------------\n` +
        `📋 *HEADER AUTHENTICATION (WAJIB):*\n` +
        `• Key: \`Authorization\`\n` +
        `• Value: \`Bearer ${newKey}\`\n\n` +
        `----------------------------------------\n` +
        `🌐 *DAFTAR URL ENDPOINT API:*\n\n` +
        `1️⃣ *Ambil Semua Daftar Database:*\n` +
        `\`GET ${BASE_URL}/api/databases\`\n\n` +
        `2️⃣ *Ambil Semua Record Data (Load Data):*\n` +
        `\`GET ${BASE_URL}/api/db/${dbExample}/records\`\n\n` +
        `3️⃣ *Tambah Record Baru (Kirim Data/Pesan):*\n` +
        `\`POST ${BASE_URL}/api/db/${dbExample}/records\`\n\n` +
        `4️⃣ *Buat Database Baru via API:*\n` +
        `\`POST ${BASE_URL}/api/db/${dbExample}\``,
        { parse_mode: 'Markdown' }
      );
    });

    // TOMBOL: LIST ALL API
    bot.hears('📜 Lihat Semua API Key', adminMiddleware, async (ctx) => {
      const keys = await getValidApiKeys();
      const list = Object.entries(keys).map(([k, v]) => `📱 *${v.app_name}*:\n  • Key: \`${k}\`\n  • Header: \`Bearer ${k}\``).join('\n\n');
      ctx.reply(`🔑 *DAFTAR API KEY AKTIF:*\n\n${list || 'Belum ada API Key.'}\n\n*Cara Hapus Key:* \`/revokeapi <key>\``, { parse_mode: 'Markdown' });
    });

    // TOMBOL: DAFTAR DATABASE
    bot.hears('📂 Daftar Database', adminMiddleware, async (ctx) => {
      const dbs = await listDatabases();
      ctx.reply(`📂 *Total Database:* ${dbs.length}\n\n` + dbs.map(d => `• \`${d}\` (URL: \`${BASE_URL}/api/db/${d}/records\`)`).join('\n\n'), { parse_mode: 'Markdown' });
    });

    // TOMBOL: BUAT DB BARU
    bot.hears('➕ Buat DB Baru', adminMiddleware, (ctx) => {
      ctx.reply('⚠️ Ketik perintah ini beserta nama database baru yang mau dibuat:\n\n*Contoh:*\n`/createdb listrik`', { parse_mode: 'Markdown' });
    });

    bot.command('createdb', adminMiddleware, async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      const name = args[0];
      if (!name) return ctx.reply('⚠️ Masukkan nama DB. Contoh: `/createdb listrik`', { parse_mode: 'Markdown' });
      try {
        await createDatabase(name);
        await sendBackupToTelegramGroup(name);
        ctx.reply(
          `✅ Database \`${name}\` Berhasil Dibuat!\n\n` +
          `🌐 *URL Endpoint Data:*\n\`${BASE_URL}/api/db/${name}/records\``,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        ctx.reply(`❌ Error: ${err.message}`);
      }
    });

    bot.command('get', adminMiddleware, async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      const name = args[0];
      if (!name) return ctx.reply('⚠️ Masukkan nama DB. Contoh: `/get listrik`', { parse_mode: 'Markdown' });
      try {
        const db = await getDatabase(name);
        ctx.reply(`📄 *Data ${name}:*\n\`\`\`json\n${JSON.stringify(db, null, 2)}\n\`\`\``, { parse_mode: 'Markdown' });
      } catch (err) {
        ctx.reply(`❌ Error: ${err.message}`);
      }
    });

    bot.command('backup', adminMiddleware, async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      const name = args[0];
      if (!name) return ctx.reply('⚠️ Masukkan nama DB. Contoh: `/backup listrik`', { parse_mode: 'Markdown' });
      try {
        await sendBackupToTelegramGroup(name);
        ctx.reply(`📦 File backup \`${name}\` berhasil dikirim ke Grup Telegram!`, { parse_mode: 'Markdown' });
      } catch (err) {
        ctx.reply(`❌ Gagal backup: ${err.message}`);
      }
    });

    bot.command('revokeapi', adminMiddleware, async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      const keyToRevoke = args[0];
      if (!keyToRevoke) return ctx.reply('⚠️ Masukkan API Key yang mau dihapus. Contoh: `/revokeapi key_xxxx`', { parse_mode: 'Markdown' });

      const deleted = await deleteApiKey(keyToRevoke);
      if (deleted) {
        ctx.reply(`🗑️ API Key \`${keyToRevoke}\` berhasil dihapus.`, { parse_mode: 'Markdown' });
      } else {
        ctx.reply(`❌ API Key tidak ditemukan.`);
      }
    });

    bot.launch().catch(err => console.error('[Bot Launch Error]', err.message));
  } catch (err) {
    console.error('[Bot Init Error]', err.message);
  }
}

// ==========================================
// 5. SERVER RUNNER
// ==========================================
process.on('uncaughtException', (err) => console.error('[Uncaught Exception]', err.message));
process.on('unhandledRejection', (reason) => console.error('[Unhandled Rejection]', reason));

ensureDataDir().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`🚀 Server running on http://${HOST}:${PORT}`);
  });
});
