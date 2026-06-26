// delete-punkt-medium.js — Ein Punkt-Medium löschen inkl. Storage-Dateien (Admin)

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

  // Medium laden für Storage-Bereinigung
  const { data: medium } = await supabase
    .from('punkt_medien')
    .select('id, bild_url, video_url')
    .eq('id', id)
    .maybeSingle();

  if (!medium) {
    return respond(404, { error: 'Medium nicht gefunden' });
  }

  // Medien im Storage löschen (falls vorhanden)
  const bucketName = 'inspiration-medien';
  const toRemove = [];
  if (medium.bild_url && medium.bild_url.includes(bucketName)) {
    const path = medium.bild_url.split('/' + bucketName + '/')[1];
    if (path) toRemove.push(path);
  }
  if (medium.video_url && medium.video_url.includes(bucketName)) {
    const path = medium.video_url.split('/' + bucketName + '/')[1];
    if (path) toRemove.push(path);
  }
  if (toRemove.length > 0) {
    await supabase.storage.from(bucketName).remove(toRemove);
  }

  // DB-Eintrag löschen
  const { error } = await supabase
    .from('punkt_medien')
    .delete()
    .eq('id', id);

  if (error) {
    return respond(500, { error: 'Löschen fehlgeschlagen: ' + error.message });
  }

  return respond(200, { ok: true });
};
