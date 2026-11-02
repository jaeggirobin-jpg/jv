// geo-admin.js — Adressvorschläge und Karten von geo.admin.ch (Bund, swisstopo) für Plattform und Tools
//
// JVGeo.suchen(text)                 → Adressen [{ text, strasse, nr, plz, ort, kanton, e, n }]
// JVGeo.adresseFinden(adresse)       → beste passende Adresse oder null
// JVGeo.vorschlaege(selektor|input, { beiAuswahl })
//                                    → Vorschlagsliste unter Adressfeldern (auch für Felder, die ein Tool
//                                      immer wieder neu zeichnet: Selektor wird über das Dokument verfolgt)
// JVGeo.karte(e, n)                  → { url, quelle } Kartenausschnitt (WMS), Objekt unten in der Mitte
// JVGeo.karteFuerAdresse(adresse)    → Promise { url, e, n, quelle, adresse } oder null
//
// Ohne Schlüssel, ohne Cookies. Ist geo.admin.ch nicht erreichbar, bleiben die Felder normal bedienbar.
(function () {
  'use strict';

  var SUCHE = 'https://api3.geo.admin.ch/rest/services/api/SearchServer';
  var WMS = 'https://wms.geo.admin.ch/';
  var MIN_ZEICHEN = 3;
  var WARTEN_MS = 220;
  var MAX = 7;

  // Kartengrundlagen in dieser Reihenfolge versuchen. Die amtliche Vermessung zeigt Gebäude,
  // Hausnummern und Strassennamen; die Landeskarten sind die Rückfallebene.
  var EBENEN = [
    { layer: 'ch.kantone.cadastralwebmap-farbe', quelle: 'av' },
    { layer: 'ch.swisstopo.landeskarte-farbe-10', quelle: 'ch' },
    { layer: 'ch.swisstopo.pixelkarte-farbe', quelle: 'ch' }
  ];
  var QUELLEN = {
    av: 'Grundkarte © Amtliche Vermessung der Kantone, geo.admin.ch',
    ch: 'Karte © swisstopo'
  };

  // Ausschnitt: quadratisch, 1600 px, 0,3 m pro Pixel (480 m), Objekt bei 50 % / 82 %
  var KARTE = { px: 1600, mpp: 0.3, fx: 0.5, fy: 0.82 };

  // WGS84 → LV95 (Näherungsformel swisstopo, Genauigkeit ca. 1 m)
  function lv95(lat, lon) {
    var p = (lat * 3600 - 169028.66) / 10000;
    var l = (lon * 3600 - 26782.5) / 10000;
    return {
      e: 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l * l * l,
      n: 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p * p * p
    };
  }

  // «Horburgstrasse 96 <b>4057 Basel</b>» → { strasse, nr, plz, ort }
  function zerlegen(label) {
    var text = String(label || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    var m = text.match(/^(.+?)\s+(\d+[a-zA-Z]?(?:\.\d+)?)\s+(\d{4})\s+(.+)$/);
    if (m) return { strasse: m[1], nr: m[2], plz: m[3], ort: m[4] };
    m = text.match(/^(.+?)\s+(\d{4})\s+(.+)$/);
    if (m) return { strasse: m[1], nr: '', plz: m[2], ort: m[3] };
    return null;
  }

  function koordinaten(a) {
    var x = +a.x, y = +a.y;
    if (x > 2e6 && y > 1e6 && y < 1.4e6) return { e: x, n: y };
    if (y > 2e6 && x > 1e6 && x < 1.4e6) return { e: y, n: x };
    if (isFinite(+a.lat) && isFinite(+a.lon) && +a.lat) return lv95(+a.lat, +a.lon);
    return null;
  }

  function ergebnis(r) {
    var a = (r && r.attrs) || {};
    var t = zerlegen(a.label);
    var k = koordinaten(a);
    if (!t || !k) return null;
    var kanton = (String(a.detail || '').trim().split(/\s+/).pop() || '').toUpperCase();
    t.text = t.strasse + (t.nr ? ' ' + t.nr : '') + ', ' + t.plz + ' ' + t.ort;
    t.kanton = /^[A-Z]{2}$/.test(kanton) ? kanton : '';
    t.e = Math.round(k.e * 10) / 10;
    t.n = Math.round(k.n * 10) / 10;
    return t;
  }

  var cache = {};
  function suchen(text, limit) {
    text = String(text || '').trim();
    if (text.length < MIN_ZEICHEN) return Promise.resolve([]);
    var schluessel = text.toLowerCase() + '|' + (limit || MAX);
    if (cache[schluessel]) return cache[schluessel];
    var url = SUCHE + '?type=locations&origins=address&sr=2056&limit=' + (limit || MAX) + '&searchText=' + encodeURIComponent(text);
    var p = fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (r) { return r.ok ? r.json() : { results: [] }; })
      .then(function (j) {
        var gesehen = {};
        return (j.results || []).map(ergebnis).filter(function (t) {
          if (!t || gesehen[t.text]) return false;
          gesehen[t.text] = true;
          return true;
        });
      })
      .catch(function () { delete cache[schluessel]; return []; });
    cache[schluessel] = p;
    return p;
  }

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/str\.?(\s|$)/g, 'strasse$1').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Beste passende Adresse: Strassenname muss vorkommen, PLZ (falls angegeben) muss stimmen
  function adresseFinden(adresse) {
    var a = norm(adresse);
    if (!a || !/\d/.test(a)) return Promise.resolve(null);
    var plz = (String(adresse).match(/\b(\d{4})\b/) || [])[1];
    return suchen(adresse, 5).then(function (liste) {
      for (var i = 0; i < liste.length; i++) {
        var t = liste[i];
        if (plz && t.plz !== plz) continue;
        if (a.indexOf(norm(t.strasse)) === -1) continue;
        return t;
      }
      return null;
    });
  }

  function karte(e, n, ebene) {
    var E = EBENEN[ebene || 0] || EBENEN[0];
    var breite = KARTE.px * KARTE.mpp;
    var bbox = [e - KARTE.fx * breite, n - (1 - KARTE.fy) * breite, e + (1 - KARTE.fx) * breite, n + KARTE.fy * breite]
      .map(function (v) { return Math.round(v * 10) / 10; });
    var url = WMS + '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=FALSE&STYLES=' +
      '&LAYERS=' + E.layer + '&CRS=EPSG%3A2056&BBOX=' + bbox.join('%2C') + '&WIDTH=' + KARTE.px + '&HEIGHT=' + KARTE.px;
    return { url: url, quelle: E.quelle, layer: E.layer };
  }

  // Bild laden und prüfen, ob es mehr als eine leere Fläche zeigt. Lädt es mit CORS nicht,
  // ein zweiter Versuch ohne CORS (dann ist nur die Anzeige möglich, nicht die Prüfung).
  function bildPruefen(url) {
    return bildLaden(url, true).then(function (r) {
      return r === 'fehler' ? bildLaden(url, false).then(function (r2) { return r2 === 'ok'; }) : r === 'ok';
    });
  }

  function bildLaden(url, cors) {
    return new Promise(function (ergebnis) {
      var ok = function (gut) { ergebnis(gut === true ? 'ok' : gut === false ? 'leer' : gut); };
      var im = new Image();
      if (cors) im.crossOrigin = 'anonymous';
      im.referrerPolicy = 'no-referrer';
      var fertig = false;
      var uhr = setTimeout(function () { if (!fertig) { fertig = true; ok('fehler'); } }, 20000);
      im.onload = function () {
        if (fertig) return;
        fertig = true;
        clearTimeout(uhr);
        if (!im.naturalWidth) return ok(false);
        try {
          var c = document.createElement('canvas');
          c.width = c.height = 48;
          var g = c.getContext('2d');
          g.drawImage(im, 0, 0, 48, 48);
          var d = g.getImageData(0, 0, 48, 48).data;
          var summe = 0, quadrat = 0, n = d.length / 4;
          for (var i = 0; i < d.length; i += 4) {
            var l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
            summe += l;
            quadrat += l * l;
          }
          var varianz = quadrat / n - (summe / n) * (summe / n);
          ok(varianz > 4);   // einfarbige Fläche = Karte für diesen Massstab leer
        } catch (e) {
          ok(true);         // ohne CORS nicht prüfbar: Bild hat aber geladen
        }
      };
      im.onerror = function () { if (!fertig) { fertig = true; clearTimeout(uhr); ok('fehler'); } };
      im.src = url;
    });
  }

  function karteMitRueckfall(e, n) {
    var i = 0;
    function naechste() {
      if (i >= EBENEN.length) return Promise.resolve(null);
      var k = karte(e, n, i++);
      return bildPruefen(k.url).then(function (gut) { return gut ? k : naechste(); });
    }
    return naechste();
  }

  function karteFuerAdresse(adresse, bekannt) {
    var start = bekannt && isFinite(bekannt.e) && isFinite(bekannt.n) ? Promise.resolve(bekannt) : adresseFinden(adresse);
    return start.then(function (t) {
      if (!t) return null;
      return karteMitRueckfall(t.e, t.n).then(function (k) {
        if (!k) return null;
        return { url: k.url, quelle: k.quelle, layer: k.layer, e: t.e, n: t.n, adresse: adresse };
      });
    });
  }

  // ── Vorschlagsliste ─────────────────────────────────────────────────
  var stilDa = false;
  function stil() {
    if (stilDa) return;
    stilDa = true;
    var s = document.createElement('style');
    s.textContent =
      '.jvgeo-liste{position:fixed;z-index:2147483600;margin:0;padding:4px;list-style:none;background:#fff;color:#2b3238;' +
      'border:1px solid #d7dce0;border-radius:8px;box-shadow:0 10px 28px rgba(20,24,28,.16);max-height:300px;overflow:auto;' +
      'font:14px/1.35 Arimo,Inter,-apple-system,"Segoe UI",Arial,sans-serif;box-sizing:border-box}' +
      '.jvgeo-liste li{padding:8px 10px;border-radius:6px;cursor:pointer;display:grid;gap:1px}' +
      '.jvgeo-liste li strong{font-weight:600}' +
      '.jvgeo-liste li span{color:#6b757d;font-size:12.5px}' +
      '.jvgeo-liste li[aria-selected=true],.jvgeo-liste li:hover{background:#f3ece3}' +
      '.jvgeo-liste .jvgeo-quelle{cursor:default;color:#8a949b;font-size:11px;padding:4px 10px 2px;display:block}' +
      '.jvgeo-liste .jvgeo-quelle:hover{background:none}' +
      '@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .jvgeo-liste{background:#1f2429;color:#e6e9eb;border-color:#353c43}' +
      ':root:not([data-theme=light]) .jvgeo-liste li span{color:#9aa4ab}' +
      ':root:not([data-theme=light]) .jvgeo-liste li[aria-selected=true],:root:not([data-theme=light]) .jvgeo-liste li:hover{background:#2c3238}}' +
      ':root[data-theme=dark] .jvgeo-liste{background:#1f2429;color:#e6e9eb;border-color:#353c43}' +
      ':root[data-theme=dark] .jvgeo-liste li span{color:#9aa4ab}' +
      ':root[data-theme=dark] .jvgeo-liste li[aria-selected=true],:root[data-theme=dark] .jvgeo-liste li:hover{background:#2c3238}';
    document.head.appendChild(s);
  }

  var zaehler = 0;

  // ziel: CSS-Selektor (wird über das ganze Dokument verfolgt) oder ein Eingabefeld
  function vorschlaege(ziel, optionen) {
    optionen = optionen || {};
    stil();
    var passt = typeof ziel === 'string'
      ? function (el) { return el && el.matches && el.matches(ziel); }
      : function (el) { return el === ziel; };
    var id = 'jvgeo-' + (++zaehler);
    var liste = document.createElement('ul');
    liste.className = 'jvgeo-liste';
    liste.id = id;
    liste.setAttribute('role', 'listbox');
    liste.hidden = true;
    document.body.appendChild(liste);

    var feld = null, treffer = [], aktiv = -1, uhr = null, lauf = 0;

    function lage() {
      if (!feld || !feld.isConnected) return schliessen();
      var r = feld.getBoundingClientRect();
      var unten = window.innerHeight - r.bottom;
      liste.style.left = Math.max(8, r.left) + 'px';
      liste.style.width = Math.max(260, r.width) + 'px';
      if (unten < 220 && r.top > unten) {
        liste.style.top = '';
        liste.style.bottom = (window.innerHeight - r.top + 4) + 'px';
      } else {
        liste.style.bottom = '';
        liste.style.top = (r.bottom + 4) + 'px';
      }
    }
    function schliessen() {
      liste.hidden = true;
      liste.innerHTML = '';
      treffer = [];
      aktiv = -1;
      if (feld) { feld.setAttribute('aria-expanded', 'false'); feld.removeAttribute('aria-activedescendant'); }
    }
    function markieren(i) {
      aktiv = i;
      Array.prototype.forEach.call(liste.querySelectorAll('li[role=option]'), function (li, j) {
        li.setAttribute('aria-selected', j === i ? 'true' : 'false');
        if (j === i) li.scrollIntoView({ block: 'nearest' });
      });
      if (feld) {
        if (i >= 0) feld.setAttribute('aria-activedescendant', id + '-' + i);
        else feld.removeAttribute('aria-activedescendant');
      }
    }
    function zeigen() {
      liste.innerHTML = '';
      if (!treffer.length || !feld) return schliessen();
      treffer.forEach(function (t, i) {
        var li = document.createElement('li');
        li.id = id + '-' + i;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        var oben = document.createElement('strong');
        oben.textContent = t.strasse + (t.nr ? ' ' + t.nr : '');
        var unten = document.createElement('span');
        unten.textContent = t.plz + ' ' + t.ort + (t.kanton ? ' · ' + t.kanton : '');
        li.appendChild(oben);
        li.appendChild(unten);
        // mousedown statt click, damit das Feld den Fokus nicht vorher verliert
        li.addEventListener('mousedown', function (ev) { ev.preventDefault(); waehlen(i); });
        liste.appendChild(li);
      });
      var q = document.createElement('li');
      q.className = 'jvgeo-quelle';
      q.textContent = 'Adressen: geo.admin.ch';
      liste.appendChild(q);
      // In einem offenen <dialog> (oberste Ebene) muss die Liste im Dialog liegen, sonst ist sie verdeckt
      var dlg = feld.closest ? feld.closest('dialog') : null;
      var ort = dlg && dlg.open ? dlg : document.body;
      if (liste.parentNode !== ort) ort.appendChild(liste);
      liste.hidden = false;
      feld.setAttribute('aria-expanded', 'true');
      lage();
      markieren(-1);
    }
    function waehlen(i) {
      var t = treffer[i];
      if (!t || !feld) return;
      var f = feld;
      schliessen();
      f.value = optionen.format ? optionen.format(t) : t.text;
      f.dispatchEvent(new Event('input', { bubbles: true }));
      f.dispatchEvent(new Event('change', { bubbles: true }));
      if (optionen.beiAuswahl) optionen.beiAuswahl(t, f);
    }
    function vorbereiten(el) {
      if (feld === el) return;
      feld = el;
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('role', 'combobox');
      el.setAttribute('aria-autocomplete', 'list');
      el.setAttribute('aria-controls', id);
      el.setAttribute('aria-expanded', 'false');
    }

    function beiEingabe(ev) {
      if (!passt(ev.target) || !ev.isTrusted) return;
      vorbereiten(ev.target);
      clearTimeout(uhr);
      var text = feld.value.trim();
      if (text.length < MIN_ZEICHEN) { lauf++; return schliessen(); }
      var nr = ++lauf;
      uhr = setTimeout(function () {
        suchen(text).then(function (l) {
          if (nr !== lauf || document.activeElement !== feld) return;
          treffer = l;
          zeigen();
        });
      }, WARTEN_MS);
    }
    function beiTaste(ev) {
      if (!passt(ev.target) || liste.hidden) return;
      if (ev.key === 'ArrowDown') { ev.preventDefault(); markieren(Math.min(aktiv + 1, treffer.length - 1)); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); markieren(Math.max(aktiv - 1, -1)); }
      else if (ev.key === 'Enter' && aktiv >= 0) { ev.preventDefault(); ev.stopPropagation(); waehlen(aktiv); }
      else if (ev.key === 'Escape') { ev.stopPropagation(); schliessen(); }
    }
    function beiFokusWeg(ev) {
      if (passt(ev.target)) setTimeout(schliessen, 150);
    }

    document.addEventListener('input', beiEingabe, true);
    document.addEventListener('keydown', beiTaste, true);
    document.addEventListener('focusout', beiFokusWeg, true);
    window.addEventListener('resize', function () { if (!liste.hidden) lage(); });
    window.addEventListener('scroll', function () { if (!liste.hidden) lage(); }, true);

    return {
      schliessen: schliessen,
      entfernen: function () {
        document.removeEventListener('input', beiEingabe, true);
        document.removeEventListener('keydown', beiTaste, true);
        document.removeEventListener('focusout', beiFokusWeg, true);
        liste.remove();
      }
    };
  }

  window.JVGeo = {
    suchen: suchen,
    adresseFinden: adresseFinden,
    vorschlaege: vorschlaege,
    karte: karte,
    karteFuerAdresse: karteFuerAdresse,
    QUELLEN: QUELLEN,
    KARTE: KARTE,
    lv95: lv95,
    zerlegen: zerlegen
  };
})();
