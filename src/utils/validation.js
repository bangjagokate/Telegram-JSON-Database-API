const crypto = require('crypto');

function generateRecordId(prefix = 'rec') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function sanitizeDatabaseName(name) {
  if (!name || typeof name !== 'string') return null;
  const clean = name.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
  return clean.length > 0 ? clean : null;
}

function validateJSON(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  generateRecordId,
  sanitizeDatabaseName,
  validateJSON
};
