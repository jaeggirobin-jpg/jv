// tool-blob.js — Dateien der Tools ausliefern
//
// GET /_blob/<id>                  → Weiterleitung auf eine kurz gültige signierte URL (Bucket «tools»)
// GET /tools/gaeste-wc/scan.json   → 3D-Scan des Gäste-WC-Tools (feste Datei)
// Nur mit gültigem Sitzungs-Cookie der Plattform (Bilder können keinen eigenen Header senden).
// Die Adressen /_blob/<id> entsprechen denen aus dem claude.ai-Speicher, die Tools laufen unverändert.

const { anmeldungDatei } = require('./_lib/auth');
const t = require('./_lib/tools');

const GUELTIG_SEK = 600;     // signierte URL
const CACHE_SEK = 300;       // Weiterleitung darf der Browser so lange wiederverwenden

function text(status, meldung) {
  return { statusCode: status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: meldung };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') return text(405, 'Methode nicht erlaubt');
  if (!(await anmeldungDatei(event, 'projekte'))) return text(401, 'Nicht angemeldet');

  const q = event.queryStringParameters || {};
  let pfad = null;
  // Feste Datei: über ?datei= (aus netlify.toml) oder, falls Netlify die Parameter der Weiterleitung
  // nicht mitgibt, über die ursprüngliche Adresse
  const scan = /\/tools\/gaeste-wc\/scan\.json$/;
  if (!q.datei && (scan.test(String(event.path || '')) || scan.test(String(event.rawUrl || '').split('?')[0]))) {
    q.datei = 'gaeste-wc-scan';
  }
  if (q.datei) {
    pfad = t.DATEIEN[q.datei] || null;
  } else {
    // /_blob/<id> (Weiterleitung aus netlify.toml) oder ?id=<id>; je nach Netlify-Version steht die
    // ursprüngliche oder die umgeschriebene Adresse in event.path, die ID ist in beiden der letzte Teil
    const letzter = (u) => String(u || '').split('?')[0].split('/').filter(Boolean).pop() || '';
    const id = q.id || (t.ASSET_RE.test(letzter(event.path)) ? letzter(event.path) : letzter(event.rawUrl));
    if (t.ASSET_RE.test(id)) pfad = t.assetPfad(id);
  }
  if (!pfad) return text(404, 'Nicht gefunden');

  try {
    const url = await t.signierteUrl(pfad, GUELTIG_SEK);
    if (!url) return text(404, 'Nicht gefunden');
    return {
      statusCode: 302,
      headers: { Location: url, 'Cache-Control': 'private, max-age=' + CACHE_SEK, 'Referrer-Policy': 'no-referrer' },
      body: ''
    };
  } catch (err) {
    console.error('tool-blob', err);
    return text(502, 'Speicher nicht erreichbar');
  }
};
