// tool-asset.js — Dateien der Tools hochladen und löschen (ersetzt den claude.ai-Speicher «assets»)
//
// POST /api/tool-asset { aktion: 'vorbereiten', tool, typ, groesse }
//      → { id, url: '/_blob/<id>', upload_url }   Browser lädt die Datei per PUT direkt in den Bucket
// POST /api/tool-asset { aktion: 'datei', name: 'gaeste-wc-scan', typ, groesse }
//      → { upload_url }   feste Datei (z. B. 3D-Scan des Gäste-WC-Tools), ersetzt die alte
// POST /api/tool-asset { aktion: 'loeschen', id }
// Nur mit Admin-Anmeldung.

const { anmeldung } = require('./_lib/auth');
const t = require('./_lib/tools');

const MAX_GROESSE = 50 * 1024 * 1024;

function pruefen(b) {
  if (!t.TYPEN.includes(b.typ)) return 'Dateityp nicht erlaubt (JPG, PNG, WebP, GIF oder JSON)';
  const g = Number(b.groesse);
  if (!(g > 0) || g > MAX_GROESSE) return 'Datei zu gross (max. 50 MB)';
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return t.json(405, { error: 'Methode nicht erlaubt' });
  if (!(await anmeldung(event, 'projekte'))) return t.json(401, { error: 'Nicht angemeldet', code: 'not_granted' });
  const b = t.body(event);
  if (!b) return t.json(400, { error: 'Ungültiges JSON' });

  try {
    if (b.aktion === 'vorbereiten') {
      if (!t.TOOLS.includes(b.tool)) return t.json(400, { error: 'Unbekanntes Tool' });
      const fehler = pruefen(b);
      if (fehler) return t.json(400, { error: fehler });
      const id = t.neueId();
      const upload_url = await t.uploadUrl(t.assetPfad(id));
      return t.json(200, { id, url: '/_blob/' + id, upload_url });
    }

    if (b.aktion === 'datei') {
      const pfad = t.DATEIEN[b.name];
      if (!pfad) return t.json(400, { error: 'Unbekannte Datei' });
      const fehler = pruefen(b);
      if (fehler) return t.json(400, { error: fehler });
      // Signierte Upload-URLs überschreiben nicht: alte Datei zuerst entfernen
      await t.dateienLoeschen([pfad]);
      const upload_url = await t.uploadUrl(pfad);
      return t.json(200, { upload_url });
    }

    if (b.aktion === 'loeschen') {
      if (!t.ASSET_RE.test(b.id || '')) return t.json(400, { error: 'Ungültige ID' });
      await t.dateienLoeschen([t.assetPfad(b.id)]);
      return t.json(200, { ok: true });
    }

    return t.json(400, { error: 'Unbekannte Aktion' });
  } catch (err) {
    console.error('tool-asset', err);
    return t.json(500, { error: 'Speicher nicht erreichbar' });
  }
};
