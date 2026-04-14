// delete-link.js — Link löschen inklusive Datei im Storage (Admin)

const { createClient } = require('@supabase/supabase-js');

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

function checkAuth(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  return token && token === process.env.ADMIN_PASSWORD;
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

  // Zuerst den Eintrag laden, um den Dateipfad zu kennen
  const { data: link, error: fetchError } = await supabase
    .from('doc_links')
    .select('id, file_path')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    return respond(500, { error: 'Datenbankfehler: ' + fetchError.message });
  }

  if (!link) {
    return respond(404, { error: 'Link nicht gefunden' });
  }

  // Datei im Storage löschen
  if (link.file_path) {
    const { error: storageError } = await supabase.storage
      .from('pdfs')
      .remove([link.file_path]);

    if (storageError) {
      // Nicht fatal: wir loggen, löschen aber trotzdem den DB-Eintrag
      console.warn('Storage-Löschung fehlgeschlagen:', storageError.message);
    }
  }

  // DB-Eintrag löschen
  const { error: deleteError } = await supabase
    .from('doc_links')
    .delete()
    .eq('id', id);

  if (deleteError) {
    return respond(500, { error: 'Löschen fehlgeschlagen: ' + deleteError.message });
  }

  return respond(200, { ok: true });
};
