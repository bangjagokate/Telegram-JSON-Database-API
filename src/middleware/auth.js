require('dotenv').config();

function apiKeyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const configuredApiKey = process.env.API_KEY;

  if (!configuredApiKey) {
    return res.status(500).json({ success: false, error: 'Server API_KEY is not configured.' });
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing or invalid Authorization header format. Expected: Bearer <API_KEY>' });
  }

  const token = authHeader.split(' ')[1];
  if (token !== configuredApiKey) {
    return res.status(403).json({ success: false, error: 'Forbidden: Invalid API Key.' });
  }

  next();
}

module.exports = { apiKeyAuth };
