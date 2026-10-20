// dachcheck-admin-liste.js — Alle Drohnen-Check-Anfragen und die Warteliste für die Übersicht (Admin)
const { antwort, rest } = require('./_lib/dachcheck');
const { checkAuth } = require('./_lib/auth');

// ip_hash bleibt serverseitig
const SPALTEN = [
  'id', 'referenz', 'status', 'created_at', 'updated_at',
  'strasse', 'hausnummer', 'plz', 'ort',
  'gebaeudetyp', 'dachform', 'rolle', 'baujahr', 'bemerkung',
  'vorname', 'nachname', 'telefon', 'email', 'kanal',
  'wunschtermine', 'termin_bestaetigt',
  'einwilligung_berechtigt', 'einwilligung_aufnahmen', 'einwilligung_kommunikation',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_extra',
  'mail_intern_ok', 'notiz_intern'
].join(',');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return antwort(405, { error: 'Methode nicht erlaubt' });
  if (!checkAuth(event)) return antwort(401, { error: 'Nicht autorisiert' });

  try {
    const [anfragen, warteliste] = await Promise.all([
      rest('drohnencheck_anfragen?select=' + SPALTEN + '&order=created_at.desc'),
      rest('drohnencheck_warteliste?select=id,created_at,email,plz,ort,utm&order=created_at.desc')
    ]);
    return antwort(200, { anfragen, warteliste });
  } catch (err) {
    console.error(err);
    return antwort(500, { error: 'Anfragen konnten nicht geladen werden' });
  }
};
