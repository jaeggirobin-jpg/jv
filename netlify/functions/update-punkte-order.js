// update-punkte-order.js — Reihenfolge von Inspiration-Punkten aktualisieren (Admin)

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

  const updates = payload.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return respond(400, { error: 'updates-Array fehlt oder ist leer' });
  }

  // Validierung: jedes Element muss id und reihenfolge haben
  for (const item of updates) {
    if (!item.id || item.reihenfolge === undefined) {
      return respond(400, { error: 'Jedes Element muss id und reihenfolge enthalten' });
    }
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Alle Reihenfolge-Werte aktualisieren
  for (const item of updates) {
    const { error } = await supabase
      .from('inspiration_punkte')
      .update({ reihenfolge: item.reihenfolge })
      .eq('id', item.id);

    if (error) {
      return respond(500, {
        error: `Aktualisierung fehlgeschlagen für ID ${item.id}: ${error.message}`,
      });
    }
  }

  return respond(200, { ok: true });
};
