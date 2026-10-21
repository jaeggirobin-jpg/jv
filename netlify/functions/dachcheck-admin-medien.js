// dachcheck-admin-medien.js — Titelvideo der Landingpage im Admin importieren (POST, Admin)
//
// Das Video wird im Browser verkleinert (admin.js) und dann direkt in den öffentlichen
// Bucket «drohnencheck-medien» geladen. Ablauf:
//   'laden'      → aktuelles Video und Standbild
//   'upload-url' → signierte Upload-URL für Video oder Standbild (Pfad hero/{zufall}.{ext})
//   'setzen'     → prüft beide Dateien, speichert sie als aktuell und löscht die alten
//   'entfernen'  → kein Titelvideo mehr, Dateien werden gelöscht
const crypto = require('crypto');
const { antwort, rest, uploadUrl, ordnerListe, bilderLoeschen, oeffentlicheUrl, BUCKET_MEDIEN } = require('./_lib/dachcheck');
const { checkAuth } = require('./_lib/auth');

const ORDNER = 'hero';
const TYPEN = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'image/jpeg': 'jpg' };
const MAX_GROESSE = 50 * 1024 * 1024;   // muss zum file_size_limit des Buckets passen
const PFAD_RE = /^hero\/[a-f0-9]{24}\.(mp4|webm|jpg)$/;

async function aktuell() {
  const r = await rest('drohnencheck_einstellungen?schluessel=eq.hero&select=wert,updated_at');
  return r && r[0] ? { ...r[0].wert, updated_at: r[0].updated_at } : null;
}

function mitUrls(w) {
  if (!w || !w.video) return null;
  return { ...w, video_url: oeffentlicheUrl(w.video), poster_url: w.poster ? oeffentlicheUrl(w.poster) : null };
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

  try {
    switch (b.action) {
      case 'laden':
        return antwort(200, { hero: mitUrls(await aktuell()) });

      case 'upload-url': {
        const ext = TYPEN[b.typ];
        if (!ext || (b.art === 'video') !== (ext !== 'jpg')) return antwort(400, { error: 'Ungültiger Dateityp' });
        if (!(Number(b.groesse) > 0) || Number(b.groesse) > MAX_GROESSE) return antwort(413, { error: 'Datei zu gross (max. 50 MB nach dem Verkleinern)' });
        const pfad = ORDNER + '/' + crypto.randomBytes(12).toString('hex') + '.' + ext;
        return antwort(200, { pfad, upload_url: await uploadUrl(pfad, BUCKET_MEDIEN) });
      }

      case 'setzen': {
        const video = String(b.video || '');
        const poster = b.poster ? String(b.poster) : null;
        if (!PFAD_RE.test(video) || /\.jpg$/.test(video)) return antwort(400, { error: 'Ungültiger Videopfad' });
        if (poster && (!PFAD_RE.test(poster) || !/\.jpg$/.test(poster))) return antwort(400, { error: 'Ungültiger Bildpfad' });
        const dateien = await ordnerListe(ORDNER, BUCKET_MEDIEN);
        const vDatei = dateien.find((d) => d.pfad === video);
        if (!vDatei) return antwort(400, { error: 'Hochgeladenes Video nicht gefunden' });
        if (poster && !dateien.some((d) => d.pfad === poster)) return antwort(400, { error: 'Hochgeladenes Standbild nicht gefunden' });
        const wert = {
          video,
          poster,
          groesse: vDatei.metadata.size || null,
          dauer: Number(b.dauer) > 0 ? Math.round(Number(b.dauer)) : null,
          breite: Number(b.breite) > 0 ? Math.round(Number(b.breite)) : null,
          hoehe: Number(b.hoehe) > 0 ? Math.round(Number(b.hoehe)) : null
        };
        await rest('drohnencheck_einstellungen?on_conflict=schluessel', {
          method: 'POST',
          body: { schluessel: 'hero', wert },
          prefer: 'resolution=merge-duplicates,return=representation'
        });
        // Alte Dateien (früheres Video, abgebrochene Uploads) entfernen
        const alt = dateien.map((d) => d.pfad).filter((x) => x !== video && x !== poster);
        await bilderLoeschen(alt, BUCKET_MEDIEN);
        return antwort(200, { hero: mitUrls(await aktuell()) });
      }

      case 'entfernen': {
        await rest('drohnencheck_einstellungen?schluessel=eq.hero', { method: 'DELETE' });
        const dateien = await ordnerListe(ORDNER, BUCKET_MEDIEN);
        await bilderLoeschen(dateien.map((d) => d.pfad), BUCKET_MEDIEN);
        return antwort(200, { hero: null });
      }

      default:
        return antwort(400, { error: 'Unbekannte Aktion' });
    }
  } catch (err) {
    console.error(err);
    return antwort(500, { error: 'Titelvideo konnte nicht verarbeitet werden' });
  }
};
