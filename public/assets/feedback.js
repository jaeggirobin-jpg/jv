// feedback.js — Feedback mit markiertem Bildausschnitt (Plattform und Tools)
//
// Nach der Vorlage aus GEMA Beta (gema_feedback.js), für die JV-Plattform angepasst:
//   1. «Feedback» → Bereich mit der Maus aufziehen (Touch: ganzer Bildschirm), oder «Ganzer Bildschirm»,
//      «Ohne Bild». Erfasst wird immer der sichtbare Ausschnitt der Seite (html2canvas-pro, ein Fork von
//      html2canvas, der auch moderne CSS-Farben wie color(), color-mix() und oklch() zeichnen kann;
//      lokal unter /assets/vendor/, wird erst beim ersten Feedback geladen).
//   2. Markieren: Stift, Pfeil, Rechteck, Text in fünf Farben, «Rückgängig» pro Form.
//   3. Formular: Art (Kommentar, Änderungsvorschlag, Fehler) und Beschreibung → POST /api/feedback.
//      Absender ist das angemeldete Login (vom Server gesetzt); nur beim Hauptzugang fragt das Formular
//      nach dem Namen.
// Was nicht ankommt (offline, abgemeldet, Server weg), wartet im Browser (localStorage) und wird beim
// nächsten Seitenstart, bei «online» und vor jedem neuen Feedback nachgesendet. Es wird nie «gesendet»
// gemeldet, was nicht angekommen ist.
// «Feedback zur Funktion» (auf jeder Ebene): Feedback zur Feedbackfunktion selbst, mit einem Bild des
// Dialogs, wie er gerade aussieht. Danach geht es mit dem begonnenen Feedback weiter.
//
// Einbinden:
//   <script src="/assets/feedback.js" data-seite="tool-terminplaner" data-name="Bau-Terminplaner JV" data-knopf="schwebend" defer></script>
//   data-knopf="schwebend": eigener Knopf am rechten Rand (Tools). Ohne: Start über ein Element mit
//   [data-feedback-start] oder JVFeedback.start(). Die Plattform meldet die Ansicht mit JVFeedback.seite(id, name).
// Die Oberfläche liegt in einem Shadow-DOM (Gestaltung der Tools wirkt nicht hinein) und in <dialog>-Ebenen,
// die über allen Dialogen der Seite liegen.
(function (w, d) {
  'use strict';
  if (w.JVFeedback) return;

  var skript = d.currentScript;
  var ds = (skript && skript.dataset) || {};
  var cfg = { seite: ds.seite || 'unbekannt', name: ds.name || d.title || '', knopf: ds.knopf || '' };

  var H2C = '/assets/vendor/html2canvas-pro.min.js';   // html2canvas-pro 2.5.2 (MIT)
  var API = '/api/feedback';
  var AUSGANG = 'jv_feedback_ausgang_v1';
  var NAME_KEY = 'jv_feedback_name';
  var MAX_BILD = 3500000;             // Zeichen (Base64); grössere Bilder werden verkleinert
  var MAX_AUSGANG = 30;
  var FARBEN = [
    { c: '#dc2626', n: 'Rot' },
    { c: '#bd843a', n: 'Kupfer' },
    { c: '#16a34a', n: 'Grün' },
    { c: '#2563eb', n: 'Blau' },
    { c: '#4b575d', n: 'Anthrazit' }
  ];
  var TYPEN = [['kommentar', 'Kommentar'], ['aenderung', 'Änderungsvorschlag'], ['fehler', 'Fehler']];
  var META = { id: 'feedback-funktion', name: 'Feedback-Funktion' };
  var SCHRITTE = { snip: 'Ausschnitt wählen', annot: 'Markieren', form: 'Formular' };
  var HINWEISE = {
    pen: 'Gedrückt halten und zeichnen',
    arrow: 'Ziehen: die Spitze zeigt zum Endpunkt',
    rect: 'Rechteck über den Bereich aufziehen',
    text: 'Auf die Stelle klicken, Text tippen, Enter'
  };

  // ── Zustand ───────────────────────────────────────────────────────────
  var bildRoh = '';          // aufgenommenes Bild (ohne Markierungen)
  var bild = '';             // Bild mit Markierungen (wird gesendet)
  var bildWeg = false;       // Bild war gewünscht, konnte aber nicht erstellt werden
  var formen = [];
  var temp = null;
  var werkzeug = 'pen';
  var farbe = FARBEN[0].c;
  var zeichnet = false;
  var textFeld = null;
  var leinwand = null, lctx = null;
  var meta = null;           // Entwurf während «Feedback zur Funktion»
  var auswahl = null;        // { x, y, w, h } in Bildschirm-Pixeln
  var start0 = null;
  var host = null, sr = null, E = {};
  var mini = null;
  var h2cP = null;
  var ausgangLaeuft = false;

  // ── Hilfen ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function neueId() {
    var b = new Uint8Array(6);
    (w.crypto || w.msCrypto).getRandomValues(b);
    return 'fb_' + Date.now().toString(36) + '_' + Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function warten(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function naechstesBild() { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); }
  function benutzer() {
    try { return (w.JVBridge && w.JVBridge.benutzer && w.JVBridge.benutzer()) || null; } catch (e) { return null; }
  }
  function lsLesen(k) { try { return w.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSchreiben(k, v) { try { w.localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  // ── Gestaltung ────────────────────────────────────────────────────────
  // Schriften müssen im Dokument stehen (Shadow-DOM lädt keine @font-face), eigener Name stört die Tools nicht
  var DOK_STIL =
    '@font-face{font-family:"JVFB Arimo";font-weight:400;font-display:swap;src:url("/assets/fonts/arimo-latin-400-normal.woff2") format("woff2")}' +
    '@font-face{font-family:"JVFB Arimo";font-weight:600;font-display:swap;src:url("/assets/fonts/arimo-latin-600-normal.woff2") format("woff2")}' +
    '@font-face{font-family:"JVFB Arimo";font-weight:700;font-display:swap;src:url("/assets/fonts/arimo-latin-700-normal.woff2") format("woff2")}' +
    '@font-face{font-family:"JVFB Condensed";font-weight:800;font-display:swap;src:url("/assets/fonts/roboto-condensed-latin-800-normal.woff2") format("woff2")}' +
    '@media print{#jvfb-root,#jvfb-mini{display:none!important}}';

  var STIL =
    ':host{all:initial}' +
    '*{box-sizing:border-box}' +
    '.f{font-family:"JVFB Arimo",Arimo,Arial,Helvetica,sans-serif;color:#3f4c57;font-size:15px;line-height:1.45}' +
    'button{font:inherit;cursor:pointer}' +
    '[hidden]{display:none!important}' +
    // Rand-Knopf (Tools)
    '.tab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147482000;writing-mode:vertical-rl;' +
      'padding:14px 7px;border:0;border-radius:8px 0 0 8px;background:#94621f;color:#fff;font-weight:700;font-size:13px;letter-spacing:.04em;' +
      'box-shadow:-2px 2px 12px rgba(40,50,60,.28);opacity:.92}' +
    '.tab:hover,.tab:focus-visible{opacity:1;background:#7a5018;outline:none}' +
    // Ebenen (alle als modaler Dialog)
    'dialog.ebene{position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;color:inherit;overflow:hidden}' +
    // Geschlossene Dialoge nie anzeigen (eigene display-Werte unten gelten nur für [open])
    'dialog:not([open]){display:none!important}' +
    'dialog.ebene::backdrop{background:transparent}' +
    'dialog.ebene:focus{outline:none}' +
    // 1. Ausschnitt
    '#aus{cursor:crosshair;background:rgba(30,38,44,.36);touch-action:none}' +
    '.leiste{position:fixed;top:calc(14px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;' +
      'width:max-content;max-width:calc(100vw - 24px);padding:9px 12px;border-radius:10px;background:#4b575d;color:#fff;box-shadow:0 8px 28px rgba(0,0,0,.28);cursor:default}' +
    '.leiste span{font-weight:700;font-size:14px;padding:0 4px}' +
    '.lk{padding:7px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.08);color:#fff;font-weight:600;font-size:13px;white-space:nowrap}' +
    '.lk:hover{background:rgba(255,255,255,.18)}' +
    '.lk--meta{border-style:dashed}' +
    '#sel{position:fixed;border:2px solid #bd843a;background:rgba(189,132,58,.14);box-shadow:0 0 0 1px rgba(255,255,255,.7);pointer-events:none}' +
    '.warte{position:fixed;inset:0;display:grid;place-items:center;pointer-events:none}' +
    '.warte span{background:#4b575d;color:#fff;padding:10px 18px;border-radius:9px;font-weight:700;font-size:14px}' +
    // 2. Markieren
    '#mark{background:rgba(40,48,55,.88);flex-direction:column}' +
    '#mark[open]{display:flex}' +
    '.mk{flex:none;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:9px 14px;padding-top:calc(9px + env(safe-area-inset-top,0px));background:#4b575d;color:#fff;box-shadow:0 2px 12px rgba(0,0,0,.3)}' +
    '.wz{display:flex;gap:6px;flex-wrap:wrap}' +
    '.wz button{padding:7px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.07);color:#e9edf0;font-weight:600;font-size:13px}' +
    '.wz button[aria-pressed=true]{background:#bd843a;border-color:#bd843a;color:#fff}' +
    '.fa{display:flex;gap:6px;align-items:center}' +
    '.fa button{width:26px;height:26px;border-radius:50%;padding:0;border:2px solid transparent;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.35)}' +
    '.fa button[aria-pressed=true]{border-color:#fff;transform:scale(1.12)}' +
    '.hw{flex:1;min-width:150px;color:#cfd6db;font-size:13px}' +
    '.mf{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;overflow:auto}' +
    '.bb{position:relative;display:inline-block;border-radius:6px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.45);background:#fff;line-height:0}' +
    '.bb img{display:block;max-width:calc(100vw - 32px);max-height:calc(100vh - 190px);max-height:calc(100dvh - 190px);user-select:none;-webkit-user-drag:none}' +
    '.bb canvas{position:absolute;left:0;top:0;cursor:crosshair;touch-action:none}' +
    '.bb input{position:absolute;z-index:2;font-family:"JVFB Arimo",Arial,sans-serif;font-weight:700;background:rgba(255,255,255,.94);border:1.5px dashed;border-radius:4px;padding:1px 5px;outline:none;min-width:80px;max-width:92%;line-height:1.2}' +
    '.mu{flex:none;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}' +
    '.mu button{padding:8px 15px;border-radius:7px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.07);color:#e9edf0;font-weight:600;font-size:13px}' +
    '.mu button.haupt{background:#bd843a;border-color:#bd843a;color:#fff;font-weight:700}' +
    '.mu button.haupt:hover{background:#94621f;border-color:#94621f}' +
    // 3. Formular
    '#form{background:rgba(40,48,55,.45);place-items:center;padding:16px}' +
    '#form[open]{display:grid}' +
    '.karte{width:min(600px,100%);max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;background:#fff;border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.25);overflow:hidden}' +
    '.kk{flex:none;display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #d7dce0;background:#f3f4f5}' +
    '.kk h2{flex:1;min-width:0;margin:0;font:800 19px/1.2 "JVFB Condensed","Roboto Condensed","Arial Narrow",Arial,sans-serif;color:#3f4c57;overflow-wrap:anywhere}' +
    '.kk h2 small{display:block;font:400 13px/1.3 "JVFB Arimo",Arial,sans-serif;color:#6c7882;margin-top:2px}' +
    '.zu{width:36px;height:36px;border-radius:8px;border:1px solid #c3cad0;background:#fff;color:#3f4c57;font-size:16px;flex:none}' +
    '.zu:hover{border-color:#bd843a}' +
    '.meta{padding:6px 11px;border-radius:999px;border:1px dashed #c3cad0;background:#fff;color:#3f4c57;font-size:12px;font-weight:600;white-space:nowrap;flex:none}' +
    '.meta:hover{border-color:#bd843a;color:#94621f}' +
    '.kb{padding:16px 18px;overflow-y:auto;flex:1;min-height:0;display:grid;gap:12px}' +
    '.hinweis{padding:9px 12px;border-radius:8px;background:#f4eadd;color:#7a4d00;font-size:13px;font-weight:600}' +
    '.vorschau{width:100%;max-height:210px;object-fit:contain;background:#e9ecee;border:1px solid #d7dce0;border-radius:8px;cursor:pointer;display:block}' +
    '.vk{font-size:12px;color:#6c7882;margin-top:-6px}' +
    'label{display:grid;gap:5px;font-size:13px;font-weight:600}' +
    'select,textarea,input.feld{width:100%;max-width:100%;box-sizing:border-box;font:15px/1.4 "JVFB Arimo",Arial,sans-serif;color:#3f4c57;background:#fff;border:1px solid #c3cad0;border-radius:6px;padding:9px 11px;min-height:42px}' +
    'textarea{min-height:110px;resize:vertical}' +
    'select:focus,textarea:focus,input.feld:focus{outline:none;border-color:#bd843a;box-shadow:0 0 0 3px rgba(189,132,58,.18)}' +
    '.kf{flex:none;display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid #d7dce0;background:#f3f4f5;flex-wrap:wrap}' +
    '.kn{min-height:40px;padding:0 16px;border-radius:6px;border:1px solid #c3cad0;background:#fff;color:#3f4c57;font-weight:600;font-size:14px}' +
    '.kn:hover{border-color:#bd843a;color:#94621f}' +
    '.kn.haupt{background:#bd843a;border-color:#bd843a;color:#fff}' +
    '.kn.haupt:hover{background:#94621f;border-color:#94621f;color:#fff}' +
    '.kn:disabled{opacity:.6;cursor:wait}' +
    // Meldung
    '.toast{position:fixed;inset:auto auto 22px 50%;transform:translateX(-50%);margin:0;border:0;max-width:min(560px,calc(100vw - 32px));padding:11px 20px;border-radius:10px;' +
      'background:#4b575d;color:#fff;font-weight:600;font-size:14px;text-align:center;box-shadow:0 8px 28px rgba(0,0,0,.25);pointer-events:none;z-index:2147483600;overflow:visible}' +
    '@media (max-width:640px){select,textarea,input.feld{font-size:16px}.leiste span{width:100%;text-align:center}.mk{padding:8px 10px}.hw{display:none}}';

  function bauen() {
    if (host) return;
    var st = d.createElement('style');
    st.id = 'jvfb-stil';
    st.textContent = DOK_STIL;
    (d.head || d.documentElement).appendChild(st);

    host = d.createElement('div');
    host.id = 'jvfb-root';
    sr = host.attachShadow({ mode: 'open' });
    var metaKnopf = function (klasse) {
      return '<button type="button" class="' + klasse + '" data-meta title="Feedback zur Feedbackfunktion selbst, mit Bild dieses Dialogs. Das begonnene Feedback bleibt erhalten.">Feedback zur Funktion</button>';
    };
    sr.innerHTML = '<style>' + STIL + '</style><div class="f">' +
      (cfg.knopf === 'schwebend' ? '<button type="button" class="tab" id="tab" title="Feedback zu dieser Seite geben">Feedback</button>' : '') +
      // 1. Ausschnitt
      '<dialog class="ebene" id="aus" aria-label="Bereich für das Feedback wählen">' +
        '<div class="leiste" id="leiste"><span>Bereich mit der Maus aufziehen</span>' +
          '<button type="button" class="lk" data-a="ganz">Ganzer Bildschirm</button>' +
          '<button type="button" class="lk" data-a="ohne">Ohne Bild</button>' +
          '<button type="button" class="lk" data-a="abbrechen">Abbrechen</button>' +
          metaKnopf('lk lk--meta') + '</div>' +
        '<div id="sel" hidden></div>' +
      '</dialog>' +
      '<dialog class="ebene" id="warte" aria-label="Bild wird erstellt"><div class="warte"><span>Bild wird erstellt …</span></div></dialog>' +
      // 2. Markieren
      '<dialog class="ebene" id="mark" aria-label="Bild markieren">' +
        '<div class="mk"><div class="wz" id="wz">' +
          '<button type="button" data-wz="pen">Stift</button><button type="button" data-wz="arrow">Pfeil</button>' +
          '<button type="button" data-wz="rect">Rechteck</button><button type="button" data-wz="text">Text</button></div>' +
          '<div class="fa" id="fa">' + FARBEN.map(function (x) {
            return '<button type="button" data-fa="' + x.c + '" title="' + x.n + '" aria-label="Farbe ' + x.n + '" style="background:' + x.c + '"></button>';
          }).join('') + '</div>' +
          '<span class="hw" id="hw"></span>' + metaKnopf('lk lk--meta') + '</div>' +
        '<div class="mf"><div class="bb" id="bb"><img id="mimg" alt="Ausschnitt zum Markieren"></div>' +
          '<div class="mu"><button type="button" data-a="rueck">Rückgängig</button><button type="button" data-a="leeren">Alles löschen</button>' +
          '<button type="button" data-a="weiter">Ohne Markierung weiter</button><button type="button" class="haupt" data-a="fertig">Fertig</button></div></div>' +
      '</dialog>' +
      // 3. Formular
      '<dialog class="ebene" id="form" aria-labelledby="ftitel">' +
        '<div class="karte"><div class="kk"><h2 id="ftitel">Feedback<small id="fseite"></small></h2>' + metaKnopf('meta') +
          '<button type="button" class="zu" data-a="zu" aria-label="Schliessen">✕</button></div>' +
          '<form class="kb" id="fform" novalidate>' +
            '<div class="hinweis" id="fmeta" hidden></div>' +
            '<img class="vorschau" id="fbild" alt="Bildausschnitt (klicken zum Markieren)" hidden>' +
            '<div class="vk" id="fbildtext" hidden>Bild anklicken, um es (weiter) zu markieren.</div>' +
            '<div class="hinweis" id="fohne" hidden></div>' +
            '<label>Art<select id="ftyp">' + TYPEN.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select></label>' +
            '<label>Was fällt auf? Was soll anders werden?<textarea id="ftext" maxlength="20000" placeholder="Beschreibung (Pflicht)"></textarea></label>' +
            '<label id="fnamezeile">Dein Name<input class="feld" id="fname" type="text" maxlength="80" autocomplete="off" placeholder="Vor- und Nachname"></label>' +
          '</form>' +
          '<div class="kf"><button type="button" class="kn" data-a="zu">Abbrechen</button>' +
          '<button type="button" class="kn haupt" id="fsenden" data-a="senden">Feedback senden</button></div></div>' +
      '</dialog>' +
      '<div class="toast" id="toast" popover="manual" role="status" aria-live="polite" hidden></div>' +
      '</div>';
    d.body.appendChild(host);
    ['tab', 'aus', 'leiste', 'sel', 'warte', 'mark', 'wz', 'fa', 'hw', 'bb', 'mimg', 'form', 'ftitel', 'fseite', 'fmeta', 'fbild', 'fbildtext',
      'fohne', 'ftyp', 'ftext', 'fnamezeile', 'fname', 'fsenden', 'toast', 'fform'].forEach(function (id) { E[id] = sr.getElementById(id); });
    ereignisse();
  }

  // ── Ebenen öffnen und schliessen ──────────────────────────────────────
  function oeffnen(el) {
    if (!el.open) {
      try { el.showModal(); } catch (e) { el.setAttribute('open', ''); }
    }
    miniPruefen();
  }
  function schliessen(el) {
    if (el && el.open) el.close();
    miniPruefen();
  }
  function ebeneOffen() {
    return !!(E.aus && (E.aus.open || E.mark.open || E.form.open || E.warte.open));
  }
  function stufe() {
    if (E.form.open) return 'form';
    if (E.mark.open) return 'annot';
    if (E.aus.open) return 'snip';
    return '';
  }
  function alleZu() {
    [E.aus, E.warte, E.mark, E.form].forEach(function (el) { if (el.open) el.close(); });
    E.sel.hidden = true;
    auswahl = null;
    start0 = null;
    miniPruefen();
  }

  // ── Start ─────────────────────────────────────────────────────────────
  function start() {
    bauen();
    if (ebeneOffen()) return;
    html2canvasLaden();      // Download beginnt mit dem Klick, die Aufnahme wartet darauf
    if (meta) { meta = null; metaUi(false); }
    bildRoh = ''; bild = ''; bildWeg = false;
    formen = []; temp = null;
    textAbbrechen();
    E.ftext.value = '';
    E.ftyp.value = 'kommentar';
    ausgangSenden();
    // Touch (Handy, Tablet): kein Aufziehen mit der Maus, direkt der ganze Bildschirm
    var touch = w.matchMedia && w.matchMedia('(pointer: coarse)').matches && !(w.matchMedia('(pointer: fine)').matches);
    if (touch) { ganzerBildschirm(); return; }
    E.sel.hidden = true;
    oeffnen(E.aus);
  }

  // ── 1. Ausschnitt wählen ──────────────────────────────────────────────
  function auswahlZeichnen() {
    if (!auswahl) { E.sel.hidden = true; return; }
    E.sel.hidden = false;
    E.sel.style.left = auswahl.x + 'px';
    E.sel.style.top = auswahl.y + 'px';
    E.sel.style.width = auswahl.w + 'px';
    E.sel.style.height = auswahl.h + 'px';
  }

  function ganzerBildschirm() {
    schliessen(E.aus);
    aufnehmenUndWeiter(null);
  }

  function ohneBild() {
    schliessen(E.aus);
    bildRoh = ''; bild = ''; bildWeg = false;
    formularZeigen();
  }

  // Seite aufnehmen (sichtbarer Ausschnitt), optional zuschneiden, dann markieren
  function aufnehmenUndWeiter(bereich) {
    oeffnen(E.warte);
    // Zwei Bilder warten: die eigene Ebene ist sicher weg und die Seite neu gezeichnet
    naechstesBild().then(naechstesBild).then(function () {
      var dpr = w.devicePixelRatio || 1;
      var skala = bereich ? 1.5 : Math.max(1, Math.min(1.5, dpr, 2800 / Math.max(1, w.innerWidth)));
      return aufnehmen(skala, false).then(function (c) {
        return jpeg(bereich ? zuschneiden(c, bereich) : c);
      });
    }).then(function (url) {
      schliessen(E.warte);
      bildRoh = url || '';
      bildWeg = !url;
      if (bildRoh) markierenOeffnen([]);
      else { meldung('Kein Bild möglich, das Feedback geht ohne Bild weiter.'); formularZeigen(); }
    }, function (e) {
      if (w.console) console.warn('[JVFeedback] Aufnahme:', e);
      schliessen(E.warte);
      bildRoh = ''; bildWeg = true;
      meldung('Kein Bild möglich, das Feedback geht ohne Bild weiter.');
      formularZeigen();
    });
  }

  // ── Aufnahme (html2canvas-pro) ────────────────────────────────────────
  // Eigene Referenz: Hat eine Seite selbst ein (älteres) html2canvas geladen, bleibt dieses für die Seite
  // unverändert, und das Feedback nimmt trotzdem die eigene Version.
  var h2c = null;
  function html2canvasLaden() {
    if (h2c) return Promise.resolve(true);
    if (h2cP) return h2cP;
    h2cP = new Promise(function (fertig) {
      var erledigt = false;
      var vorher = w.html2canvas;
      var hatte = 'html2canvas' in w;
      var s = d.createElement('script');
      var ende = function (ok) {
        if (erledigt) return;
        erledigt = true;
        if (ok && typeof w.html2canvas === 'function' && w.html2canvas !== vorher) h2c = w.html2canvas;
        // Globale Namen der Seite wiederherstellen
        try {
          if (hatte) w.html2canvas = vorher; else delete w.html2canvas;
          delete w.html2canvasExports;
        } catch (e) { /* egal */ }
        if (!h2c) h2cP = null;
        fertig(!!h2c);
      };
      s.src = H2C;
      s.async = true;
      s.onload = function () { ende(true); };
      s.onerror = function () { ende(false); };
      setTimeout(function () { ende(false); }, 10000);
      d.head.appendChild(s);
    });
    return h2cP;
  }

  // Ein opakes Vollbild-Element (position:fixed über dem ganzen Fenster) wird direkt erfasst:
  // keine Scroll-Rechnung nötig (Erfahrung aus GEMA: iOS-Safari, Vollbild-Editoren)
  function vollbildElement() {
    try {
      var vw = w.innerWidth, vh = w.innerHeight;
      var stapel = d.elementsFromPoint ? d.elementsFromPoint(Math.floor(vw / 2), Math.floor(vh / 2)) : [];
      for (var i = 0; i < stapel.length; i++) {
        var el = stapel[i];
        if (!el || el === d.documentElement || el === d.body || el === host) continue;
        var cs = getComputedStyle(el);
        if (cs.position !== 'fixed') continue;
        var r = el.getBoundingClientRect();
        if (r.top > 2 || r.left > 2 || r.width < vw - 4 || r.height < vh - 4) continue;
        var m = String(cs.backgroundColor || '').match(/rgba?\(([^)]+)\)/);
        var teile = m ? m[1].split(',') : null;
        var alpha = teile ? (teile[3] !== undefined ? parseFloat(teile[3]) : 1) : 0;
        if (alpha >= 0.99) return el;
      }
    } catch (e) { /* normaler Weg */ }
    return null;
  }

  // Kalibrier-Marken (aus GEMA): zwei kleine Quadrate oben links und rechts. Im Bild gefunden, liefern
  // sie Versatz und tatsächliche Skalierung für den Zuschnitt; danach werden sie wieder übermalt.
  var MARKE = 4;
  function spanne() { return d.documentElement.clientWidth || w.innerWidth; }
  function markenAn() {
    try {
      var lage = d.createElement('div');
      lage.setAttribute('data-jvfb-marken', '');
      lage.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
      [0, Math.max(0, spanne() - MARKE)].forEach(function (x) {
        var q = d.createElement('div');
        q.style.cssText = 'position:fixed;top:0;left:' + x + 'px;width:' + MARKE + 'px;height:' + MARKE + 'px;background:rgb(255,0,255)';
        lage.appendChild(q);
      });
      d.body.appendChild(lage);
      return lage;
    } catch (e) { return null; }
  }
  function markenAus(lage) { try { if (lage && lage.parentNode) lage.parentNode.removeChild(lage); } catch (e) { /* weg */ } }
  function markenMessen(c, skala) {
    try {
      var band = Math.min(c.height, Math.max(24, Math.round(MARKE * skala * 6)));
      // Nur den oberen Streifen auslesen, über eine eigene Leinwand (schneller, keine Browser-Warnung)
      var streifen = d.createElement('canvas');
      streifen.width = c.width;
      streifen.height = band;
      var sg = streifen.getContext('2d', { willReadFrequently: true });
      sg.drawImage(c, 0, 0, c.width, band, 0, 0, c.width, band);
      var px = sg.getImageData(0, 0, c.width, band).data;
      var links = -1, rechts = -1, y = -1;
      for (var py = 0; py < band; py++) {
        for (var x = 0; x < c.width; x++) {
          var i = (py * c.width + x) * 4;
          if (Math.abs(px[i] - 255) < 30 && px[i + 1] < 30 && Math.abs(px[i + 2] - 255) < 30 && px[i + 3] > 200) {
            if (links < 0) { links = x; y = py; }
            if (py === y) rechts = x;
          }
        }
        if (links >= 0) break;
      }
      if (links < 0 || rechts <= links) return null;
      var sc = ((rechts + 1) - links) / spanne();
      if (!(sc > 0.2 && sc < 6)) return null;
      return { offX: links, offY: y, sc: sc };
    } catch (e) { return null; }
  }
  function markenWeg(c, cal) {
    try {
      var g = c.getContext('2d');
      var s = Math.ceil(MARKE * cal.sc) + 2;
      var quelle = Math.min(c.height - 1, cal.offY + s + 1);
      var rechts = Math.round((spanne() - MARKE) * cal.sc + cal.offX) - 1;
      [cal.offX, rechts].forEach(function (x) {
        x = Math.max(0, Math.min(c.width - s, Math.round(x)));
        g.drawImage(c, x, quelle, s, 1, x, Math.max(0, cal.offY), s, s);
      });
    } catch (e) { /* bleibt */ }
  }

  // Sanftes Scrollen (scroll-behavior:smooth) würde html2canvas den Seitenanfang liefern lassen (GEMA)
  function sofortScrollen() {
    var de = d.documentElement, bo = d.body;
    var alt = [de.style.scrollBehavior, bo ? bo.style.scrollBehavior : ''];
    de.style.scrollBehavior = 'auto';
    if (bo) bo.style.scrollBehavior = 'auto';
    return function () {
      de.style.scrollBehavior = alt[0] || '';
      if (bo) bo.style.scrollBehavior = alt[1] || '';
    };
  }

  // Bilder hinter einer Weiterleitung (/_blob/…, /api/…: gleiche Adresse, aber Daten aus dem Speicher)
  // würden das Bild «verschmutzen» (Sicherheitsregel des Browsers). Sie werden vorher als blob: geladen.
  var UMLEITUNG = /^\/(_blob|api)\//;
  function gleicheHerkunft(u) {
    try { var x = new URL(u, location.href); return x.origin === location.origin ? x : null; } catch (e) { return null; }
  }
  function bilderVorbereiten() {
    var karte = {};
    var urls = [];
    var vh = w.innerHeight, vw = w.innerWidth;
    Array.prototype.forEach.call(d.images, function (img) {
      var u = img.currentSrc || img.src;
      var x = u && gleicheHerkunft(u);
      if (!x || !UMLEITUNG.test(x.pathname) || urls.indexOf(u) >= 0) return;
      var r = img.getBoundingClientRect();
      if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw || r.width < 1) return;
      urls.push(u);
    });
    Array.prototype.forEach.call(d.querySelectorAll('[style*="/_blob/"]'), function (el) {
      var m = /url\(["']?([^"')]+)["']?\)/.exec(el.style.backgroundImage || '');
      if (m && urls.indexOf(new URL(m[1], location.href).href) < 0) urls.push(new URL(m[1], location.href).href);
    });
    urls = urls.slice(0, 40);
    // SVG-Bilder (z. B. das Logo) zeichnet html2canvas nicht zuverlässig: vorher als PNG rastern
    var svgs = [];
    Array.prototype.forEach.call(d.images, function (img) {
      var u = img.currentSrc || img.src;
      var x = u && gleicheHerkunft(u);
      if (!x || !/\.svg$/i.test(x.pathname) || karte[u] || svgs.some(function (s) { return s.u === u; })) return;
      if (!img.complete || !img.naturalWidth && !img.width) return;
      var r = img.getBoundingClientRect();
      if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw || r.width < 1 || r.height < 1) return;
      svgs.push({ u: u, img: img, w: r.width, h: r.height });
    });
    var raster = svgs.slice(0, 20).map(function (s) {
      return new Promise(function (fertig) {
        try {
          var f = Math.min(4, Math.max(2, (w.devicePixelRatio || 1) * 1.5));
          var c = d.createElement('canvas');
          c.width = Math.max(1, Math.round(s.w * f));
          c.height = Math.max(1, Math.round(s.h * f));
          c.getContext('2d').drawImage(s.img, 0, 0, c.width, c.height);
          c.toBlob(function (b) { if (b) karte[s.u] = URL.createObjectURL(b); fertig(); }, 'image/png');
        } catch (e) { fertig(); }
      });
    });
    return Promise.all(raster.concat(urls.map(function (u) {
      var abbruch = w.AbortController ? new AbortController() : null;
      var t = setTimeout(function () { if (abbruch) abbruch.abort(); }, 5000);
      return fetch(u, { credentials: 'same-origin', signal: abbruch ? abbruch.signal : undefined }).then(function (r) {
        return r.ok ? r.blob() : null;
      }).then(function (b) {
        clearTimeout(t);
        if (b && /^image\//.test(b.type)) karte[u] = URL.createObjectURL(b);
      }, function () { clearTimeout(t); });
    }))).then(function () { return karte; });
  }
  function bilderFreigeben(karte) {
    Object.keys(karte || {}).forEach(function (k) { try { URL.revokeObjectURL(karte[k]); } catch (e) { /* egal */ } });
  }
  var LEER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  function klonVorbereiten(karte, sx, sy) {
    return function (doc) {
      try {
        doc.documentElement.style.scrollBehavior = 'auto';
        if (doc.body) doc.body.style.scrollBehavior = 'auto';
        var win = doc.defaultView;
        if (win) { try { win.scrollTo({ left: sx, top: sy, behavior: 'instant' }); } catch (e) { win.scrollTo(sx, sy); } }
      } catch (e) { /* weiter */ }
      // Geschlossene <details> (z. B. Benutzermenü): Inhalt im Klon ausblenden, html2canvas zeigte ihn sonst
      Array.prototype.forEach.call(doc.querySelectorAll('details:not([open])'), function (dt) {
        Array.prototype.forEach.call(dt.children, function (k) {
          if (k.tagName !== 'SUMMARY') k.style.setProperty('display', 'none', 'important');
        });
      });
      Array.prototype.forEach.call(doc.images, function (img) {
        var u = img.currentSrc || img.src;
        if (karte[u]) { img.removeAttribute('srcset'); img.src = karte[u]; return; }
        var x = u && gleicheHerkunft(u);
        if (x && UMLEITUNG.test(x.pathname)) { img.removeAttribute('srcset'); img.src = LEER; }
      });
      Array.prototype.forEach.call(doc.querySelectorAll('[style*="/_blob/"]'), function (el) {
        var m = /url\(["']?([^"')]+)["']?\)/.exec(el.style.backgroundImage || '');
        if (!m) return;
        var u = new URL(m[1], location.href).href;
        el.style.backgroundImage = karte[u] ? 'url("' + karte[u] + '")' : 'none';
      });
      return schriftenLaden(doc);
    };
  }
  // Webfonts im Klon laden, bevor html2canvas die Textpositionen misst. Sonst rechnet der Klon mit der
  // Ersatzschrift (breiter), gezeichnet wird aber mit der richtigen: Lücken zwischen den Wörtern.
  function schriftenLaden(doc) {
    try {
      if (!doc.fonts || !doc.fonts.load || !d.fonts) return null;
      var laden = [];
      d.fonts.forEach(function (f) {
        if (f.status !== 'loaded') return;
        var familie = String(f.family || '').replace(/^["']|["']$/g, '');
        if (!familie) return;
        var gewicht = String(f.weight || '400').split(' ')[0];          // variable Schriften: «100 900»
        var stil = /^(normal|italic)$/.test(f.style) ? f.style : 'normal';
        laden.push(doc.fonts.load(stil + ' ' + gewicht + ' 16px "' + familie + '"').catch(function () { /* egal */ }));
      });
      if (doc.body) void doc.body.offsetHeight;     // Layout anstossen: lädt auch die übrigen Schriften
      laden.push(doc.fonts.ready);
      return Promise.race([Promise.all(laden), warten(3000)]);
    } catch (e) { return null; }
  }

  function ignorieren(mitUi) {
    return function (el) {
      if (!el) return false;
      if (el === mini || (el.hasAttribute && el.hasAttribute('data-jv-anmeldung'))) return true;
      if (el === host) return !mitUi;
      return false;
    };
  }

  // Sichtbaren Ausschnitt erfassen → Canvas (mit Kalibrierung c._jvCal)
  function aufnehmen(skala, mitUi) {
    return html2canvasLaden().then(function (ok) {
      if (!ok) throw new Error('html2canvas nicht geladen');
      var ov = mitUi ? null : vollbildElement();
      var sx = w.scrollX || w.pageXOffset || 0, sy = w.scrollY || w.pageYOffset || 0;
      return bilderVorbereiten().then(function (karte) {
        var marken = markenAn();
        var zurueck = sofortScrollen();
        var aufraeumen = function () { markenAus(marken); zurueck(); bilderFreigeben(karte); };
        var optionen = {
          ignoreElements: ignorieren(mitUi), scale: skala, logging: false, useCORS: true, allowTaint: false,
          imageTimeout: 8000, onclone: klonVorbereiten(karte, sx, sy)
        };
        if (ov) { optionen.width = w.innerWidth; optionen.height = w.innerHeight; optionen.backgroundColor = null; }
        else { optionen.x = sx; optionen.y = sy; optionen.width = w.innerWidth; optionen.height = w.innerHeight; }
        // Im nächsten Bild aufrufen: html2canvas kopiert Canvas-Inhalte sofort, und WebGL-Bilder
        // (3D-Ansicht im Gäste-WC-Tool) sind nur direkt nach dem Zeichnen lesbar
        return new Promise(function (fertig, fehler) {
          requestAnimationFrame(function () {
            try { Promise.resolve(h2c(ov || d.body, optionen)).then(fertig, fehler); } catch (e) { fehler(e); }
          });
        }).then(function (c) {
          aufraeumen();
          var cal = markenMessen(c, skala);
          if (cal) { markenWeg(c, cal); c._jvCal = cal; }
          return c;
        }, function (e) { aufraeumen(); throw e; });
      });
    });
  }

  function zuschneiden(c, b) {
    var cal = c._jvCal || { offX: 0, offY: 0, sc: c.width / Math.max(1, w.innerWidth) };
    var x = Math.round(b.x * cal.sc + cal.offX), y = Math.round(b.y * cal.sc + cal.offY);
    var bw = Math.min(Math.round(b.w * cal.sc), c.width), bh = Math.min(Math.round(b.h * cal.sc), c.height);
    x = Math.max(0, Math.min(x, c.width - bw));
    y = Math.max(0, Math.min(y, c.height - bh));
    var z = d.createElement('canvas');
    z.width = Math.max(1, bw);
    z.height = Math.max(1, bh);
    z.getContext('2d').drawImage(c, x, y, bw, bh, 0, 0, bw, bh);
    return z;
  }

  // Canvas → JPEG (data:-URL), nötigenfalls verkleinert; null wenn das Bild «verschmutzt» ist
  function jpeg(c) {
    var weiss = d.createElement('canvas');
    var q = 0.82;
    for (var runde = 0; runde < 5; runde++) {
      weiss.width = c.width;
      weiss.height = c.height;
      var g = weiss.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, weiss.width, weiss.height);
      g.drawImage(c, 0, 0);
      var url;
      try { url = weiss.toDataURL('image/jpeg', q); } catch (e) { return null; }
      if (url.length <= MAX_BILD) return url;
      var k = d.createElement('canvas');
      k.width = Math.max(1, Math.round(c.width * 0.75));
      k.height = Math.max(1, Math.round(c.height * 0.75));
      k.getContext('2d').drawImage(c, 0, 0, k.width, k.height);
      c = k;
      q = 0.78;
    }
    return null;
  }

  // ── 2. Markieren ──────────────────────────────────────────────────────
  function strich() { return Math.max(3, (leinwand ? leinwand.width : 600) / 180); }
  function schrift() { return Math.max(16, Math.round((leinwand ? leinwand.width : 600) / 26)); }

  function formZeichnen(g, s, lw) {
    var col = s.c || '#dc2626';
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
    if (s.tool === 'pen') {
      if (!s.points || s.points.length < 2) return;
      g.beginPath();
      g.moveTo(s.points[0].x, s.points[0].y);
      for (var i = 1; i < s.points.length; i++) g.lineTo(s.points[i].x, s.points[i].y);
      g.stroke();
    } else if (s.tool === 'rect') {
      g.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
    } else if (s.tool === 'arrow') {
      var dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      if (Math.sqrt(dx * dx + dy * dy) < 1) return;
      var ang = Math.atan2(dy, dx), spitze = Math.max(10, lw * 3.2);
      g.beginPath();
      g.moveTo(s.x1, s.y1);
      g.lineTo(s.x2 - Math.cos(ang) * spitze * 0.6, s.y2 - Math.sin(ang) * spitze * 0.6);
      g.stroke();
      g.beginPath();
      g.moveTo(s.x2, s.y2);
      g.lineTo(s.x2 - spitze * Math.cos(ang - 0.42), s.y2 - spitze * Math.sin(ang - 0.42));
      g.lineTo(s.x2 - spitze * Math.cos(ang + 0.42), s.y2 - spitze * Math.sin(ang + 0.42));
      g.closePath();
      g.fill();
    } else if (s.tool === 'text') {
      if (!s.text) return;
      g.font = '700 ' + s.size + 'px "JVFB Arimo",Arial,sans-serif';
      g.textBaseline = 'top';
      g.lineWidth = Math.max(2, s.size / 7);
      g.strokeStyle = 'rgba(255,255,255,.9)';
      g.strokeText(s.text, s.x, s.y);
      g.fillStyle = col;
      g.fillText(s.text, s.x, s.y);
    }
  }

  function neuZeichnen() {
    if (!lctx) return;
    lctx.clearRect(0, 0, leinwand.width, leinwand.height);
    var lw = strich();
    formen.forEach(function (s) { formZeichnen(lctx, s, lw); });
    if (temp) formZeichnen(lctx, temp, lw);
  }

  function werkzeugSetzen(t) {
    textUebernehmen();
    werkzeug = t;
    E.hw.textContent = HINWEISE[t] || '';
    Array.prototype.forEach.call(E.wz.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-wz') === t));
    });
    if (leinwand) leinwand.style.cursor = t === 'text' ? 'text' : 'crosshair';
  }
  function farbeSetzen(c) {
    textUebernehmen();
    farbe = c;
    Array.prototype.forEach.call(E.fa.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-fa') === c));
    });
  }

  function leinwandAnpassen() {
    if (!leinwand) return;
    leinwand.style.width = E.mimg.clientWidth + 'px';
    leinwand.style.height = E.mimg.clientHeight + 'px';
  }

  function markierenOeffnen(alteFormen) {
    formen = (alteFormen || []).slice();
    temp = null;
    zeichnet = false;
    textAbbrechen();
    if (leinwand) { leinwand.remove(); leinwand = null; lctx = null; }
    E.mimg.onload = function () {
      leinwand = d.createElement('canvas');
      leinwand.width = E.mimg.naturalWidth;
      leinwand.height = E.mimg.naturalHeight;
      E.bb.appendChild(leinwand);
      lctx = leinwand.getContext('2d');
      leinwandAnpassen();
      werkzeugSetzen(werkzeug);
      neuZeichnen();
      leinwandEreignisse(leinwand);
    };
    E.mimg.src = bildRoh;
    werkzeugSetzen(werkzeug);
    farbeSetzen(farbe);
    oeffnen(E.mark);
  }

  function leinwandEreignisse(cv) {
    var unten = null, bewegt = false;
    function pos(e) {
      var r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) };
    }
    cv.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button > 0) return;
      e.preventDefault();
      textUebernehmen();
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* egal */ }
      var p = pos(e);
      unten = p; bewegt = false;
      if (werkzeug === 'pen') temp = { tool: 'pen', points: [p], c: farbe };
      else if (werkzeug === 'arrow' || werkzeug === 'rect') temp = { tool: werkzeug, x1: p.x, y1: p.y, x2: p.x, y2: p.y, c: farbe };
      else temp = null;
      zeichnet = true;
    });
    cv.addEventListener('pointermove', function (e) {
      if (!zeichnet) return;
      e.preventDefault();
      var p = pos(e);
      if (unten && (Math.abs(p.x - unten.x) > 3 || Math.abs(p.y - unten.y) > 3)) bewegt = true;
      if (temp) {
        if (temp.tool === 'pen') temp.points.push(p);
        else { temp.x2 = p.x; temp.y2 = p.y; }
        neuZeichnen();
      }
    });
    function ende() {
      if (!zeichnet) return;
      zeichnet = false;
      if (werkzeug === 'text') {
        if (unten && !bewegt) textOeffnen(unten);
      } else if (temp) {
        var behalten = temp.tool === 'pen' ? temp.points.length > 1
          : (Math.abs(temp.x2 - temp.x1) > 6 || Math.abs(temp.y2 - temp.y1) > 6);
        if (behalten) formen.push(temp);
      }
      temp = null;
      unten = null;
      neuZeichnen();
    }
    cv.addEventListener('pointerup', ende);
    cv.addEventListener('pointercancel', ende);
  }

  function textOeffnen(p) {
    textUebernehmen();
    if (!leinwand) return;
    var r = leinwand.getBoundingClientRect();
    var mass = r.width / leinwand.width;
    var gross = schrift();
    var inp = d.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'Text …';
    inp.autocomplete = 'off';
    inp.maxLength = 200;
    inp.style.left = Math.round(p.x * mass) + 'px';
    inp.style.top = Math.round(p.y * mass) + 'px';
    inp.style.fontSize = Math.max(12, gross * mass) + 'px';
    inp.style.color = farbe;
    inp.style.borderColor = farbe;
    inp._jv = { x: p.x, y: p.y, size: gross, c: farbe };
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); textUebernehmen(); }
      else if (e.key === 'Escape') { e.preventDefault(); textAbbrechen(); }
    });
    inp.addEventListener('blur', function () { textUebernehmen(); });
    inp.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    E.bb.appendChild(inp);
    textFeld = inp;
    try { inp.focus(); } catch (e) { /* iOS */ }
  }
  function textUebernehmen() {
    var inp = textFeld;
    if (!inp) return;
    textFeld = null;
    var wert = (inp.value || '').trim();
    var m = inp._jv;
    try { inp.remove(); } catch (e) { /* weg */ }
    if (wert && m) {
      formen.push({ tool: 'text', x: m.x, y: m.y, text: wert, size: m.size, c: m.c });
      neuZeichnen();
    }
  }
  function textAbbrechen() {
    var inp = textFeld;
    if (!inp) return;
    textFeld = null;
    try { inp.remove(); } catch (e) { /* weg */ }
  }

  function markierenFertig(mitFormen) {
    textUebernehmen();
    if (!mitFormen) formen = [];
    if (leinwand && formen.length) {
      var z = d.createElement('canvas');
      z.width = leinwand.width;
      z.height = leinwand.height;
      var g = z.getContext('2d');
      g.drawImage(E.mimg, 0, 0, z.width, z.height);
      formen.forEach(function (s) { formZeichnen(g, s, strich()); });
      bild = jpeg(z) || bildRoh;
    } else {
      bild = bildRoh;
    }
    schliessen(E.mark);
    formularZeigen();
  }

  // ── 3. Formular ───────────────────────────────────────────────────────
  function formularZeigen() {
    var b = benutzer();
    var persoenlich = !!(b && !b.hauptzugang);
    E.fnamezeile.hidden = persoenlich;
    if (!persoenlich && !E.fname.value) E.fname.value = lsLesen(NAME_KEY) || '';
    E.fseite.textContent = meta ? META.name : (cfg.name || '');
    E.ftitel.firstChild.nodeValue = meta ? 'Feedback zur Funktion' : 'Feedback';
    if (bild) {
      E.fbild.src = bild;
      E.fbild.hidden = false;
      E.fbildtext.hidden = false;
    } else {
      E.fbild.removeAttribute('src');
      E.fbild.hidden = true;
      E.fbildtext.hidden = true;
    }
    E.fohne.hidden = !bildWeg;
    E.fohne.textContent = 'Ein Bild war hier nicht möglich. Bitte im Text genau beschreiben, wo es ist.';
    metaHinweis();
    oeffnen(E.form);
    setTimeout(function () { try { E.ftext.focus(); } catch (e) { /* egal */ } }, 30);
  }

  function formularZu() {
    if (meta) { metaEnde(); return; }
    alleZu();
  }

  function pfad() {
    return (location.pathname + location.search + location.hash).slice(0, 500);
  }

  function senden() {
    var text = (E.ftext.value || '').trim();
    if (!text) { meldung('Bitte beschreiben, was auffällt.'); E.ftext.focus(); return; }
    var name = (E.fname.value || '').trim();
    if (!E.fnamezeile.hidden && name) lsSchreiben(NAME_KEY, name);
    var m = meta;
    var eintrag = {
      id: neueId(),
      seite: m ? META.id : cfg.seite,
      seite_name: m ? META.name : cfg.name,
      url: pfad(),
      typ: E.ftyp.value,
      text: text,
      autor: E.fnamezeile.hidden ? '' : name,
      meta: {
        bildschirm: w.innerWidth + ' × ' + w.innerHeight + ((w.devicePixelRatio || 1) !== 1 ? ' @' + Math.round((w.devicePixelRatio || 1) * 100) / 100 + 'x' : ''),
        browser: String(navigator.userAgent || '').slice(0, 200)
      }
    };
    if (m) { eintrag.meta.schritt = m.stufe; eintrag.meta.aufgenommen_in = { id: cfg.seite, name: cfg.name }; }
    if (bildWeg && !bild) eintrag.meta.bild_weg = true;
    var paket = { eintrag: eintrag, bild: bild || null };

    E.fsenden.disabled = true;
    E.fsenden.textContent = 'Wird gesendet …';
    ausgangSenden().then(function () { return zustellen(paket); }).then(function (res) {
      var wartet = false;
      if (res.st !== 'ok' && res.st !== 'abgewiesen') wartet = ausgangLegen(paket);
      E.fsenden.disabled = false;
      E.fsenden.textContent = 'Feedback senden';
      var was = m ? 'Feedback zur Funktion' : 'Feedback';
      if (res.st === 'ok') {
        E.ftext.value = '';
        formularZu();
        meldung(paket.eintrag.meta.bild_weg && paket.bild === null && bild ? was + ' gesendet (ohne Bild, es war zu gross).' : was + ' gesendet. Danke!' + (m ? ' Weiter mit deinem Feedback.' : ''));
      } else if (wartet) {
        E.ftext.value = '';
        formularZu();
        var warum = res.st === 'offline' ? 'keine Verbindung'
          : res.st === 'anmelden' ? 'nicht angemeldet, es geht nach der Anmeldung weiter'
          : res.st === 'gesperrt' ? 'abgelehnt (' + res.grund + ')'
          : 'Server gerade nicht erreichbar';
        meldung('Noch nicht übermittelt: ' + warum + '. Lokal gesichert, wird nachgesendet.');
      } else if (res.st === 'abgewiesen') {
        meldung('Nicht gesendet: ' + res.grund);
      } else {
        meldung('Nicht gesendet und lokal nicht zu sichern. Bitte später nochmals versuchen.');
      }
    });
  }

  // ── Zustellung und Warteschlange ──────────────────────────────────────
  // Ergebnis: ok | offline | server | anmelden (401) | gesperrt (403) | abgewiesen (400/413)
  function sendenRoh(paket) {
    return fetch(API, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-JV-Sitzung': '1' },
      body: JSON.stringify({ aktion: 'senden', eintrag: paket.eintrag, bild: paket.bild || undefined })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        var grund = (j && j.error) || ('Fehler ' + r.status);
        if (r.ok && j && j.ok) return { st: 'ok', res: j };
        if (r.status === 401) return { st: 'anmelden', grund: grund };
        if (r.status === 403) return { st: 'gesperrt', grund: grund };
        if (r.status === 400 || r.status === 413) return { st: 'abgewiesen', grund: grund, status: r.status };
        return { st: 'server', grund: grund, status: r.status };
      });
    }, function () { return { st: 'offline', grund: 'keine Verbindung' }; });
  }
  // Zu gross mit Bild: einmal ohne Bild senden (benannt), statt ewig in der Warteschlange zu hängen
  function zustellen(paket) {
    return sendenRoh(paket).then(function (r) {
      if (r.st === 'abgewiesen' && r.status === 413 && paket.bild) {
        paket.bild = null;
        paket.eintrag.meta.bild_weg = true;
        return sendenRoh(paket);
      }
      return r;
    });
  }

  function ausgangLesen() {
    try { var a = JSON.parse(lsLesen(AUSGANG) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function ausgangSchreiben(liste) {
    if (!liste.length) { try { w.localStorage.removeItem(AUSGANG); } catch (e) { /* egal */ } return true; }
    return lsSchreiben(AUSGANG, JSON.stringify(liste));
  }
  function ausgangLegen(paket) {
    var liste = ausgangLesen().filter(function (p) { return p && p.eintrag && p.eintrag.id !== paket.eintrag.id; });
    liste.push(paket);
    if (liste.length > MAX_AUSGANG) liste = liste.slice(-MAX_AUSGANG);
    if (ausgangSchreiben(liste)) return true;
    // Speicher voll: ohne Bild sichern (benannt)
    var ohne = { eintrag: JSON.parse(JSON.stringify(paket.eintrag)), bild: null };
    ohne.eintrag.meta.bild_weg = true;
    liste[liste.length - 1] = ohne;
    return ausgangSchreiben(liste);
  }
  function ausgangAnzahl() { return ausgangLesen().length; }

  // Wartende Einträge nachsenden; am Ende frisch lesen und nur das Zugestellte entfernen
  function ausgangSenden() {
    if (ausgangLaeuft) return Promise.resolve(0);
    var liste = ausgangLesen();
    if (!liste.length) return Promise.resolve(0);
    ausgangLaeuft = true;
    var weg = {}, neu = {}, n = 0;
    var kette = Promise.resolve(true);
    liste.forEach(function (p) {
      kette = kette.then(function (weiter) {
        if (!weiter || !p || !p.eintrag) return weiter;
        if (p.abgewiesen) return true;
        return zustellen(p).then(function (r) {
          if (r.st === 'ok') { weg[p.eintrag.id] = 1; n++; return true; }
          if (r.st === 'abgewiesen') { p.abgewiesen = r.grund; neu[p.eintrag.id] = p; return true; }
          return false;    // offline, abgemeldet, Server weg: der Rest wartet
        });
      });
    });
    return kette.then(function () {
      var frisch = ausgangLesen().filter(function (p) { return !(p && p.eintrag && weg[p.eintrag.id]); })
        .map(function (p) { return p && p.eintrag && neu[p.eintrag.id] ? neu[p.eintrag.id] : p; });
      ausgangSchreiben(frisch);
      ausgangLaeuft = false;
      if (n) meldung(n === 1 ? 'Ein gespeichertes Feedback wurde nachgesendet.' : n + ' gespeicherte Feedbacks wurden nachgesendet.');
      return n;
    }, function () { ausgangLaeuft = false; return 0; });
  }

  // ── «Feedback zur Funktion» ───────────────────────────────────────────
  function metaKnoepfe(sichtbar) {
    if (!sr) return;
    Array.prototype.forEach.call(sr.querySelectorAll('[data-meta]'), function (b) { b.hidden = !sichtbar; });
  }
  function metaUi(an) { metaKnoepfe(!an); metaHinweis(); }
  function metaHinweis() {
    if (!meta) { E.fmeta.hidden = true; E.fmeta.textContent = ''; return; }
    E.fmeta.textContent = 'Feedback zur Feedbackfunktion: Das Bild zeigt den Dialog, wie er eben aussah (Seite «' + (cfg.name || cfg.seite) +
      '», Schritt «' + (SCHRITTE[meta.stufe] || meta.stufe) + '»). Dein begonnenes Feedback bleibt erhalten und kommt danach wieder.';
    E.fmeta.hidden = false;
  }
  function metaStart() {
    if (meta) return;
    var st = stufe();
    if (!st) return;
    textUebernehmen();
    meta = { stufe: st, bildRoh: bildRoh, bild: bild, bildWeg: bildWeg, formen: formen.slice(), text: E.ftext.value, typ: E.ftyp.value, auswahl: auswahl };
    metaKnoepfe(false);                  // der Knopf selbst gehört nicht aufs Bild
    var skala = Math.max(1, Math.min(2, w.devicePixelRatio || 1));
    warten(120).then(function () { return aufnehmen(skala, true); }).then(jpeg, function () { return null; }).then(function (url) {
      if (!meta) return;
      alleZu();
      textAbbrechen();
      formen = []; temp = null;
      bildRoh = url || ''; bild = ''; bildWeg = !url;
      E.ftext.value = '';
      E.ftyp.value = 'aenderung';
      metaUi(true);
      if (bildRoh) markierenOeffnen([]);
      else formularZeigen();
    });
  }
  function metaEnde() {
    var m = meta;
    if (!m) return;
    meta = null;
    alleZu();
    textAbbrechen();
    metaUi(false);
    bildRoh = m.bildRoh; bild = m.bild; bildWeg = m.bildWeg;
    E.ftext.value = m.text;
    E.ftyp.value = m.typ;
    if (m.stufe === 'annot' && bildRoh) { markierenOeffnen(m.formen); return; }
    if (m.stufe === 'snip') { E.sel.hidden = true; oeffnen(E.aus); return; }
    formen = m.formen.slice();
    formularZeigen();
  }

  // ── Meldung ───────────────────────────────────────────────────────────
  var toastTimer = null;
  function meldung(text) {
    bauen();
    var t = E.toast;
    t.textContent = text;
    t.hidden = false;
    try {
      if (t.showPopover) { if (t.matches(':popover-open')) t.hidePopover(); t.showPopover(); }
    } catch (e) { /* ohne Popover: normal sichtbar */ }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      try { if (t.hidePopover && t.matches(':popover-open')) t.hidePopover(); } catch (e) { /* egal */ }
      t.hidden = true;
    }, 3800);
  }

  // ── Kleiner Knopf, wenn ein Dialog der Seite offen ist ────────────────
  // Der Knopf der Seite liegt dann unter dem Dialog. Bei einem modalen <dialog> muss der kleine Knopf
  // IN diesem Dialog liegen (sonst ist er nicht bedienbar); bei Seitenpanels reicht das Dokument.
  function seitenDialog() {
    var liste = d.querySelectorAll('dialog[open]');
    for (var i = liste.length - 1; i >= 0; i--) {
      var dl = liste[i];
      var modal = false;
      try { modal = dl.matches(':modal'); } catch (e) { modal = true; }
      if (modal) return dl;
    }
    return null;
  }
  function seitenPanel() {
    var p = d.querySelector('.detail-panel.open, [data-feedback-dialog].open');
    return p && p.offsetParent !== null ? p : (p && getComputedStyle(p).position === 'fixed' ? p : null);
  }
  function miniBauen() {
    if (mini) return;
    mini = d.createElement('button');
    mini.type = 'button';
    mini.id = 'jvfb-mini';
    mini.textContent = 'Feedback';
    mini.title = 'Feedback zu diesem Dialog geben';
    mini.style.cssText = 'all:initial;position:fixed;right:calc(14px + env(safe-area-inset-right,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));' +
      'z-index:2147482500;display:inline-flex;align-items:center;min-height:38px;padding:0 15px;border-radius:999px;background:#94621f;color:#fff;' +
      'font:700 13px/1 "JVFB Arimo",Arimo,Arial,sans-serif;letter-spacing:.02em;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.28)';
    ['pointerdown', 'mousedown', 'touchstart', 'mouseup', 'pointerup'].forEach(function (ev) {
      mini.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true });
    });
    mini.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); start(); });
  }
  var miniGeplant = false;
  function miniPruefen() {
    if (miniGeplant) return;
    miniGeplant = true;
    requestAnimationFrame(function () {
      miniGeplant = false;
      if (!mini) return;
      var ziel = null;
      if (!ebeneOffen()) {
        var dl = seitenDialog();
        if (dl) ziel = dl;
        else if (cfg.knopf !== 'schwebend' && seitenPanel()) ziel = d.body;
      }
      if (ziel) { if (mini.parentNode !== ziel) ziel.appendChild(mini); }
      else if (mini.parentNode) mini.parentNode.removeChild(mini);
      if (E.tab) E.tab.hidden = ebeneOffen();
    });
  }

  // ── Ereignisse ────────────────────────────────────────────────────────
  function ereignisse() {
    // Tasten bleiben in der eigenen Oberfläche (Tastenkürzel der Tools sollen nicht auslösen)
    ['keydown', 'keyup', 'keypress'].forEach(function (ev) {
      sr.addEventListener(ev, function (e) { e.stopPropagation(); });
    });
    if (E.tab) E.tab.addEventListener('click', function () { start(); });

    // 1. Ausschnitt
    E.aus.addEventListener('pointerdown', function (e) {
      if (e.target !== E.aus && e.target !== E.sel) return;
      if (e.button > 0) return;
      e.preventDefault();
      try { E.aus.setPointerCapture(e.pointerId); } catch (x) { /* egal */ }
      start0 = { x: e.clientX, y: e.clientY };
      auswahl = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
      auswahlZeichnen();
    });
    E.aus.addEventListener('pointermove', function (e) {
      if (!start0) return;
      auswahl = {
        x: Math.min(e.clientX, start0.x), y: Math.min(e.clientY, start0.y),
        w: Math.abs(e.clientX - start0.x), h: Math.abs(e.clientY - start0.y)
      };
      auswahlZeichnen();
    });
    function auswahlEnde() {
      if (!start0) return;
      start0 = null;
      var b = auswahl;
      E.sel.hidden = true;
      schliessen(E.aus);
      // Nur geklickt (kein Rechteck): ganzer Bildschirm
      aufnehmenUndWeiter(b && b.w >= 12 && b.h >= 12 ? b : null);
    }
    E.aus.addEventListener('pointerup', auswahlEnde);
    E.aus.addEventListener('pointercancel', function () { start0 = null; auswahl = null; E.sel.hidden = true; });

    // Knöpfe (alle Ebenen)
    sr.addEventListener('click', function (e) {
      var k = e.target.closest && e.target.closest('button');
      if (!k) return;
      if (k.hasAttribute('data-meta')) { e.preventDefault(); metaStart(); return; }
      var wz = k.getAttribute('data-wz');
      if (wz) { werkzeugSetzen(wz); return; }
      var fa = k.getAttribute('data-fa');
      if (fa) { farbeSetzen(fa); return; }
      switch (k.getAttribute('data-a')) {
        case 'ganz': ganzerBildschirm(); break;
        case 'ohne': ohneBild(); break;
        case 'abbrechen': if (meta) metaEnde(); else alleZu(); break;
        case 'rueck':
          if (textFeld) textAbbrechen();
          else if (formen.length) { formen.pop(); neuZeichnen(); }
          break;
        case 'leeren': textAbbrechen(); formen = []; temp = null; neuZeichnen(); break;
        case 'weiter': markierenFertig(false); break;
        case 'fertig': markierenFertig(true); break;
        case 'zu': formularZu(); break;
        case 'senden': senden(); break;
      }
    });
    E.fbild.addEventListener('click', function () {
      if (!bildRoh) return;
      schliessen(E.form);
      markierenOeffnen(formen);
    });
    E.fform.addEventListener('submit', function (e) { e.preventDefault(); senden(); });
    E.ftext.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); senden(); }
    });

    // Escape (cancel): Ausschnitt → abbrechen, Markieren → weiter zum Formular, Formular → schliessen
    E.aus.addEventListener('cancel', function (e) { e.preventDefault(); if (meta) metaEnde(); else alleZu(); });
    E.warte.addEventListener('cancel', function (e) { e.preventDefault(); });
    E.mark.addEventListener('cancel', function (e) { e.preventDefault(); if (!textFeld) markierenFertig(true); });
    E.form.addEventListener('cancel', function (e) { e.preventDefault(); formularZu(); });
    w.addEventListener('resize', leinwandAnpassen);
  }

  function seiteMelden(id, name) {
    if (id && /^[a-z0-9-]{2,60}$/.test(id)) cfg.seite = id;
    if (name) cfg.name = String(name).slice(0, 120);
    // Gelegentlich Wartendes nachsenden (z. B. nach der Anmeldung)
    if (ausgangAnzahl() && Date.now() - (seiteMelden.zuletzt || 0) > 60000) {
      seiteMelden.zuletzt = Date.now();
      ausgangSenden();
    }
  }

  // ── Start der Seite ───────────────────────────────────────────────────
  function init() {
    bauen();
    miniBauen();
    if (w.MutationObserver) {
      new MutationObserver(miniPruefen).observe(d.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['open', 'class'] });
    }
    miniPruefen();
    d.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-feedback-start]');
      if (el) { e.preventDefault(); start(); }
    });
    // Rückstand nachsenden: beim Seitenstart (verzögert) und sobald wieder Netz da ist
    setTimeout(function () { if (ausgangAnzahl()) ausgangSenden(); }, 2500);
    w.addEventListener('online', function () { setTimeout(ausgangSenden, 800); });
    // Nach einer (erneuten) Anmeldung: was wegen «nicht angemeldet» wartet, gleich nachsenden
    w.addEventListener('jv-benutzer', function (e) { if (e.detail && ausgangAnzahl()) setTimeout(ausgangSenden, 300); });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init);
  else init();

  w.JVFeedback = {
    start: start,
    seite: seiteMelden,
    meldung: meldung,
    nachsenden: ausgangSenden
  };
  // Test-Hilfen (Browser-Tests), keine öffentliche Schnittstelle
  w._jvfb = {
    formen: function () { return formen; },
    bild: function () { return bild; },
    bildRoh: function () { return bildRoh; },
    stufe: stufe,
    meta: function () { return meta ? { stufe: meta.stufe, formen: meta.formen.length, text: meta.text } : null; },
    ausgang: ausgangLesen,
    ausgangKey: AUSGANG,
    cfg: function () { return { seite: cfg.seite, name: cfg.name }; },
    root: function () { return sr; },
    mini: function () { return mini; }
  };
})(window, document);
