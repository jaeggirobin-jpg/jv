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

  // Alle Dokumente des Kunden suchen (verknüpft über kunde_token).
  // Ein Token kann mehrere Dokumente haben (mehrere Visualisierungen).
  // customer_name wird nicht an den Client zurückgegeben.
  const { data: links, error: dbError } = await supabase
    .from('doc_links')
    .select('id, note, file_path, is_active, view_count, created_at')
    .eq('kunde_token', token)
    .order('created_at', { ascending: true });

  if (dbError) {
    return respond(500, { error: 'Datenbankfehler' });
  }

  if (!links || links.length === 0) {
    return respond(404, { error: 'Link nicht gefunden' });
  }

  // Nur aktive Dokumente ausliefern
  const activeLinks = links.filter((l) => l.is_active);

  if (activeLinks.length === 0) {
    return respond(403, { error: 'Dieser Link wurde deaktiviert. Bitte kontaktieren Sie Jäggi Vollmer.' });
  }

  // Für jedes aktive Dokument eine signierte URL (60s TTL) erzeugen
  const documents = [];
  for (const link of activeLinks) {
    const { data: signed, error: signError } = await supabase.storage
      .from('pdfs')
      .createSignedUrl(link.file_path, 60);

    if (signError || !signed) {
      continue; // dieses Dokument überspringen, Rest weiterhin ausliefern
    }

    documents.push({
      signed_url: signed.signedUrl,
      note: link.note || null,
    });

    // Aufruf-Zähler pro Dokument aktualisieren (fire and forget)
    await supabase
      .from('doc_links')
      .update({
        last_viewed_at: new Date().toISOString(),
        view_count: (link.view_count || 0) + 1,
      })
      .eq('id', link.id);
  }

  if (documents.length === 0) {
    return respond(500, { error: 'Signierte URL konnte nicht erzeugt werden' });
  }

  return respond(200, {
    ok: true,
    documents,
    // Rückwärtskompatibel: erste URL auch einzeln
    signed_url: documents[0].signed_url,
  });
};
