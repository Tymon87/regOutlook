// config/config.js
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');

// Pomocnicza funkcja konwersji liczb
const num = (v, def) => (v && !Number.isNaN(Number(v)) ? Number(v) : def);

const PORT = num(process.env.PORT, 3000);
const REDIRECT_URI = `http://${process.env.OAUTH_REDIRECT_HOST || 'localhost'}:${PORT}/callback`;

module.exports = {
  server: {
    port: PORT,
    redirectUri: REDIRECT_URI,
  },

  oauth: {
    clientId: process.env.OAUTH_CLIENT_ID,
    clientSecret: process.env.OAUTH_CLIENT_SECRET,
    scope: process.env.OAUTH_SCOPE || 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access',
    tenant: process.env.OAUTH_TENANT || 'common',
  },

  capsolver: {
    apiKey: process.env.CAPSOLVER_KEY,
  },

  fingerprint: {
    tags: (process.env.FINGERPRINT_TAGS || 'Desktop,Chrome')
      .split(',')
      .map(s => s.trim()),
    minHeight: num(process.env.FINGERPRINT_MIN_HEIGHT, 900),
    maxHeight: num(process.env.FINGERPRINT_MAX_HEIGHT, 1500),
    minWidth: num(process.env.FINGERPRINT_MIN_WIDTH, 1200),
    maxWidth: num(process.env.FINGERPRINT_MAX_WIDTH, 2100),
  },

  proxy: {
    url: process.env.PROXY_URL || null,
    listFile: process.env.PROXIES_FILE || null,
  },

	files: {
    tokens: process.env.TOKENS_FILE
      ? path.resolve(process.cwd(), process.env.TOKENS_FILE)
      : path.join(process.cwd(), 'tokens.txt'),
    csv: process.env.CSV_FILE
      ? path.resolve(process.cwd(), process.env.CSV_FILE)
      : path.join(process.cwd(), 'dane.csv'),
  },
  csv: {
    separator: process.env.CSV_SEPARATOR || ',',
    headers: (process.env.CSV_HEADERS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean), // -> [] gdy brak
  },
};
