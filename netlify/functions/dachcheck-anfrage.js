// dachcheck-anfrage.js — Neue Drohnen-Check-Anfrage entgegennehmen, speichern und Info-Mail senden
const { config, antwort, ipHash, rpc, anfrageAktualisieren, mailSenden, imEinzugsgebiet, esc } = require('./_lib/dachcheck');

const GEBAEUDETYPEN = ['Einfamilienhaus', 'Mehrfamilienhaus', 'Gewerbe', 'anderes'];
const DACHFORMEN = ['Steildach', 'Flachdach', 'weiss nicht'];
const ROLLEN = ['Eigentümer', 'Verwaltung', 'Mieter'];
const KANAELE = ['E-Mail', 'WhatsApp'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TERMIN_RE = /^\d{4}-\d{2}-\d{2}_(vm|nm)$/;

function text(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// Eingaben serverseitig prüfen. Gibt { fehler } oder { daten } zurück.
function pruefen(b) {
  const d = {
    strasse: text(b.strasse, 120),
    hausnummer: text(b.hausnummer, 20),
    plz: text(b.plz, 4),
    ort: text(b.ort, 80),
    gebaeudetyp: text(b.gebaeudetyp, 40),
    dachform: text(b.dachform, 40),
    rolle: text(b.rolle, 40),
    baujahr: b.baujahr ? String(b.baujahr).trim() : '',
    bemerkung: text(b.bemerkung, 1000) || null,
    vorname: text(b.vorname, 80),
    nachname: text(b.nachname, 80),
    telefon: text(b.telefon, 40),
    email: text(b.email, 200).toLowerCase(),
    kanal: text(b.kanal, 20),
    wunschtermine: Array.isArray(b.termine) ? b.termine.filter((t) => TERMIN_RE.test(t)).slice(0, config.termine.maxAuswahl) : [],
    einwilligung_berechtigt: b.einwilligung_berechtigt === true,
    einwilligung_aufnahmen: b.einwilligung_aufnahmen === true,
    einwilligung_kommunikation: b.einwilligung_kommunikation === true
  };

  if (!d.strasse || !d.hausnummer || !d.ort) return { fehler: 'Bitte geben Sie die vollständige Adresse an.' };
  if (!/^\d{4}$/.test(d.plz)) return { fehler: 'Bitte geben Sie eine gültige Postleitzahl an.' };
  if (!imEinzugsgebiet(d.plz)) return { fehler: 'Diese Postleitzahl liegt ausserhalb unseres Einzugsgebiets.' };
  if (!GEBAEUDETYPEN.includes(d.gebaeudetyp) || !DACHFORMEN.includes(d.dachform) || !ROLLEN.includes(d.rolle)) {
    return { fehler: 'Bitte machen Sie die Angaben zum Gebäude.' };
  }
  if (d.baujahr && !/^\d{4}$/.test(d.baujahr)) return { fehler: 'Bitte geben Sie das Baujahr als Jahreszahl an.' };
  if (!d.vorname || !d.nachname) return { fehler: 'Bitte geben Sie Ihren Namen an.' };
  if (d.telefon.replace(/\D/g, '').length < 9) return { fehler: 'Bitte geben Sie eine gültige Telefonnummer an.' };
  if (!EMAIL_RE.test(d.email)) return { fehler: 'Bitte geben Sie eine gültige E-Mail-Adresse an.' };
  if (!KANAELE.includes(d.kanal)) return { fehler: 'Bitte wählen Sie, wie Sie den Report erhalten möchten.' };
  if (d.wunschtermine.length < config.termine.minAuswahl) {
    return { fehler: 'Bitte wählen Sie mindestens ' + config.termine.minAuswahl + ' Wunschtermine.' };
  }
  if (!d.einwilligung_berechtigt || !d.einwilligung_aufnahmen) {
    return { fehler: 'Bitte bestätigen Sie die beiden Pflicht-Einwilligungen.' };
  }

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
