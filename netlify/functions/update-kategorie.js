// update-kategorie.js — Inspiration-Kategorie aktualisieren (Admin)

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
  if (payload.titel !== undefined) updates.titel = payload.titel;
  if (payload.intro !== undefined) updates.intro = payload.intro;
  if (payload.reihenfolge !== undefined) updates.reihenfolge = payload.reihenfolge;

  if (Object.keys(updates).length === 0) {
    return respond(400, { error: 'Keine Felder zum Aktualisieren angegeben' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('inspiration_kategorien')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return respond(500, { error: 'Aktualisierung fehlgeschlagen: ' + error.message });
  }

  if (!data) {
    return respond(404, { error: 'Kategorie nicht gefunden' });
  }

  return respond(200, { ok: true, kategorie: data });
};
