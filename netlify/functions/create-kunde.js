// create-kunde.js — Neuen Kunden anlegen (Admin)

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

  const vorname = (payload.vorname || '').trim();
  const nachname = (payload.nachname || '').trim();

  if (!vorname || !nachname) {
    return respond(400, { error: 'Vorname und Nachname sind erforderlich' });
  }

  // Felder für den neuen Kunden zusammenstellen
  const insert = {
    vorname,
    nachname,
  };

  // Optionale Felder
  if (payload.anrede_typ !== undefined) insert.anrede_typ = payload.anrede_typ;
  if (payload.email !== undefined) insert.email = (payload.email || '').trim() || null;
  if (payload.telefon !== undefined) insert.telefon = (payload.telefon || '').trim() || null;
  if (payload.projekt_adresse !== undefined) insert.projekt_adresse = (payload.projekt_adresse || '').trim() || null;
  if (payload.termin_datum !== undefined) insert.termin_datum = payload.termin_datum || null;
  if (payload.termin_uhrzeit !== undefined) insert.termin_uhrzeit = payload.termin_uhrzeit || null;
  if (payload.admin_notizen !== undefined) insert.admin_notizen = (payload.admin_notizen || '').trim() || null;

  // Sichtbare Punkte: Array von UUIDs, oder null für alle
  if (Array.isArray(payload.sichtbare_punkte) && payload.sichtbare_punkte.length > 0) {
    insert.sichtbare_punkte = payload.sichtbare_punkte;
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('kunden')
    .insert(insert)
    .select()
    .single();

  if (error) {
    return respond(500, { error: 'Datenbankfehler: ' + error.message });
  }

  return respond(200, {
    ok: true,
    kunde: data,
    share_url: `/inspiration.html?t=${data.access_token}`,
  });
};
