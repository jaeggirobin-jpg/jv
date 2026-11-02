// _lib/auth.js — Anmeldung für alle Admin-Functions (Hauptzugang und Mitarbeiter-Logins)
// Kein eigener Endpoint: Dateien in Unterordnern ohne index.js werden von Netlify nicht als
// Function deployt, sondern nur per require() eingebunden.
//
// Zwei Arten von Zugängen:
// 1. Hauptzugang: ADMIN_PASSWORD (Netlify-Variable). Gilt immer als Admin. Entweder per
//    «Authorization: Bearer PASSWORT» (Drohnen-/KRV-Übersicht auf den Subdomains) oder über die
//    Anmeldung der Plattform ohne E-Mail.
// 2. Mitarbeiter-Logins (Tabelle «mitarbeiter», migration_017): E-Mail und eigenes Passwort (scrypt),
//    Rolle «admin» oder «mitarbeiter». Mitarbeiter sehen nur ihre Bereiche (BEREICHE), die Verwaltung
//    (Logins, Feedback-Board) ist den Admins vorbehalten.
//
// Nach der Anmeldung (/api/sitzung) trägt der Browser ein signiertes Sitzungs-Cookie. Es wird bei JEDER
// Anfrage geprüft: Signatur, Ablauf und bei Mitarbeitern in der Datenbank, ob das Login noch aktiv ist
// und die Sitzungsversion stimmt. Sperren, neues Passwort oder geänderte Rechte erhöhen die Version und
// beenden damit alle Sitzungen dieser Person sofort.
//
// fetch()-Aufrufe brauchen zusätzlich den Header «X-JV-Sitzung»: Fremde Seiten können ihn nur nach einem
// CORS-Preflight senden, den unsere Functions nicht erlauben (Schutz gegen CSRF). Nur Bilder und Dateien,
// bei denen der Browser keinen eigenen Header senden kann, kommen mit dem Cookie allein aus (anmeldungDatei).
//
// Wichtig: anmeldung() ist asynchron. Immer «if (!(await anmeldung(event, 'bereich')))» schreiben.
// Die früheren synchronen checkAuth/checkSitzung gibt es bewusst nicht mehr: ein vergessenes «await»
// liefe sonst mit einem Promise (immer «wahr») durch die Prüfung.

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const COOKIE = '__Host-jv_sitzung';
const DAUER_KURZ = 12 * 3600;           // Sekunden: normale Anmeldung (Cookie bis Browser zu, Signatur max. 12 h)
const DAUER_LANG = 30 * 24 * 3600;      // «Auf diesem Gerät angemeldet bleiben»

// Bereiche, die einem Mitarbeiter-Login gegeben werden können (Admins haben alle)
const BEREICHE = {
  projekte: 'Projekte und Tools',
  kunden: 'Kunden, Dokumente und Kundenlinks',
  katalog: 'Katalog',
  anfragen: 'Drohnen-Check und KRV-Check'
};
const VERWALTUNG = 'verwaltung';         // Logins und Feedback-Board: nur Admins

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// scrypt-Parameter für Mitarbeiter-Passwörter (ca. 64 MiB, gut 100 ms pro Prüfung)
const SCRYPT_N = 65536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_LEN = 32;
const SCRYPT_MAXMEM = 160 * 1024 * 1024;

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest();
}

// ── Hauptzugang ─────────────────────────────────────────────────────────
// Zeitkonstanter Vergleich über SHA-256-Hashes (gleiche Länge), damit die
// Antwortzeit nichts über das Passwort verrät.
function passwortOk(wert) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected || !wert) return false;
  return crypto.timingSafeEqual(sha256(wert), sha256(expected));
}

function bearerOk(event) {
  const headers = event.headers || {};
  const header = headers.authorization || headers.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  return passwortOk(token);
}

function hauptzugang() {
  return { id: 'admin', name: 'Hauptzugang', email: '', rolle: 'admin', bereiche: Object.keys(BEREICHE), hauptzugang: true };
}

// ── Passwörter der Mitarbeiter (scrypt) ─────────────────────────────────
// Gespeichert als «scrypt$N$r$p$salz$hash» (Base64), damit die Parameter später erhöht werden können.
async function passwortHash(passwort) {
  const salz = crypto.randomBytes(16);
  const h = await scrypt(String(passwort).normalize('NFC'), salz, SCRYPT_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salz.toString('base64'), h.toString('base64')].join('$');
}

async function passwortPruefen(passwort, gespeichert) {
  const t = String(gespeichert || '').split('$');
  const N = Number(t[1]), r = Number(t[2]), p = Number(t[3]);
  const gueltig = t.length === 6 && t[0] === 'scrypt' && N >= 1024 && N <= 1048576 && (N & (N - 1)) === 0 &&
    r >= 1 && r <= 32 && p >= 1 && p <= 16;
  const salz = gueltig ? Buffer.from(t[4], 'base64') : crypto.randomBytes(16);
  const soll = gueltig ? Buffer.from(t[5], 'base64') : crypto.randomBytes(SCRYPT_LEN);
  // Auch ohne gültigen Hash rechnen (gleiche Antwortzeit, verrät nicht, ob es das Login gibt)
  const ist = await scrypt(String(passwort || '').normalize('NFC'), salz, soll.length || SCRYPT_LEN,
    gueltig ? { N, r, p, maxmem: SCRYPT_MAXMEM } : { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM });
  return gueltig && ist.length === soll.length && crypto.timingSafeEqual(ist, soll);
}

// Startpasswort für neue Logins und beim Zurücksetzen: 3 × 4 Zeichen ohne verwechselbare Zeichen
function startpasswort() {
  const z = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXYZ2345679';
  const b = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) {
    if (i && i % 4 === 0) s += '-';
    s += z[b[i] % z.length];
  }
  return s;
}

// ── Sitzungs-Cookie ─────────────────────────────────────────────────────
// Schlüssel für die Signatur: aus Service-Key und Admin-Passwort abgeleitet.
// Wer das Admin-Passwort ändert, beendet damit alle Sitzungen.
function schluessel() {
  return sha256('jv-sitzung|' + (process.env.SUPABASE_SERVICE_KEY || '') + '|' + (process.env.ADMIN_PASSWORD || ''));
}

function signieren(daten) {
  return crypto.createHmac('sha256', schluessel()).update(daten).digest();
}

function cookieLesen(event, name) {
  const h = event.headers || {};
  const roh = h.cookie || h.Cookie || '';
  const teile = String(roh).split(';');
  for (let i = 0; i < teile.length; i++) {
    const t = teile[i].trim();
    const gleich = t.indexOf('=');
    if (gleich > 0 && t.slice(0, gleich) === name) return t.slice(gleich + 1);
  }
  return '';
}

// Sitzung: «v2.<id>.<version>.<ablauf>.<zufall>.<hmac>», id = «admin» (Hauptzugang) oder UUID des Logins
function sitzungErstellen(id, version, lang) {
  const jetzt = Math.floor(Date.now() / 1000);
  const dauer = lang ? DAUER_LANG : DAUER_KURZ;
  const daten = 'v2.' + id + '.' + (version | 0) + '.' + (jetzt + dauer) + '.' + crypto.randomBytes(12).toString('hex');
  const wert = daten + '.' + signieren(daten).toString('hex');
  return {
    wert,
    ablauf: new Date((jetzt + dauer) * 1000).toISOString(),
    // Ohne «bleiben» ein Sitzungs-Cookie (weg, wenn der Browser schliesst)
    cookie: COOKIE + '=' + wert + '; Path=/; HttpOnly; Secure; SameSite=Strict' + (lang ? '; Max-Age=' + dauer : ''),
    lang: !!lang
  };
}

function sitzungsCookieLoeschen() {
  return COOKIE + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';
}

// Cookie prüfen (Signatur und Ablauf): { id, version, ablauf, lang } oder null
function sitzungLesen(event) {
  if (!process.env.ADMIN_PASSWORD) return null;
  const wert = cookieLesen(event, COOKIE);
  const m = /^v2\.(admin|[0-9a-f-]{36})\.(\d{1,9})\.(\d{10})\.([0-9a-f]{24})\.([0-9a-f]{64})$/.exec(wert);
  if (!m) return null;
  // Gruppen: 1 id, 2 version, 3 ablauf, 4 zufall, 5 signatur
  if (m[1] !== 'admin' && !UUID_RE.test(m[1])) return null;
  const ablauf = parseInt(m[3], 10);
  if (!(ablauf * 1000 > Date.now())) return null;
  const soll = signieren(wert.slice(0, wert.lastIndexOf('.')));
  const ist = Buffer.from(m[5], 'hex');
  if (ist.length !== soll.length || !crypto.timingSafeEqual(ist, soll)) return null;
  return { id: m[1], version: parseInt(m[2], 10), ablauf, lang: ablauf - Math.floor(Date.now() / 1000) > DAUER_KURZ };
}

// Login aus der Datenbank (ohne Passwort-Hash)
async function mitarbeiterLesen(id) {
  if (!UUID_RE.test(String(id || ''))) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const res = await fetch(url.replace(/\/$/, '') + '/rest/v1/mitarbeiter?select=id,email,name,rolle,bereiche,aktiv,sitzung_version,muss_passwort_aendern&id=eq.' + id, {
    headers: { apikey: key, Authorization: 'Bearer ' + key }
  });
  if (!res.ok) throw new Error('mitarbeiter nicht lesbar: ' + res.status);
  const rows = await res.json();
  return (rows && rows[0]) || null;
}

function benutzerAus(m) {
  return {
    id: m.id, name: m.name, email: m.email, rolle: m.rolle === 'admin' ? 'admin' : 'mitarbeiter',
    bereiche: Array.isArray(m.bereiche) ? m.bereiche.filter((b) => BEREICHE[b]) : [],
    passwortAendern: !!m.muss_passwort_aendern
  };
}

// Angemeldete Person aus dem Cookie (ohne Header-Prüfung). null = nicht (mehr) angemeldet.
// optionen.auchPasswortAendern: auch Logins liefern, die zuerst ihr Startpasswort ändern müssen
async function sitzungsBenutzer(event, optionen) {
  const s = sitzungLesen(event);
  if (!s) return null;
  if (s.id === 'admin') return Object.assign(hauptzugang(), { sitzung: s });
  let m;
  try {
    m = await mitarbeiterLesen(s.id);
  } catch (e) {
    console.error('auth', e.message);
    return null;      // Datenbank nicht erreichbar: lieber abweisen als durchlassen
  }
  if (!m || m.aktiv !== true || Number(m.sitzung_version) !== s.version) return null;
  const b = benutzerAus(m);
  if (b.passwortAendern && !(optionen && optionen.auchPasswortAendern)) return null;
  b.sitzung = s;
  return b;
}

function darf(wer, bereich) {
  if (!wer) return false;
  if (!bereich) return true;
  if (wer.rolle === 'admin') return true;
  if (bereich === VERWALTUNG) return false;
  return wer.bereiche.indexOf(bereich) >= 0;
}

function sitzungsHeader(event) {
  const h = event.headers || {};
  return !!(h['x-jv-sitzung'] || h['X-JV-Sitzung']);
}

// Für alle Admin-Functions (fetch-Aufrufe): Hauptpasswort ODER Cookie + eigener Header.
// bereich: 'projekte' | 'kunden' | 'katalog' | 'anfragen' | 'verwaltung' | leer (jede angemeldete Person)
// Ergebnis: die angemeldete Person ({ id, name, email, rolle, bereiche }) oder null
async function anmeldung(event, bereich) {
  let wer = null;
  if (bearerOk(event)) wer = hauptzugang();
  else if (sitzungsHeader(event)) wer = await sitzungsBenutzer(event);
  return darf(wer, bereich) ? wer : null;
}

// Nur für Lese-Abrufe ohne eigenen Header (Bilder, 3D-Scan): Cookie genügt
async function anmeldungDatei(event, bereich) {
  const wer = bearerOk(event) ? hauptzugang() : await sitzungsBenutzer(event);
  return darf(wer, bereich) ? wer : null;
}

module.exports = {
  COOKIE, BEREICHE, VERWALTUNG, UUID_RE,
  anmeldung, anmeldungDatei, sitzungsBenutzer, darf, sitzungsHeader,
  passwortOk, passwortHash, passwortPruefen, startpasswort,
  sitzungErstellen, sitzungsCookieLoeschen, sitzungLesen, mitarbeiterLesen, benutzerAus, hauptzugang
};
