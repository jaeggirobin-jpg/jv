// tool-db.js — Dokumenten-Speicher der Tools (ersetzt den claude.ai-Speicher «db»)
//
// GET  /api/tool-db?tool=terminplaner&sammlungen=projects,firms,config[&seit=ISO]
//      → { docs: [{ pfad, daten, geloescht, geaendert }], jetzt }
//      Ohne «seit» nur vorhandene Dokumente, mit «seit» alle Änderungen danach (auch Löschungen).
// POST /api/tool-db { tool, aktion: 'set',      pfad, daten }       Dokument speichern (ersetzt es)
//                   { tool, aktion: 'patch',    pfad, daten }       einzelne Felder ändern
//                   { tool, aktion: 'delete',   pfad }              löschen
//                   { tool, aktion: 'set_viele', docs: [{ pfad, daten }] }   mehrere (Datenübernahme)
// Nur mit Admin-Anmeldung (Passwort oder Sitzungs-Cookie der Plattform).

const { anmeldung } = require('./_lib/auth');
const t = require('./_lib/tools');

const MAX_BYTES = 5.5 * 1024 * 1024;   // Netlify erlaubt höchstens 6 MB pro Anfrage
const MAX_SAMMLUNGEN = 10;

function istObjekt(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

async function lesen(event) {
  const q = event.queryStringParameters || {};
  const tool = q.tool || '';
  if (!t.TOOLS.includes(tool)) return t.json(400, { error: 'Unbekanntes Tool' });

  const sammlungen = String(q.sammlungen || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!sammlungen.length || sammlungen.length > MAX_SAMMLUNGEN || !sammlungen.every((s) => t.SAMMLUNG_RE.test(s))) {
    return t.json(400, { error: 'Sammlungen fehlen oder sind ungültig' });
  }

  let filter = '&sammlung=in.(' + sammlungen.join(',') + ')';
  if (q.seit) {
    const seit = new Date(q.seit);
    if (isNaN(seit.getTime())) return t.json(400, { error: 'Ungültiger Zeitpunkt' });
    filter += '&geaendert=gt.' + encodeURIComponent(seit.toISOString());
  } else {
    filter += '&geloescht=is.false';
  }

  const jetzt = new Date().toISOString();
  const docs = await t.rest('tool_docs?select=pfad,daten,geloescht,geaendert&tool=eq.' + tool + filter +
    '&order=geaendert.asc&limit=10000');
  return t.json(200, { docs: docs || [], jetzt });
}

async function schreiben(event) {
  if ((event.body || '').length > MAX_BYTES) return t.json(413, { error: 'Daten zu gross (max. 5 MB pro Dokument)', code: 'quota_exceeded' });
  const b = t.body(event);
  if (!b) return t.json(400, { error: 'Ungültiges JSON' });
  const tool = b.tool;
  if (!t.TOOLS.includes(tool)) return t.json(400, { error: 'Unbekanntes Tool' });

  if (b.aktion === 'set_viele') {
    if (!Array.isArray(b.docs) || !b.docs.length || b.docs.length > 500) return t.json(400, { error: 'Dokumente fehlen' });
    for (const d of b.docs) {
      if (!d || !t.PFAD_RE.test(d.pfad || '') || !istObjekt(d.daten)) return t.json(400, { error: 'Ungültiges Dokument: ' + (d && d.pfad) });
    }
    const zeilen = b.docs.map((d) => ({ tool, pfad: d.pfad, daten: d.daten, geloescht: false }));
    const r = await t.rest('tool_docs?on_conflict=tool,pfad', {
      method: 'POST', body: zeilen, prefer: 'resolution=merge-duplicates,return=representation'
    });
    return t.json(200, { ok: true, anzahl: (r || []).length });
  }

  const pfad = b.pfad || '';
  if (!t.PFAD_RE.test(pfad)) return t.json(400, { error: 'Ungültiger Pfad' });

  if (b.aktion === 'set') {
    if (!istObjekt(b.daten)) return t.json(400, { error: 'Daten fehlen' });
    const r = await t.rest('tool_docs?on_conflict=tool,pfad', {
      method: 'POST', body: { tool, pfad, daten: b.daten, geloescht: false },
      prefer: 'resolution=merge-duplicates,return=representation'
    });
    return t.json(200, { ok: true, geaendert: r && r[0] && r[0].geaendert });
  }

  if (b.aktion === 'patch') {
    if (!istObjekt(b.daten)) return t.json(400, { error: 'Daten fehlen' });
    const r = await t.rpc('tool_doc_patch', { p_tool: tool, p_pfad: pfad, p_daten: b.daten });
    if (!r) return t.json(404, { error: 'Dokument nicht gefunden' });
    return t.json(200, { ok: true, geaendert: r.geaendert, daten: r.daten });
  }

  if (b.aktion === 'delete') {
    await t.rest('tool_docs?tool=eq.' + tool + '&pfad=eq.' + encodeURIComponent(pfad), {
      method: 'PATCH', body: { daten: null, geloescht: true }, prefer: 'return=minimal'
    });
    return t.json(200, { ok: true });
  }

  return t.json(400, { error: 'Unbekannte Aktion' });
}

exports.handler = async (event) => {
  if (!(await anmeldung(event, 'projekte'))) return t.json(401, { error: 'Nicht angemeldet', code: 'not_granted' });
  try {
    if (event.httpMethod === 'GET') return await lesen(event);
    if (event.httpMethod === 'POST') return await schreiben(event);
    return t.json(405, { error: 'Methode nicht erlaubt' });
  } catch (err) {
    console.error('tool-db', err);
    return t.json(500, { error: 'Speicher nicht erreichbar' });
  }
};
