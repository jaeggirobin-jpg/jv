// upload-punkt-medium-file.js — Bild oder Video für ein Punkt-Medium hochladen (Admin)

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

// Erlaubte Dateiformate und Maximalgrössen
const ALLOWED_IMAGES = ['jpg', 'jpeg', 'png', 'webp'];
const ALLOWED_VIDEOS = ['mp4', 'webm'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;   // 5 MB
const MAX_VIDEO_SIZE = 10 * 1024 * 1024;   // 10 MB

function getExtension(filename) {
  const parts = (filename || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function getContentType(ext) {
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
  };
  return map[ext] || 'application/octet-stream';
}

// Pfad aus einer öffentlichen URL extrahieren
function extractPathFromUrl(url, bucketName) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.substring(idx + marker.length);
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

  const { medium_id, file_base64, file_name, media_type } = payload;

  // Validierung
  if (!medium_id) {
    return respond(400, { error: 'medium_id fehlt' });
  }
  if (!file_base64) {
    return respond(400, { error: 'file_base64 fehlt' });
  }
  if (!file_name) {
    return respond(400, { error: 'file_name fehlt' });
  }
  if (!media_type || !['bild', 'video'].includes(media_type)) {
    return respond(400, { error: 'media_type muss "bild" oder "video" sein' });
  }

  const ext = getExtension(file_name);

  // Dateiformat prüfen
  if (media_type === 'bild' && !ALLOWED_IMAGES.includes(ext)) {
    return respond(400, { error: 'Bildformat nicht erlaubt. Erlaubt: ' + ALLOWED_IMAGES.join(', ') });
  }
  if (media_type === 'video' && !ALLOWED_VIDEOS.includes(ext)) {
    return respond(400, { error: 'Videoformat nicht erlaubt. Erlaubt: ' + ALLOWED_VIDEOS.join(', ') });
  }

  // Base64 → Buffer
  let fileBuffer;
  try {
    fileBuffer = Buffer.from(file_base64, 'base64');
  } catch (e) {
    return respond(400, { error: 'Datei konnte nicht dekodiert werden' });
  }

  // Grösse prüfen
  const maxSize = media_type === 'bild' ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;
  if (fileBuffer.length > maxSize) {
    const maxMB = maxSize / (1024 * 1024);
    return respond(413, { error: `Datei zu gross (max. ${maxMB} MB für ${media_type === 'bild' ? 'Bilder' : 'Videos'})` });
  }

  if (fileBuffer.length === 0) {
    return respond(400, { error: 'Datei ist leer' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Medium laden um punkt_id und vorhandene URLs zu erhalten
  const { data: medium, error: mediumError } = await supabase
    .from('punkt_medien')
    .select('id, punkt_id, bild_url, video_url')
    .eq('id', medium_id)
    .maybeSingle();

  if (mediumError) {
    return respond(500, { error: 'Datenbankfehler: ' + mediumError.message });
  }

  if (!medium) {
    return respond(404, { error: 'Medium nicht gefunden' });
  }

  // Punkt laden um Kategorie zu erhalten
  const { data: punkt, error: punktError } = await supabase
    .from('inspiration_punkte')
    .select('id, kategorie')
    .eq('id', medium.punkt_id)
    .maybeSingle();

  if (punktError) {
    return respond(500, { error: 'Datenbankfehler: ' + punktError.message });
  }

  if (!punkt) {
    return respond(404, { error: 'Zugehöriger Punkt nicht gefunden' });
  }

  const bucketName = 'inspiration-medien';
  const urlField = media_type === 'bild' ? 'bild_url' : 'video_url';

  // Altes File entfernen falls vorhanden
  const oldUrl = medium[urlField];
  if (oldUrl) {
    const oldPath = extractPathFromUrl(oldUrl, bucketName);
    if (oldPath) {
      await supabase.storage.from(bucketName).remove([oldPath]);
    }
  }

  // Neuen Dateipfad zusammenbauen
  const safeName = (file_name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${punkt.kategorie}/${medium_id}_${safeName}`;

  // Hochladen
  const { error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(storagePath, fileBuffer, {
      contentType: getContentType(ext),
      upsert: true,
    });

  if (uploadError) {
    return respond(500, { error: 'Upload fehlgeschlagen: ' + uploadError.message });
  }

  // Öffentliche URL holen
  const { data: publicUrlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(storagePath);

  const publicUrl = publicUrlData.publicUrl;

  // Medium in DB aktualisieren
  const { error: updateError } = await supabase
    .from('punkt_medien')
    .update({ [urlField]: publicUrl })
    .eq('id', medium_id);

  if (updateError) {
    return respond(500, { error: 'DB-Update fehlgeschlagen: ' + updateError.message });
  }

  return respond(200, { ok: true, url: publicUrl });
};
