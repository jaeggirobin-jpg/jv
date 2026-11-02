// krv-admin-liste.js — Alle KRV-Check-Anfragen für die Übersicht (Admin)
const { antwort, rest } = require('./_lib/krvcheck');
const { anmeldung } = require('./_lib/auth');

// ip_hash und upload_token_hash bleiben serverseitig
const SPALTEN = [
  'id', 'referenz', 'status', 'created_at', 'updated_at',
  'strasse', 'hausnummer', 'plz', 'ort',
  'vorname', 'nachname', 'telefon', 'email', 'rolle', 'iwb_brief', 'offerte_gewuenscht', 'bemerkung',
  'fotos', 'keine_fotos', 'fotos_abgeschlossen_at',
  'beurteilung', 'beurteilung_text', 'beurteilt_at', 'einwilligung',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_extra',
  'mail_intern_ok', 'notiz_intern'
].join(',');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return antwort(405, { error: 'Methode nicht erlaubt' });
  if (!(await anmeldung(event, 'anfragen'))) return antwort(401, { error: 'Nicht autorisiert' });

  try {
    let anfragen;
    try {
      anfragen = await rest('krvcheck_anfragen?select=' + SPALTEN + '&order=created_at.desc');
    } catch (err) {
      // Solange migration_014 nicht ausgeführt ist, fehlt die Spalte offerte_gewuenscht:
      // dann ohne sie laden, damit die Übersicht weiter funktioniert.
      const ohne = SPALTEN.replace(',offerte_gewuenscht', '');
      anfragen = await rest('krvcheck_anfragen?select=' + ohne + '&order=created_at.desc');
    }
    return antwort(200, { anfragen });
  } catch (err) {
    console.error(err);
    return antwort(500, { error: 'Anfragen konnten nicht geladen werden' });
  }
};
