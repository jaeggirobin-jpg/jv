// delete-kunde.js — Kunde löschen (Admin)
// CASCADE in der DB räumt kunden_interessen und aktivitaet_log auf

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

  // Prüfen ob Kunde existiert
  const { data: kunde, error: fetchError } = await supabase
    .from('kunden')
    .select('id')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    return respond(500, { error: 'Datenbankfehler: ' + fetchError.message });
  }

  if (!kunde) {
    return respond(404, { error: 'Kunde nicht gefunden' });
  }

  // Löschen (CASCADE räumt Abhängigkeiten auf)
  const { error: deleteError } = await supabase
    .from('kunden')
    .delete()
    .eq('id', id);

  if (deleteError) {
    return respond(500, { error: 'Löschen fehlgeschlagen: ' + deleteError.message });
  }

  return respond(200, { ok: true });
};
