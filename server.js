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
const MSG_TRACKER_FILE = path.join(DATA_DIR, '_msg_tracker.json');
const BASE_URL = 'https://databasetele.pie.host';

// ==========================================
// 1. HELPER STORAGE & FILESYSTEM
// ==========================================
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      await fs.access(API_KEYS_FILE);
    } catch (e) {
      await fs.writeFile(API_KEYS_FILE, JSON.stringify({}, null, 2), 'utf8');
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

async function getMsgTracker() {
  try {
    const raw = await fs.readFile(MSG_TRACKER_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

async function saveMsgTracker(dbName, messageId) {
  const tracker = await getMsgTracker();
  tracker[dbName] = messageId;
  await fs.writeFile(MSG_TRACKER_FILE, JSON.stringify(tracker, null, 2), 'utf8');
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

async function createDatabase(dbName, initialObj = {}) {
  await ensureDataDir();
  const filePath = getFilePath(dbName);
  try {
    await fs.access(filePath);
    return await getDatabase(dbName);
  } catch (e) {}

  const payload = {
    _meta: { database: dbName, version: 1, created_at: new Date().toISOString() },
    users: {},
    chats: {},
    rooms: {},
    ...initialObj
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function deleteDatabaseFile(dbName) {
  await ensureDataDir();
  const filePath = getFilePath(dbName);
  try {
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    return false;
  }
}

// ==========================================
// 2. BACKUP ENGINE
// ==========================================
async function sendBackupToTelegramGroup(dbName) {
  if (!bot) return;
  const groupId = process.env.GROUP_ID;
  if (!groupId) return;

  try {
    const filePath = getFilePath(dbName);
    const content = await fs.readFile(filePath, 'utf8');
    const buffer = Buffer.from(content, 'utf8');
    const tracker = await getMsgTracker();

    if (tracker[dbName]) {
      try {
        await bot.telegram.deleteMessage(groupId, tracker[dbName]);
      } catch (delErr) {}
    }

    const caption = `📦 *FIREBASE-STYLE AUTO-BACKUP*\n📄 Database: \`${dbName}\`\n🕒 Update: ${new Date().toLocaleString('id-ID')}`;
    
    const sentMsg = await bot.telegram.sendDocument(groupId, {
      source: buffer,
      filename: `${dbName}.json`
    }, { caption, parse_mode: 'Markdown' });

    if (sentMsg && sentMsg.message_id) {
      await saveMsgTracker(dbName, sentMsg.message_id);
    }
  } catch (err) {
    console.error(`[Backup Error ${dbName}]`, err.message);
  }
}

// ==========================================
// 3. EXPRESS APP & MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

async function apiKeyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authorization harus format: Bearer API_KEY' });
  }

  const clientKey = authHeader.split(' ')[1];
  const validKeys = await getValidApiKeys();

  if (!validKeys[clientKey]) {
    return res.status(403).json({ success: false, error: 'API Key Tidak Valid!' });
  }

  req.appName = validKeys[clientKey].app_name;
  next();
}

// ==========================================
// 4. WEB DASHBOARD CONSOLE (SAFE STRING)
// ==========================================
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Firebase-Style Realtime Database Console</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    body { background: #f8f9fa; color: #202124; display: flex; height: 100vh; overflow: hidden; }
    .sidebar { width: 260px; background: #fff; border-right: 1px solid #dadce0; display: flex; flex-direction: column; }
    .sidebar-header { padding: 18px; border-bottom: 1px solid #dadce0; font-weight: bold; font-size: 16px; color: #1a73e8; }
    .db-list { flex: 1; overflow-y: auto; padding: 10px; }
    .db-item { padding: 10px 14px; border-radius: 6px; cursor: pointer; font-size: 14px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; }
    .db-item:hover { background: #f1f3f4; }
    .db-item.active { background: #e8f0fe; color: #1a73e8; font-weight: bold; }
    .main { flex: 1; display: flex; flex-direction: column; background: #f8f9fa; }
    .topbar { background: #fff; border-bottom: 1px solid #dadce0; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; }
    .topbar h2 { font-size: 18px; font-weight: 600; }
    .console-content { flex: 1; padding: 24px; overflow-y: auto; }
    .node-card { background: #fff; border: 1px solid #dadce0; border-radius: 8px; padding: 16px; font-family: monospace; font-size: 13px; line-height: 1.6; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .tree-row { margin-left: 20px; border-left: 2px solid #e8eaed; padding-left: 10px; position: relative; margin-top: 4px; }
    .key-name { color: #d93025; font-weight: bold; }
    .val-str { color: #188038; }
    .val-num { color: #1a73e8; }
    .btn-action { background: none; border: none; font-size: 12px; cursor: pointer; margin-left: 8px; padding: 2px 6px; border-radius: 4px; }
    .btn-action:hover { background: #eee; }
    .btn-del { color: #d93025; }
    .btn-add { color: #1a73e8; }
    .key-input-bar { background: #fff; border-bottom: 1px solid #dadce0; padding: 12px 24px; display: flex; gap: 10px; align-items: center; }
    .key-input-bar input { padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; outline: none; }
    .key-input-bar button { padding: 8px 16px; background: #1a73e8; color: #fff; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="sidebar-header">🔥 JSON Database Console</div>
    <div class="db-list" id="dbList">
      <div style="padding: 10px; font-size: 12px; color: #666;">Masukkan API Key & Tekan Enter</div>
    </div>
  </div>

  <div class="main">
    <div class="topbar">
      <h2 id="activeDbTitle">Pilih Database</h2>
      <div style="font-size: 12px; color: #555;">Dashboard Management</div>
    </div>

    <div class="key-input-bar">
      <input type="text" id="adminKey" placeholder="API Key..." style="width: 220px;" onchange="loadDbList()">
      <input type="text" id="nodePath" placeholder="Node Path (misal: users/user001)" style="flex:1;">
      <input type="text" id="nodeValue" placeholder='Value JSON' style="flex:1;">
      <button onclick="setNodeValue()">SET / UPDATE NODE</button>
    </div>

    <div class="console-content">
      <div class="node-card" id="treeView">
        <div style="color: #666;">Silakan isi API Key di kotak atas lalu pilih database di kiri.</div>
      </div>
    </div>
  </div>

<script>
  let activeDb = '';

  async function loadDbList() {
    const key = document.getElementById('adminKey').value.trim();
    if (!key) return;

    try {
      const res = await fetch('/api/databases', {
        headers: { 'Authorization': 'Bearer ' + key }
      });
      const json = await res.json();

      if (json.success) {
        const dbList = document.getElementById('dbList');
        dbList.innerHTML = '';
        json.databases.forEach(db => {
          const div = document.createElement('div');
          div.className = 'db-item ' + (db === activeDb ? 'active' : '');
          div.innerHTML = '📂 ' + db;
          div.onclick = function() { selectDb(db); };
          dbList.appendChild(div);
        });
      } else {
        alert('API Key Salah!');
      }
    } catch(err) {
      console.error(err);
    }
  }

  async function selectDb(dbName) {
    activeDb = dbName;
    document.getElementById('activeDbTitle').textContent = '🔥 Database: ' + dbName;
    loadDbTree();
    loadDbList();
  }

  async function loadDbTree() {
    if (!activeDb) return;
    const key = document.getElementById('adminKey').value.trim();

    try {
      const res = await fetch('/api/db/' + activeDb, {
        headers: { 'Authorization': 'Bearer ' + key }
      });
      const json = await res.json();

      if (json.success) {
        const treeView = document.getElementById('treeView');
        treeView.innerHTML = '<div style="font-weight:bold; color:#1a73e8; margin-bottom:10px;">root (' + activeDb + ')</div>' + renderTree(json.data, '');
      }
    } catch(err) {
      console.error(err);
    }
  }

  function renderTree(obj, currentPath) {
    if (typeof obj !== 'object' || obj === null) {
      const valClass = typeof obj === 'string' ? 'val-str' : 'val-num';
      return '<span class="' + valClass + '">"' + obj + '"</span>';
    }

    let html = '';
    for (let key in obj) {
      const path = currentPath ? currentPath + '/' + key : key;
      const val = obj[key];
      const isObject = typeof val === 'object' && val !== null;

      html += '<div class="tree-row">';
      html += '<span class="key-name">"' + key + '"</span>: ';
      html += isObject ? '{' : '';
      html += renderTree(val, path);
      html += isObject ? '}' : '';
      html += '<button class="btn-action btn-add" onclick="quickAdd(\'' + path + '\')">+ Child</button>';
      html += '<button class="btn-action btn-del" onclick="deleteNode(\'' + path + '\')">🗑️ Hapus</button>';
      html += '</div>';
    }
    return html;
  }

  async function setNodeValue() {
    const key = document.getElementById('adminKey').value.trim();
    const path = document.getElementById('nodePath').value.trim();
    const rawVal = document.getElementById('nodeValue').value.trim();

    if (!activeDb || !path || !key) return alert('Lengkapi DB, API Key, dan Node Path!');

    let parsedValue = rawVal;
    try { parsedValue = JSON.parse(rawVal); } catch(e) {}

    try {
      const res = await fetch('/api/db/' + activeDb + '/' + path, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ value: parsedValue })
      });
      const json = await res.json();
      if (json.success) {
        loadDbTree();
      } else {
        alert('Gagal set node: ' + json.error);
      }
    } catch(err) {
      alert('Error koneksi!');
    }
  }

  function quickAdd(parentPath) {
    const keyName = prompt('Masukkan Key Baru di bawah "' + parentPath + '":');
    if (!keyName) return;
    const val = prompt('Masukkan Value (String/JSON):');
    
    document.getElementById('nodePath').value = parentPath + '/' + keyName;
    document.getElementById('nodeValue').value = val || '""';
    setNodeValue();
  }

  async function deleteNode(path) {
    if (!confirm('Yakin mau hapus node "' + path + '"?')) return;
    const key = document.getElementById('adminKey').value.trim();

    try {
      const res = await fetch('/api/db/' + activeDb + '/' + path, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + key }
      });
      const json = await res.json();
      if (json.success) loadDbTree();
    } catch(err) {
      alert('Gagal hapus node!');
    }
  }
</script>
</body>
</html>`);
});

// ==========================================
// 5. REST API ENDPOINTS (TREE BASED)
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
    res.status(404).json({ success: false, error: `Database '${req.params.name}' tidak ditemukan.` });
  }
});

app.get('/api/db/:name/*', apiKeyAuth, async (req, res) => {
  try {
    const db = await getDatabase(req.params.name);
    const nodePath = req.params[0].split('/').filter(Boolean);

    let current = db;
    for (const key of nodePath) {
      if (current[key] === undefined) {
        return res.status(404).json({ success: false, error: `Node '${nodePath.join('/')}' tidak ditemukan.` });
      }
      current = current[key];
    }

    res.json({ success: true, node: nodePath.join('/'), data: current });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/db/:name/*', apiKeyAuth, async (req, res) => {
  try {
    let db = await getDatabase(req.params.name);
    const nodePath = req.params[0].split('/').filter(Boolean);
    const valueToSet = req.body.value !== undefined ? req.body.value : req.body;

    let current = db;
    for (let i = 0; i < nodePath.length - 1; i++) {
      const key = nodePath[i];
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    const lastKey = nodePath[nodePath.length - 1];
    current[lastKey] = valueToSet;

    await fs.writeFile(getFilePath(req.params.name), JSON.stringify(db, null, 2), 'utf8');
    sendBackupToTelegramGroup(req.params.name).catch(() => {});

    res.json({ success: true, path: nodePath.join('/'), data: valueToSet });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/db/:name/*', apiKeyAuth, async (req, res) => {
  try {
    let db = await getDatabase(req.params.name);
    const nodePath = req.params[0].split('/').filter(Boolean);

    let current = db;
    for (let i = 0; i < nodePath.length - 1; i++) {
      const key = nodePath[i];
      if (!current[key]) return res.status(404).json({ success: false, error: 'Node tidak ditemukan' });
      current = current[key];
    }

    const lastKey = nodePath[nodePath.length - 1];
    delete current[lastKey];

    await fs.writeFile(getFilePath(req.params.name), JSON.stringify(db, null, 2), 'utf8');
    sendBackupToTelegramGroup(req.params.name).catch(() => {});

    res.json({ success: true, message: `Node '${nodePath.join('/')}' berhasil dihapus.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 6. BOT TELEGRAM WITH MENU BUTTONS
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

    const sendMainMenu = (ctx) => {
      ctx.reply(
        '🤖 *PANEL UTAMA TELEGRAM JSON DB*\n\nSilakan klik tombol di bawah:',
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

    bot.hears('🔑 Buat API Key', adminMiddleware, (ctx) => {
      ctx.reply('⚠️ Ketik perintah pembuatannya beserta nama aplikasinya:\n\n*Contoh:*\n`/makeapi chatapp`', { parse_mode: 'Markdown' });
    });

    bot.command('makeapi', adminMiddleware, async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      const rawName = args.join(' ');
      if (!rawName) return ctx.reply('⚠️ Masukkan nama aplikasi. Contoh: `/makeapi chatapp`', { parse_mode: 'Markdown' });

      const dbName = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const newKey = `key_${crypto.randomBytes(12).toString('hex')}`;

      await saveApiKey(newKey, rawName);
      await createDatabase(dbName, {});
      await sendBackupToTelegramGroup(dbName);

      ctx.reply(
        `✅ *API KEY & DATABASE BERHASIL DIBUAT!*\n\n` +
        `📱 *Nama Aplikasi:* ${rawName}\n` +
        `📂 *Database:* \`${dbName}\`\n` +
        `🔑 *API Key:* \`${newKey}\`\n\n` +
        `----------------------------------------\n` +
        `🌐 *WEB CONSOLE (FIREBASE STYLE):*\n` +
        `\`${BASE_URL}\`\n\n` +
        `----------------------------------------\n` +
        `📋 *ENDPOINT API SPESIFIK NODE:*\n` +
        `• Set User: \`POST ${BASE_URL}/api/db/${dbName}/users/user001\`\n` +
        `• Get User: \`GET ${BASE_URL}/api/db/${dbName}/users/user001\`\n` +
        `• Set Chat: \`POST ${BASE_URL}/api/db/${dbName}/chats/chat001\``,
        { parse_mode: 'Markdown' }
      );
    });

    bot.hears('📜 Lihat Semua API Key', adminMiddleware, async (ctx) => {
      const keys = await getValidApiKeys();
      const list = Object.entries(keys).map(([k, v]) => `📱 *${v.app_name}*:\n  • Key: \`${k}\`\n  • Header: \`Bearer ${k}\``).join('\n\n');
      ctx.reply(`🔑 *DAFTAR API KEY AKTIF:*\n\n${list || 'Belum ada API Key.'}\n\n*Cara Hapus Key:* \`/revokeapi <key>\``, { parse_mode: 'Markdown' });
    });

    bot.hears('📂 Daftar Database', adminMiddleware, async (ctx) => {
      const dbs = await listDatabases();
      ctx.reply(
        `📂 *Total Database:* ${dbs.length}\n\n` + 
        dbs.map(d => `• \`${d}\` (Backup: \`/backup ${d}\` | Hapus: \`/deletedb ${d}\`)`).join('\n\n'), 
        { parse_mode: 'Markdown' }
      );
    });

    bot.hears('➕ Buat DB Baru', adminMiddleware, (ctx) => {
      ctx.reply('⚠️ Ketik perintah ini beserta nama database baru:\n\n*Contoh:*\n`/createdb laundry`', { parse_mode: 'Markdown' });
    });

    bot.command('createdb', adminMiddleware, async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      const name = args[0];
      if (!name) return ctx.reply('⚠️ Masukkan nama DB. Contoh: `/createdb laundry`', { parse_mode: 'Markdown' });
      try {
        await createDatabase(name);
        await sendBackupToTelegramGroup(name);
        ctx.reply(
          `✅ Database \`${name}\` Berhasil Dibuat!\n\n` +
          `🌐 *URL Console:*\n\`${BASE_URL}\``,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        ctx.reply(`❌ Error: ${err.message}`);
      }
    });

    bot.command('deletedb', adminMiddleware, async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      const name = args[0];
      if (!name) return ctx.reply('⚠️ Masukkan nama DB yang ingin dihapus. Contoh: `/deletedb test`', { parse_mode: 'Markdown' });
      
      const deleted = await deleteDatabaseFile(name);
      if (deleted) {
        ctx.reply(`🗑️ Database \`${name}\` berhasil dihapus permanen!`, { parse_mode: 'Markdown' });
      } else {
        ctx.reply(`❌ Database \`${name}\` tidak ditemukan.`, { parse_mode: 'Markdown' });
      }
    });

    bot.command('backup', adminMiddleware, async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      const name = args[0];
      if (!name) return ctx.reply('⚠️ Masukkan nama DB. Contoh: `/backup chatapp`', { parse_mode: 'Markdown' });
      try {
        await sendBackupToTelegramGroup(name);
        ctx.reply(`📦 File backup \`${name}\` di Grup Telegram telah diperbarui!`, { parse_mode: 'Markdown' });
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
// 7. SERVER RUNNER
// ==========================================
process.on('uncaughtException', (err) => console.error('[Uncaught Exception]', err.message));
process.on('unhandledRejection', (reason) => console.error('[Unhandled Rejection]', reason));

ensureDataDir().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`🚀 Server running on http://${HOST}:${PORT}`);
  });
});
