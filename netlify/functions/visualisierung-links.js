// visualisierung-links.js — Kundenlinks für Badvisualisierungen verwalten (Admin)
//
// GET  /api/visualisierung-links[?objekt_id=…|?projekt_id=…]   → { links: [...] }
// POST /api/visualisierung-links { aktion: 'erstellen', objekt_id, kunde_name, kunde_id?, projekt_id? }
//                                { aktion: 'aktiv', id, is_active }
//                                { aktion: 'loeschen', id }
// Der Kunde öffnet /visualisierung.html?t=TOKEN (siehe get-visualisierung.js).

const { anmeldung } = require('./_lib/auth');
const t = require('./_lib/tools');

const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPALTEN = 'id,token,objekt_id,kunde_name,kunde_id,projekt_id,is_active,created_at,last_viewed_at,view_count';

exports.handler = async (event) => {
  if (!(await anmeldung(event, 'kunden'))) return t.json(401, { error: 'Nicht angemeldet' });

  try {
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      let filter = '';
      if (q.objekt_id) {
        if (!ID_RE.test(q.objekt_id)) return t.json(400, { error: 'Ungültige Objekt-ID' });
        filter = '&objekt_id=eq.' + q.objekt_id;
      } else if (q.projekt_id) {
        if (!ID_RE.test(q.projekt_id)) return t.json(400, { error: 'Ungültige Projekt-ID' });
        filter = '&projekt_id=eq.' + q.projekt_id;
      }
      const links = await t.rest('visualisierung_links?select=' + SPALTEN + filter + '&order=created_at.desc');
      return t.json(200, { links: links || [] });
    }

    if (event.httpMethod !== 'POST') return t.json(405, { error: 'Methode nicht erlaubt' });
    const b = t.body(event);
    if (!b) return t.json(400, { error: 'Ungültiges JSON' });

    if (b.aktion === 'erstellen') {
      const objektId = String(b.objekt_id || '');
      const name = String(b.kunde_name || '').trim().slice(0, 120);
      if (!ID_RE.test(objektId)) return t.json(400, { error: 'Objekt fehlt' });
      if (!name) return t.json(400, { error: 'Name des Links fehlt' });
      if (b.kunde_id && !UUID_RE.test(b.kunde_id)) return t.json(400, { error: 'Ungültige Kunden-ID' });
      if (b.projekt_id && !ID_RE.test(b.projekt_id)) return t.json(400, { error: 'Ungültige Projekt-ID' });
      // Objekt muss existieren
      const doc = await t.docLesen('badvis', 'objekte/' + objektId);
      if (!doc) return t.json(404, { error: 'Visualisierung nicht gefunden' });
      const r = await t.rest('visualisierung_links?select=' + SPALTEN, {
        method: 'POST',
        body: { objekt_id: objektId, kunde_name: name, kunde_id: b.kunde_id || null, projekt_id: b.projekt_id || null }
      });
      return t.json(200, { ok: true, link: r && r[0] });
    }

    if (!UUID_RE.test(b.id || '')) return t.json(400, { error: 'ID fehlt' });

    if (b.aktion === 'aktiv') {
      const r = await t.rest('visualisierung_links?id=eq.' + b.id + '&select=' + SPALTEN, {
        method: 'PATCH', body: { is_active: !!b.is_active }
      });
      if (!r || !r.length) return t.json(404, { error: 'Link nicht gefunden' });
      return t.json(200, { ok: true, link: r[0] });
    }

    if (b.aktion === 'loeschen') {
      await t.rest('visualisierung_links?id=eq.' + b.id, { method: 'DELETE', prefer: 'return=minimal' });
      return t.json(200, { ok: true });
    }

    return t.json(400, { error: 'Unbekannte Aktion' });
  } catch (err) {
    console.error('visualisierung-links', err);
    return t.json(500, { error: 'Datenbankfehler' });
  }
};
