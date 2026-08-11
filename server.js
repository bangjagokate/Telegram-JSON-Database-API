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

    const caption = `📦 *FIREBASE CONSOLE AUTO-BACKUP*\n📄 Database: \`${dbName}\`\n🕒 Update: ${new Date().toLocaleString('id-ID')}`;
    
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
    return res.status(401).json({ success: false, error: 'Format Authorization: Bearer API_KEY' });
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
// 4. FIREBASE CONSOLE WEB GUI (PAKEM MODE)
// ==========================================
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Firebase Console Manager</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #f0f2f5; color: #1c1e21; min-height: 100vh; display: flex; flex-direction: column; }
    
    .navbar { background: #039be5; color: #fff; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .navbar h1 { font-size: 18px; font-weight: 600; }
    .btn-logout { background: #d32f2f; color: #fff; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; }

    .container { flex: 1; display: flex; flex-direction: column; padding: 15px; max-width: 900px; margin: 0 auto; width: 100%; gap: 15px; }

    .login-card { background: #fff; border-radius: 8px; padding: 25px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; margin-top: 30px; }
    .input-group { margin: 12px 0; text-align: left; }
    .input-group label { display: block; font-size: 12px; font-weight: bold; color: #555; margin-bottom: 5px; }
    .input-group input { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; outline: none; }
    .btn-login { width: 100%; background: #039be5; color: #fff; border: none; padding: 12px; border-radius: 6px; font-weight: bold; cursor: pointer; margin-top: 10px; }

    .node-panel { background: #fff; border-radius: 8px; border: 1px solid #e0e0e0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); padding: 20px; font-family: monospace; font-size: 13px; line-height: 1.8; overflow-x: auto; }
    .tree-row { margin-left: 18px; border-left: 2px solid #e0e0e0; padding-left: 10px; margin-top: 4px; }
    .key-name { color: #d32f2f; font-weight: bold; }
    .val-str { color: #2e7d32; }
    .val-num { color: #1976d2; }
    
    .btn-icon { background: none; border: none; font-size: 11px; cursor: pointer; margin-left: 6px; padding: 2px 5px; border-radius: 3px; }
    .btn-icon:hover { background: #eeeeee; }
    .btn-add { color: #1976d2; }
    .btn-edit { color: #f57c00; }
    .btn-del { color: #d32f2f; }
  </style>
</head>
<body>

  <div class="navbar">
    <h1>🔥 Firebase Realtime Console</h1>
    <button class="btn-logout" id="btnLogout" style="display:none;" onclick="logout()">LOGOUT</button>
  </div>

  <div class="container">
    <!-- FORM LOGIN API KEY & DB NAME -->
    <div class="login-card" id="loginScreen">
      <h2 style="margin-bottom: 5px;">🔐 Akses Database</h2>
      <p style="font-size: 13px; color: #666; margin-bottom: 15px;">Masukkan Kunci API dan Nama Database milikmu:</p>
      
      <div class="input-group">
        <label>API KEY:</label>
        <input type="text" id="apiKeyInput" placeholder="Contoh: key_b1eaa5a75892eecc457d7d38">
      </div>

      <div class="input-group">
        <label>NAMA DATABASE:</label>
        <input type="text" id="dbNameInput" placeholder="Contoh: chatapp">
      </div>

      <button class="btn-login" onclick="loginAndConnect()">MASUK CONSOLE</button>
    </div>

    <!-- MAIN CONSOLE PANEL -->
    <div id="consoleScreen" style="display: none; flex-direction: column; gap: 15px;">
      <div class="node-panel">
        <div style="font-weight: bold; color: #039be5; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <span id="rootDbTitle">root</span>
          <button class="btn-icon btn-add" style="font-size: 13px;" onclick="addRootChild()">➕ Tambah Root Node</button>
        </div>
        <div id="treeContent">Memuat data...</div>
      </div>
    </div>
  </div>

<script>
  let activeKey = localStorage.getItem('fb_key') || '';
  let activeDb = localStorage.getItem('fb_db') || '';

  if (activeKey && activeDb) {
    document.getElementById('apiKeyInput').value = activeKey;
    document.getElementById('dbNameInput').value = activeDb;
    loginAndConnect();
  }

  async function loginAndConnect() {
    const key = document.getElementById('apiKeyInput').value.trim();
    const db = document.getElementById('dbNameInput').value.trim().toLowerCase();

    if (!key || !db) return alert('Harap isi API Key dan Nama Database!');

    try {
      const res = await fetch('/api/db/' + db, {
        headers: { 'Authorization': 'Bearer ' + key }
      });
      const json = await res.json();

      if (json.success) {
        activeKey = key;
        activeDb = db;
        localStorage.setItem('fb_key', key);
        localStorage.setItem('fb_db', db);

        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('consoleScreen').style.display = 'flex';
        document.getElementById('btnLogout').style.display = 'block';
        document.getElementById('rootDbTitle').textContent = '📂 root (' + db + ')';

        renderTreeContent(json.data);
      } else {
        alert('Gagal Masuk: ' + json.error);
      }
    } catch (err) {
      alert('Koneksi Gagal! Pastikan API Key dan Nama Database Benar.');
    }
  }

  function logout() {
    localStorage.removeItem('fb_key');
    localStorage.removeItem('fb_db');
    location.reload();
  }

  async function refreshTree() {
    try {
      const res = await fetch('/api/db/' + activeDb, {
        headers: { 'Authorization': 'Bearer ' + activeKey }
      });
      const json = await res.json();
      if (json.success) renderTreeContent(json.data);
    } catch(err) {}
  }

  function renderTreeContent(data) {
    document.getElementById('treeContent').innerHTML = renderTree(data, '');
  }

  function renderTree(obj, path) {
    if (typeof obj !== 'object' || obj === null) {
      const isStr = typeof obj === 'string';
      const valClass = isStr ? 'val-str' : 'val-num';
      return '<span class="' + valClass + '">' + (isStr ? '"' + obj + '"' : obj) + '</span>';
    }

    let html = '';
    for (let key in obj) {
      const currentPath = path ? path + '/' + key : key;
      const val = obj[key];
      const isObject = typeof val === 'object' && val !== null;

      html += '<div class="tree-row">';
      html += '<span class="key-name">"' + key + '"</span>: ';
      html += isObject ? '{' : '';
      html += renderTree(val, currentPath);
      html += isObject ? '}' : '';
      
      html += '<button class="btn-icon btn-add" onclick="addChildNode(\'' + currentPath + '\')">➕</button>';
      if (!isObject) {
        html += '<button class="btn-icon btn-edit" onclick="editNodeValue(\'' + currentPath + '\', \'' + val + '\')">✏️</button>';
      }
      html += '<button class="btn-icon btn-del" onclick="deleteNode(\'' + currentPath + '\')">🗑️</button>';
      html += '</div>';
    }
    return html;
  }

  async function addChildNode(parentPath) {
    const key = prompt('Masukkan Nama Key Baru:');
    if (!key) return;
    const rawVal = prompt('Masukkan Value (String/Angka/JSON):');
    
    let value = rawVal;
    try { value = JSON.parse(rawVal); } catch(e) {}

    const fullPath = parentPath ? parentPath + '/' + key : key;
    await setNodeApi(fullPath, value);
  }

  function addRootChild() {
    addChildNode('');
  }

  async function editNodeValue(path, oldVal) {
    const newVal = prompt('Edit Value untuk ' + path + ':', oldVal);
    if (newVal === null) return;

    let value = newVal;
    try { value = JSON.parse(newVal); } catch(e) {}

    await setNodeApi(path, value);
  }

  async function setNodeApi(path, value) {
    try {
      const res = await fetch('/api/db/' + activeDb + '/' + path, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + activeKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ value: value })
      });
      const json = await res.json();
      if (json.success) {
        refreshTree();
      } else {
        alert('Gagal simpan: ' + json.error);
      }
    } catch(err) {
      alert('Error koneksi!');
    }
  }

  async function deleteNode(path) {
    if (!confirm('Hapus node "' + path + '"?')) return;
    try {
      const res = await fetch('/api/db/' + activeDb + '/' + path, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + activeKey }
      });
      const json = await res.json();
      if (json.success) refreshTree();
    } catch(err) {
      alert('Gagal hapus!');
    }
  }
</script>

</body>
</html>`);
});

// ==========================================
// 5. REST API ENDPOINTS
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
        `📋 *ENDPOINT API NODE:*\n` +
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
