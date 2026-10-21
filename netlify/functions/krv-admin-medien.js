// krv-admin-medien.js — Anleitungsvideo der KRV-Landingpage im Admin importieren (POST, Admin)
//
// Gleicher Ablauf wie dachcheck-admin-medien.js, aber Bucket «krvcheck-medien», Ordner «anleitung»:
//   'laden'      → aktuelles Video und Standbild
//   'upload-url' → signierte Upload-URL für Video oder Standbild
//   'setzen'     → prüft beide Dateien, speichert sie als aktuell und löscht die alten
//   'entfernen'  → kein Anleitungsvideo mehr, Dateien werden gelöscht
const crypto = require('crypto');
const { antwort, rest, medienUploadUrl, medienListe, medienLoeschen, oeffentlicheUrl } = require('./_lib/krvcheck');
const { checkAuth } = require('./_lib/auth');

const ORDNER = 'anleitung';
const SCHLUESSEL = 'anleitung';
const TYPEN = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'image/jpeg': 'jpg' };
const MAX_GROESSE = 50 * 1024 * 1024;   // muss zum file_size_limit des Buckets passen
const PFAD_RE = /^anleitung\/[a-f0-9]{24}\.(mp4|webm|jpg)$/;

async function aktuell() {
  const r = await rest('krvcheck_einstellungen?schluessel=eq.' + SCHLUESSEL + '&select=wert,updated_at');
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
        return antwort(200, { video: mitUrls(await aktuell()) });

      case 'upload-url': {
        const ext = TYPEN[b.typ];
        if (!ext || (b.art === 'video') !== (ext !== 'jpg')) return antwort(400, { error: 'Ungültiger Dateityp' });
        if (!(Number(b.groesse) > 0) || Number(b.groesse) > MAX_GROESSE) return antwort(413, { error: 'Datei zu gross (max. 50 MB nach dem Verkleinern)' });
        const pfad = ORDNER + '/' + crypto.randomBytes(12).toString('hex') + '.' + ext;
        return antwort(200, { pfad, upload_url: await medienUploadUrl(pfad) });
      }

      case 'setzen': {
        const video = String(b.video || '');
        const poster = b.poster ? String(b.poster) : null;
        if (!PFAD_RE.test(video) || /\.jpg$/.test(video)) return antwort(400, { error: 'Ungültiger Videopfad' });
        if (poster && (!PFAD_RE.test(poster) || !/\.jpg$/.test(poster))) return antwort(400, { error: 'Ungültiger Bildpfad' });
        const dateien = await medienListe(ORDNER);
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
        await rest('krvcheck_einstellungen?on_conflict=schluessel', {
          method: 'POST',
          body: { schluessel: SCHLUESSEL, wert },
          prefer: 'resolution=merge-duplicates,return=representation'
        });
        const alt = dateien.map((d) => d.pfad).filter((x) => x !== video && x !== poster);
        await medienLoeschen(alt);
        return antwort(200, { video: mitUrls(await aktuell()) });
      }

      case 'entfernen': {
        await rest('krvcheck_einstellungen?schluessel=eq.' + SCHLUESSEL, { method: 'DELETE' });
        const dateien = await medienListe(ORDNER);
        await medienLoeschen(dateien.map((d) => d.pfad));
        return antwort(200, { video: null });
      }

      default:
        return antwort(400, { error: 'Unbekannte Aktion' });
    }
  } catch (err) {
    console.error(err);
    return antwort(500, { error: 'Anleitungsvideo konnte nicht verarbeitet werden' });
  }
};
