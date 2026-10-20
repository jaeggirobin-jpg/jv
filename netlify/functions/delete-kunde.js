// delete-kunde.js — Kunde löschen (Admin)
// Löscht auch die verknüpften Dokumente (doc_links + PDFs im Storage).
// CASCADE in der DB räumt kunden_interessen auf, aktivitaet_log wird anonymisiert.

const { createClient } = require('@supabase/supabase-js');
const { checkAuth } = require('./_lib/auth');

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Methode nicht erlaubt' });
  }

  if (!checkAuth(event)) {
    return respond(401, { error: 'Nicht autorisiert' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return respond(400, { error: 'Ungültiges JSON' });
  }

  const id = payload.id;
  if (!id) {
    return respond(400, { error: 'ID fehlt' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Prüfen ob Kunde existiert
  const { data: kunde, error: fetchError } = await supabase
    .from('kunden')
    .select('id, access_token')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    return respond(500, { error: 'Datenbankfehler: ' + fetchError.message });
  }

  if (!kunde) {
    return respond(404, { error: 'Kunde nicht gefunden' });
  }

  // Verknüpfte Dokumente löschen. doc_links hat keinen Fremdschlüssel auf
  // kunden, CASCADE greift hier also nicht. Ohne diesen Schritt blieben die
  // PDFs im Storage liegen und über den alten Link abrufbar.
  const { data: dokumente, error: docsError } = await supabase
    .from('doc_links')
    .select('id, file_path')
    .eq('kunde_token', kunde.access_token);

  if (docsError) {
    return respond(500, { error: 'Datenbankfehler: ' + docsError.message });
  }

  if (dokumente && dokumente.length > 0) {
    const paths = dokumente.map((d) => d.file_path).filter(Boolean);
    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage.from('pdfs').remove(paths);
      if (storageError) {
        // Abbrechen, damit keine verwaisten PDFs ohne DB-Eintrag entstehen
        return respond(500, { error: 'PDFs konnten nicht gelöscht werden: ' + storageError.message });
      }
    }

    const { error: docsDeleteError } = await supabase
      .from('doc_links')
      .delete()
      .eq('kunde_token', kunde.access_token);

    if (docsDeleteError) {
      return respond(500, { error: 'Dokumente konnten nicht gelöscht werden: ' + docsDeleteError.message });
    }
  }

  // Kunde löschen (CASCADE räumt Interessen auf, Log wird anonymisiert)
  const { error: deleteError } = await supabase
    .from('kunden')
    .delete()
    .eq('id', id);

  if (deleteError) {
    return respond(500, { error: 'Löschen fehlgeschlagen: ' + deleteError.message });
  }

  return respond(200, { ok: true });
};
