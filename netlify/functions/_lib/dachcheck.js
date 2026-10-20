// dachcheck.js — Hilfsfunktionen für die Drohnen-Check-Functions (dachcheck-*.js)
// Keine npm-Abhängigkeiten: Supabase (PostgREST) und Resend werden direkt per fetch angesprochen.

const crypto = require('crypto');
const config = require('../../../public/dachcheck/config.js');

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function antwort(status, body) {
  return { statusCode: status, headers: HEADERS, body: JSON.stringify(body) };
}

// Client-IP gesalzen hashen (nur für Rate-Limit, wird nach 7 Tagen gelöscht)
function ipHash(event) {
  const h = event.headers || {};
  const ip = h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || '';
  if (!ip) return null;
  const salz = process.env.DC_IP_SALT || 'drohnencheck';
  return crypto.createHash('sha256').update(salz + '|' + ip).digest('hex');
}

// Supabase RPC mit service_role-Key aufrufen
async function rpc(name, params) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL oder SUPABASE_SERVICE_KEY fehlt');
  const res = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key },
    body: JSON.stringify(params)
  });
  const text = await res.text();
  if (!res.ok) throw new Error('RPC ' + name + ' fehlgeschlagen: ' + res.status + ' ' + text);
  return text ? JSON.parse(text) : null;
}

// Einzelne Felder einer Anfrage aktualisieren (z. B. Mail-Status)
async function anfrageAktualisieren(referenz, felder) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(url.replace(/\/$/, '') + '/rest/v1/drohnencheck_anfragen?referenz=eq.' + encodeURIComponent(referenz), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' },
    body: JSON.stringify(felder)
  });
  if (!res.ok) console.error('Update fehlgeschlagen', res.status, await res.text());
}

// Direkter PostgREST-Aufruf (für die Übersicht). pfad z. B. 'drohnencheck_anfragen?select=*'
async function rest(pfad, { method = 'GET', body } = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL oder SUPABASE_SERVICE_KEY fehlt');
  const res = await fetch(url.replace(/\/$/, '') + '/rest/v1/' + pfad, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error('REST ' + method + ' ' + pfad + ' fehlgeschlagen: ' + res.status + ' ' + text);
  return text ? JSON.parse(text) : null;
}

// E-Mail via Resend (EU-Region empfohlen). Gibt true/false zurück, wirft nie.
async function mailSenden({ an, betreff, html, text, antwortAn }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('RESEND_API_KEY fehlt – Mail an ' + an + ' nicht versendet');
    return false;
  }
  const absender = config.email.absenderName + ' <' + (process.env.DC_ABSENDER || config.email.absenderAdresse) + '>';
  try {
    const res = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ from: absender, to: [an], subject: betreff, html, text, reply_to: antwortAn || undefined })
    });
    if (!res.ok) {
      console.error('Resend-Fehler', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Resend nicht erreichbar', err);
    return false;
  }
}

function imEinzugsgebiet(plz) {
  const n = parseInt(plz, 10);
  if (!n) return false;
  return config.einzugsgebiet.plz.some((e) => {
    if (typeof e === 'number') return e === n;
    const [von, bis] = String(e).split('-');
    return n >= parseInt(von, 10) && n <= parseInt(bis || von, 10);
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}


module.exports = { config, antwort, ipHash, rpc, rest, anfrageAktualisieren, mailSenden, imEinzugsgebiet, esc };
