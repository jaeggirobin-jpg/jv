// dachcheck-bericht-ansehen.js — Veröffentlichten Bericht für den Kunden ausliefern (bericht.html?t=TOKEN)
// Öffentlich, aber nur mit dem zufälligen 32-Hex-Token und nur, solange der Bericht freigeschaltet ist.
// Gibt nur aus, was im Bericht steht (keine E-Mail, keine internen Notizen).
const { config, antwort, rest, signierteUrls } = require('./_lib/dachcheck');

const BILD_SEKUNDEN = 3600;   // Bilder bleiben eine Stunde ladbar, danach Seite neu laden

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return antwort(405, { error: 'Methode nicht erlaubt' });

  const token = String((event.queryStringParameters || {}).t || '');
  if (!/^[a-f0-9]{32}$/.test(token)) return antwort(404, { error: 'Bericht nicht gefunden' });

  try {
    const r = await rest('drohnencheck_berichte?token=eq.' + token + '&veroeffentlicht_at=not.is.null' +
      '&select=flugdatum,ampel,zusammenfassung,empfehlung,bilder,veroeffentlicht_at,' +
      'anfrage:drohnencheck_anfragen(referenz,vorname,nachname,strasse,hausnummer,plz,ort,status,created_at)');
    const b = r && r[0];
    if (!b || !b.anfrage) return antwort(404, { error: 'Bericht nicht gefunden' });

    const urls = await signierteUrls(b.bilder.map((x) => x.pfad), BILD_SEKUNDEN);
    const a = b.anfrage;
    const loeschdatum = a.status === 'auftrag'
      ? null
      : new Date(new Date(a.created_at).getTime() + config.loeschfristTage * 864e5).toISOString();

    return antwort(200, {
      referenz: a.referenz,
      name: a.vorname + ' ' + a.nachname,
      adresse: [a.strasse, a.hausnummer].filter(Boolean).join(' ') + ', ' + a.plz + ' ' + a.ort,
      flugdatum: b.flugdatum,
      ampel: b.ampel,
      zusammenfassung: b.zusammenfassung,
      empfehlung: b.empfehlung,
      bilder: b.bilder.filter((x) => urls[x.pfad]).map((x) => ({ url: urls[x.pfad], beschriftung: x.beschriftung })),
      erstellt: b.veroeffentlicht_at,
      loeschdatum
    });
  } catch (err) {
    console.error(err);
    return antwort(500, { error: 'Bericht konnte nicht geladen werden' });
  }
};
