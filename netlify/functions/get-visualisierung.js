// get-visualisierung.js — Badvisualisierung für den Kundenlink (/visualisierung.html?t=TOKEN)
// KEIN Admin-Passwort nötig: wird von der Kundenseite aufgerufen.
//
// GET ?t=TOKEN                      → Objekt (Texte, Farben) + signierte URLs (60 s) der Startbilder
// GET ?t=TOKEN&bilder=room-x,mock-x → nur signierte URLs dieser Bilder (beim Farbwechsel)
// Prüft bei jedem Aufruf, ob der Link aktiv ist (und der Kunde, falls der Link einem Kunden gehört).

const t = require('./_lib/tools');

const URL_SEK = 60;
const SCHLUESSEL_RE = /^(vorher|(room|mock)-[A-Za-z0-9_-]{1,60})$/;
const ID_RE = /^[A-Za-z0-9_-]{1,60}$/;

function kundenName(k) {
  const anrede = { frau: 'Frau', herr: 'Herr', familie: 'Familie' }[k.anrede_typ] || '';
  const vorname = k.anrede_typ !== 'familie' && k.vorname ? k.vorname : '';
  return [anrede, vorname, k.nachname].filter(Boolean).join(' ');
}

// Text aus den Spezifikationen: nur Klartext, Farbmuster als eigener Wert (kein HTML an den Kunden)
function entitaeten(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
function specZeile(z) {
  if (!Array.isArray(z)) return null;
  const roh = String(z[1] == null ? '' : z[1]);
  const farbe = (roh.match(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})\b/) || [])[1] || null;
  return { k: entitaeten(String(z[0] || '').replace(/<[^>]*>/g, '')).trim(), text: entitaeten(roh.replace(/<[^>]*>/g, '')).trim(), farbe };
}

function farbe(x) {
  return /^#[0-9a-fA-F]{3,8}$/.test(x || '') ? x : '#cccccc';
}

function objektFuerKunden(o) {
  const varianten = (Array.isArray(o.varianten) ? o.varianten : [])
    .filter((v) => v && ID_RE.test(v.id || ''))
    .map((v) => ({ id: v.id, name: String(v.name || v.id), swatch: farbe(v.swatch), glossy: !!v.glossy }));
  const start = Math.max(0, Math.min(varianten.length - 1, parseInt(o.start, 10) || 0));
  return {
    raum: String(o.raum || ''),
    datum: String(o.datum || ''),
    aspect: /^\d{1,2}\/\d{1,2}$/.test(o.aspect || '') ? o.aspect : '4/3',
    start,
    titel: String(o.titel || ''),
    lead: String(o.lead || ''),
    hinweis: String(o.hinweis || ''),
    varianten,
    spec: (Array.isArray(o.spec) ? o.spec : []).map(specZeile).filter(Boolean)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return t.json(405, { error: 'Methode nicht erlaubt' });
  const q = event.queryStringParameters || {};
  const token = q.t || '';
  if (!/^[a-f0-9]{32}$/.test(token)) return t.json(400, { error: 'Ungültiger Link' });

  try {
    const links = await t.rest('visualisierung_links?select=id,objekt_id,kunde_name,kunde_id,is_active,view_count&token=eq.' + token);
    const link = links && links[0];
    if (!link) return t.json(404, { error: 'Link nicht gefunden' });

    const deaktiviert = { error: 'Dieser Link wurde deaktiviert. Bitte kontaktieren Sie Jäggi Vollmer.' };
    if (!link.is_active) return t.json(403, deaktiviert);

    let name = link.kunde_name;
    if (link.kunde_id) {
      const k = await t.rest('kunden?select=anrede_typ,vorname,nachname,status&id=eq.' + link.kunde_id);
      if (!k || !k[0] || k[0].status !== 'aktiv') return t.json(403, deaktiviert);
      name = kundenName(k[0]) || name;
    }

    const doc = await t.docLesen('badvis', 'objekte/' + link.objekt_id);
    if (!doc || !doc.daten) return t.json(404, { error: 'Visualisierung nicht gefunden' });
    const o = doc.daten;
    const bilderIds = o.bilder || {};
    const objekt = objektFuerKunden(o);

    // Welche Bilder? Beim ersten Aufruf: Vorher + Startvariante. Sonst die angefragten.
    let schluessel;
    if (q.bilder) {
      schluessel = String(q.bilder).split(',').slice(0, 6).filter((s) => SCHLUESSEL_RE.test(s));
    } else {
      const v0 = objekt.varianten[objekt.start];
      schluessel = ['vorher'].concat(v0 ? ['room-' + v0.id, 'mock-' + v0.id] : []);
    }
    const pfade = {};
    schluessel.forEach((s) => { if (t.ASSET_RE.test(bilderIds[s] || '')) pfade[s] = t.assetPfad(bilderIds[s]); });
    const signiert = await t.signierteUrls(Object.values(pfade), URL_SEK);
    const bilder = {};
    Object.keys(pfade).forEach((s) => { if (signiert[pfade[s]]) bilder[s] = signiert[pfade[s]]; });

    if (q.bilder) return t.json(200, { ok: true, bilder });

    // Aufruf zählen (nur beim ersten Laden der Seite)
    try {
      await t.rest('visualisierung_links?id=eq.' + link.id, {
        method: 'PATCH', body: { view_count: (link.view_count || 0) + 1, last_viewed_at: new Date().toISOString() }, prefer: 'return=minimal'
      });
    } catch (e) { console.error('Zähler', e); }

    return t.json(200, { ok: true, watermark: name, objekt, bilder });
  } catch (err) {
    console.error('get-visualisierung', err);
    return t.json(500, { error: 'Die Visualisierung konnte nicht geladen werden.' });
  }
};
