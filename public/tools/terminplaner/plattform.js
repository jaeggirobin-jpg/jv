// plattform.js — Ergänzungen der JV-Plattform für den Bau-Terminplaner (läuft nach dem Skript des Tools)
//
// 1. Karte: Statt der festen Google-Karte zeigt der Terminplan die Umgebung der Projektadresse
//    (geo.admin.ch, amtliche Vermessung). Das Objekt steht unten in der Mitte, die Umgebungsstrassen
//    sind sichtbar. Die Karte wird automatisch erzeugt, sobald ein Projekt eine Adresse hat oder die
//    Adresse ändert, und dient auch im PDF als Hintergrund.
// 2. Adressvorschläge (geo.admin.ch) in «Neues Projekt» und im Projektkopf.
// 3. Aufruf aus der Plattform: ?projekt=<id> öffnet das Projekt (siehe jv-bridge.js),
//    &vorlage=1 bietet bei einem leeren Projekt gleich «Vorlage einfügen» an.
(function () {
  'use strict';
  if (typeof S === 'undefined' || typeof cur !== 'function' || !window.JVGeo) return;

  var KOORD = {};   // Adresse → { e, n } aus der Vorschlagsliste (spart eine zweite Suche)
  var FEHL = {};    // Adresse → Zeitpunkt der letzten erfolglosen Suche
  var laeuft = false;

  window.JVGeo.vorschlaege('#np-address, #pk-address', {
    beiAuswahl: function (t) { KOORD[t.text] = { e: t.e, n: t.n }; }
  });

  function adressfeldAktiv() {
    var a = document.activeElement;
    return !!(a && (a.id === 'pk-address' || a.id === 'np-address'));
  }

  function neuZeichnen() {
    if (typeof queueRender === 'function') queueRender();
    else if (typeof render === 'function') render();
  }

  function pruefen() {
    if (laeuft || !S.loaded) return;
    var p = cur();
    if (!p) return;
    var adresse = String(p.address || '');
    if (!adresse.trim()) return;
    var bg = p.mapBg;
    // Karte passt zur Adresse und stammt nicht aus dem alten claude.ai-Speicher
    if (typeof mapOk === 'function' && mapOk(p) && !/^\/_blob\//.test(bg.url || '')) return;
    if (adressfeldAktiv()) return;
    if (FEHL[adresse] && Date.now() - FEHL[adresse] < 10 * 60 * 1000) return;

    var bekannt = KOORD[adresse.trim()] ||
      (bg && (bg.addr || '') === adresse && +bg.e > 2e6 && +bg.n > 1e6 ? { e: +bg.e, n: +bg.n } : null);
    laeuft = true;
    window.JVGeo.karteFuerAdresse(adresse, bekannt).then(function (k) {
      var p2 = S.projects[p.id];
      if (!p2 || String(p2.address || '') !== adresse) return;   // inzwischen geändert
      if (!k) { FEHL[adresse] = Date.now(); return; }
      p2.mapBg = {
        addr: adresse, url: k.url, e: k.e, n: k.n, fy: window.JVGeo.KARTE.fy, src: k.quelle,
        created: typeof todayIso === 'function' ? todayIso() : new Date().toISOString().slice(0, 10)
      };
      touch(p2);
      neuZeichnen();
    }).catch(function () {
      FEHL[adresse] = Date.now();
    }).then(function () {
      laeuft = false;
    });
  }

  // Quellenangabe der Karte auch am Bildschirm (im PDF setzt sie der Terminplaner selbst)
  var quelle = null;
  function quelleZeigen() {
    var bg = document.getElementById('objbg');
    var p = S.loaded ? cur() : null;
    var text = bg && !bg.hidden && p && p.mapBg && typeof MAP_SRC !== 'undefined' ? (MAP_SRC[p.mapBg.src] || '') : '';
    if (!quelle) {
      if (!text) return;
      quelle = document.createElement('div');
      quelle.setAttribute('aria-hidden', 'true');
      quelle.style.cssText = 'position:fixed;right:8px;bottom:6px;z-index:5;pointer-events:none;font-size:10px;line-height:1.3;' +
        'padding:1px 6px;border-radius:3px;background:var(--surface,#fff);color:var(--muted,#6b7280);opacity:.85';
      document.body.appendChild(quelle);
    }
    quelle.hidden = !text;
    if (text && quelle.textContent !== text) quelle.textContent = text;
  }

  setInterval(function () { pruefen(); quelleZeigen(); }, 1500);

  // Vorlage anbieten, wenn die Plattform ein leeres Projekt öffnet
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('vorlage') === '1' && q.get('projekt')) {
      var versuche = 0;
      var uhr = setInterval(function () {
        versuche++;
        if (versuche > 60) return clearInterval(uhr);
        if (!S.loaded) return;
        clearInterval(uhr);
        var p = cur();
        if (p && p.id === q.get('projekt') && typeof allTasks === 'function' && !allTasks(p).length && typeof ACT !== 'undefined' && ACT.insertTemplate) {
          ACT.insertTemplate();
        }
        // Parameter entfernen, damit ein Neuladen nicht wieder fragt
        try { history.replaceState(null, '', location.pathname); } catch (e) { /* egal */ }
      }, 250);
    }
  } catch (e) { /* ohne URLSearchParams: kein Vorschlag */ }
})();
