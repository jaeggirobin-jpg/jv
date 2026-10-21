// krv-loeschroutine.js — Geplante Function (täglich, siehe netlify.toml)
// 1. Löscht Anfragen ohne Auftrag nach der Löschfrist aus config.js (Standard 90 Tage) samt Fotos.
// 2. Sicherheitsnetz: Wurde der Foto-Upload nie abgeschlossen (z. B. Handy offline), geht die
//    Info-Mail trotzdem raus, sobald die Upload-Frist vorbei ist.
const { config, rpc, rest, ordnerLoeschen, ordnerListe, infoMailSenden } = require('./_lib/krvcheck');

exports.handler = async () => {
  const ergebnis = { geloescht: 0, fotos: 0, nachgemeldet: 0 };
  try {
    const r = await rpc('krvcheck_loeschen', { p_tage: config.loeschfristTage });
    ergebnis.geloescht = (r && r.geloescht) || 0;
    for (const id of (r && r.ids) || []) {
      try {
        ergebnis.fotos += await ordnerLoeschen(id);
      } catch (err) {
        console.error('Fotos von Anfrage ' + id + ' nicht gelöscht', err);
      }
    }
  } catch (err) {
    console.error('Löschroutine fehlgeschlagen', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Löschroutine fehlgeschlagen' }) };
  }

  try {
    const offen = await rest('krvcheck_anfragen?mail_intern_ok=is.null&fotos_abgeschlossen_at=is.null' +
      '&created_at=lt.' + encodeURIComponent(new Date(Date.now() - 3 * 3600e3).toISOString()) + '&select=id,referenz');
    for (const a of offen || []) {
      const dateien = await ordnerListe(a.id);
      await infoMailSenden(a.referenz, dateien.length);
      ergebnis.nachgemeldet++;
    }
  } catch (err) {
    console.error('Nachmeldung fehlgeschlagen', err);
  }

  console.log('KRV-Löschroutine:', JSON.stringify(ergebnis));
  return { statusCode: 200, body: JSON.stringify(ergebnis) };
};
