// daten.js — Objekte der Badvisualisierungen aus der JV-Plattform laden
//
// Im Original standen Objekte und Bilder fest im Tool (Kundendaten). In der Plattform liegen sie in der
// Datenbank (tool_docs badvis/objekte/<id>) und im privaten Bucket. Das Tool selbst bleibt unverändert:
// es bekommt dieselben Listen OBJ und IMG, nur eben von hier.
//
// Seit 3.11.2026 entstehen Objekte auch im Editor der Plattform (assets/badvis-editor.js; Robin: «bei der
// badvisualisierung gibt es die option eine neue zu erstellen nicht»). Darum hier zusätzlich:
//   - Felder vereinheitlichen, damit das Tool nie «undefined» zeigt oder abbricht
//   - Ausführung (spec): das Tool setzt den Wert als HTML ein, erlaubt bleiben nur Farbmuster
//     (<span class="sw" style="background:#hex">) und b/strong/i/em/br, alles andere wird Text
//   - fehlende Bilder (das Mockup ist freiwillig) als leeres Bild; die Mockup-Fläche verschwindet dann
//   - oben rechts «＋ Neue Visualisierung» und «Bearbeiten» (öffnen den Editor der Plattform im selben Tab)
(function () {
  'use strict';

  var LEER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  var ASSET = /^[a-f0-9]{32}$/;
  var ID = /^[A-Za-z0-9_-]{1,60}$/;
  var HEX = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;
  var bekannte = [];

  function text(x) { return typeof x === 'string' ? x : x == null ? '' : String(x); }
  function esc(s) {
    return text(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  // Wert einer Ausführungs-Zeile: DOMParser führt nichts aus und lädt nichts
  function specHtml(v) {
    var doc = new DOMParser().parseFromString('<!doctype html><body>' + text(v), 'text/html');
    function knoten(n) {
      if (n.nodeType === 3) return esc(n.nodeValue);
      if (n.nodeType !== 1) return '';
      var tag = n.tagName.toLowerCase();
      var innen = Array.prototype.map.call(n.childNodes, knoten).join('');
      if (tag === 'br') return '<br>';
      if (tag === 'span' && n.classList.contains('sw')) {
        var m = /background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6})(?![0-9a-fA-F])/.exec(n.getAttribute('style') || '');
        return (m && HEX.test(m[1]) ? '<span class="sw" style="background:' + m[1] + '"></span>' : '') + innen;
      }
      if (tag === 'b' || tag === 'strong' || tag === 'i' || tag === 'em') return '<' + tag + '>' + innen + '</' + tag + '>';
      return innen;
    }
    return Array.prototype.map.call(doc.body.childNodes, knoten).join('');
  }

  function vereinheitlichen(o) {
    ['kunde', 'raum', 'titel', 'datum', 'lead', 'hinweis'].forEach(function (k) { o[k] = text(o[k]); });
    o.aspect = /^\d{1,2}\/\d{1,2}$/.test(text(o.aspect)) ? o.aspect : '4/3';
    o.varianten = o.varianten.filter(function (v) { return v && ID.test(text(v.id)); }).map(function (v) {
      return Object.assign({}, v, { name: text(v.name), swatch: text(v.swatch) || '#cccccc', glossy: !!v.glossy });
    });
    o.start = Math.max(0, Math.min(o.varianten.length - 1, parseInt(o.start, 10) || 0));
    o.spec = (Array.isArray(o.spec) ? o.spec : [])
      .filter(function (z) { return Array.isArray(z) && z.length >= 2; })
      .map(function (z) { return [text(z[0]), specHtml(z[1])]; });
    return o;
  }

  function aufbereiten(docs) {
    var objekte = docs
      .map(function (d) { var o = d.data() || {}; o.id = d.id; return o; })
      .filter(function (o) { return Array.isArray(o.varianten) && o.bilder && typeof o.bilder === 'object'; })
      .map(vereinheitlichen)
      .filter(function (o) { return o.varianten.length; })
      .sort(function (a, b) { return (a.reihenfolge || 0) - (b.reihenfolge || 0) || a.kunde.localeCompare(b.kunde, 'de'); });
    var bilder = {};
    objekte.forEach(function (o) {
      var vorne = 'img/' + o.id + '/';
      Object.keys(o.bilder).forEach(function (k) {
        if (ASSET.test(o.bilder[k])) bilder[vorne + k + '.jpg'] = '/_blob/' + o.bilder[k];
      });
      // Bilder, die das Tool erwartet: fehlt eines, ein leeres statt «undefined»
      ['vorher'].concat(o.varianten.map(function (v) { return 'room-' + v.id; }), o.varianten.map(function (v) { return 'mock-' + v.id; }))
        .forEach(function (k) { if (!bilder[vorne + k + '.jpg']) bilder[vorne + k + '.jpg'] = LEER; });
    });
    return { objekte: objekte, bilder: bilder };
  }

  // ── Kopfzeile: «＋ Neue Visualisierung» und «Bearbeiten» ──────────────
  var STIL =
    '.top .jv-kopf{margin-left:auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}' +
    '.top .jv-kopf a{display:inline-flex;align-items:center;min-height:36px;padding:0 14px;border:1px solid var(--line);' +
      'border-radius:999px;background:var(--card,#fff)}' +
    '.top .jv-kopf a:hover{border-color:var(--accent)}' +
    '.top .jv-kopf a[hidden]{display:none}' +
    '.mock:has(img[src^="data:"]){display:none}.mock img[src^="data:"]{display:none}' +
    '@media print{.top .jv-kopf{display:none}}';

  function kopf() {
    var top = document.querySelector('header.top');
    if (!top) return;
    var nav = top.querySelector('[data-jv-links]');
    if (!nav) {
      nav = document.createElement('nav');
      nav.className = 'jv-kopf';
      nav.setAttribute('data-jv-links', '');
      nav.setAttribute('aria-label', 'Visualisierungen bearbeiten');
      nav.innerHTML = '<a data-jv-bearbeiten hidden>Bearbeiten</a><a href="/#/visualisierung/neu?von=tool">＋ Neue Visualisierung</a>';
      top.appendChild(nav);
    }
    var id = location.hash.slice(1);
    var b = nav.querySelector('[data-jv-bearbeiten]');
    var da = !!id && bekannte.indexOf(id) >= 0;
    b.hidden = !da;
    if (da) b.setAttribute('href', '/#/visualisierung/' + encodeURIComponent(id) + '?von=tool');
    else b.removeAttribute('href');
  }

  var stil = document.createElement('style');
  stil.textContent = STIL;
  (document.head || document.documentElement).appendChild(stil);
  document.addEventListener('DOMContentLoaded', kopf);
  window.addEventListener('hashchange', kopf);

  window.JVBadvis = {
    // weiter(d) wird beim Laden und bei jeder Änderung aufgerufen
    laden: function (weiter) {
      window.claude.use('db').then(function (db) {
        db.collection('objekte').onSnapshot(function (snap) {
          var d = aufbereiten(snap.docs);
          bekannte = d.objekte.map(function (o) { return o.id; });
          weiter(d);
          kopf();
        }, function () {
          weiter({ objekte: [], bilder: {} });
          kopf();
        });
      });
    },
    // Leere Übersicht: kurzer Hinweis, wie die erste Visualisierung entsteht
    hinweis: function (obj) {
      if (obj.length || location.hash.length > 1) return;
      var app = document.getElementById('app');
      if (!app || app.querySelector('[data-jv-hinweis]')) return;
      var p = document.createElement('p');
      p.className = 'lead';
      p.setAttribute('data-jv-hinweis', '');
      p.textContent = 'Noch keine Visualisierungen. Mit «＋ Neue Visualisierung» oben rechts die erste erstellen.';
      app.appendChild(p);
    }
  };
})();
