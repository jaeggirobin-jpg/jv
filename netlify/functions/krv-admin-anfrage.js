// krv-admin-anfrage.js — Eine KRV-Check-Anfrage im Admin ansehen und beurteilen (POST, Admin)
//
//   'fotos'     → kurz gültige Links zu allen Fotos im Bucket (auch nicht abgeschlossene Uploads)
//   'speichern' → Status, Beurteilung, Text für den Kunden und interne Notiz
const { antwort, rest, ordnerListe, signierteUrls, REFERENZ_RE } = require('./_lib/krvcheck');
const { checkAuth } = require('./_lib/auth');

// Muss zum CHECK-Constraint in migration_013_krvcheck.sql passen
const STATUS = ['neu', 'beurteilt', 'offerte', 'auftrag', 'abgeschlossen', 'abgesagt'];
const BEURTEILUNG = ['vorhanden', 'fehlt', 'unklar'];
const FOTO_SEKUNDEN = 3600;
const RUECKGABE = 'referenz,status,beurteilung,beurteilung_text,beurteilt_at,notiz_intern,updated_at';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return antwort(405, { error: 'Methode nicht erlaubt' });
  if (!checkAuth(event)) return antwort(401, { error: 'Nicht autorisiert' });

  let b;
  try {
    b = JSON.parse(event.body || '{}');
  } catch (e) {
    return antwort(400, { error: 'Ungültige Anfrage' });
  }
  const referenz = typeof b.referenz === 'string' ? b.referenz.trim() : '';
  if (!REFERENZ_RE.test(referenz)) return antwort(400, { error: 'Ungültige Referenz' });

  try {
    const r = await rest('krvcheck_anfragen?referenz=eq.' + encodeURIComponent(referenz) + '&select=id,status,beurteilung');
    const a = r && r[0];
    if (!a) return antwort(404, { error: 'Anfrage nicht gefunden' });

    if (b.action === 'fotos') {
      const dateien = await ordnerListe(a.id);
      // Neueste zuletzt, so wie der Kunde sie hochgeladen hat
      dateien.sort((x, y) => String(x.metadata.lastModified || '').localeCompare(String(y.metadata.lastModified || '')));
      const urls = await signierteUrls(dateien.map((d) => d.pfad), FOTO_SEKUNDEN);
      return antwort(200, { fotos: dateien.filter((d) => urls[d.pfad]).map((d) => ({ pfad: d.pfad, url: urls[d.pfad], groesse: d.metadata.size || null })) });
    }

    if (b.action === 'speichern') {
      const felder = {};
      if (b.status !== undefined) {
        if (!STATUS.includes(b.status)) return antwort(400, { error: 'Ungültiger Status' });
        felder.status = b.status;
      }
      if (b.beurteilung !== undefined) {
        if (b.beurteilung !== null && !BEURTEILUNG.includes(b.beurteilung)) return antwort(400, { error: 'Ungültige Beurteilung' });
        felder.beurteilung = b.beurteilung;
        if (b.beurteilung !== a.beurteilung) felder.beurteilt_at = b.beurteilung ? new Date().toISOString() : null;
        // Beurteilt, solange die Anfrage noch neu ist
        if (b.beurteilung && (felder.status || a.status) === 'neu') felder.status = 'beurteilt';
      }
      ['beurteilung_text', 'notiz_intern'].forEach((k) => {
        if (b[k] === undefined) return;
        felder[k] = typeof b[k] === 'string' && b[k].trim() ? b[k].trim().slice(0, 4000) : null;
      });
      if (!Object.keys(felder).length) return antwort(400, { error: 'Nichts zu ändern' });
      const neu = await rest('krvcheck_anfragen?id=eq.' + a.id + '&select=' + RUECKGABE, { method: 'PATCH', body: felder });
      return antwort(200, neu[0]);
    }

    return antwort(400, { error: 'Unbekannte Aktion' });
  } catch (err) {
    console.error(err);
    return antwort(500, { error: 'Anfrage konnte nicht verarbeitet werden' });
  }
};
