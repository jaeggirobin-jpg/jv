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

// Client-IP mit geheimem Schlüssel hashen (nur für Rate-Limit, wird nach 7 Tagen gelöscht).
// Ohne DC_IP_SALT wird der Schlüssel aus dem Service-Key abgeleitet: Ein fest im Code stehendes
// Salz liesse sich durch Durchprobieren aller IPv4-Adressen in Minuten zurückrechnen.
function ipHash(event) {
  const h = event.headers || {};
  const ip = h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || '';
  if (!ip) return null;
  const geheim = process.env.DC_IP_SALT ||
    crypto.createHash('sha256').update('ip-hash|' + (process.env.SUPABASE_SERVICE_KEY || '')).digest('hex');
  return crypto.createHmac('sha256', geheim).update(ip).digest('hex');
}

// Bremse gegen Massen-Einträge von vielen IP-Adressen (das Rate-Limit pro IP greift dort nicht).
// Zählt die Einträge der letzten Stunde über alle Absender. true = Grenze erreicht.
async function zuVieleInsgesamt(tabelle, max) {
  if (!(max > 0)) return false;
  const seit = new Date(Date.now() - 3600e3).toISOString();
  const r = await rest(tabelle + '?select=id&created_at=gt.' + encodeURIComponent(seit) + '&limit=' + max);
  return (r || []).length >= max;
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
async function rest(pfad, { method = 'GET', body, prefer = 'return=representation' } = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL oder SUPABASE_SERVICE_KEY fehlt');
  const res = await fetch(url.replace(/\/$/, '') + '/rest/v1/' + pfad, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key, Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error('REST ' + method + ' ' + pfad + ' fehlgeschlagen: ' + res.status + ' ' + text);
  return text ? JSON.parse(text) : null;
}

// E-Mail via Resend (EU-Region empfohlen). Gibt true/false zurück, wirft nie.
// absender: optional, z. B. für den KRV-Check (sonst Drohnen-Check-Absender)
async function mailSenden({ an, betreff, html, text, antwortAn, absender: absenderVorgabe }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('RESEND_API_KEY fehlt – Mail an ' + an + ' nicht versendet');
    return false;
  }
  const absender = absenderVorgabe || config.email.absenderName + ' <' + (process.env.DC_ABSENDER || config.email.absenderAdresse) + '>';
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

// ── Storage ────────────────────────────────────────────────────────────
// «drohnencheck»: privat, Bilder der Berichte. «drohnencheck-medien»: öffentlich, Titelvideo.
// Direkt über die Storage-REST-API, damit keine npm-Abhängigkeit nötig ist.
const BUCKET = 'drohnencheck';
const BUCKET_MEDIEN = 'drohnencheck-medien';

async function storage(pfad, { method = 'POST', body } = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL oder SUPABASE_SERVICE_KEY fehlt');
  const res = await fetch(url.replace(/\/$/, '') + '/storage/v1/' + pfad, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Storage ' + method + ' ' + pfad + ' fehlgeschlagen: ' + res.status + ' ' + text);
  return text ? JSON.parse(text) : null;
}

function storageBasis() {
  return process.env.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1';
}

// Signierte Upload-URL: der Browser lädt die Datei per PUT direkt in den Bucket
async function uploadUrl(pfad, bucket = BUCKET) {
  const r = await storage('object/upload/sign/' + bucket + '/' + pfad);
  return storageBasis() + r.url;
}

// Signierte Lese-URLs für mehrere Bilder: { pfad: url }
async function signierteUrls(pfade, sekunden, bucket = BUCKET) {
  if (!pfade.length) return {};
  const r = await storage('object/sign/' + bucket, { body: { expiresIn: sekunden, paths: pfade } });
  const urls = {};
  (r || []).forEach((e) => { if (e.signedURL && !e.error) urls[e.path] = storageBasis() + e.signedURL; });
  return urls;
}

// Dateien eines Ordners auflisten (Ordner = anfrage_id)
async function ordnerListe(ordner, bucket = BUCKET) {
  const r = await storage('object/list/' + bucket, { body: { prefix: ordner, limit: 1000, offset: 0 } });
  return (r || []).filter((o) => o.id).map((o) => ({ pfad: ordner + '/' + o.name, metadata: o.metadata || {} }));
}

async function bilderLoeschen(pfade, bucket = BUCKET) {
  if (!pfade.length) return;
  await storage('object/' + bucket, { method: 'DELETE', body: { prefixes: pfade } });
}

// Öffentliche URL (nur für den öffentlichen Medien-Bucket)
function oeffentlicheUrl(pfad, bucket = BUCKET_MEDIEN) {
  return storageBasis() + '/object/public/' + bucket + '/' + pfad;
}

async function ordnerLoeschen(ordner, bucket = BUCKET) {
  const dateien = await ordnerListe(ordner, bucket);
  await bilderLoeschen(dateien.map((d) => d.pfad), bucket);
  return dateien.length;
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


module.exports = {
  config, antwort, ipHash, zuVieleInsgesamt, rpc, rest, storage, anfrageAktualisieren, mailSenden, imEinzugsgebiet, esc,
  uploadUrl, signierteUrls, ordnerListe, bilderLoeschen, ordnerLoeschen, oeffentlicheUrl, BUCKET_MEDIEN
};
