// dachcheck-loeschroutine.js — Geplante Function (täglich, siehe netlify.toml)
// Löscht Anfragen ohne Auftrag nach der Löschfrist aus config.js (Standard 60 Tage),
// samt Bericht (ON DELETE CASCADE) und den Bildern im Bucket (Ordner = anfrage_id).
const { config, rpc, ordnerLoeschen } = require('./_lib/dachcheck');

exports.handler = async () => {
  try {
    const r = await rpc('drohnencheck_loeschen', { p_tage: config.loeschfristTage });
    let bilder = 0;
    for (const id of (r && r.ids) || []) {
      try {
        bilder += await ordnerLoeschen(id);
      } catch (err) {
        // Einzelner Fehler soll die übrigen Ordner nicht blockieren
        console.error('Bilder von Anfrage ' + id + ' nicht gelöscht', err);
      }
    }
    console.log('Löschroutine:', JSON.stringify({ geloescht: r && r.geloescht, bilder }));
    return { statusCode: 200, body: JSON.stringify({ geloescht: r && r.geloescht, bilder }) };
  } catch (err) {
    console.error('Löschroutine fehlgeschlagen', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Löschroutine fehlgeschlagen' }) };
  }
};
