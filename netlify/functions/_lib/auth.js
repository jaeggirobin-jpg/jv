// _lib/auth.js — Gemeinsame Admin-Authentifizierung für alle Admin-Functions
// Kein eigener Endpoint: Dateien in Unterordnern ohne index.js werden von
// Netlify nicht als Function deployt, sondern nur per require() eingebunden.

const crypto = require('crypto');

// Passwort aus dem Authorization-Header gegen ADMIN_PASSWORD vergleichen.
// Zeitkonstanter Vergleich über SHA-256-Hashes (gleiche Länge), damit die
// Antwortzeit nichts über das Passwort verrät.
function checkAuth(event) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) return false;

  const headers = event.headers || {};
  const header = headers.authorization || headers.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) return false;

  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { checkAuth };
