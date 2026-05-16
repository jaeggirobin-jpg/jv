// update-kunde.js — Kundendaten aktualisieren (Admin)

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

  // Erlaubte Felder zum Aktualisieren
  const allowedFields = [
    'anrede_typ', 'vorname', 'nachname', 'email', 'telefon',
    'projekt_adresse', 'termin_datum', 'termin_uhrzeit', 'admin_notizen', 'status',
  ];
  const updates = {};

  for (const field of allowedFields) {
    if (payload[field] !== undefined) {
      updates[field] = payload[field];
    }
  }

  // sichtbare_punkte: Array von UUIDs oder null (alle zeigen)
  if (payload.sichtbare_punkte !== undefined) {
    updates.sichtbare_punkte = Array.isArray(payload.sichtbare_punkte) && payload.sichtbare_punkte.length > 0
      ? payload.sichtbare_punkte
      : null;
  }

  if (Object.keys(updates).length === 0) {
    return respond(400, { error: 'Keine Felder zum Aktualisieren angegeben' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('kunden')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return respond(500, { error: 'Datenbankfehler: ' + error.message });
  }

  if (!data) {
    return respond(404, { error: 'Kunde nicht gefunden' });
  }

  return respond(200, { ok: true, kunde: data });
};
