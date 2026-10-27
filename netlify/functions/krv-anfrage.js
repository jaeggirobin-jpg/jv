// krv-anfrage.js — Neue KRV-Check-Anfrage entgegennehmen (öffentlich, POST)
//
// Speichert die Angaben und gibt signierte Upload-URLs für die Fotos zurück. Der Browser lädt die
// (bereits verkleinerten) Fotos direkt in den privaten Bucket «krvcheck» und ruft danach krv-fotos auf.
// Ohne Fotos («bitte anrufen») ist die Anfrage hier schon abgeschlossen und die Info-Mail geht sofort raus.
const crypto = require('crypto');
const { config, antwort, ipHash, zuVieleInsgesamt, rpc, uploadUrl, hash, imEinzugsgebiet, infoMailSenden } = require('./_lib/krvcheck');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROLLEN = ['eigentuemer', 'verwaltung', 'mieter'];
const MAX_FOTOS = 5;                      // wie config.fotos.max
const MAX_GROESSE = 10 * 1024 * 1024;     // muss zum file_size_limit des Buckets passen
const UPLOAD_MINUTEN = 120;

function text(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// Eingaben serverseitig prüfen. Gibt { fehler } oder { daten, fotos } zurück.
function pruefen(b) {
  const d = {
    strasse: text(b.strasse, 120),
    hausnummer: text(b.hausnummer, 20),
    plz: text(b.plz, 4),
    ort: text(b.ort, 80),
    vorname: text(b.vorname, 80),
    nachname: text(b.nachname, 80),
    telefon: text(b.telefon, 40),
    email: text(b.email, 200).toLowerCase(),
    rolle: text(b.rolle, 20),
    iwb_brief: b.iwb_brief === true,
    bemerkung: text(b.bemerkung, 1000) || null,
    keine_fotos: b.keine_fotos === true,
    einwilligung: b.einwilligung === true
  };

  if (!d.vorname || !d.nachname) return { fehler: 'Bitte geben Sie Ihren Namen an.' };
  if (!EMAIL_RE.test(d.email)) return { fehler: 'Bitte geben Sie eine gültige E-Mail-Adresse an.' };
  if (d.telefon.replace(/\D/g, '').length < 9) return { fehler: 'Bitte geben Sie eine gültige Telefonnummer an.' };
  if (!d.strasse || !d.hausnummer || !d.ort) return { fehler: 'Bitte geben Sie die vollständige Adresse an.' };
  if (!/^\d{4}$/.test(d.plz)) return { fehler: 'Bitte geben Sie eine gültige Postleitzahl an.' };
  if (!imEinzugsgebiet(d.plz)) return { fehler: 'Den Gratis-Check bieten wir zurzeit nur in ' + config.einzugsgebiet.bezeichnung + ' an. Rufen Sie uns an: ' + config.firma.telefon + '.' };
  if (!ROLLEN.includes(d.rolle)) return { fehler: 'Bitte wählen Sie, ob Sie Eigentümer/in, Verwaltung oder Mieter/in sind.' };
  if (!d.einwilligung) return { fehler: 'Bitte bestätigen Sie die Einwilligung.' };

  const fotos = Array.isArray(b.fotos) ? b.fotos : [];
  if (fotos.length > MAX_FOTOS) return { fehler: 'Höchstens ' + MAX_FOTOS + ' Fotos.' };
  if (fotos.some((f) => !f || !(Number(f.groesse) > 0) || Number(f.groesse) > MAX_GROESSE)) return { fehler: 'Ein Foto ist zu gross (max. 10 MB).' };
  if (!fotos.length && !d.keine_fotos) return { fehler: 'Bitte laden Sie mindestens ein Foto hoch.' };
  if (fotos.length) d.keine_fotos = false;

  const utm = b.utm && typeof b.utm === 'object' ? b.utm : {};
  d.utm_source = text(utm.utm_source, 200) || null;
  d.utm_medium = text(utm.utm_medium, 200) || null;
  d.utm_campaign = text(utm.utm_campaign, 200) || null;
  d.utm_content = text(utm.utm_content, 200) || null;
  d.utm_term = text(utm.utm_term, 200) || null;
  d.utm_extra = {
    fbclid: text(utm.fbclid, 300) || undefined,
    landing: text(utm.landing, 300) || undefined,
    referrer: text(utm.referrer, 300) || undefined
  };
  return { daten: d, anzahl: fotos.length };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return antwort(405, { error: 'Methode nicht erlaubt' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return antwort(400, { error: 'Ungültige Anfrage' });
  }

  // Honeypot: Bots füllen das versteckte Feld aus. Wir tun so, als wäre alles gut.
  if (body.firma_website) {
    return antwort(200, { referenz: 'KRV-' + new Date().getFullYear() + '-0000', upload_token: null, uploads: [] });
  }

  const { fehler, daten, anzahl } = pruefen(body);
  if (fehler) return antwort(400, { error: fehler });

  // Upload-Token: nur der Browser kennt ihn, gespeichert wird der Hash
  const token = anzahl ? crypto.randomBytes(16).toString('hex') : null;

  let ergebnis;
  try {
    if (await zuVieleInsgesamt('krvcheck_anfragen', parseInt(process.env.KRV_LIMIT_GESAMT || '30', 10))) {
      console.warn('KRV-Check: Gesamtlimit pro Stunde erreicht');
      return antwort(429, { error: 'Zurzeit gehen sehr viele Anfragen ein. Bitte versuchen Sie es später nochmals oder rufen Sie uns an: ' + config.firma.telefon + '.' });
    }
    ergebnis = await rpc('krvcheck_anfrage_erfassen', {
      p_daten: {
        ...daten,
        ip_hash: ipHash(event),
        upload_token_hash: token ? hash(token) : null,
        upload_bis: token ? new Date(Date.now() + UPLOAD_MINUTEN * 60000).toISOString() : null
      },
      p_max_pro_stunde: parseInt(process.env.KRV_RATE_LIMIT || '5', 10)
    });
  } catch (err) {
    console.error(err);
    return antwort(500, { error: 'Ihre Anfrage konnte nicht gespeichert werden. Bitte rufen Sie uns an: ' + config.firma.telefon + '.' });
  }
  if (ergebnis && ergebnis.error === 'rate_limit') {
    return antwort(429, { error: 'Es wurden zu viele Anfragen gesendet. Bitte versuchen Sie es später nochmals oder rufen Sie uns an: ' + config.firma.telefon + '.' });
  }
  const ref = ergebnis.referenz;

  if (!anzahl) {
    await infoMailSenden(ref, 0);
    return antwort(200, { referenz: ref, upload_token: null, uploads: [] });
  }

  try {
    const uploads = [];
    for (let i = 0; i < anzahl; i++) {
      const pfad = ergebnis.id + '/' + crypto.randomBytes(12).toString('hex') + '.jpg';
      uploads.push({ pfad, upload_url: await uploadUrl(pfad) });
    }
    return antwort(200, { referenz: ref, upload_token: token, uploads });
  } catch (err) {
    // Anfrage ist gespeichert, nur die Fotos fehlen: Info-Mail trotzdem, damit wir anrufen können
    console.error(err);
    await infoMailSenden(ref, 0);
    return antwort(200, { referenz: ref, upload_token: null, uploads: [] });
  }
};

// für Tests
exports._pruefen = pruefen;
