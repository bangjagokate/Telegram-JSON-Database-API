const fs = require('fs').promises;
const path = require('path');
const { ensureDataDir, listDatabases, getFilePath } = require('./storage');
const { restoreFromGroup } = require('../telegram/backup');

async function runStartupRecovery(bot) {
  await ensureDataDir();
  console.log('[Recovery System] Checking database integrity...');

  const DATA_DIR = path.join(__dirname, '../../data');
  const files = await fs.readdir(DATA_DIR);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const dbName = file.replace('.json', '');
    const filePath = path.join(DATA_DIR, file);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      JSON.parse(content);
      console.log(`[Recovery System] Local database '${dbName}' is valid.`);
    } catch (err) {
      console.warn(`[Recovery System] Local database '${dbName}' is corrupt! Attempting restore from Telegram...`);
      try {
        if (bot) {
          await restoreFromGroup(bot, dbName);
          console.log(`[Recovery System] Successfully restored corrupt '${dbName}' from Telegram.`);
        }
      } catch (restoreErr) {
        console.error(`[Recovery System] Failed to restore '${dbName}' from Telegram:`, restoreErr.message);
      }
    }
  }
}

module.exports = { runStartupRecovery };
