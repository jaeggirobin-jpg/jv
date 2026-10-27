// krvcheck.js — Hilfsfunktionen für die KRV-Check-Functions (krv-*.js)
// Supabase-, Storage- und Mail-Zugriff kommen aus dachcheck.js (gleiche Technik, andere Tabellen und Buckets).

const crypto = require('crypto');
const config = require('../../../public/krv/config.js');
const dc = require('./dachcheck');

const BUCKET = 'krvcheck';               // privat: Fotos der Kunden
const BUCKET_MEDIEN = 'krvcheck-medien'; // öffentlich: Anleitungsvideo
const REFERENZ_RE = /^KRV-\d{4}-\d{4,}$/;

function imEinzugsgebiet(plz) {
  const n = parseInt(plz, 10);
  if (!n) return false;
  return config.einzugsgebiet.plz.some((e) => {
    if (typeof e === 'number') return e === n;
    const [von, bis] = String(e).split('-');
    return n >= parseInt(von, 10) && n <= parseInt(bis || von, 10);
  });
}

function hash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Info-Mail an uns. Bewusst OHNE Personendaten: nur Referenz, Zeitpunkt, Anzahl Fotos und Link.
function mailInfo(ref, anzahlFotos) {
  const zeit = new Date().toLocaleString('de-CH', { timeZone: 'Europe/Zurich', dateStyle: 'short', timeStyle: 'short' });
  const link = (process.env.KRV_UEBERSICHT_URL || config.email.uebersichtUrl) + '#' + ref;
  const fotos = anzahlFotos ? anzahlFotos + (anzahlFotos === 1 ? ' Foto' : ' Fotos') : 'ohne Fotos, bitte anrufen';
  const text = 'Neue KRV-Check-Anfrage ' + ref + ' (' + zeit + ', ' + fotos + ').\n\nAnfrage ansehen:\n' + link;
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#25292E">' +
    '<p>Neue KRV-Check-Anfrage <strong>' + dc.esc(ref) + '</strong> (' + dc.esc(zeit) + ', ' + dc.esc(fotos) + ').</p>' +
    '<p><a href="' + dc.esc(link) + '" style="display:inline-block;padding:10px 18px;background:#94621F;color:#fff;text-decoration:none;border-radius:6px">Anfrage ansehen</a></p></div>';
  return { text, html };
}

// Info-Mail senden und das Ergebnis in der Anfrage vermerken
async function infoMailSenden(ref, anzahlFotos) {
  const m = mailInfo(ref, anzahlFotos);
  const absender = config.email.absenderName + ' <' + (process.env.KRV_ABSENDER || process.env.DC_ABSENDER || config.email.absenderAdresse) + '>';
  const ok = await dc.mailSenden({
    an: process.env.KRV_EMPFAENGER || config.email.empfaengerIntern,
    betreff: config.email.betreffIntern + ' ' + ref,
    html: m.html,
    text: m.text,
    absender
  });
  try {
    await dc.rest('krvcheck_anfragen?referenz=eq.' + encodeURIComponent(ref), { method: 'PATCH', body: { mail_intern_ok: ok }, prefer: 'return=minimal' });
  } catch (err) {
    console.error('Mail-Status nicht gespeichert', err);
  }
  return ok;
}

module.exports = {
  config, BUCKET, BUCKET_MEDIEN, REFERENZ_RE, imEinzugsgebiet, hash, mailInfo, infoMailSenden,
  antwort: dc.antwort, ipHash: dc.ipHash, zuVieleInsgesamt: dc.zuVieleInsgesamt, rpc: dc.rpc, rest: dc.rest, esc: dc.esc,
  uploadUrl: (pfad) => dc.uploadUrl(pfad, BUCKET),
  medienUploadUrl: (pfad) => dc.uploadUrl(pfad, BUCKET_MEDIEN),
  signierteUrls: (pfade, sekunden) => dc.signierteUrls(pfade, sekunden, BUCKET),
  ordnerListe: (ordner) => dc.ordnerListe(ordner, BUCKET),
  medienListe: (ordner) => dc.ordnerListe(ordner, BUCKET_MEDIEN),
  medienLoeschen: (pfade) => dc.bilderLoeschen(pfade, BUCKET_MEDIEN),
  ordnerLoeschen: (ordner) => dc.ordnerLoeschen(ordner, BUCKET),
  oeffentlicheUrl: (pfad) => dc.oeffentlicheUrl(pfad, BUCKET_MEDIEN)
};
