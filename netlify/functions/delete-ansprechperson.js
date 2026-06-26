// delete-ansprechperson.js — Ansprechperson löschen inkl. Foto im Storage (Admin)

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

  // Zuerst den Eintrag laden, um das Foto zu kennen
  const { data: person, error: fetchError } = await supabase
    .from('ansprechpersonen')
    .select('id, foto_url')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    return respond(500, { error: 'Datenbankfehler: ' + fetchError.message });
  }

  if (!person) {
    return respond(404, { error: 'Ansprechperson nicht gefunden' });
  }

  // Foto im Storage löschen, falls vorhanden
  if (person.foto_url) {
    const marker = '/object/public/inspiration-medien/';
    const idx = person.foto_url.indexOf(marker);
    if (idx !== -1) {
      const filePath = person.foto_url.substring(idx + marker.length);
      const { error: storageError } = await supabase.storage
        .from('inspiration-medien')
        .remove([decodeURIComponent(filePath)]);

      if (storageError) {
        // Nicht fatal: wir loggen, löschen aber trotzdem den DB-Eintrag
        console.warn('Foto-Löschung fehlgeschlagen:', storageError.message);
      }
    }
  }

  // DB-Eintrag löschen
  const { error: deleteError } = await supabase
    .from('ansprechpersonen')
    .delete()
    .eq('id', id);

  if (deleteError) {
    return respond(500, { error: 'Löschen fehlgeschlagen: ' + deleteError.message });
  }

  return respond(200, { ok: true });
};
