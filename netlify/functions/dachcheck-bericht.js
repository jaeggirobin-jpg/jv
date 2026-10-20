// dachcheck-bericht.js — Bericht zu einer Anfrage im Admin erstellen und bearbeiten
//
// POST mit { action, referenz, ... } und Admin-Passwort:
//   'laden'            → Bericht (oder null) plus signierte Vorschau-URLs der Bilder
//   'upload-url'       → signierte Upload-URL für ein neues Bild (Browser lädt direkt in den Bucket)
//   'bild-hinzufuegen' → prüft das hochgeladene Bild und hängt es an den Bericht
//   'bild-loeschen'    → entfernt ein Bild aus Bericht und Bucket
//   'speichern'        → Flugdatum, Ampel, Texte, Reihenfolge und Beschriftungen
//   'veroeffentlichen' → Kundenlink freischalten oder sperren
//
// Bilder liegen im privaten Bucket «drohnencheck» unter {anfrage_id}/{zufall}.{ext}, nie als Base64.

const crypto = require('crypto');
const { antwort, rest, uploadUrl, signierteUrls, ordnerListe, bilderLoeschen } = require('./_lib/dachcheck');
const { checkAuth } = require('./_lib/auth');

const AMPEL = ['gut', 'beobachten', 'handlung'];
const TYPEN = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BILDER = 12;
const MAX_GROESSE = 10 * 1024 * 1024;   // muss zum file_size_limit des Buckets passen
const VORSCHAU_SEKUNDEN = 3600;
const SPALTEN = 'id,anfrage_id,token,flugdatum,ampel,zusammenfassung,empfehlung,bilder,veroeffentlicht_at,created_at,updated_at';

async function anfrageHolen(referenz) {
  const r = await rest('drohnencheck_anfragen?referenz=eq.' + encodeURIComponent(referenz) + '&select=id,referenz,status');
  return r && r[0];
}

async function berichtHolen(anfrageId) {
  const r = await rest('drohnencheck_berichte?anfrage_id=eq.' + anfrageId + '&select=' + SPALTEN);
  return r && r[0];
}

// Bericht anlegen, falls es noch keinen gibt (Token für den Kundenlink gleich mit erzeugen)
async function berichtSicherstellen(anfrageId) {
  const vorhanden = await berichtHolen(anfrageId);
  if (vorhanden) return vorhanden;
  const r = await rest('drohnencheck_berichte?select=' + SPALTEN, {
    method: 'POST',
    body: { anfrage_id: anfrageId, token: crypto.randomBytes(16).toString('hex') }
  });
  return r[0];
}

async function berichtAendern(id, felder) {
  const r = await rest('drohnencheck_berichte?id=eq.' + id + '&select=' + SPALTEN, { method: 'PATCH', body: felder });
  return r[0];
}

// Bericht für den Admin mit kurz gültigen Bild-URLs anreichern
async function mitUrls(bericht) {
  if (!bericht) return null;
  const urls = await signierteUrls(bericht.bilder.map((b) => b.pfad), VORSCHAU_SEKUNDEN);
  return { ...bericht, bilder: bericht.bilder.map((b) => ({ ...b, url: urls[b.pfad] || null })) };
}

function text(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return antwort(405, { error: 'Methode nicht erlaubt' });
  if (!checkAuth(event)) return antwort(401, { error: 'Nicht autorisiert' });

  let b;
  try {
    b = JSON.parse(event.body || '{}');
  } catch (e) {
    return antwort(400, { error: 'Ungültige Anfrage' });
  }

  const referenz = text(b.referenz, 40);
  if (!/^DC-\d{4}-\d{4,}$/.test(referenz)) return antwort(400, { error: 'Ungültige Referenz' });

  try {
    const anfrage = await anfrageHolen(referenz);
    if (!anfrage) return antwort(404, { error: 'Anfrage nicht gefunden' });

    switch (b.action) {
      case 'laden': {
        return antwort(200, { bericht: await mitUrls(await berichtHolen(anfrage.id)) });
      }

      case 'upload-url': {
        const ext = TYPEN[b.typ];
        if (!ext) return antwort(400, { error: 'Nur JPG, PNG oder WebP' });
        if (!(Number(b.groesse) > 0) || Number(b.groesse) > MAX_GROESSE) return antwort(413, { error: 'Bild zu gross (max. 10 MB)' });
        const bericht = await berichtHolen(anfrage.id);
        if (bericht && bericht.bilder.length >= MAX_BILDER) return antwort(400, { error: 'Höchstens ' + MAX_BILDER + ' Bilder pro Bericht' });
        const pfad = anfrage.id + '/' + crypto.randomBytes(12).toString('hex') + '.' + ext;
        return antwort(200, { pfad, upload_url: await uploadUrl(pfad) });
      }

      case 'bild-hinzufuegen': {
        const pfad = text(b.pfad, 200);
        if (!new RegExp('^' + anfrage.id + '/[a-f0-9]{24}\\.(jpg|png|webp)$').test(pfad)) return antwort(400, { error: 'Ungültiger Bildpfad' });
        // Datei muss wirklich im Bucket liegen (Grösse und Typ prüft der Bucket selbst)
        const datei = (await ordnerListe(anfrage.id)).find((d) => d.pfad === pfad);
        if (!datei) return antwort(400, { error: 'Hochgeladenes Bild nicht gefunden' });
        const bericht = await berichtSicherstellen(anfrage.id);
        if (bericht.bilder.some((x) => x.pfad === pfad)) return antwort(200, { bericht: await mitUrls(bericht) });
        if (bericht.bilder.length >= MAX_BILDER) {
          await bilderLoeschen([pfad]);
          return antwort(400, { error: 'Höchstens ' + MAX_BILDER + ' Bilder pro Bericht' });
        }
        const neu = await berichtAendern(bericht.id, { bilder: bericht.bilder.concat([{ pfad, beschriftung: '' }]) });
        return antwort(200, { bericht: await mitUrls(neu) });
      }

      case 'bild-loeschen': {
        const pfad = text(b.pfad, 200);
        const bericht = await berichtHolen(anfrage.id);
        if (!bericht || !bericht.bilder.some((x) => x.pfad === pfad)) return antwort(404, { error: 'Bild nicht gefunden' });
        await bilderLoeschen([pfad]);
        const neu = await berichtAendern(bericht.id, { bilder: bericht.bilder.filter((x) => x.pfad !== pfad) });
        return antwort(200, { bericht: await mitUrls(neu) });
      }

      case 'speichern': {
        const felder = {
          flugdatum: b.flugdatum || null,
          ampel: b.ampel || null,
          zusammenfassung: text(b.zusammenfassung, 4000) || null,
          empfehlung: text(b.empfehlung, 4000) || null
        };
        if (felder.flugdatum && !/^\d{4}-\d{2}-\d{2}$/.test(felder.flugdatum)) return antwort(400, { error: 'Ungültiges Flugdatum' });
        if (felder.ampel && !AMPEL.includes(felder.ampel)) return antwort(400, { error: 'Ungültige Ampel' });
        const bericht = await berichtSicherstellen(anfrage.id);
        // Reihenfolge und Beschriftungen: nur bereits bekannte Bilder, keines darf verloren gehen
        if (Array.isArray(b.bilder)) {
          const bekannt = new Set(bericht.bilder.map((x) => x.pfad));
          const neu = b.bilder
            .filter((x) => x && bekannt.has(x.pfad))
            .map((x) => ({ pfad: x.pfad, beschriftung: text(x.beschriftung, 300) }));
          if (new Set(neu.map((x) => x.pfad)).size !== bekannt.size) return antwort(409, { error: 'Bilder haben sich geändert. Bitte neu laden.' });
          felder.bilder = neu;
        }
        return antwort(200, { bericht: await mitUrls(await berichtAendern(bericht.id, felder)) });
      }

      case 'veroeffentlichen': {
        const bericht = await berichtHolen(anfrage.id);
        if (!bericht) return antwort(404, { error: 'Noch kein Bericht vorhanden' });
        if (b.veroeffentlicht) {
          if (!bericht.ampel) return antwort(400, { error: 'Bitte zuerst die Ampel wählen und speichern' });
          if (!bericht.bilder.length) return antwort(400, { error: 'Bitte mindestens ein Bild hochladen' });
        }
        const neu = await berichtAendern(bericht.id, { veroeffentlicht_at: b.veroeffentlicht ? new Date().toISOString() : null });
        // Status nachführen, solange die Anfrage noch nicht weiter ist
        let status = anfrage.status;
        if (b.veroeffentlicht && ['neu', 'termin', 'geflogen'].includes(status)) {
          await rest('drohnencheck_anfragen?id=eq.' + anfrage.id, { method: 'PATCH', body: { status: 'report' } });
          status = 'report';
        }
        return antwort(200, { bericht: await mitUrls(neu), status });
      }

      default:
        return antwort(400, { error: 'Unbekannte Aktion' });
    }
  } catch (err) {
    console.error(err);
    return antwort(500, { error: 'Bericht konnte nicht verarbeitet werden' });
  }
};
