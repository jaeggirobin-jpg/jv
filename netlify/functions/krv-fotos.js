// krv-fotos.js — Foto-Upload einer KRV-Check-Anfrage abschliessen (öffentlich, POST)
//
// Der Browser ruft das nach dem Hochladen auf, mit Referenz und Upload-Token aus krv-anfrage.
// Wir übernehmen, was wirklich im Bucket liegt, entwerten den Token und senden die Info-Mail.
const { antwort, rest, ordnerListe, hash, infoMailSenden, REFERENZ_RE } = require('./_lib/krvcheck');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return antwort(405, { error: 'Methode nicht erlaubt' });

  let b;
  try {
    b = JSON.parse(event.body || '{}');
  } catch (e) {
    return antwort(400, { error: 'Ungültige Anfrage' });
  }
  const referenz = typeof b.referenz === 'string' ? b.referenz.trim() : '';
  const token = typeof b.upload_token === 'string' ? b.upload_token : '';
  if (!REFERENZ_RE.test(referenz) || !/^[a-f0-9]{32}$/.test(token)) return antwort(400, { error: 'Ungültige Anfrage' });

  try {
    const r = await rest('krvcheck_anfragen?referenz=eq.' + encodeURIComponent(referenz) +
      '&upload_token_hash=eq.' + hash(token) + '&upload_bis=gt.' + encodeURIComponent(new Date().toISOString()) +
      '&select=id,referenz');
    const a = r && r[0];
    if (!a) return antwort(403, { error: 'Der Upload ist abgelaufen. Bitte rufen Sie uns an oder senden Sie die Fotos per E-Mail.' });

    const pfadRe = new RegExp('^' + a.id + '/[a-f0-9]{24}\\.jpg$');
    const dateien = (await ordnerListe(a.id)).filter((d) => pfadRe.test(d.pfad));
    await rest('krvcheck_anfragen?id=eq.' + a.id, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: {
        fotos: dateien.map((d) => ({ pfad: d.pfad })),
        fotos_abgeschlossen_at: new Date().toISOString(),
        upload_token_hash: null
      }
    });
    await infoMailSenden(a.referenz, dateien.length);
    return antwort(200, { ok: true, anzahl: dateien.length });
  } catch (err) {
    console.error(err);
    return antwort(500, { error: 'Die Fotos konnten nicht abgeschlossen werden. Bitte versuchen Sie es nochmals.' });
  }
};
