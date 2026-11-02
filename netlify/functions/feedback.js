// feedback.js — Feedback aus der Plattform und den Tools (Vorlage: GEMA Beta, feedback-senden.js)
//
// POST /api/feedback { aktion: 'senden', eintrag, bild }      → { ok, id, schon? }   (jede angemeldete Person)
//      eintrag: { id: 'fb_…', seite, seite_name, url, typ, text, autor, meta }
//      bild:    'data:image/jpeg;base64,…' (optional, der markierte Bildausschnitt)
//      Derselbe Eintrag (gleiche id) wird nie doppelt gespeichert: die Warteschlange im Browser darf
//      nach einem Netzabbruch einfach nochmals senden.
// GET  /api/feedback?aktion=liste                            → { eintraege }          (nur Admins)
// GET  /api/feedback?bild=<id>[&direkt=1]                    → Bild (Weiterleitung auf eine kurz gültige
//      signierte URL; mit direkt=1 die Bilddaten selbst, für den Markdown-Export)    (nur Admins)
// POST /api/feedback { aktion: 'aendern', ids, status?, umsetzen? }  → { eintraege }  (nur Admins)
// POST /api/feedback { aktion: 'loeschen', ids }                     → { geloescht }  (nur Admins)
//
// Absender: Name und Login kommen aus der Sitzung, nie vom Browser. Nur beim Hauptzugang (ohne
// persönliches Login) gilt der Name aus dem Formular.

const crypto = require('crypto');
const a = require('./_lib/auth');
const t = require('./_lib/tools');

const BUCKET = 'feedback';
const MAX_BILD = 4500000;          // Zeichen des Base64-Bildes (≈ 3,3 MB JPEG); Functions nehmen max. 6 MB an
const MAX_TEXT = 20000;
const MAX_LISTE = 2000;
const GUELTIG_SEK = 600;
const CACHE_SEK = 300;
const TYPEN = ['kommentar', 'aenderung', 'fehler'];
const STATUS = ['offen', 'bearbeitung', 'erledigt'];
const SCHRITTE = ['snip', 'annot', 'form'];
const ID_RE = /^fb_[A-Za-z0-9_-]{4,60}$/;
const SEITE_RE = /^[a-z0-9-]{2,60}$/;

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function text(status, meldung) {
  return { statusCode: status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: meldung };
}

// Nur der Pfad mit Anker, ohne Domain und ohne Tokens (?t=…) – reicht, um die Stelle wiederzufinden
function urlText(u) {
  const s = str(u, 500);
  if (!/^\/(?!\/)[^\s<>"'`\\]*$/.test(s)) return '';      // nur eigene Seiten, kein «//andere-domain»
  return s.replace(/([?&])(t|token)=[^&#]*/gi, '$1$2=…');
}

function metaAus(roh) {
  const m = roh && typeof roh === 'object' && !Array.isArray(roh) ? roh : {};
  const aus = {};
  const bildschirm = str(m.bildschirm, 40);
  if (/^[0-9]{2,5} × [0-9]{2,5}( @[0-9.]{1,4}x)?$/.test(bildschirm)) aus.bildschirm = bildschirm;
  const browser = str(m.browser, 200);
  if (browser) aus.browser = browser.replace(/[<>"'`]/g, '');
  if (SCHRITTE.indexOf(m.schritt) >= 0) aus.schritt = m.schritt;
  if (m.aufgenommen_in && typeof m.aufgenommen_in === 'object') {
    const id = str(m.aufgenommen_in.id, 60);
    aus.aufgenommen_in = { id: SEITE_RE.test(id) ? id : '', name: str(m.aufgenommen_in.name, 120) };
  }
  if (m.bild_weg === true) aus.bild_weg = true;
  return aus;
}

function ausgabe(e) {
  return {
    id: e.id, clientId: e.client_id, seite: e.seite, seiteName: e.seite_name, url: e.url, typ: e.typ, text: e.text,
    autor: e.autor, bild: !!e.bild_pfad, bildWeg: e.bild_weg, meta: e.meta || {}, status: e.status,
    umsetzen: e.umsetzen, erstellt: e.erstellt, geaendert: e.geaendert, erledigtAm: e.erledigt_am
  };
}

function idsListe(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 500) return null;
  return ids.every((id) => a.UUID_RE.test(String(id))) ? ids : null;
}

async function senden(b, wer) {
  const e = b.eintrag && typeof b.eintrag === 'object' ? b.eintrag : null;
  if (!e) return t.json(400, { error: 'Eintrag fehlt' });
  if (!ID_RE.test(String(e.id || ''))) return t.json(400, { error: 'Ungültige ID' });
  if (!SEITE_RE.test(String(e.seite || ''))) return t.json(400, { error: 'Ungültige Seite' });
  const inhalt = typeof e.text === 'string' ? e.text.trim() : '';
  if (!inhalt) return t.json(400, { error: 'Bitte beschreiben, was auffällt.' });
  if (inhalt.length > MAX_TEXT) return t.json(413, { error: 'Text zu lang: ' + inhalt.length + ' Zeichen (höchstens ' + MAX_TEXT + ')' });

  // Schon da? (nachgesendet aus der Warteschlange)
  const vorhanden = await t.rest('plattform_feedback?select=id&client_id=eq.' + encodeURIComponent(e.id));
  if (vorhanden && vorhanden[0]) return t.json(200, { ok: true, id: vorhanden[0].id, schon: true });

  let jpeg = null;
  if (typeof b.bild === 'string' && b.bild) {
    if (b.bild.length > MAX_BILD) return t.json(413, { error: 'Bild zu gross: ' + b.bild.length + ' Zeichen (höchstens ' + MAX_BILD + ')' });
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(b.bild);
    if (!m) return t.json(400, { error: 'Das Bild muss ein JPEG sein' });
    jpeg = Buffer.from(m[1], 'base64');
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) return t.json(400, { error: 'Das Bild ist kein gültiges JPEG' });
  }

  // Absender aus der Sitzung; nur der Hauptzugang nennt sich im Formular
  const autor = wer.hauptzugang ? (str(e.autor, 80) || 'Hauptzugang') : wer.name;
  const meta = metaAus(e.meta);
  if (!wer.hauptzugang) meta.login = { id: wer.id, email: wer.email };

  const zeile = {
    client_id: e.id,
    seite: e.seite,
    seite_name: str(e.seite_name, 120),
    url: urlText(e.url),
    typ: TYPEN.indexOf(e.typ) >= 0 ? e.typ : 'kommentar',
    text: inhalt,
    autor,
    bild_weg: !jpeg && meta.bild_weg === true,
    meta
  };

  let pfad = null;
  if (jpeg) {
    const jetzt = new Date();
    pfad = jetzt.toISOString().slice(0, 7) + '/' + crypto.randomUUID() + '.jpg';
    await t.speichern(BUCKET, pfad, jpeg, 'image/jpeg');
    zeile.bild_pfad = pfad;
  }
  try {
    const r = await t.rest('plattform_feedback', { method: 'POST', body: zeile });
    return t.json(200, { ok: true, id: r[0].id });
  } catch (err) {
    if (pfad) await bildLoeschen([pfad]).catch(() => {});
    // Gleichzeitig zweimal gesendet: der andere Aufruf hat gespeichert
    if (/\b409\b|23505|duplicate key/i.test(String(err.message))) {
      const r = await t.rest('plattform_feedback?select=id&client_id=eq.' + encodeURIComponent(e.id));
      if (r && r[0]) return t.json(200, { ok: true, id: r[0].id, schon: true });
    }
    throw err;
  }
}

async function bildLoeschen(pfade) {
  if (!pfade.length) return;
  await t.dc.bilderLoeschen(pfade, BUCKET);
}

async function bild(q, event) {
  if (!a.UUID_RE.test(String(q.bild || ''))) return text(404, 'Nicht gefunden');
  const r = await t.rest('plattform_feedback?select=bild_pfad&id=eq.' + q.bild);
  const pfad = r && r[0] && r[0].bild_pfad;
  if (!pfad) return text(404, 'Nicht gefunden');
  if (q.direkt === '1') {
    const daten = await t.lesen(BUCKET, pfad);
    if (!daten) return text(404, 'Nicht gefunden');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
      body: daten.toString('base64'),
      isBase64Encoded: true
    };
  }
  const urls = await t.dc.signierteUrls([pfad], GUELTIG_SEK, BUCKET);
  if (!urls[pfad]) return text(404, 'Nicht gefunden');
  return {
    statusCode: 302,
    headers: { Location: urls[pfad], 'Cache-Control': 'private, max-age=' + CACHE_SEK, 'Referrer-Policy': 'no-referrer' },
    body: ''
  };
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  try {
    // Bilder: <img>-Abrufe senden keinen eigenen Header, das Cookie genügt
    if (event.httpMethod === 'GET' && q.bild) {
      const wer = await a.anmeldungDatei(event);
      if (!wer) return text(401, 'Nicht angemeldet');
      if (!a.darf(wer, a.VERWALTUNG)) return text(403, 'Nur für Admins');
      return await bild(q, event);
    }

    const wer = await a.anmeldung(event);
    if (!wer) return t.json(401, { error: 'Nicht angemeldet', code: 'not_granted' });

    if (event.httpMethod === 'GET') {
      if (!a.darf(wer, a.VERWALTUNG)) return t.json(403, { error: 'Das Feedback-Board ist nur für Admins.' });
      const r = await t.rest('plattform_feedback?select=*&order=erstellt.desc&limit=' + MAX_LISTE);
      return t.json(200, { eintraege: (r || []).map(ausgabe) });
    }
    if (event.httpMethod !== 'POST') return t.json(405, { error: 'Methode nicht erlaubt' });
    const b = t.body(event);
    if (!b) return t.json(400, { error: 'Ungültiges JSON' });

    if (b.aktion === 'senden') return await senden(b, wer);

    if (!a.darf(wer, a.VERWALTUNG)) return t.json(403, { error: 'Das Feedback-Board ist nur für Admins.' });

    if (b.aktion === 'aendern') {
      const ids = idsListe(b.ids);
      if (!ids) return t.json(400, { error: 'Ungültige Auswahl' });
      const felder = {};
      if (b.status !== undefined) {
        if (STATUS.indexOf(b.status) < 0) return t.json(400, { error: 'Ungültiger Status' });
        felder.status = b.status;
      }
      if (b.umsetzen !== undefined) felder.umsetzen = b.umsetzen === true;
      if (!Object.keys(felder).length) return t.json(400, { error: 'Nichts zu ändern' });
      const r = await t.rest('plattform_feedback?id=in.(' + ids.join(',') + ')', { method: 'PATCH', body: felder });
      return t.json(200, { eintraege: (r || []).map(ausgabe) });
    }

    if (b.aktion === 'loeschen') {
      const ids = idsListe(b.ids);
      if (!ids) return t.json(400, { error: 'Ungültige Auswahl' });
      const r = await t.rest('plattform_feedback?id=in.(' + ids.join(',') + ')&select=id,bild_pfad', { method: 'DELETE' });
      const pfade = (r || []).map((x) => x.bild_pfad).filter(Boolean);
      if (pfade.length) await bildLoeschen(pfade).catch((e) => console.error('feedback: Bilder nicht gelöscht', e.message));
      return t.json(200, { geloescht: (r || []).length });
    }

    return t.json(400, { error: 'Unbekannte Aktion' });
  } catch (err) {
    console.error('feedback', err);
    if (/plattform_feedback/.test(String(err.message)) && /\b404\b|42P01|does not exist|schema cache/i.test(String(err.message))) {
      return t.json(500, { error: 'Die Tabelle «plattform_feedback» fehlt noch. Bitte migration_016_feedback.sql in Supabase ausführen.' });
    }
    return t.json(500, { error: 'Feedback-Speicher nicht erreichbar' });
  }
};
