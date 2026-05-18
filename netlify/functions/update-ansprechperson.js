// update-ansprechperson.js — Ansprechperson aktualisieren (Admin)

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
  // CORS-Preflight
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Methode nicht erlaubt' });
  }

  if (!checkAuth(event)) {
    return respond(401, { error: 'Nicht autorisiert' });
  }

  // Request-Body parsen
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

  // Nur übergebene Felder aktualisieren
  const updates = {};
  if (payload.name !== undefined) updates.name = payload.name;
  if (payload.email !== undefined) updates.email = payload.email;
  if (payload.telefon !== undefined) updates.telefon = payload.telefon;
  if (payload.foto_url !== undefined) updates.foto_url = payload.foto_url;
  if (payload.aktiv !== undefined) updates.aktiv = payload.aktiv;

  if (Object.keys(updates).length === 0) {
    return respond(400, { error: 'Keine Felder zum Aktualisieren angegeben' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('ansprechpersonen')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return respond(500, { error: 'Aktualisierung fehlgeschlagen: ' + error.message });
  }

  if (!data) {
    return respond(404, { error: 'Ansprechperson nicht gefunden' });
  }

  return respond(200, { ok: true, ansprechperson: data });
};
