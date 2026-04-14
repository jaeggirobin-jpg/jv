// get-pdf.js — Sichere PDF-Auslieferung für den Kunden-Viewer
// Prüft Token, liefert signierte Kurz-URL (60s) und Metadaten zurück.
// KEIN Admin-Passwort nötig: wird vom Kunden-Frontend aufgerufen.

const { createClient } = require('@supabase/supabase-js');

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, { ok: true });
  }

  if (event.httpMethod !== 'GET') {
    return respond(405, { error: 'Methode nicht erlaubt' });
  }

  const token = (event.queryStringParameters && event.queryStringParameters.t) || '';

  // Token-Format prüfen (32 Hex-Zeichen)
  if (!/^[a-f0-9]{32}$/.test(token)) {
    return respond(400, { error: 'Ungültiger Token' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Link in DB suchen
  // Wichtig: customer_name wird zwar geladen (für Logging),
  // aber NICHT an den Client zurückgegeben — der Kunde soll
  // die Adresse im Viewer nicht sehen.
  const { data: link, error: dbError } = await supabase
    .from('doc_links')
    .select('id, token, customer_name, file_path, is_active, view_count')
    .eq('token', token)
    .maybeSingle();

  if (dbError) {
    return respond(500, { error: 'Datenbankfehler' });
  }

  if (!link) {
    return respond(404, { error: 'Link nicht gefunden' });
  }

  if (!link.is_active) {
    return respond(403, { error: 'Dieser Link wurde deaktiviert. Bitte kontaktieren Sie Jäggi Vollmer.' });
  }

  // Signierte URL mit 60s TTL erzeugen
  const { data: signed, error: signError } = await supabase.storage
    .from('pdfs')
    .createSignedUrl(link.file_path, 60);

  if (signError || !signed) {
    return respond(500, { error: 'Signierte URL konnte nicht erzeugt werden' });
  }

  // Aufruf-Zähler und Zeitstempel aktualisieren (fire and forget)
  await supabase
    .from('doc_links')
    .update({
      last_viewed_at: new Date().toISOString(),
      view_count: (link.view_count || 0) + 1,
    })
    .eq('id', link.id);

  return respond(200, {
    ok: true,
    signed_url: signed.signedUrl,
  });
};
