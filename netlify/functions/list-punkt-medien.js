// list-punkt-medien.js — Alle Medien eines Inspirations-Punktes auflisten (Admin)

const { createClient } = require('@supabase/supabase-js');
const { checkAuth } = require('./_lib/auth');

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, { ok: true });
  }

  if (event.httpMethod !== 'GET') {
    return respond(405, { error: 'Methode nicht erlaubt' });
  }

  if (!checkAuth(event)) {
    return respond(401, { error: 'Nicht autorisiert' });
  }

  const punktId = (event.queryStringParameters || {}).punkt_id;
  if (!punktId) {
    return respond(400, { error: 'punkt_id Query-Parameter fehlt' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('punkt_medien')
    .select('*')
    .eq('punkt_id', punktId)
    .order('reihenfolge', { ascending: true });

  if (error) {
    return respond(500, { error: 'Datenbankfehler: ' + error.message });
  }

  return respond(200, { ok: true, medien: data || [] });
};
