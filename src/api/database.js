const express = require('express');
const router = express.Router();
const {
  listDatabases,
  getDatabase,
  createDatabase,
  updateDatabase,
  patchDatabase,
  deleteDatabase
} = require('../database/storage');
const { executeBackup, restoreFromGroup } = require('../telegram/backup');

module.exports = (bot) => {
  // GET /api/databases
  router.get('/databases', async (req, res) => {
    try {
      const databases = await listDatabases();
      res.json({ success: true, databases });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/db/:name
  router.get('/db/:name', async (req, res) => {
    try {
      const data = await getDatabase(req.params.name);
      res.json({ success: true, data });
    } catch (err) {
      res.status(404).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/:name
  router.post('/db/:name', async (req, res) => {
    try {
      const data = await createDatabase(req.params.name, req.body.data || []);
      res.json({ success: true, data });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // PUT /api/db/:name
  router.put('/db/:name', async (req, res) => {
    try {
      const updated = await updateDatabase(req.params.name, req.body);
      res.json({ success: true, data: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // PATCH /api/db/:name
  router.patch('/db/:name', async (req, res) => {
    try {
      const patched = await patchDatabase(req.params.name, req.body);
      res.json({ success: true, data: patched });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // DELETE /api/db/:name
  router.delete('/db/:name', async (req, res) => {
    try {
      await deleteDatabase(req.params.name);
      res.json({ success: true, message: `Database '${req.params.name}' deleted.` });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/:name/backup
  router.post('/db/:name/backup', async (req, res) => {
    try {
      if (!bot) throw new Error('Telegram bot is not active.');
      const fileId = await executeBackup(bot, req.params.name);
      res.json({ success: true, message: 'Backed up to Telegram.', file_id: fileId });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/:name/restore
  router.post('/db/:name/restore', async (req, res) => {
    try {
      if (!bot) throw new Error('Telegram bot is not active.');
      const restored = await restoreFromGroup(bot, req.params.name, req.body.file_id);
      res.json({ success: true, message: 'Restored from Telegram.', data: restored });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
