// create-punkt.js — Neuen Inspiration-Punkt anlegen (Admin)

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

  const kategorie = (payload.kategorie || '').trim();
  const titel = (payload.titel || '').trim();

  if (!kategorie || !titel) {
    return respond(400, { error: 'Kategorie und Titel sind erforderlich' });
  }

  // Kategorie wird als Kleinbuchstaben gespeichert (Konsistenz)
  // Keine fixe Liste — neue Kategorien werden automatisch erkannt.

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Nächste Reihenfolge in dieser Kategorie ermitteln
  const { data: existing } = await supabase
    .from('inspiration_punkte')
    .select('reihenfolge')
    .eq('kategorie', kategorie)
    .order('reihenfolge', { ascending: false })
    .limit(1);

  const nextOrder = (existing && existing.length > 0) ? existing[0].reihenfolge + 1 : 1;

  const insert = {
    kategorie,
    reihenfolge: payload.reihenfolge || nextOrder,
    titel,
    kurzbeschreibung: (payload.kurzbeschreibung || '').trim() || null,
    vorteil: (payload.vorteil || '').trim() || null,
    zu_bedenken: (payload.zu_bedenken || '').trim() || null,
    bild_url: payload.bild_url || null,
    video_url: payload.video_url || null,
    aktiv: payload.aktiv !== undefined ? !!payload.aktiv : true,
  };

  const { data, error } = await supabase
    .from('inspiration_punkte')
    .insert(insert)
    .select()
    .single();

  if (error) {
    return respond(500, { error: 'Datenbankfehler: ' + error.message });
  }

  return respond(200, { ok: true, punkt: data });
};
