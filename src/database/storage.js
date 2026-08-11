const fs = require('fs').promises;
const path = require('path');
const { sanitizeDatabaseName, generateRecordId } = require('../utils/validation');

const DATA_DIR = path.join(__dirname, '../../data');
const fileLocks = new Map();

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create data directory:', err.message);
  }
}

async function acquireLock(dbName) {
  while (fileLocks.get(dbName)) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  fileLocks.set(dbName, true);
}

function releaseLock(dbName) {
  fileLocks.delete(dbName);
}

function getFilePath(dbName) {
  const clean = sanitizeDatabaseName(dbName);
  if (!clean) throw new Error('Invalid database name');
  return path.join(DATA_DIR, `${clean}.json`);
}

async function writeAtomic(filePath, data) {
  const tempPath = `${filePath}.${Date.now()}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function listDatabases() {
  await ensureDataDir();
  const files = await fs.readdir(DATA_DIR);
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
}

async function getDatabase(dbName) {
  await ensureDataDir();
  const filePath = getFilePath(dbName);
  await acquireLock(dbName);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } finally {
    releaseLock(dbName);
  }
}

async function createDatabase(dbName, initialData = []) {
  await ensureDataDir();
  const filePath = getFilePath(dbName);
  await acquireLock(dbName);
  try {
    try {
      await fs.access(filePath);
      throw new Error(`Database '${dbName}' already exists.`);
    } catch (err) {
      if (err.message.includes('already exists')) throw err;
    }

    const payload = {
      _meta: {
        database: dbName,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      data: Array.isArray(initialData) ? initialData : []
    };

    await writeAtomic(filePath, payload);
    return payload;
  } finally {
    releaseLock(dbName);
  }
}

async function updateDatabase(dbName, fullPayload) {
  await ensureDataDir();
  const filePath = getFilePath(dbName);
  await acquireLock(dbName);
  try {
    const current = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const updated = {
      _meta: {
        ...current._meta,
        version: (current._meta?.version || 1) + 1,
        updated_at: new Date().toISOString()
      },
      data: Array.isArray(fullPayload.data) ? fullPayload.data : fullPayload
    };
    await writeAtomic(filePath, updated);
    return updated;
  } finally {
    releaseLock(dbName);
  }
}

async function patchDatabase(dbName, patchData) {
  await ensureDataDir();
  const filePath = getFilePath(dbName);
  await acquireLock(dbName);
  try {
    const current = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const updated = {
      ...current,
      ...patchData,
      _meta: {
        ...current._meta,
        ...(patchData._meta || {}),
        version: (current._meta?.version || 1) + 1,
        updated_at: new Date().toISOString()
      }
    };
    await writeAtomic(filePath, updated);
    return updated;
  } finally {
    releaseLock(dbName);
  }
}

async function deleteDatabase(dbName) {
  await ensureDataDir();
  const filePath = getFilePath(dbName);
  await acquireLock(dbName);
  try {
    await fs.unlink(filePath);
    return true;
  } finally {
    releaseLock(dbName);
  }
}

// Record operations
async function addRecord(dbName, recordData) {
  const db = await getDatabase(dbName);
  const prefix = dbName.substring(0, 3);
  const newRecord = {
    id: generateRecordId(prefix),
    ...recordData,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  db.data.push(newRecord);
  await updateDatabase(dbName, db);
  return newRecord;
}

async function getRecord(dbName, recordId) {
  const db = await getDatabase(dbName);
  return db.data.find((r) => r.id === recordId) || null;
}

async function updateRecord(dbName, recordId, newData) {
  const db = await getDatabase(dbName);
  const index = db.data.findIndex((r) => r.id === recordId);
  if (index === -1) return null;

  const existing = db.data[index];
  const updatedRecord = {
    ...newData,
    id: existing.id,
    created_at: existing.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.data[index] = updatedRecord;
  await updateDatabase(dbName, db);
  return updatedRecord;
}

async function patchRecord(dbName, recordId, patchData) {
  const db = await getDatabase(dbName);
  const index = db.data.findIndex((r) => r.id === recordId);
  if (index === -1) return null;

  const existing = db.data[index];
  const updatedRecord = {
    ...existing,
    ...patchData,
    id: existing.id,
    updated_at: new Date().toISOString()
  };

  db.data[index] = updatedRecord;
  await updateDatabase(dbName, db);
  return updatedRecord;
}

async function deleteRecord(dbName, recordId) {
  const db = await getDatabase(dbName);
  const index = db.data.findIndex((r) => r.id === recordId);
  if (index === -1) return false;

  db.data.splice(index, 1);
  await updateDatabase(dbName, db);
  return true;
}

module.exports = {
  ensureDataDir,
  listDatabases,
  getDatabase,
  createDatabase,
  updateDatabase,
  patchDatabase,
  deleteDatabase,
  addRecord,
  getRecord,
  updateRecord,
  patchRecord,
  deleteRecord,
  writeAtomic,
  getFilePath
};
