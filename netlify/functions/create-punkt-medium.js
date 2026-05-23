// create-punkt-medium.js — Neues Medium für einen Inspirations-Punkt anlegen (Admin)

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

  const punktId = payload.punkt_id;
  if (!punktId) {
    return respond(400, { error: 'punkt_id ist erforderlich' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Reihenfolge automatisch ermitteln falls nicht angegeben
  let reihenfolge = payload.reihenfolge;
  if (reihenfolge === undefined || reihenfolge === null) {
    const { data: existing } = await supabase
      .from('punkt_medien')
      .select('reihenfolge')
      .eq('punkt_id', punktId)
      .order('reihenfolge', { ascending: false })
      .limit(1);

    reihenfolge = (existing && existing.length > 0) ? existing[0].reihenfolge + 1 : 1;
  }

  const insert = {
    punkt_id: punktId,
    name: (payload.name || '').trim() || null,
    reihenfolge,
  };

  const { data, error } = await supabase
    .from('punkt_medien')
    .insert(insert)
    .select()
    .single();

  if (error) {
    return respond(500, { error: 'Datenbankfehler: ' + error.message });
  }

  return respond(200, { ok: true, medium: data });
};
