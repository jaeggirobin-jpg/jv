// list-kunden.js — Alle Kunden für das Admin-Panel auflisten

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

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('kunden')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return respond(500, { error: 'Datenbankfehler: ' + error.message });
  }

  const kunden = data || [];

  // Statistiken pro Kunde laden (Besuche, Interessen, Kommentare)
  if (kunden.length > 0) {
    const ids = kunden.map(k => k.id);

    // Besuche (seite_geoeffnet) und letzter Besuch aus aktivitaet_log
    const { data: logStats } = await supabase
      .from('aktivitaet_log')
      .select('kunden_id, timestamp')
      .in('kunden_id', ids)
      .eq('aktion', 'seite_geoeffnet')
      .order('timestamp', { ascending: false });

    // Interessen und Kommentare aus kunden_interessen
    const { data: interessen } = await supabase
      .from('kunden_interessen')
      .select('kunden_id, interessiert, kommentar')
      .in('kunden_id', ids);

    // Stats pro Kunde zusammenbauen
    const besucheMap = {};
    const letztMap = {};
    (logStats || []).forEach(function(l) {
      besucheMap[l.kunden_id] = (besucheMap[l.kunden_id] || 0) + 1;
      if (!letztMap[l.kunden_id]) letztMap[l.kunden_id] = l.timestamp;
    });

    const markiertMap = {};
    const kommentarMap = {};
    (interessen || []).forEach(function(i) {
      if (i.interessiert) markiertMap[i.kunden_id] = (markiertMap[i.kunden_id] || 0) + 1;
      if (i.kommentar && i.kommentar.trim()) kommentarMap[i.kunden_id] = (kommentarMap[i.kunden_id] || 0) + 1;
    });

    kunden.forEach(function(k) {
      k.besuche = besucheMap[k.id] || 0;
      k.letzter_besuch = letztMap[k.id] || null;
      k.markierte_punkte = markiertMap[k.id] || 0;
      k.kommentare = kommentarMap[k.id] || 0;
    });
  }

  return respond(200, { ok: true, kunden: kunden });
};
