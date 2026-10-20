// dachcheck-loeschroutine.js — Geplante Function (täglich, siehe netlify.toml)
// Löscht Anfragen ohne Auftrag nach der Löschfrist aus config.js (Standard 60 Tage).
const { config, rpc } = require('./_lib/dachcheck');

exports.handler = async () => {
  try {
    const r = await rpc('drohnencheck_loeschen', { p_tage: config.loeschfristTage });
    console.log('Löschroutine:', JSON.stringify(r));
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (err) {
    console.error('Löschroutine fehlgeschlagen', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Löschroutine fehlgeschlagen' }) };
  }
};
