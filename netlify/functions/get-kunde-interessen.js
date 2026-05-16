// get-kunde-interessen.js — Kundendetails mit Interessen und Aktivitätslog (Admin)

const { createClient } = require('@supabase/supabase-js');

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'no-store',
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

  if (event.httpMethod !== 'GET') {
    return respond(405, { error: 'Methode nicht erlaubt' });
  }

  if (!checkAuth(event)) {
    return respond(401, { error: 'Nicht autorisiert' });
  }

  // Kunden-ID aus Query-Parameter
  const params = event.queryStringParameters || {};
  const id = params.id;

  if (!id) {
    return respond(400, { error: 'ID fehlt (Query-Parameter ?id=...)' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Kunde laden
  const { data: kunde, error: kundeError } = await supabase
    .from('kunden')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (kundeError) {
    return respond(500, { error: 'Datenbankfehler: ' + kundeError.message });
  }

  if (!kunde) {
    return respond(404, { error: 'Kunde nicht gefunden' });
  }

  // Interessen mit Punkt-Titel laden (Join)
  const { data: interessen, error: interessenError } = await supabase
    .from('kunden_interessen')
    .select('*, inspiration_punkte(id, titel, kategorie)')
    .eq('kunde_id', id)
    .order('created_at', { ascending: false });

  if (interessenError) {
    return respond(500, { error: 'Fehler beim Laden der Interessen: ' + interessenError.message });
  }

  // Aktivitätslog laden (letzte 50 Einträge)
  const { data: log, error: logError } = await supabase
    .from('aktivitaet_log')
    .select('*')
    .eq('kunde_id', id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (logError) {
    return respond(500, { error: 'Fehler beim Laden des Logs: ' + logError.message });
  }

  return respond(200, {
    ok: true,
    kunde,
    interessen: interessen || [],
    log: log || [],
  });
};
