const fs = require('fs').promises;
const path = require('path');
const { listDatabases, getFilePath } = require('../database/storage');

const pendingBackups = new Set();
let debounceTimer = null;

async function executeBackup(bot, dbName) {
  const groupId = process.env.GROUP_ID;
  if (!groupId) throw new Error('GROUP_ID environment variable is missing.');

  const filePath = getFilePath(dbName);
  const content = await fs.readFile(filePath, 'utf8');
  const buffer = Buffer.from(content, 'utf8');

  const caption = `#BACKUP #${dbName}\nTimestamp: ${new Date().toISOString()}`;
  const document = { source: buffer, filename: `database_${dbName}.json` };

  const msg = await bot.telegram.sendDocument(groupId, document, { caption });
  return msg.document.file_id;
}

function queueBackup(bot, dbName) {
  pendingBackups.add(dbName);
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(async () => {
    const queue = Array.from(pendingBackups);
    pendingBackups.clear();
    for (const name of queue) {
      try {
        await executeBackup(bot, name);
        console.log(`[Debounced Backup] Successfully backed up database: ${name}`);
      } catch (err) {
        console.error(`[Debounced Backup Failed] ${name}:`, err.message);
      }
    }
  }, 10000); // 10 detik debounce queue
}

async function backupAll(bot) {
  const dbs = await listDatabases();
  const results = [];
  for (const dbName of dbs) {
    try {
      const fileId = await executeBackup(bot, dbName);
      results.push({ dbName, success: true, fileId });
    } catch (err) {
      results.push({ dbName, success: false, error: err.message });
    }
  }
  return results;
}

async function findLatestBackupInGroup(bot, dbName) {
  const groupId = process.env.GROUP_ID;
  const updates = await bot.telegram.getUpdates({ limit: 100 }).catch(() => []);
  
  // Mencari dari update history jika ada
  let targetFile = null;
  const expectedFilename = `database_${dbName}.json`;

  for (const u of updates.reverse()) {
    const msg = u.message || u.channel_post;
    if (msg && msg.chat.id.toString() === groupId.toString() && msg.document) {
      if (msg.document.file_name === expectedFilename) {
        targetFile = msg.document.file_id;
        break;
      }
    }
  }
  return targetFile;
}

async function restoreFromGroup(bot, dbName, explicitFileId = null) {
  let fileId = explicitFileId;
  if (!fileId) {
    fileId = await findLatestBackupInGroup(bot, dbName);
  }

  if (!fileId) {
    throw new Error(`No backup file found in Telegram Group for database: ${dbName}`);
  }

  const fileLink = await bot.telegram.getFileLink(fileId);
  const response = await fetch(fileLink.href);
  const text = await response.text();

  const parsed = JSON.parse(text); // Validasi JSON
  const filePath = getFilePath(dbName);
  await fs.writeFile(filePath, JSON.stringify(parsed, null, 2), 'utf8');
  return parsed;
}

module.exports = {
  executeBackup,
  queueBackup,
  backupAll,
  restoreFromGroup
};
