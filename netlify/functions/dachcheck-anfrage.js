// dachcheck-anfrage.js — Neue Drohnen-Check-Anfrage entgegennehmen, speichern und Info-Mail senden
const { config, antwort, ipHash, zuVieleInsgesamt, rpc, anfrageAktualisieren, mailSenden, imEinzugsgebiet, esc } = require('./_lib/dachcheck');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// Eingaben serverseitig prüfen. Gibt { fehler } oder { daten } zurück.
// Das Formular fragt nur Name, E-Mail, Telefon und Adresse ab.
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
    bemerkung: text(b.bemerkung, 1000) || null,
    // Eine Pflicht-Checkbox deckt Berechtigung und Aufnahmen ab
    einwilligung_berechtigt: b.einwilligung === true,
    einwilligung_aufnahmen: b.einwilligung === true,
    einwilligung_kommunikation: b.einwilligung_kommunikation === true
  };

  if (!d.vorname || !d.nachname) return { fehler: 'Bitte geben Sie Ihren Namen an.' };
  if (!EMAIL_RE.test(d.email)) return { fehler: 'Bitte geben Sie eine gültige E-Mail-Adresse an.' };
  if (!d.strasse || !d.hausnummer || !d.ort) return { fehler: 'Bitte geben Sie die vollständige Adresse an.' };
  if (!/^\d{4}$/.test(d.plz)) return { fehler: 'Bitte geben Sie eine gültige Postleitzahl an.' };
  if (!imEinzugsgebiet(d.plz)) return { fehler: 'Diese Postleitzahl liegt ausserhalb unseres Einzugsgebiets.' };
  if (d.telefon.replace(/\D/g, '').length < 9) return { fehler: 'Bitte geben Sie eine gültige Telefonnummer an.' };
  if (!d.einwilligung_berechtigt) return { fehler: 'Bitte bestätigen Sie die Einwilligung.' };

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
  return { daten: d };
}

// ── Info-Mail intern ───────────────────────────────────────────────────
// Bewusst OHNE Personendaten: nur Referenz, Zeitpunkt und Link zur Übersicht.
// Die Angaben sieht man nach dem Login in der Übersicht (admin.html).
function mailInfo(ref) {
  const zeit = new Date().toLocaleString('de-CH', { timeZone: 'Europe/Zurich', dateStyle: 'short', timeStyle: 'short' });
  const link = (process.env.DC_UEBERSICHT_URL || config.email.uebersichtUrl) + '#' + ref;
  const text = 'Neue Drohnen-Check-Anfrage ' + ref + ' (' + zeit + ').\n\n' +
    'Anfrage ansehen:\n' + link;
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#25292E">' +
    '<p>Neue Drohnen-Check-Anfrage <strong>' + esc(ref) + '</strong> (' + esc(zeit) + ').</p>' +
    '<p><a href="' + esc(link) + '" style="display:inline-block;padding:10px 18px;background:#94621F;color:#fff;text-decoration:none;border-radius:6px">Anfrage ansehen</a></p></div>';
  return { text, html };
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
    return antwort(200, { referenz: 'DC-' + new Date().getFullYear() + '-0000' });
  }

  const { fehler, daten } = pruefen(body);
  if (fehler) return antwort(400, { error: fehler });

  let ergebnis;
  try {
    if (await zuVieleInsgesamt('drohnencheck_anfragen', parseInt(process.env.DC_LIMIT_GESAMT || '30', 10))) {
      console.warn('Drohnen-Check: Gesamtlimit pro Stunde erreicht');
      return antwort(429, { error: 'Zurzeit gehen sehr viele Anfragen ein. Bitte versuchen Sie es später nochmals oder rufen Sie uns an: ' + config.firma.telefon + '.' });
    }
    ergebnis = await rpc('drohnencheck_anfrage_erfassen', {
      p_daten: { ...daten, ip_hash: ipHash(event) },
      p_max_pro_stunde: parseInt(process.env.DC_RATE_LIMIT || '5', 10)
    });
  } catch (err) {
    console.error(err);
    return antwort(500, { error: 'Ihre Anfrage konnte nicht gespeichert werden. Bitte rufen Sie uns an: ' + config.firma.telefon + '.' });
  }
  if (ergebnis && ergebnis.error === 'rate_limit') {
    return antwort(429, { error: 'Es wurden zu viele Anfragen gesendet. Bitte versuchen Sie es später nochmals oder rufen Sie uns an: ' + config.firma.telefon + '.' });
  }
  const ref = ergebnis.referenz;

  // Nur Info-Mail an uns, keine Bestätigung an den Kunden
  const info = mailInfo(ref);
  const okIntern = await mailSenden({ an: process.env.DC_EMPFAENGER || config.email.empfaengerIntern, betreff: config.email.betreffIntern + ' ' + ref, html: info.html, text: info.text });
  await anfrageAktualisieren(ref, { mail_intern_ok: okIntern });

  return antwort(200, { referenz: ref });
};

// für Tests
exports._pruefen = pruefen;
exports._mailInfo = mailInfo;
