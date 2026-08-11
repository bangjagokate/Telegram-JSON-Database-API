const { Telegraf } = require('telegraf');
const {
  listDatabases,
  getDatabase,
  createDatabase,
  deleteDatabase
} = require('../database/storage');
const { executeBackup, backupAll, restoreFromGroup } = require('./backup');

function initBot() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.warn('[Telegram Bot] BOT_TOKEN missing. Telegram Bot will be disabled.');
    return null;
  }

  const bot = new Telegraf(token);

  const isAdmin = (ctx) => {
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim());
    const userId = ctx.from?.id?.toString();
    return adminIds.includes(userId);
  };

  bot.use(async (ctx, next) => {
    if (!isAdmin(ctx)) {
      return ctx.reply('⛔ Unauthorized: Access restricted to registered Admins only.');
    }
    return next();
  });

  bot.start((ctx) => {
    ctx.reply(
      '🤖 *Telegram JSON Database API Bot*\n\n' +
        'Perintah yang tersedia:\n' +
        '/database - Lihat daftar database\n' +
        '/create <nama> - Buat database baru\n' +
        '/get <nama> - Lihat isi database\n' +
        '/delete <nama> - Hapus database\n' +
        '/backup [nama] - Backup database ke group\n' +
        '/restore <nama> - Restore database dari group\n' +
        '/status - Cek status server',
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('database', async (ctx) => {
    try {
      const dbs = await listDatabases();
      if (dbs.length === 0) return ctx.reply('📂 Database kosong.');
      ctx.reply(`📂 *Daftar Database (${dbs.length}):*\n\n` + dbs.map((d) => `- \`${d}\``).join('\n'), { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  bot.command('create', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const dbName = args[0];
    if (!dbName) return ctx.reply('⚠️ Format: /create <nama_database>');

    try {
      const db = await createDatabase(dbName);
      ctx.reply(`✅ Database \`${dbName}\` berhasil dibuat!\n\`\`\`json\n${JSON.stringify(db, null, 2)}\n\`\`\``, { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply(`❌ Gagal membuat database: ${err.message}`);
    }
  });

  bot.command('get', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const dbName = args[0];
    if (!dbName) return ctx.reply('⚠️ Format: /get <nama_database>');

    try {
      const db = await getDatabase(dbName);
      const jsonStr = JSON.stringify(db, null, 2);
      if (jsonStr.length > 3500) {
        ctx.replyWithDocument({ source: Buffer.from(jsonStr), filename: `${dbName}.json` }, { caption: `📄 Data ${dbName}` });
      } else {
        ctx.reply(`📄 *Database: ${dbName}*\n\`\`\`json\n${jsonStr}\n\`\`\``, { parse_mode: 'Markdown' });
      }
    } catch (err) {
      ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  bot.command('delete', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const dbName = args[0];
    if (!dbName) return ctx.reply('⚠️ Format: /delete <nama_database>');

    try {
      await deleteDatabase(dbName);
      ctx.reply(`🗑️ Database \`${dbName}\` berhasil dihapus.`, { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  bot.command('backup', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const dbName = args[0];

    try {
      if (dbName) {
        await executeBackup(bot, dbName);
        ctx.reply(`📦 Database \`${dbName}\` berhasil di-backup ke Group.`, { parse_mode: 'Markdown' });
      } else {
        const results = await backupAll(bot);
        ctx.reply(`📦 Backup Selesai:\n` + results.map((r) => `${r.success ? '✅' : '❌'} ${r.dbName}`).join('\n'));
      }
    } catch (err) {
      ctx.reply(`❌ Backup gagal: ${err.message}`);
    }
  });

  bot.command('restore', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const dbName = args[0];
    if (!dbName) return ctx.reply('⚠️ Format: /restore <nama_database>');

    try {
      await restoreFromGroup(bot, dbName);
      ctx.reply(`🔄 Database \`${dbName}\` berhasil di-restore dari Group!`, { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply(`❌ Restore gagal: ${err.message}`);
    }
  });

  bot.command('status', async (ctx) => {
    try {
      const dbs = await listDatabases();
      const memoryUsage = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);

      ctx.reply(
        `🟢 *Server & Bot Status*\n\n` +
          `- Uptime: ${Math.floor(process.uptime())} detik\n` +
          `- RAM Usage: ${memoryUsage} MB\n` +
          `- Total Database: ${dbs.length}\n` +
          `- Telegram Group Storage: Connected\n` +
          `- Environment: ${process.env.NODE_ENV || 'development'}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      ctx.reply(`❌ Error status: ${err.message}`);
    }
  });

  bot.launch().then(() => console.log('[Telegram Bot] Successfully started.')).catch((err) => console.error('[Telegram Bot] Launch failed:', err.message));

  return bot;
}

module.exports = { initBot };
