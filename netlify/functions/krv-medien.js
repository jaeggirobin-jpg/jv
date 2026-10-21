// krv-medien.js — Aktuelles Anleitungsvideo der KRV-Landingpage (öffentlich, GET)
// Gibt die öffentlichen URLs von Video und Standbild zurück, oder null, wenn keines gesetzt ist.
const { antwort, rest, oeffentlicheUrl } = require('./_lib/krvcheck');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return antwort(405, { error: 'Methode nicht erlaubt' });
  try {
    const r = await rest('krvcheck_einstellungen?schluessel=eq.anleitung&select=wert');
    const w = r && r[0] && r[0].wert;
    if (!w || !w.video) return antwort(200, { video: null, poster: null });
    return antwort(200, { video: oeffentlicheUrl(w.video), poster: w.poster ? oeffentlicheUrl(w.poster) : null });
  } catch (err) {
    // Ohne Video funktioniert die Seite trotzdem (gezeichnete Anleitung)
    console.error(err);
    return antwort(200, { video: null, poster: null });
  }
};
