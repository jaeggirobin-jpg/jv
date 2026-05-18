// upload-ansprechperson-foto.js — Foto für Ansprechperson hochladen (Admin)
// Speichert das Bild im Supabase Storage Bucket «inspiration-medien»
// und aktualisiert das foto_url-Feld in der Tabelle.

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

// Content-Type anhand Dateiendung bestimmen
function getContentType(fileName) {
  const ext = (fileName || '').toLowerCase().split('.').pop();
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return map[ext] || null;
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

  const ansprechpersonId = payload.ansprechperson_id;
  const fileBase64 = payload.file_base64 || '';
  const fileName = payload.file_name || '';

  // Input-Validierung
  if (!ansprechpersonId) {
    return respond(400, { error: 'ansprechperson_id fehlt' });
  }
  if (!fileBase64) {
    return respond(400, { error: 'Datei fehlt' });
  }
  if (!fileName) {
    return respond(400, { error: 'Dateiname fehlt' });
  }

  // Dateityp prüfen (nur jpg, png, webp erlaubt)
  const contentType = getContentType(fileName);
  if (!contentType) {
    return respond(400, { error: 'Ungültiger Dateityp. Erlaubt: jpg, png, webp' });
  }

  // Base64 → Buffer
  let fileBuffer;
  try {
    fileBuffer = Buffer.from(fileBase64, 'base64');
  } catch (e) {
    return respond(400, { error: 'Datei konnte nicht dekodiert werden' });
  }

  // Grössenbegrenzung: max 2 MB
  if (fileBuffer.length > 2 * 1024 * 1024) {
    return respond(413, { error: 'Datei zu gross (max. 2 MB)' });
  }

  if (fileBuffer.length === 0) {
    return respond(400, { error: 'Datei ist leer' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Prüfen ob die Ansprechperson existiert und altes Foto ermitteln
  const { data: person, error: fetchError } = await supabase
    .from('ansprechpersonen')
    .select('id, foto_url')
    .eq('id', ansprechpersonId)
    .maybeSingle();

  if (fetchError) {
    return respond(500, { error: 'Datenbankfehler: ' + fetchError.message });
  }

  if (!person) {
    return respond(404, { error: 'Ansprechperson nicht gefunden' });
  }

  // Altes Foto im Storage löschen, falls vorhanden
  if (person.foto_url) {
    // Pfad aus der URL extrahieren (nach /object/public/inspiration-medien/)
    const marker = '/object/public/inspiration-medien/';
    const idx = person.foto_url.indexOf(marker);
    if (idx !== -1) {
      const oldPath = person.foto_url.substring(idx + marker.length);
      const { error: removeError } = await supabase.storage
        .from('inspiration-medien')
        .remove([decodeURIComponent(oldPath)]);

      if (removeError) {
        console.warn('Altes Foto konnte nicht gelöscht werden:', removeError.message);
      }
    }
  }

  // Dateinamen säubern und Pfad erstellen
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `ansprechpersonen/${ansprechpersonId}_${safeName}`;

  // Neues Foto hochladen
  const { error: uploadError } = await supabase.storage
    .from('inspiration-medien')
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    return respond(500, { error: 'Upload fehlgeschlagen: ' + uploadError.message });
  }

  // Öffentliche URL generieren
  const { data: urlData } = supabase.storage
    .from('inspiration-medien')
    .getPublicUrl(storagePath);

  const publicUrl = urlData.publicUrl;

  // foto_url in der Datenbank aktualisieren
  const { error: updateError } = await supabase
    .from('ansprechpersonen')
    .update({ foto_url: publicUrl })
    .eq('id', ansprechpersonId);

  if (updateError) {
    return respond(500, { error: 'DB-Aktualisierung fehlgeschlagen: ' + updateError.message });
  }

  return respond(200, { ok: true, url: publicUrl });
};
