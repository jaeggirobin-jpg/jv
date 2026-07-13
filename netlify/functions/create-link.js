// create-link.js — Admin lädt PDF hoch und erstellt einen neuen Share-Link
// Ablauf: Datei in Supabase Storage speichern, Eintrag in doc_links anlegen,
// fertige Share-URL zurückgeben.

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Einheitliche JSON-Antwort mit CORS-Header
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

// Admin-Auth: Passwort aus Authorization-Header gegen ENV vergleichen
function checkAuth(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  return token && token === process.env.ADMIN_PASSWORD;
}

// Dateinamen säubern: nur sichere Zeichen zulassen
function sanitizeFilename(name) {
  const base = (name || 'dokument.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.toLowerCase().endsWith('.pdf') ? base : base + '.pdf';
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

  // Hinweis: Das Feld heisst aus historischen Gründen weiterhin
  // `customer_name`, enthält jetzt aber die Adresse des Bauobjekts.
  const customerName = (payload.customer_name || '').trim();
  const note = (payload.note || '').trim();
  const fileName = sanitizeFilename(payload.file_name);
  const fileBase64 = payload.file_base64 || '';

  // Input-Validierung
  if (!customerName) {
    return respond(400, { error: 'Adresse fehlt' });
  }
  if (!fileBase64) {
    return respond(400, { error: 'Datei fehlt' });
  }

  // Base64 → Buffer
  let fileBuffer;
  try {
    fileBuffer = Buffer.from(fileBase64, 'base64');
  } catch (e) {
    return respond(400, { error: 'Datei konnte nicht dekodiert werden' });
  }

  if (fileBuffer.length === 0) {
    return respond(400, { error: 'Datei ist leer' });
  }

  // Grobe Grössenbegrenzung (Netlify Function Limit ~6 MB Request)
  if (fileBuffer.length > 25 * 1024 * 1024) {
    return respond(413, { error: 'Datei zu gross (max. 25 MB)' });
  }

  // Jedes Dokument bekommt einen EIGENEN zufälligen Token (32 Hex).
  // So können mehrere Dokumente pro Kunde existieren, ohne dass der
  // UNIQUE-Constraint auf doc_links.token verletzt wird.
  const token = crypto.randomBytes(16).toString('hex');

  // Kunden-Token (aus der kunden-Tabelle) verknüpft mehrere Dokumente
  // mit einem Kunden. Fehlt er, ist das Dokument eigenständig
  // (kunde_token = eigener Token → view.html?t=token funktioniert direkt).
  const passedKundeToken = (payload.token || '').trim();
  const kundeToken = /^[a-f0-9]{32}$/.test(passedKundeToken)
    ? passedKundeToken
    : token;

  const filePath = `${token}/${fileName}`;

  // Supabase-Client serverseitig mit Service-Role-Key
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Datei in den privaten Bucket «pdfs» hochladen
  const { error: uploadError } = await supabase.storage
    .from('pdfs')
    .upload(filePath, fileBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (uploadError) {
    return respond(500, { error: 'Upload fehlgeschlagen: ' + uploadError.message });
  }

  // Eintrag in doc_links anlegen
  const { data, error: insertError } = await supabase
    .from('doc_links')
    .insert({
      token,
      kunde_token: kundeToken,
      customer_name: customerName,
      note: note || null,
      file_path: filePath,
      is_active: true,
    })
    .select()
    .single();

  if (insertError) {
    // Rollback: hochgeladene Datei wieder löschen
    await supabase.storage.from('pdfs').remove([filePath]);
    return respond(500, { error: 'DB-Eintrag fehlgeschlagen: ' + insertError.message });
  }

  // Der Share-Link zeigt auf den Kunden-Token, damit ALLE Dokumente
  // des Kunden unter view.html?t=... erscheinen.
  return respond(200, {
    ok: true,
    link: data,
    share_url: `/view.html?t=${kundeToken}`,
  });
};
