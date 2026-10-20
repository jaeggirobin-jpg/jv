// anfrage.js — Neue Drohnen-Check-Anfrage entgegennehmen, speichern und Mails versenden
const { config, antwort, ipHash, rpc, anfrageAktualisieren, mailSenden, imEinzugsgebiet, esc, terminLabel } = require('../lib/gemeinsam');

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

// ── Mail-Inhalte ───────────────────────────────────────────────────────
function mailKunde(ref, d) {
  const F = config.firma;
  const termine = d.wunschtermine.map(terminLabel);
  const text = [
    'Guten Tag ' + d.vorname + ' ' + d.nachname,
    '',
    'Vielen Dank für Ihre Anfrage für den Gratis Drohnen-Check. Ihre Referenznummer: ' + ref,
    '',
    'Ihre Angaben',
    'Adresse: ' + d.strasse + ' ' + d.hausnummer + ', ' + d.plz + ' ' + d.ort,
    'Gebäude: ' + d.gebaeudetyp + ', ' + d.dachform,
    'Wunschtermine: ' + termine.join('; '),
    'Report per: ' + d.kanal,
    '',
    'So geht es weiter',
    ...config.texte.danke.naechsteSchritte.map((s, i) => (i + 1) + '. ' + s),
    '',
    config.texte.formular.terminHinweis,
    '',
    'Freundliche Grüsse',
    F.name,
    F.strasse + ', ' + F.ort,
    F.telefon + ' · ' + F.email
  ].join('\n');

  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#25292E;max-width:560px">' +
    '<p>Guten Tag ' + esc(d.vorname) + ' ' + esc(d.nachname) + '</p>' +
    '<p>Vielen Dank für Ihre Anfrage für den Gratis Drohnen-Check.</p>' +
    '<p style="font-size:13px;color:#5C636B;margin-bottom:2px">Ihre Referenznummer</p>' +
    '<p style="font-size:22px;font-weight:bold;color:#94621F;margin-top:0">' + esc(ref) + '</p>' +
    '<table style="border-collapse:collapse;font-size:14px;margin:12px 0">' +
    zeile('Adresse', d.strasse + ' ' + d.hausnummer + ', ' + d.plz + ' ' + d.ort) +
    zeile('Gebäude', d.gebaeudetyp + ', ' + d.dachform) +
    zeile('Wunschtermine', termine.join('<br>'), true) +
    zeile('Report per', d.kanal) +
    '</table>' +
    '<p><strong>So geht es weiter</strong></p><ol>' +
    config.texte.danke.naechsteSchritte.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' +
    '<p>' + esc(config.texte.formular.terminHinweis) + '</p>' +
    '<p>Freundliche Grüsse<br>' + esc(F.name) + '</p>' +
    '<p style="font-size:13px;color:#5C636B">' + esc(F.strasse) + ', ' + esc(F.ort) + '<br>' + esc(F.telefon) + ' · ' + esc(F.email) + '</p>' +
    '</div>';
  return { text, html };
}

function zeile(label, wert, roh) {
  return '<tr><td style="padding:4px 14px 4px 0;color:#5C636B;vertical-align:top;white-space:nowrap">' + esc(label) + '</td>' +
    '<td style="padding:4px 0">' + (roh ? wert : esc(wert)) + '</td></tr>';
}

function mailIntern(ref, d) {
  const adresse = d.strasse + ' ' + d.hausnummer + ', ' + d.plz + ' ' + d.ort;
  const maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(adresse + ', Schweiz');
  const extra = d.utm_extra || {};
  const termine = d.wunschtermine.map(terminLabel);

  const felder = [
    ['Referenz', ref],
    ['Name', d.vorname + ' ' + d.nachname],
    ['Telefon', d.telefon],
    ['E-Mail', d.email],
    ['Report per', d.kanal],
    ['Adresse', adresse],
    ['Gebäudetyp', d.gebaeudetyp],
    ['Dachform', d.dachform],
    ['Rolle', d.rolle + (d.rolle === 'Mieter' ? ' (Zustimmung Eigentümer einholen)' : '')],
    ['Baujahr', d.baujahr || '–'],
    ['Bemerkung', d.bemerkung || '–'],
    ['Wunschtermine', termine.join('; ')],
    ['Einw. berechtigt', d.einwilligung_berechtigt ? 'ja' : 'nein'],
    ['Einw. Aufnahmen', d.einwilligung_aufnahmen ? 'ja' : 'nein'],
    ['Einw. Kommunikation', d.einwilligung_kommunikation ? 'ja' : 'nein'],
    ['utm_source', d.utm_source || '–'],
    ['utm_medium', d.utm_medium || '–'],
    ['utm_campaign', d.utm_campaign || '–'],
    ['utm_content', d.utm_content || '–'],
    ['utm_term', d.utm_term || '–'],
    ['fbclid', extra.fbclid ? 'vorhanden' : '–'],
    ['Landingpage', extra.landing || '–'],
    ['Referrer', extra.referrer || '–']
  ];

  const text = 'Neue Drohnen-Check-Anfrage ' + ref + '\n\n' +
    felder.map(([k, v]) => k + ': ' + v).join('\n') + '\n\nGoogle Maps: ' + maps;

  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#25292E">' +
    '<h2 style="font-size:18px;margin:0 0 12px">Neue Drohnen-Check-Anfrage ' + esc(ref) + '</h2>' +
    '<p><a href="' + esc(maps) + '">Adresse in Google Maps öffnen</a> · <a href="tel:' + esc(d.telefon.replace(/[^\d+]/g, '')) + '">anrufen</a></p>' +
    '<table style="border-collapse:collapse">' + felder.map(([k, v]) => zeile(k, v)).join('') + '</table>' +
    '</div>';
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

  const kunde = mailKunde(ref, daten);
  const intern = mailIntern(ref, daten);
  const [okKunde, okIntern] = await Promise.all([
    mailSenden({ an: daten.email, betreff: config.email.betreffKunde + ' (' + ref + ')', html: kunde.html, text: kunde.text, antwortAn: config.firma.email }),
    mailSenden({ an: process.env.DC_EMPFAENGER || config.email.empfaengerIntern, betreff: config.email.betreffIntern + ' ' + ref + ' · ' + daten.plz + ' ' + daten.ort, html: intern.html, text: intern.text, antwortAn: daten.email })
  ]);
  await anfrageAktualisieren(ref, { mail_kunde_ok: okKunde, mail_intern_ok: okIntern });

  return antwort(200, { referenz: ref });
};

// für Tests
exports._pruefen = pruefen;
exports._mailIntern = mailIntern;
exports._mailKunde = mailKunde;
