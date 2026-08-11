const express = require('express');
const router = express.Router();
const {
  addRecord,
  getRecord,
  updateRecord,
  patchRecord,
  deleteRecord,
  getDatabase
} = require('../database/storage');
const { queueBackup } = require('../telegram/backup');

module.exports = (bot) => {
  // GET /api/db/:name/records
  router.get('/db/:name/records', async (req, res) => {
    try {
      const db = await getDatabase(req.params.name);
      res.json({ success: true, total: db.data.length, data: db.data });
    } catch (err) {
      res.status(404).json({ success: false, error: err.message });
    }
  });

  // POST /api/db/:name/records
  router.post('/db/:name/records', async (req, res) => {
    try {
      const record = await addRecord(req.params.name, req.body);
      if (bot) queueBackup(bot, req.params.name);
      res.status(201).json({ success: true, data: record });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // GET /api/db/:name/records/:id
  router.get('/db/:name/records/:id', async (req, res) => {
    try {
      const record = await getRecord(req.params.name, req.params.id);
      if (!record) return res.status(404).json({ success: false, error: 'Record not found.' });
      res.json({ success: true, data: record });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // PUT /api/db/:name/records/:id
  router.put('/db/:name/records/:id', async (req, res) => {
    try {
      const updated = await updateRecord(req.params.name, req.params.id, req.body);
      if (!updated) return res.status(404).json({ success: false, error: 'Record not found.' });
      if (bot) queueBackup(bot, req.params.name);
      res.json({ success: true, data: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // PATCH /api/db/:name/records/:id
  router.patch('/db/:name/records/:id', async (req, res) => {
    try {
      const patched = await patchRecord(req.params.name, req.params.id, req.body);
      if (!patched) return res.status(404).json({ success: false, error: 'Record not found.' });
      if (bot) queueBackup(bot, req.params.name);
      res.json({ success: true, data: patched });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // DELETE /api/db/:name/records/:id
  router.delete('/db/:name/records/:id', async (req, res) => {
    try {
      const deleted = await deleteRecord(req.params.name, req.params.id);
      if (!deleted) return res.status(404).json({ success: false, error: 'Record not found.' });
      if (bot) queueBackup(bot, req.params.name);
      res.json({ success: true, message: 'Record deleted.' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  return router;
};
