// dachcheck-admin-update.js — Status, Termin und interne Notiz einer Anfrage ändern (Admin)
const { antwort, rest } = require('./_lib/dachcheck');
const { checkAuth } = require('./_lib/auth');

// Muss zum CHECK-Constraint in migration_010_drohnencheck.sql passen
const STATUS = ['neu', 'termin', 'geflogen', 'report', 'auftrag', 'abgeschlossen', 'abgesagt'];

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
  if (!/^DC-\d{4}-\d{4,}$/.test(referenz)) return antwort(400, { error: 'Ungültige Referenz' });

  const felder = {};
  if (b.status !== undefined) {
    if (!STATUS.includes(b.status)) return antwort(400, { error: 'Ungültiger Status' });
    felder.status = b.status;
  }
  if (b.notiz_intern !== undefined) {
    if (b.notiz_intern !== null && typeof b.notiz_intern !== 'string') return antwort(400, { error: 'Ungültige Notiz' });
    felder.notiz_intern = b.notiz_intern ? b.notiz_intern.slice(0, 4000) : null;
  }
  if (b.termin_bestaetigt !== undefined) {
    if (b.termin_bestaetigt === null || b.termin_bestaetigt === '') {
      felder.termin_bestaetigt = null;
    } else {
      const d = new Date(b.termin_bestaetigt);
      if (isNaN(d)) return antwort(400, { error: 'Ungültiger Termin' });
      felder.termin_bestaetigt = d.toISOString();
    }
  }
  if (!Object.keys(felder).length) return antwort(400, { error: 'Nichts zu ändern' });

  try {
    const r = await rest('drohnencheck_anfragen?referenz=eq.' + encodeURIComponent(referenz) + '&select=referenz,status,notiz_intern,termin_bestaetigt,updated_at', {
      method: 'PATCH',
      body: felder
    });
    if (!r || !r.length) return antwort(404, { error: 'Anfrage nicht gefunden' });
    return antwort(200, r[0]);
  } catch (err) {
    console.error(err);
    return antwort(500, { error: 'Speichern fehlgeschlagen' });
  }
};
