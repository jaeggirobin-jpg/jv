// gestaltung.js — freie Gestaltung von Reel und Story über den Claude-Chat (Robin, 4.11.2026:
// «man muss freie Anpassungen via Chat machen können»). Prüft die Gestaltungs-Änderungen, die Claude
// vorschlägt: nur bekannte Felder, Zahlen in festen Grenzen, Farben als #RRGGBB, CSS nur mit erlaubten
// Eigenschaften und Funktionen (kein url(), nichts, was Dateien von fremden Seiten lädt).
// Genutzt von werkzeug-chat.js; die Seite (public/assets/ki-chat.js) prüft CSS nochmals.

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[a-z0-9]{1,12}$/;
const MAX_EBENEN = 20;

function zahl(v, min, max) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : undefined;
}
function farbe(v) { return typeof v === 'string' && HEX_RE.test(v) ? v.toUpperCase() : undefined; }
function wahr(v) { return typeof v === 'boolean' ? v : undefined; }
function wahl(v, liste) { return liste.includes(v) ? v : undefined; }
function kurztext(v, zeilen, max) {
  if (typeof v !== 'string' || v.length > max) return undefined;
  return v.replace(/ß/g, 'ss').replace(/\r/g, '').split('\n').slice(0, zeilen).join('\n');
}

// Felder nach Schema prüfen. null heisst «zurück auf Original» und bleibt null.
// Gibt { werte, fehler } zurück; ein unbekanntes oder ungültiges Feld ist ein Fehler.
function felder(roh, schema) {
  const werte = {};
  let fehler = 0;
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return { werte, fehler: 1 };
  for (const k of Object.keys(roh)) {
    if (!schema[k]) { fehler++; continue; }
    if (roh[k] === null) { werte[k] = null; continue; }
    const w = schema[k](roh[k]);
    if (w === undefined) fehler++; else werte[k] = w;
  }
  return { werte, fehler };
}

// ── Reel (Canvas 1080 × 1920) ──────────────────────────────────────────
const SEK = (v) => zahl(v, 0, 300);
const REEL_LOGO = {
  sichtbar: wahr, freigestellt: wahr,
  x: (v) => zahl(v, -500, 1580), y: (v) => zahl(v, -500, 2420),
  breite: (v) => zahl(v, 60, 1080),
  karte: wahr, kartenfarbe: farbe, radius: (v) => zahl(v, 0, 300),
  deckkraft: (v) => zahl(v, 0, 1), schatten: wahr,
  von: SEK, bis: SEK, einblenden: (v) => zahl(v, 0, 10), ausblenden: (v) => zahl(v, 0, 10)
};
const REEL_EBENE = {
  typ: (v) => wahl(v, ['text', 'rechteck', 'kreis', 'linie', 'logo']),
  text: (v) => kurztext(v, 4, 200),
  schrift: (v) => wahl(v, ['schreib', 'schmal']),
  groesse: (v) => zahl(v, 10, 400), gewicht: (v) => zahl(v, 100, 900),
  ausrichtung: (v) => wahl(v, ['links', 'mitte', 'rechts']),
  farbe,
  x: (v) => zahl(v, -500, 1580), y: (v) => zahl(v, -500, 2420),
  x2: (v) => zahl(v, -500, 1580), y2: (v) => zahl(v, -500, 2420),
  b: (v) => zahl(v, 1, 2200), h: (v) => zahl(v, 1, 2800), r: (v) => zahl(v, 1, 1500),
  radius: (v) => zahl(v, 0, 1000), dicke: (v) => zahl(v, 1, 200), breite: (v) => zahl(v, 40, 1080), freigestellt: wahr,
  drehung: (v) => zahl(v, -360, 360), deckkraft: (v) => zahl(v, 0, 1), schatten: wahr,
  von: SEK, bis: SEK, einblenden: (v) => zahl(v, 0, 10), ausblenden: (v) => zahl(v, 0, 10)
};

function idVon(v) { return typeof v === 'string' && ID_RE.test(v) ? v : undefined; }
function ebenenIds(z) {
  const g = z && z.gestaltung;
  return g && Array.isArray(g.ebenen) ? g.ebenen.map((e) => e && e.id).filter(Boolean) : [];
}

// Gemeinsame Prüfung für {art:'ebene', aktion, id, ebene}
function ebene(a, z, schema, extra) {
  const ids = ebenenIds(z);
  if (a.aktion === 'entfernen') {
    const id = idVon(a.id);
    return id && ids.includes(id) ? { art: 'ebene', aktion: 'entfernen', id } : null;
  }
  if (a.aktion !== 'neu' && a.aktion !== 'aendern') return null;
  const { werte, fehler } = felder(a.ebene, schema);
  if (fehler) return null;
  if (extra && extra(werte, a) === false) return null;
  if (a.aktion === 'aendern') {
    const id = idVon(a.id);
    if (!id || !ids.includes(id) || !Object.keys(werte).length) return null;
    return { art: 'ebene', aktion: 'aendern', id, ebene: werte };
  }
  if (ids.length >= MAX_EBENEN || !werte.typ) return null;
  return { art: 'ebene', aktion: 'neu', ebene: werte };
}

function reelPruefen(a, z) {
  if (a.art === 'logo') {
    const roh = Object.assign({}, a);
    delete roh.art;
    const { werte, fehler } = felder(roh, REEL_LOGO);
    return fehler || !Object.keys(werte).length ? null : { art: 'logo', werte };
  }
  if (a.art === 'farbe') {
    if (!['gold', 'weiss', 'dunkel'].includes(a.name)) return null;
    if (a.wert === null) return { art: 'farbe', name: a.name, wert: null };
    const f = farbe(a.wert);
    return f ? { art: 'farbe', name: a.name, wert: f } : null;
  }
  if (a.art === 'ebene') {
    return ebene(a, z, REEL_EBENE, (w, roh) => {
      if (roh.aktion === 'neu' && w.typ === 'text' && !w.text) return false;
      return true;
    });
  }
  if (a.art === 'gestaltung_zuruecksetzen') return { art: a.art };
  return null;
}

const REEL_BESCHREIBUNG =
  'Freie Gestaltung (Zeichenfläche 1080 × 1920 Pixel, x nach rechts, y nach unten, Mitte x 540; Zeiten in Sekunden ab Start, ' +
  'die Länge steht im Stand unter «dauer»; der aktuelle Stand der Gestaltung steht unter «gestaltung», die Originalfarben unter «gestaltungStandard»):\n' +
  '{"art":"logo", …Felder}  Logo oben (Original: Breite 600, weisse Karte mit Schatten, oben mittig, Kartenmitte etwa y 210). ' +
  'Felder: sichtbar (true/false), freigestellt (true = Logo-Datei ohne weissen Hintergrund; die normale Datei hat selbst einen weissen Hintergrund, ' +
  'ohne Karte bleibt sonst ein weisses Rechteck; die Schrift des Logos ist grau und kupfer, auf dunklen Fotos darum besser mit heller Karte), x, y (Mitte), breite, karte (true/false, weisse Fläche hinter dem Logo), kartenfarbe (#RRGGBB), radius, ' +
  'deckkraft (0–1), schatten (true/false), von, bis, einblenden, ausblenden (Sekunden). null setzt ein Feld aufs Original zurück.\n' +
  '{"art":"farbe","name":"gold"|"weiss"|"dunkel","wert":"#RRGGBB"|null}  Grundfarben des Reels: gold = Akzent (Unterstriche, Nummern), ' +
  'weiss = Schrift und Flächen, dunkel = Schrift auf hellen Flächen. null = Original.\n' +
  '{"art":"ebene","aktion":"neu","ebene":{…}}  zusätzliche Ebene über dem Bild: typ "text" (text, schrift "schreib"|"schmal", groesse, gewicht, ' +
  'ausrichtung "links"|"mitte"|"rechts", farbe), "rechteck" (b, h, radius, farbe), "kreis" (r, farbe), "linie" (x2, y2, dicke, farbe), ' +
  '"logo" (breite, freigestellt; das JV-Logo nochmals). Für alle: x, y (Mitte bzw. Anfang der Linie), drehung (Grad), deckkraft, schatten, von, bis, einblenden, ausblenden.\n' +
  '{"art":"ebene","aktion":"aendern","id":"…","ebene":{…nur geänderte Felder}}  bzw. {"art":"ebene","aktion":"entfernen","id":"…"} (id wie im Stand)\n' +
  '{"art":"gestaltung_zuruecksetzen"}  Logo, Farben und alle Ebenen zurück aufs Original\n' +
  'Gestalte mit den Markenfarben von Jäggi Vollmer (Kupfer #BD843A, dunkles Kupfer #94621F, Anthrazit #4B575D, Grau #929A9D), ausser die Person will andere. ' +
  'Das Logo nie ganz weiss einfärben (geht auch nicht). Die Fotos selbst und der Ablauf der Bilder sind fix.';

// ── Story (HTML 1080 × 1920) ───────────────────────────────────────────
const STORY_ELEMENTE = ['flaeche', 'hintergrund', 'verlauf', 'inhalt', 'logokarte', 'logo', 'titel', 'strich', 'text', 'knopf', 'kontakt', 'telefon', 'fusszeile'];
const CSS_EIGENSCHAFTEN = [
  'display', 'position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'max-width', 'min-width', 'max-height', 'min-height',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'background', 'background-color', 'color', 'font-size', 'font-weight', 'font-style', 'font-family', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'text-shadow', 'text-decoration', 'box-shadow', 'border', 'border-radius', 'opacity', 'transform', 'filter',
  'align-self', 'align-items', 'justify-content', 'flex-direction', 'flex-grow', 'gap', 'order', 'z-index', 'object-fit', 'object-position',
  'white-space', 'visibility'
];
const CSS_FUNKTIONEN = ['rgb', 'rgba', 'hsl', 'hsla', 'linear-gradient', 'radial-gradient', 'repeating-linear-gradient', 'calc', 'min', 'max', 'clamp',
  'translate', 'translatex', 'translatey', 'rotate', 'scale', 'scalex', 'scaley', 'skew', 'skewx', 'skewy',
  'blur', 'brightness', 'contrast', 'grayscale', 'saturate', 'sepia', 'invert', 'hue-rotate', 'drop-shadow'];
const SCHRIFTEN = ['kaushan script', 'roboto condensed', 'arial', 'arial narrow', 'helvetica', 'georgia', 'sans-serif', 'serif', 'cursive'];

// Ein CSS-Wert: kurz, keine Zeichen, mit denen man aus der Eigenschaft ausbricht, nur erlaubte Funktionen.
function cssWert(eig, v) {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return undefined;
  v = v.trim();
  if (!v || v.length > 200 || /[;{}<>\\"`@!]|\/\*/.test(v)) return undefined;
  const funk = v.toLowerCase().match(/[a-z-]+(?=\s*\()/g) || [];
  if (funk.some((f) => !CSS_FUNKTIONEN.includes(f))) return undefined;
  if (eig === 'font-family') {
    const teile = v.split(',').map((s) => s.trim().replace(/^'|'$/g, '').toLowerCase());
    if (!teile.every((s) => SCHRIFTEN.includes(s))) return undefined;
  }
  if (eig === 'position' && !['relative', 'absolute', 'static'].includes(v)) return undefined;
  return v;
}
function cssStil(roh) {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return null;
  const keys = Object.keys(roh);
  if (!keys.length || keys.length > 30) return null;
  const stil = {};
  for (const k of keys) {
    const eig = k.trim().toLowerCase();
    if (!CSS_EIGENSCHAFTEN.includes(eig)) return null;
    if (roh[k] === null) { stil[eig] = null; continue; }
    const w = cssWert(eig, roh[k]);
    if (w === undefined) return null;
    stil[eig] = w;
  }
  return stil;
}

const STORY_EBENE = {
  typ: (v) => wahl(v, ['text']),
  text: (v) => kurztext(v, 6, 300),
  stil: (v) => cssStil(v) || undefined
};

function storyPruefen(a, z) {
  if (a.art === 'stil') {
    if (!STORY_ELEMENTE.includes(a.element)) return null;
    const stil = cssStil(a.stil);
    return stil ? { art: 'stil', element: a.element, stil } : null;
  }
  if (a.art === 'ebene') {
    if (a.ebene && typeof a.ebene === 'object' && a.aktion === 'neu' && !a.ebene.typ) a.ebene.typ = 'text';
    return ebene(a, z, STORY_EBENE, (w, roh) => !(roh.aktion === 'neu' && !w.text));
  }
  if (a.art === 'logo_bild') return ['original', 'freigestellt'].includes(a.wert) ? { art: a.art, wert: a.wert } : null;
  if (a.art === 'gestaltung_zuruecksetzen') {
    if (a.element !== undefined) return STORY_ELEMENTE.includes(a.element) ? { art: a.art, element: a.element } : null;
    return { art: a.art };
  }
  return null;
}

const STORY_BESCHREIBUNG =
  'Freie Gestaltung mit CSS (Fläche 1080 × 1920 Pixel; der Stand zeigt unter «gestaltung.stile» deine bisherigen Stile und unter «aufbau» den Aufbau):\n' +
  '{"art":"stil","element":"…","stil":{"eigenschaft":"wert",…}}  CSS für ein Element. Elemente: ' + STORY_ELEMENTE.join(', ') + '. ' +
  '(flaeche = ganze Story, hintergrund = unscharfes Foto, verlauf = dunkler Verlauf darüber, inhalt = Spalte mit allem, logokarte = weisse Karte ums Logo, ' +
  'logo = Logo-Bild, strich = farbiger Strich unter dem Titel, knopf = Knopf, kontakt = Block mit Telefon und Fusszeile). ' +
  'Wert null entfernt deine Änderung dieser Eigenschaft. Erlaubt sind übliche Eigenschaften für Lage, Grösse, Abstände, Farben, Schrift, Rahmen, ' +
  'Schatten, transform und filter; keine Bilder von aussen (kein url()). Die Elemente liegen in einer Spalte (flex); zum freien Platzieren ' +
  'position:absolute mit left/top im Element «inhalt» verwenden. Schriften: Kaushan Script, Roboto Condensed, Arial, Georgia.\n' +
  '{"art":"ebene","aktion":"neu","ebene":{"text":"…","stil":{…}}}  zusätzliches Textfeld (liegt absolut auf der Fläche; Lage über left/top im stil). ' +
  'Ändern: {"art":"ebene","aktion":"aendern","id":"…","ebene":{…}}, entfernen: {"art":"ebene","aktion":"entfernen","id":"…"}\n' +
  '{"art":"logo_bild","wert":"freigestellt"|"original"}  Logo-Datei: die normale hat selbst einen weissen Hintergrund (bleibt auch ohne Karte als weisses ' +
  'Rechteck sichtbar), «freigestellt» ist ohne Hintergrund (Schrift grau und kupfer, auf dunklem Grund schlecht lesbar).\n' +
  '{"art":"gestaltung_zuruecksetzen"}  alle Stile und Textfelder zurück (mit "element" nur dieses Element)\n' +
  'Gestalte mit den Markenfarben von Jäggi Vollmer (Kupfer #BD843A, dunkles Kupfer #94621F, Anthrazit #4B575D, Grau #929A9D), ausser die Person will andere.';

module.exports = {
  reelPruefen, storyPruefen, cssStil, cssWert, REEL_BESCHREIBUNG, STORY_BESCHREIBUNG,
  STORY_ELEMENTE, CSS_EIGENSCHAFTEN, CSS_FUNKTIONEN, MAX_EBENEN
};
