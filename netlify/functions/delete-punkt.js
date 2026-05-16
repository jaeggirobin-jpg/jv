// delete-punkt.js — Inspiration-Punkt löschen (Admin)

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

  // Punkt laden für allfällige Storage-Bereinigung
  const { data: punkt } = await supabase
    .from('inspiration_punkte')
    .select('id, bild_url, video_url')
    .eq('id', id)
    .maybeSingle();

  if (!punkt) {
    return respond(404, { error: 'Punkt nicht gefunden' });
  }

  // Medien im Storage löschen (falls vorhanden)
  const toRemove = [];
  if (punkt.bild_url && punkt.bild_url.includes('inspiration-medien')) {
    const path = punkt.bild_url.split('/inspiration-medien/')[1];
    if (path) toRemove.push(path);
  }
  if (punkt.video_url && punkt.video_url.includes('inspiration-medien')) {
    const path = punkt.video_url.split('/inspiration-medien/')[1];
    if (path) toRemove.push(path);
  }
  if (toRemove.length > 0) {
    await supabase.storage.from('inspiration-medien').remove(toRemove);
  }

  // DB-Eintrag löschen (CASCADE löscht kunden_interessen-Referenzen)
  const { error } = await supabase
    .from('inspiration_punkte')
    .delete()
    .eq('id', id);

  if (error) {
    return respond(500, { error: 'Löschen fehlgeschlagen: ' + error.message });
  }

  return respond(200, { ok: true });
};
