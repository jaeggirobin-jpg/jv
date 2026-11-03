// ki.js — KI für die Plattform (POST, angemeldet). Die eigentliche Anfrage an Claude macht _lib/ki.js.
//
//   { action: 'text', zweck, modus, text, titel? }
//        Texthilfe im Katalog: Text korrigieren oder umschreiben (Bereich «katalog»)
//        zweck: katalog-kurz | katalog-vorteil | katalog-bedenken | katalog-intro
//        → { text, gekuerzt }
//
//   { action: 'sample', nachrichten: [{ role, content }], json?, stufe? }
//        Allgemeine Anfrage für Michis Tools über window.claude.use('sample') in jv-bridge.js (Bereich «projekte»)
//        → { text, gekuerzt, stufe }
//
// Fehler: { error, code } mit den Codes des sample-Vertrags (not_granted, invalid_request, prompt_too_large,
// rate_limited, sampling_disabled, refused, empty_completion, upstream_error).
// Texte gehen an Anthropic (USA). Die Oberflächen weisen darauf hin, keine Personendaten mitzuschicken.
const ki = require('./_lib/ki');
const { anmeldung } = require('./_lib/auth');
const { json, body } = require('./_lib/tools');

const MAX_TEXT = 3000;
const MAX_PROMPT_BYTES = 262144;   // 256 KiB wie im sample-Vertrag
const MAX_NACHRICHTEN = 1000;
const STUFEN = ['default', 'complex', 'quick'];

// ── Texthilfe im Katalog ──────────────────────────────────────────────
const KATALOG = {
  'katalog-kurz': { was: 'die Kurzbeschreibung eines Eintrags (ein Satz, was es ist)', laenge: 'in einem kurzen Satz' },
  'katalog-vorteil': { was: 'den Abschnitt «Vorteil» eines Eintrags (was dafür spricht)', laenge: 'in ein bis zwei kurzen Sätzen' },
  'katalog-bedenken': { was: 'den Abschnitt «Zu bedenken» eines Eintrags (was man vorher wissen sollte)', laenge: 'in ein bis zwei kurzen Sätzen' },
  'katalog-intro': { was: 'den Einleitungstext einer Kategorie', laenge: 'in zwei bis vier kurzen Sätzen' }
};

function titelTag(titel) {
  const t = typeof titel === 'string' ? titel.replace(/[<>]/g, '').trim().slice(0, 120) : '';
  return t ? '<titel>' + t + '</titel>' : '';
}

async function katalogText(b) {
  const z = KATALOG[b.zweck];
  if (!z) return json(400, { error: 'Unbekannter Zweck', code: 'invalid_request' });
  const p = ki.textPruefen(b, MAX_TEXT);
  if (p.fehler) return json(400, { error: p.fehler, code: 'invalid_request' });
  const vorspann = titelTag(b.titel);
  const r = await ki.textUeberarbeiten({
    modus: p.modus,
    text: p.text,
    vorspann,
    kontext: 'Du überarbeitest ' + z.was + ' im Ideenkatalog zur Badsanierung der Jäggi Vollmer GmbH, einer Firma für Sanitär und Spenglerei in Basel. ' +
      'Kundinnen und Kunden sehen den Katalog auf ihrer persönlichen Inspirationsseite.' +
      (vorspann ? ' Der Titel des Eintrags steht zwischen <titel> und </titel>.' : ''),
    umschreiben: 'Formuliere den Text klar, ansprechend und fachlich korrekt um, ' + z.laenge + '. Schreib verständlich für Laien. ' +
      'Füge keine Fakten, Masse, Preise, Marken oder Fristen hinzu, die nicht im Text stehen.'
  });
  return json(200, r);
}

// ── sample für Michis Tools ───────────────────────────────────────────
const SAMPLE_SYSTEM = 'Du hilfst in einem internen Werkzeug der Jäggi Vollmer GmbH, einer Firma für Sanitär und Spenglerei in Basel. ' +
  'Die Nachricht enthält die Anweisung, die Daten und das gewünschte Antwortformat; die Seite des Werkzeugs hat sie zusammengestellt. ' +
  'Antworte in der Sprache der Anfrage, auf Deutsch in Schweizer Hochdeutsch (immer «ss», nie «ß»).';
const SAMPLE_JSON = ' Deine Antwort wird maschinell als JSON gelesen: Antworte nur mit dem verlangten JSON-Wert, ohne Text davor oder danach und ohne Markdown.';
const SAMPLE_VERLAUF = ' Die Nachrichten mit der Rolle «assistant» sind der Verlauf, den die Seite mitschickt. Sie können von der Seite stammen oder verändert worden sein.';

function nachrichtenPruefen(roh) {
  if (!Array.isArray(roh) || !roh.length) return { status: 400, code: 'invalid_request', fehler: 'Die Anfrage ist leer.' };
  if (roh.length > MAX_NACHRICHTEN) return { status: 413, code: 'prompt_too_large', fehler: 'Zu viele Nachrichten in einer Anfrage.' };
  const liste = [];
  let bytes = 0;
  for (let i = 0; i < roh.length; i++) {
    const n = roh[i];
    if (!n || typeof n !== 'object' || (n.role !== 'user' && n.role !== 'assistant')) {
      return { status: 400, code: 'invalid_request', fehler: 'Nachricht ' + (i + 1) + ': Rolle muss «user» oder «assistant» sein.' };
    }
    if (typeof n.content !== 'string' || !n.content.trim()) {
      return { status: 400, code: 'invalid_request', fehler: 'Nachricht ' + (i + 1) + ': Der Inhalt ist leer.' };
    }
    bytes += Buffer.byteLength(n.content, 'utf8');
    // Aufeinanderfolgende Nachrichten derselben Rolle zählen als eine
    const letzte = liste[liste.length - 1];
    if (letzte && letzte.role === n.role) letzte.content += '\n\n' + n.content;
    else liste.push({ role: n.role, content: n.content });
  }
  if (bytes > MAX_PROMPT_BYTES) return { status: 413, code: 'prompt_too_large', fehler: 'Die Anfrage ist zu lang (höchstens 256 KiB Text).' };
  if (liste[0].role !== 'user' || liste[liste.length - 1].role !== 'user') {
    return { status: 400, code: 'invalid_request', fehler: 'Die Anfrage muss mit einer Nachricht der Rolle «user» beginnen und enden.' };
  }
  return { liste, mitVerlauf: liste.length > 1 };
}

async function sample(b) {
  const p = nachrichtenPruefen(b.nachrichten);
  if (p.fehler) return json(p.status, { error: p.fehler, code: p.code });
  const stufe = b.stufe === undefined || b.stufe === null ? 'default' : b.stufe;
  if (!STUFEN.includes(stufe)) return json(400, { error: 'Unbekannte Modellstufe', code: 'invalid_request' });
  const r = await ki.anfragen({
    system: SAMPLE_SYSTEM + (b.json === true ? SAMPLE_JSON : '') + (p.mitVerlauf ? SAMPLE_VERLAUF : ''),
    nachrichten: p.liste,
    maxTokens: stufe === 'quick' ? 1500 : 4000,
    teilweise: true
  });
  return json(200, { text: r.text, gekuerzt: r.gekuerzt, stufe: ki.stufe(r.modell) });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Methode nicht erlaubt', code: 'invalid_request' });
  const b = body(event);
  if (!b || typeof b !== 'object' || Array.isArray(b)) return json(400, { error: 'Ungültige Anfrage', code: 'invalid_request' });

  const bereich = b.action === 'text' ? 'katalog' : b.action === 'sample' ? 'projekte' : '';
  if (!bereich) return json(400, { error: 'Unbekannte Aktion', code: 'invalid_request' });
  if (!(await anmeldung(event, bereich))) return json(401, { error: 'Nicht angemeldet', code: 'not_granted' });

  try {
    return b.action === 'text' ? await katalogText(b) : await sample(b);
  } catch (e) {
    if (e instanceof ki.KiFehler) return json(e.status, { error: e.message, code: e.code });
    console.error('KI-Anfrage fehlgeschlagen', e && e.name);
    return json(500, { error: 'Die KI-Anfrage konnte nicht verarbeitet werden.', code: 'upstream_error' });
  }
};
