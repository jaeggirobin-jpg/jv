// dachcheck-medien.js — Aktuelles Titelvideo der Landingpage (öffentlich, GET)
// Gibt die öffentlichen URLs von Video und Standbild zurück, oder null, wenn keines gesetzt ist.
const { antwort, rest, oeffentlicheUrl } = require('./_lib/dachcheck');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return antwort(405, { error: 'Methode nicht erlaubt' });
  try {
    const r = await rest('drohnencheck_einstellungen?schluessel=eq.hero&select=wert');
    const w = r && r[0] && r[0].wert;
    if (!w || !w.video) return antwort(200, { video: null, poster: null });
    return antwort(200, { video: oeffentlicheUrl(w.video), poster: w.poster ? oeffentlicheUrl(w.poster) : null });
  } catch (err) {
    // Ohne Video funktioniert die Seite trotzdem (ruhiger Hintergrund)
    console.error(err);
    return antwort(200, { video: null, poster: null });
  }
};
