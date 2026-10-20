// create-link.js — Admin lädt PDF hoch und erstellt einen neuen Share-Link
// Ablauf in zwei Schritten, damit auch grosse PDFs gehen (Netlify Functions
// nehmen nur ca. 6 MB Request-Body an, Base64 bläht zusätzlich auf):
//   1. action 'prepare':  Function erzeugt eine signierte Upload-URL
//   2. Browser lädt die Datei direkt in den privaten Bucket «pdfs»
//   3. action 'finalize': Function prüft die Datei und legt doc_links an

const { createClient } = require('@supabase/supabase-js');
const { checkAuth } = require('./_lib/auth');
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

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

// Dateinamen säubern: nur sichere Zeichen zulassen
function sanitizeFilename(name) {
  const base = (name || 'dokument.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.toLowerCase().endsWith('.pdf') ? base : base + '.pdf';
}

const HEX32 = /^[a-f0-9]{32}$/;

// Schritt 1: Upload-Ziel reservieren und signierte Upload-URL zurückgeben
async function prepare(supabase, payload) {
  const fileName = sanitizeFilename(payload.file_name);
  const size = Number(payload.file_size) || 0;

  if (size <= 0) {
    return respond(400, { error: 'Datei ist leer' });
  }
  if (size > MAX_SIZE) {
    return respond(413, { error: 'Datei zu gross (max. 25 MB)' });
  }

  // Jedes Dokument bekommt einen EIGENEN zufälligen Token (32 Hex).
  // So können mehrere Dokumente pro Kunde existieren, ohne dass der
  // UNIQUE-Constraint auf doc_links.token verletzt wird.
  const docToken = crypto.randomBytes(16).toString('hex');
  const filePath = `${docToken}/${fileName}`;

  const { data, error } = await supabase.storage
    .from('pdfs')
    .createSignedUploadUrl(filePath);

  if (error || !data) {
    return respond(500, { error: 'Upload-URL konnte nicht erzeugt werden' });
  }

  return respond(200, {
    ok: true,
    doc_token: docToken,
    file_path: filePath,
    upload_url: data.signedUrl,
  });
}

// Schritt 3: hochgeladene Datei prüfen und Eintrag in doc_links anlegen
async function finalize(supabase, payload) {
  // Hinweis: Das Feld heisst aus historischen Gründen weiterhin
  // `customer_name`, enthält jetzt aber die Bezeichnung des Dokuments.
  const customerName = (payload.customer_name || '').trim();
  const note = (payload.note || '').trim();
  const docToken = (payload.doc_token || '').trim();
  const filePath = (payload.file_path || '').trim();

  if (!customerName) {
    return respond(400, { error: 'Bezeichnung fehlt' });
  }
  // Pfad muss exakt dem Schema aus prepare() entsprechen
  if (!HEX32.test(docToken) || !filePath.startsWith(docToken + '/')
      || sanitizeFilename(filePath.slice(docToken.length + 1)) !== filePath.slice(docToken.length + 1)) {
    return respond(400, { error: 'Ungültiger Dateipfad' });
  }

  // Datei muss im Bucket liegen, ein PDF sein und das Limit einhalten
  const fileName = filePath.slice(docToken.length + 1);
  const { data: files, error: listError } = await supabase.storage
    .from('pdfs')
    .list(docToken, { search: fileName });

  const file = !listError && files ? files.find((f) => f.name === fileName) : null;
  if (!file) {
    return respond(400, { error: 'Hochgeladene Datei nicht gefunden' });
  }

  const meta = file.metadata || {};
  if (meta.mimetype !== 'application/pdf' || !(meta.size > 0) || meta.size > MAX_SIZE) {
    await supabase.storage.from('pdfs').remove([filePath]);
    return respond(400, { error: 'Nur PDF-Dateien bis 25 MB erlaubt' });
  }

  // Kunden-Token (aus der kunden-Tabelle) verknüpft mehrere Dokumente
  // mit einem Kunden. Fehlt er, ist das Dokument eigenständig
  // (kunde_token = eigener Token → view.html?t=token funktioniert direkt).
  const passedKundeToken = (payload.token || '').trim();
  const kundeToken = HEX32.test(passedKundeToken) ? passedKundeToken : docToken;

  const { data, error: insertError } = await supabase
    .from('doc_links')
    .insert({
      token: docToken,
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

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return respond(400, { error: 'Ungültiges JSON' });
  }

  // Supabase-Client serverseitig mit Service-Role-Key
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  if (payload.action === 'prepare') return prepare(supabase, payload);
  if (payload.action === 'finalize') return finalize(supabase, payload);

  return respond(400, { error: 'Unbekannte Aktion (prepare oder finalize)' });
};
