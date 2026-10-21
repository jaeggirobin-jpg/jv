// szene.js — Gezeichnete Anleitung «Wo und wie fotografieren?» (inline SVG, keine Abhängigkeiten)
//
// Zeigt die Wasserleitung mit Absperrarmatur, Wasserzähler und Rückflussverhinderer.
// Ein Kamera-Rahmen wandert je nach Schritt an die Stelle, die auf das Foto soll.
// Wird auf der Landingpage (Hero und Anleitung) und für das Erklärvideo verwendet.
(function () {
  'use strict';

  // Rahmen pro Schritt (x, y, Breite, Höhe im viewBox 0 0 400 240)
  var RAHMEN = [
    { x: 126, y: 88, b: 82, h: 86 },    // 1. Wasserzähler finden
    { x: 30, y: 70, b: 300, h: 116 },   // 2. ganze Stelle
    { x: 222, y: 70, b: 92, h: 112 },   // 3. Ventile nach dem Zähler
    { x: 252, y: 150, b: 66, h: 50 }    // 4. Beschriftung
  ];

  var SVG =
    '<svg class="szene" viewBox="0 0 400 240" role="img" aria-label="Skizze: Wasserleitung im Keller mit Absperrventil, Wasserzähler und Ventilen nach dem Zähler">' +
      '<defs>' +
        '<linearGradient id="sz-wand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EFEBE5"/><stop offset="1" stop-color="#E4DED6"/></linearGradient>' +
        '<linearGradient id="sz-messing" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E2B66E"/><stop offset=".55" stop-color="#BD843A"/><stop offset="1" stop-color="#8F5E1F"/></linearGradient>' +
      '</defs>' +
      // Wand und Boden
      '<rect width="400" height="240" fill="url(#sz-wand)"/>' +
      '<rect y="212" width="400" height="28" fill="#CFC7BC"/>' +
      '<path d="M0 212h400" stroke="#B8AFA3" stroke-width="2"/>' +
      // Rohr: aus dem Boden, waagrecht, dann nach oben ins Haus
      '<path class="sz-rohr" d="M44 240V130H350V0" fill="none" stroke="#929A9D" stroke-width="14" stroke-linejoin="round"/>' +
      '<path class="sz-wasser" d="M44 240V130H350V0" fill="none" stroke="#F7F5F2" stroke-width="4" stroke-linejoin="round" stroke-dasharray="6 14"/>' +
      // Absperrarmatur vor dem Zähler
      '<g class="sz-ventil" transform="translate(88 130)">' +
        '<path d="M-16-12L0 0-16 12zM16-12L0 0 16 12z" fill="url(#sz-messing)" stroke="#7A5019" stroke-width="1.5"/>' +
        '<rect x="-3" y="-28" width="6" height="16" fill="#7A5019"/><rect x="-14" y="-33" width="28" height="7" rx="3" fill="#4B575D"/>' +
      '</g>' +
      // Wasserzähler
      '<g class="sz-zaehler" transform="translate(167 130)">' +
        '<rect x="-30" y="-26" width="60" height="52" rx="10" fill="#4B575D" stroke="#25292E" stroke-width="2"/>' +
        '<circle r="19" fill="#F4F6F7" stroke="#9AA3AA" stroke-width="2"/>' +
        '<rect x="-14" y="-9" width="28" height="9" rx="1.5" fill="#25292E"/>' +
        '<text x="0" y="-2" text-anchor="middle" font-family="monospace" font-size="7.5" fill="#fff" letter-spacing="1">04271</text>' +
        '<text x="0" y="12" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="9" font-weight="600" fill="#25292E">m³</text>' +
        '<path class="sz-zeiger" d="M0 4l7-3" stroke="#BD843A" stroke-width="1.6" stroke-linecap="round"/>' +
      '</g>' +
      // Ventile nach dem Zähler: Absperrventil mit Rückflussverhinderer (KRV) und Prüfstutzen
      '<g class="sz-krv" transform="translate(268 130)">' +
        '<path d="M-20-13L0 0-20 13zM20-13L0 0 20 13z" fill="url(#sz-messing)" stroke="#7A5019" stroke-width="1.5"/>' +
        '<rect x="-3" y="-30" width="6" height="17" fill="#7A5019"/><rect x="-15" y="-35" width="30" height="7" rx="3" fill="#BD843A"/>' +
        '<rect x="-4" y="12" width="8" height="10" rx="2" fill="#8F5E1F"/>' +
        '<path d="M-8 0h12m-4-4l4 4-4 4" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
        // Anhänger mit Aufschrift
        '<path d="M2 22l8 14" stroke="#9AA3AA" stroke-width="1.2"/>' +
        '<g transform="translate(10 36) rotate(-8)"><rect x="-4" y="0" width="34" height="16" rx="3" fill="#fff" stroke="#9AA3AA"/>' +
          '<text x="13" y="11" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="8" font-weight="700" fill="#25292E">KRV ⟶</text></g>' +
      '</g>' +
      // Beschriftungen
      '<g font-family="Inter, Arial, sans-serif" font-size="11" fill="#5C636B" text-anchor="middle">' +
        '<text x="88" y="168">Absperrung</text>' +
        '<text x="167" y="176" font-weight="600" fill="#25292E">Wasserzähler</text>' +
        '<text x="268" y="84" class="sz-label-nach">nach dem Zähler</text>' +
        '<text x="372" y="60" transform="rotate(-90 372 60)" font-size="10">ins Haus</text>' +
        '<text x="56" y="230" font-size="10" fill="#6E655A" text-anchor="start">vom Netz</text>' +
      '</g>' +
      // Suchkreis (Schritt 1) und Kamera-Rahmen
      '<circle class="sz-puls" cx="167" cy="130" r="44" fill="none" stroke="#BD843A" stroke-width="3"/>' +
      '<g class="sz-rahmen"><rect class="sz-rahmen__rect" x="0" y="0" width="1" height="1" fill="rgba(189,132,58,.10)" stroke="#94621F" stroke-width="3" stroke-dasharray="10 6" vector-effect="non-scaling-stroke"/></g>' +
      '<g class="sz-blitz"><rect width="400" height="240" fill="#fff"/></g>' +
    '</svg>';

  function erstellen(box, opt) {
    opt = opt || {};
    box.innerHTML = SVG;
    var svg = box.querySelector('svg');
    var rect = svg.querySelector('.sz-rahmen__rect');
    var schritt = -1;
    var timer = null;

    function zeige(i) {
      schritt = ((i % RAHMEN.length) + RAHMEN.length) % RAHMEN.length;
      var r = RAHMEN[schritt];
      rect.style.transform = 'translate(' + r.x + 'px,' + r.y + 'px) scale(' + r.b + ',' + r.h + ')';
      box.setAttribute('data-schritt', String(schritt));
      // Blitz neu auslösen (Foto-Moment), ausser beim Suchen
      svg.classList.remove('blitzt');
      if (schritt > 0) { void svg.getBoundingClientRect(); svg.classList.add('blitzt'); }
      if (opt.onSchritt) opt.onSchritt(schritt);
    }

    function start(ms) {
      stopp();
      timer = setInterval(function () { zeige(schritt + 1); }, ms || 4500);
    }
    function stopp() { if (timer) clearInterval(timer); timer = null; }

    zeige(opt.start || 0);
    return { zeige: zeige, start: start, stopp: stopp, anzahl: RAHMEN.length };
  }

  window.KRVSzene = { erstellen: erstellen, anzahl: RAHMEN.length };
})();
