// update-hero-bg.js — Hero-Hintergrundbild hochladen/ersetzen (Admin)

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

  const fileBase64 = payload.file_base64 || '';
  const fileName = (payload.file_name || 'hero.jpg').toLowerCase();

  if (!fileBase64) {
    return respond(400, { error: 'Datei fehlt' });
  }

  const allowedExt = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = '.' + fileName.split('.').pop();
  if (!allowedExt.includes(ext)) {
    return respond(400, { error: 'Nur JPG, PNG oder WebP erlaubt' });
  }

  let fileBuffer;
  try {
    fileBuffer = Buffer.from(fileBase64, 'base64');
  } catch (e) {
    return respond(400, { error: 'Datei konnte nicht dekodiert werden' });
  }

  if (fileBuffer.length > 5 * 1024 * 1024) {
    return respond(413, { error: 'Datei zu gross (max. 5 MB)' });
  }

  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  const storagePath = 'hero/bg' + ext;

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Alte Datei(en) im hero/-Ordner löschen
  const { data: existing } = await supabase.storage
    .from('inspiration-medien')
    .list('hero');

  if (existing && existing.length > 0) {
    const toRemove = existing.map(f => 'hero/' + f.name);
    await supabase.storage.from('inspiration-medien').remove(toRemove);
  }

  // Neue Datei hochladen
  const { error: uploadError } = await supabase.storage
    .from('inspiration-medien')
    .upload(storagePath, fileBuffer, {
      contentType: mimeMap[ext] || 'image/jpeg',
      upsert: true,
    });

  if (uploadError) {
    return respond(500, { error: 'Upload fehlgeschlagen: ' + uploadError.message });
  }

  // Öffentliche URL ermitteln
  const { data: urlData } = supabase.storage
    .from('inspiration-medien')
    .getPublicUrl(storagePath);

  return respond(200, {
    ok: true,
    url: urlData.publicUrl,
  });
};
