// create-ansprechperson.js — Neue Ansprechperson erstellen (Admin)

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

  const name = (payload.name || '').trim();
  const email = (payload.email || '').trim();
  const telefon = (payload.telefon || '').trim();

  // Input-Validierung
  if (!name) {
    return respond(400, { error: 'Name fehlt' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('ansprechpersonen')
    .insert({
      name,
      email: email || null,
      telefon: telefon || null,
    })
    .select()
    .single();

  if (error) {
    return respond(500, { error: 'Erstellen fehlgeschlagen: ' + error.message });
  }

  return respond(200, { ok: true, ansprechperson: data });
};
