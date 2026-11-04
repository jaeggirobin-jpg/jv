// ki-chat.js — Chat mit Claude in Michis Tools Reel-Generator und Story (Robin, 4.11.2026)
//
//   <script src="/assets/ki-chat.js" data-werkzeug="reel" defer></script>   (bzw. "story")
//
// Knopf «Claude» unten rechts öffnet ein Seitenfenster: Fragen stellen oder Änderungen verlangen
// («Mach den Rätsel-Text lustiger», «Verschieb Foto 3 nach vorne», «Logo ohne Karte unten rechts»).
// Freie Gestaltung: im Reel Logo, Farben und Ebenen (Text, Formen, Logo) über window.JVReelGestaltung
// (eingefügt von tools_einbinden.py), in der Story CSS je Element und zusätzliche Textfelder. Die Anfrage geht über
// /api/ki (Aktion «chat», netlify/functions/_lib/werkzeug-chat.js) an Claude. Mit geht nur der Stand
// des Tools (Texte, Einstellungen, Reihenfolge), nie Fotos. Die Antwort enthält geprüfte Änderungen;
// dieses Skript wendet sie über die Bedienelemente des Tools an (wie ein Klick oder eine Eingabe),
// das Tool selbst bleibt unverändert. Jede Antwort mit Änderungen lässt sich rückgängig machen.
//
// Eingebunden über werkzeuge/tools_einbinden.py (bleibt beim nächsten Einbinden erhalten).
(function () {
  'use strict';
  var skript = document.currentScript;
  var WZ = (skript && skript.dataset.werkzeug) || '';
  if (window.top !== window) return;   // eingebettet (Vorschau): kein Chat

  function $(id) { return document.getElementById(id); }
  function eingabe(el, wert) {
    el.value = wert;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function waehlen(name, wert) {
    var r = document.querySelector('input[name="' + name + '"][value="' + wert + '"]');
    if (!r) return false;
    if (!r.checked) {
      r.checked = true;
      r.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }
  function gewaehlt(name) {
    var r = document.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : '';
  }

  // ── Reel-Generator ────────────────────────────────────────────────────
  var REEL_FELDER = {
    raetsel: ['quizText', 'Rätsel-Text'],
    splitOben: ['splitTop', 'Split-Text oben'],
    splitUnten: ['splitBottom', 'Split-Text unten'],
    eigenerSpruchVorher: ['ownSayA', 'Eigener Spruch (Vorher)'],
    eigenerSpruchNachher: ['ownSayB', 'Eigener Spruch (Nachher)'],
    zusatzNachher: ['heroSub', 'Zusatz beim Nachher-Bild']
  };
  var EINLEITUNG = { quiz: 'Rätsel', split: 'Vorher/Nachher-Split', none: 'ohne Startseite' };

  function reelFotos() {
    var ol = $('photoList');
    return ol ? Array.prototype.slice.call(ol.children) : [];
  }
  function fotoSchluessel(li) {
    var im = li.querySelector('img');
    return im ? im.getAttribute('src') : '';
  }
  // Foto von Stelle «von» nach «nach» (1-basiert) über die Pfeilknöpfe des Tools
  function reelVerschieben(von, nach) {
    var lis = reelFotos();
    if (von < 1 || von > lis.length || nach < 1 || nach > lis.length) return false;
    var schl = fotoSchluessel(lis[von - 1]);
    var pos = von, schutz = 0;
    while (pos !== nach && schutz++ < 200) {
      var li = reelFotos()[pos - 1];
      var knopf = li && li.querySelector('button[aria-label="' + (nach < pos ? 'Nach oben' : 'Nach unten') + '"]');
      if (!knopf || knopf.disabled) return false;
      knopf.click();
      var neu = reelFotos().map(fotoSchluessel).indexOf(schl);
      if (neu < 0) return false;
      pos = neu + 1;
    }
    return pos === nach;
  }

  // ── Freie Gestaltung (Robin, 4.11.2026: «freie Anpassungen via Chat») ─────
  // Gestaltung = { farben, logo, ebenen } (Reel) bzw. { stile, ebenen } (Story). Der Server prüft jede
  // Änderung (netlify/functions/_lib/gestaltung.js); hier werden sie nur noch eingesetzt.
  function kopie(o) { return JSON.parse(JSON.stringify(o || {})); }
  function felderSetzen(ziel, werte) {
    Object.keys(werte || {}).forEach(function (k) { if (werte[k] === null) delete ziel[k]; else ziel[k] = werte[k]; });
  }
  function neueId(liste) {
    var n = 1;
    while (liste.some(function (e) { return e.id === 'e' + n; })) n++;
    return 'e' + n;
  }
  // {art:'ebene', aktion, id, ebene} auf die Liste anwenden; gibt Text oder Fehler zurück
  function ebeneAnwenden(liste, a, wort) {
    if (a.aktion === 'neu') {
      var e = kopie(a.ebene);
      Object.keys(e).forEach(function (k) { if (e[k] === null) delete e[k]; });
      e.id = neueId(liste);
      liste.push(e);
      return { text: wort + ' «' + e.id + '» hinzugefügt' };
    }
    var i = liste.map(function (x) { return x.id; }).indexOf(a.id);
    if (i < 0) return { fehler: wort + ' «' + a.id + '» gibt es nicht' };
    if (a.aktion === 'entfernen') { liste.splice(i, 1); return { text: wort + ' «' + a.id + '» entfernt' }; }
    var alt = liste[i];
    Object.keys(a.ebene || {}).forEach(function (k) {
      if (k === 'stil' && a.ebene.stil) { alt.stil = alt.stil || {}; felderSetzen(alt.stil, a.ebene.stil); }
      else if (a.ebene[k] === null) delete alt[k]; else alt[k] = a.ebene[k];
    });
    return { text: wort + ' «' + a.id + '» geändert' };
  }

  var REEL_GESTALTUNG = 'jvreel.ki_gestaltung';
  var LOGO_FELDER = { sichtbar: 'sichtbar', freigestellt: 'Datei ohne Hintergrund', x: 'Lage', y: 'Lage', breite: 'Grösse', karte: 'Karte', kartenfarbe: 'Kartenfarbe', radius: 'Ecken',
    deckkraft: 'Deckkraft', schatten: 'Schatten', von: 'Zeit', bis: 'Zeit', einblenden: 'Einblenden', ausblenden: 'Ausblenden' };
  function reelG() { return window.JVReelGestaltung && window.JVReelGestaltung.setzen ? window.JVReelGestaltung : null; }
  function gestaltungLeer(g) {
    return !g || (!Object.keys(g.farben || {}).length && !Object.keys(g.logo || {}).length && !(g.ebenen || []).length);
  }
  function reelGSetzen(g) {
    var G = reelG();
    if (!G) return false;
    G.setzen(g);
    try {
      if (gestaltungLeer(g)) localStorage.removeItem(REEL_GESTALTUNG);
      else localStorage.setItem(REEL_GESTALTUNG, JSON.stringify(g));
    } catch (e) { /* gilt dann nur bis zum Neuladen */ }
    return true;
  }
  function reelStart() {
    var G = reelG();
    if (!G) return;
    var g = null;
    try { g = JSON.parse(localStorage.getItem(REEL_GESTALTUNG) || 'null'); } catch (e) { g = null; }
    if (g && typeof g === 'object' && !Array.isArray(g)) {
      G.setzen({
        farben: g.farben && typeof g.farben === 'object' ? g.farben : {},
        logo: g.logo && typeof g.logo === 'object' ? g.logo : {},
        ebenen: Array.isArray(g.ebenen) ? g.ebenen.filter(function (e) { return e && typeof e === 'object'; }).slice(0, 20) : []
      });
    }
  }
  function reelGestaltung(a) {
    var G = reelG();
    if (!G) return { fehler: 'Die Gestaltung ist in diesem Tool nicht verfügbar' };
    var g = G.stand();
    g.farben = g.farben || {}; g.logo = g.logo || {}; g.ebenen = g.ebenen || [];
    var e;
    if (a.art === 'logo') {
      felderSetzen(g.logo, a.werte);
      var was = [];
      Object.keys(a.werte).forEach(function (k) { var w = LOGO_FELDER[k]; if (w && was.indexOf(w) < 0) was.push(w); });
      e = { text: 'Logo: ' + (was.join(', ') || 'angepasst') };
    } else if (a.art === 'farbe') {
      if (a.wert === null) delete g.farben[a.name]; else g.farben[a.name] = a.wert;
      e = { text: 'Farbe ' + a.name + ': ' + (a.wert || 'Original') };
    } else if (a.art === 'ebene') {
      e = ebeneAnwenden(g.ebenen, a, 'Ebene');
    } else if (a.art === 'gestaltung_zuruecksetzen') {
      g = { farben: {}, logo: {}, ebenen: [] };
      e = { text: 'Gestaltung aufs Original zurückgesetzt' };
    } else return { fehler: 'Unbekannte Änderung' };
    if (!e.fehler) reelGSetzen(g);
    return e;
  }

  var reel = {
    name: 'Reel-Generator',
    vorschlaege: ['Schlag mir einen witzigeren Rätsel-Text vor', 'Zeig das Logo ohne weisse Karte, kleiner und unten rechts', 'Kürze die Etappen-Texte'],
    bereit: function () { return !!$('photoList') && !!$('quizText'); },
    zustand: function () {
      var z = { einleitung: gewaehlt('intro'), spruch: gewaehlt('say'), sprueche: {}, felder: {}, fotos: [] };
      document.querySelectorAll('input[name=say]').forEach(function (r) {
        var l = r.closest('label');
        z.sprueche[r.value] = l ? l.textContent.trim().slice(0, 120) : r.value;
      });
      Object.keys(REEL_FELDER).forEach(function (k) {
        var el = $(REEL_FELDER[k][0]);
        if (el) z.felder[k] = el.value;
      });
      var lis = reelFotos();
      lis.forEach(function (li, i) {
        var inp = li.querySelector('input[type=text]');
        var rolle = inp ? 'etappe' : (i === 0 ? 'vorher' : i === lis.length - 1 ? 'nachher' : 'etappe');
        z.fotos.push({ nr: i + 1, rolle: rolle, text: inp ? inp.value : '' });
      });
      var bsp = $('exampleRow');
      z.beispielFotos = !!(bsp && !bsp.hidden && bsp.offsetParent !== null);
      var d = $('durLabel');
      if (d && d.textContent) z.dauer = d.textContent;
      var G = reelG();
      if (G) { z.gestaltung = G.stand(); z.gestaltungStandard = G.standard(); }
      return z;
    },
    anwenden: function (a) {
      if (a.art === 'feld') {
        var f = REEL_FELDER[a.feld], el = f && $(f[0]);
        if (!el) return { fehler: 'Feld nicht gefunden' };
        eingabe(el, a.wert);
        return { text: f[1] + ' geändert' };
      }
      if (a.art === 'einleitung') {
        return waehlen('intro', a.wert) ? { text: 'Startseite: ' + EINLEITUNG[a.wert] } : { fehler: 'Startseite nicht gefunden' };
      }
      if (a.art === 'spruch') {
        if (!waehlen('say', a.wert)) return { fehler: 'Spruch nicht gefunden' };
        var r = document.querySelector('input[name=say][value="' + a.wert + '"]');
        var l = r && r.closest('label');
        return { text: 'Spruch: ' + (l ? l.textContent.trim() : a.wert) };
      }
      if (a.art === 'etappe') {
        var li = reelFotos()[a.nr - 1];
        var inp = li && li.querySelector('input[type=text]');
        if (!inp) return { fehler: 'Foto ' + a.nr + ' hat keinen Etappen-Text (erstes und letztes Foto zeigen den Spruch)' };
        eingabe(inp, a.text);
        return { text: 'Text von Foto ' + a.nr + ' geändert' };
      }
      if (a.art === 'verschieben') {
        return reelVerschieben(a.nr, a.nach) ? { text: 'Foto ' + a.nr + ' an Stelle ' + a.nach + ' verschoben' } : { fehler: 'Foto ' + a.nr + ' liess sich nicht verschieben' };
      }
      return reelGestaltung(a);
    },
    sichern: function () {
      var s = { intro: gewaehlt('intro'), say: gewaehlt('say'), felder: {}, reihe: [], texte: {} };
      Object.keys(REEL_FELDER).forEach(function (k) { var el = $(REEL_FELDER[k][0]); if (el) s.felder[k] = el.value; });
      reelFotos().forEach(function (li) {
        var k = fotoSchluessel(li), inp = li.querySelector('input[type=text]');
        s.reihe.push(k);
        if (inp) s.texte[k] = inp.value;
      });
      var G = reelG();
      if (G) s.gestaltung = G.stand();
      return s;
    },
    zuruecksetzen: function (s) {
      if (s.intro) waehlen('intro', s.intro);
      if (s.say) waehlen('say', s.say);
      Object.keys(s.felder).forEach(function (k) { var el = $(REEL_FELDER[k][0]); if (el && el.value !== s.felder[k]) eingabe(el, s.felder[k]); });
      // Reihenfolge: jedes Foto der Reihe nach an seine Stelle (Fotos, die es nicht mehr gibt, fallen weg)
      var ziel = s.reihe.filter(function (k) { return reelFotos().map(fotoSchluessel).indexOf(k) >= 0; });
      ziel.forEach(function (k, i) {
        var pos = reelFotos().map(fotoSchluessel).indexOf(k) + 1;
        if (pos !== i + 1) reelVerschieben(pos, i + 1);
      });
      reelFotos().forEach(function (li) {
        var k = fotoSchluessel(li), inp = li.querySelector('input[type=text]');
        if (inp && Object.prototype.hasOwnProperty.call(s.texte, k) && inp.value !== s.texte[k]) eingabe(inp, s.texte[k]);
      });
      if (s.gestaltung) reelGSetzen(s.gestaltung);
    },
    original: {
      text: 'Gestaltung zurück',
      titel: 'Logo, Farben und Ebenen aufs Original zurücksetzen (Texte bleiben)',
      geaendert: function () { var G = reelG(); return !!G && !gestaltungLeer(G.stand()); },
      tun: function () { reelGSetzen({ farben: {}, logo: {}, ebenen: [] }); }
    }
  };

  // ── Story Badumbau ────────────────────────────────────────────────────
  // Die Story ist eine feste Seite (1080 × 1920). Geänderte Texte und die Akzentfarbe merkt sich der
  // Browser (localStorage «jvstory.ki») und setzt sie beim Öffnen wieder; «Original» stellt alles zurück.
  var STORY_SPEICHER = 'jvstory.ki';
  var STORY_FELDER = { titel: 'Titel', text: 'Text', knopf: 'Knopf', telefon: 'Telefon', fusszeile: 'Fusszeile' };
  var storyEl = null, storyOriginal = null, storyWerte = {};

  function storyElemente() {
    if (storyEl) return storyEl;
    var fit = $('fit');
    if (!fit) return null;
    var titel = fit.querySelector('div[style*="Kaushan"]');
    var a = fit.querySelector('a[href]');
    var spans = Array.prototype.filter.call(fit.querySelectorAll('span'), function (s) { return !s.closest('a'); });
    storyEl = {
      titel: titel,
      text: fit.querySelector('p'),
      knopf: a ? a.querySelector('span') : null,
      telefon: spans[0] || null,
      fusszeile: fit.querySelector('div[style*="font-size: 38px"]'),
      knopfFlaeche: a,
      strich: fit.querySelector('div[style*="rotate(-3deg)"]')
    };
    return storyEl;
  }
  function storyLesen(el) {
    var t = '';
    el.childNodes.forEach(function (n) { t += n.nodeName === 'BR' ? '\n' : n.textContent; });
    return t.trim();
  }
  function storySchreiben(el, wert) {
    el.textContent = '';
    String(wert).split('\n').forEach(function (z, i) {
      if (i) el.appendChild(document.createElement('br'));
      el.appendChild(document.createTextNode(z));
    });
  }
  function storyFarbe() {
    var e = storyElemente();
    var f = e && e.knopfFlaeche ? e.knopfFlaeche.style.backgroundColor : '';
    var m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(f);
    return m ? '#' + [m[1], m[2], m[3]].map(function (x) { return ('0' + Number(x).toString(16)).slice(-2); }).join('').toUpperCase() : f;
  }
  function storySetzen(feld, wert) {
    var e = storyElemente();
    if (!e) return false;
    if (feld === 'farbe') {
      if (e.knopfFlaeche) e.knopfFlaeche.style.background = wert;
      if (e.strich) e.strich.style.background = wert;
      return !!e.knopfFlaeche;
    }
    if (!e[feld]) return false;
    storySchreiben(e[feld], wert);
    return true;
  }
  function storySpeichern() {
    try {
      if (Object.keys(storyWerte).length) localStorage.setItem(STORY_SPEICHER, JSON.stringify(storyWerte));
      else localStorage.removeItem(STORY_SPEICHER);
    } catch (e) { /* gilt dann nur bis zum Neuladen */ }
  }
  // Elemente für die freie Gestaltung (CSS) und ihr ursprüngliches style-Attribut
  var STIL_ELEMENTE = ['flaeche', 'hintergrund', 'verlauf', 'inhalt', 'logokarte', 'logo', 'titel', 'strich', 'text', 'knopf', 'kontakt', 'telefon', 'fusszeile'];
  var CSS_EIGENSCHAFTEN = ['display', 'position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'max-width', 'min-width', 'max-height', 'min-height',
    'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
    'background', 'background-color', 'color', 'font-size', 'font-weight', 'font-style', 'font-family', 'line-height', 'letter-spacing',
    'text-align', 'text-transform', 'text-shadow', 'text-decoration', 'box-shadow', 'border', 'border-radius', 'opacity', 'transform', 'filter',
    'align-self', 'align-items', 'justify-content', 'flex-direction', 'flex-grow', 'gap', 'order', 'z-index', 'object-fit', 'object-position',
    'white-space', 'visibility'];
  var stilEl = null, stilOriginal = {};
  function storyStilElemente() {
    if (stilEl) return stilEl;
    var fit = $('fit'), e = storyElemente();
    if (!fit || !e) return null;
    var flaeche = fit.firstElementChild;
    var kinder = flaeche ? Array.prototype.slice.call(flaeche.children) : [];
    var logo = fit.querySelector('img[alt^="Jäggi"]');
    var telZeile = e.telefon ? e.telefon.parentElement : null;
    stilEl = {
      flaeche: flaeche, hintergrund: kinder[0] && kinder[0].tagName === 'IMG' ? kinder[0] : null, verlauf: kinder[1] || null, inhalt: kinder[2] || null,
      logokarte: logo ? logo.parentElement : null, logo: logo, titel: e.titel, strich: e.strich, text: e.text, knopf: e.knopfFlaeche,
      kontakt: telZeile ? telZeile.parentElement : null, telefon: telZeile, fusszeile: e.fusszeile
    };
    STIL_ELEMENTE.forEach(function (k) { if (stilEl[k]) stilOriginal[k] = stilEl[k].getAttribute('style') || ''; });
    return stilEl;
  }
  // zweite Prüfung im Browser (auch für Werte aus dem Speicher des Browsers)
  function cssOk(eig, wert) {
    return CSS_EIGENSCHAFTEN.indexOf(eig) >= 0 && typeof wert === 'string' && wert.length <= 200 &&
      !/[;{}<>\\"`@!]|\/\*|url\s*\(|image-set|image\s*\(|element\s*\(|expression|javascript/i.test(wert);
  }
  function stilSetzen(el, stil) {
    Object.keys(stil || {}).forEach(function (k) { if (stil[k] != null && cssOk(k, stil[k])) el.style.setProperty(k, stil[k]); });
  }
  var EBENE_GRUND = 'position:absolute;left:80px;top:860px;width:920px;z-index:5;font-family:"Roboto Condensed",Arial,sans-serif;' +
    'font-size:60px;font-weight:700;line-height:1.2;color:#ffffff;text-align:center;text-shadow:0 2px 14px rgba(0,0,0,0.5)';
  function storyGestaltungAnwenden(werte) {
    var S = storyStilElemente();
    if (!S) return;
    STIL_ELEMENTE.forEach(function (k) { if (S[k]) S[k].setAttribute('style', stilOriginal[k]); });
    if (werte.farbe) storySetzen('farbe', werte.farbe);
    if (S.logo) {
      if (!S.logo.dataset.jvOriginal) S.logo.dataset.jvOriginal = S.logo.getAttribute('src');
      var src = werte.logoFrei ? '/logo.png' : S.logo.dataset.jvOriginal;
      if (S.logo.getAttribute('src') !== src) S.logo.setAttribute('src', src);
    }
    var stile = werte.stile || {};
    Object.keys(stile).forEach(function (k) { if (S[k]) stilSetzen(S[k], stile[k]); });
    Array.prototype.forEach.call(S.flaeche.querySelectorAll('[data-jv-ebene]'), function (d) { d.remove(); });
    (werte.ebenen || []).forEach(function (eb) {
      if (!eb || typeof eb.text !== 'string') return;
      var d = document.createElement('div');
      d.setAttribute('data-jv-ebene', eb.id || '');
      d.setAttribute('style', EBENE_GRUND);
      storySchreiben(d, eb.text.slice(0, 300));
      stilSetzen(d, eb.stil);
      S.flaeche.appendChild(d);
    });
  }
  function storyAnwendenAlle(werte) {
    Object.keys(storyOriginal).forEach(function (k) {
      var w = Object.prototype.hasOwnProperty.call(werte, k) ? werte[k] : storyOriginal[k];
      storySetzen(k, w);
    });
    storyWerte = JSON.parse(JSON.stringify(werte));
    storyGestaltungAnwenden(storyWerte);
    storySpeichern();
  }
  function storyGestaltung(a) {
    var stile = kopie(storyWerte.stile), ebenen = kopie({ l: storyWerte.ebenen || [] }).l, e;
    if (a.art === 'stil') {
      var S = storyStilElemente();
      if (!S || !S[a.element]) return { fehler: 'Element «' + a.element + '» nicht gefunden' };
      stile[a.element] = stile[a.element] || {};
      felderSetzen(stile[a.element], a.stil);
      if (!Object.keys(stile[a.element]).length) delete stile[a.element];
      e = { text: 'Gestaltung von «' + a.element + '» geändert' };
    } else if (a.art === 'logo_bild') {
      var n = kopie(storyWerte);
      if (a.wert === 'freigestellt') n.logoFrei = true; else delete n.logoFrei;
      storyAnwendenAlle(n);
      return { text: a.wert === 'freigestellt' ? 'Logo ohne weissen Hintergrund' : 'Logo-Datei wie im Original' };
    } else if (a.art === 'ebene') {
      e = ebeneAnwenden(ebenen, a, 'Textfeld');
    } else if (a.art === 'gestaltung_zuruecksetzen') {
      if (a.element) { delete stile[a.element]; e = { text: '«' + a.element + '» aufs Original zurückgesetzt' }; }
      else { stile = {}; ebenen = []; e = { text: 'Gestaltung aufs Original zurückgesetzt' }; }
    } else return { fehler: 'Unbekannte Änderung' };
    if (e.fehler) return e;
    var neu = kopie(storyWerte);
    if (a.art === 'gestaltung_zuruecksetzen' && !a.element) delete neu.logoFrei;
    if (Object.keys(stile).length) neu.stile = stile; else delete neu.stile;
    if (ebenen.length) neu.ebenen = ebenen; else delete neu.ebenen;
    storyAnwendenAlle(neu);
    return e;
  }
  function storyStart() {
    var e = storyElemente();
    if (!e) return;
    storyStilElemente();   // ursprüngliche Stile merken, bevor etwas gesetzt wird
    storyOriginal = {};
    Object.keys(STORY_FELDER).forEach(function (k) { if (e[k]) storyOriginal[k] = storyLesen(e[k]); });
    storyOriginal.farbe = storyFarbe();
    var gemerkt = {};
    try { gemerkt = JSON.parse(localStorage.getItem(STORY_SPEICHER) || '{}') || {}; } catch (err) { gemerkt = {}; }
    var sauber = {};
    Object.keys(gemerkt).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(storyOriginal, k) && typeof gemerkt[k] === 'string' && gemerkt[k].length <= 300) sauber[k] = gemerkt[k];
    });
    if (sauber.farbe && !/^#[0-9A-Fa-f]{6}$/.test(sauber.farbe)) delete sauber.farbe;
    if (gemerkt.stile && typeof gemerkt.stile === 'object' && !Array.isArray(gemerkt.stile)) {
      var st = {};
      Object.keys(gemerkt.stile).forEach(function (k) {
        if (STIL_ELEMENTE.indexOf(k) >= 0 && gemerkt.stile[k] && typeof gemerkt.stile[k] === 'object') st[k] = gemerkt.stile[k];
      });
      if (Object.keys(st).length) sauber.stile = st;
    }
    if (gemerkt.logoFrei === true) sauber.logoFrei = true;
    if (Array.isArray(gemerkt.ebenen)) {
      var eb = gemerkt.ebenen.filter(function (x) { return x && typeof x.text === 'string' && typeof x.id === 'string'; }).slice(0, 20);
      if (eb.length) sauber.ebenen = eb;
    }
    storyAnwendenAlle(sauber);
  }

  var story = {
    name: 'Story Badumbau',
    vorschlaege: ['Mach den Titel persönlicher', 'Zeig das Logo ohne weisse Karte und etwas kleiner', 'Setz die Akzentfarbe auf JV-Kupfer'],
    bereit: function () { return !!storyOriginal; },
    zustand: function () {
      var e = storyElemente(), z = { felder: {}, original: {} };
      Object.keys(STORY_FELDER).forEach(function (k) { if (e[k]) z.felder[k] = storyLesen(e[k]); });
      z.farbe = storyFarbe();
      Object.keys(storyWerte).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(storyOriginal, k)) z.original[k] = storyOriginal[k]; });
      storyStilElemente();
      z.gestaltung = { stile: kopie(storyWerte.stile), ebenen: kopie({ l: storyWerte.ebenen || [] }).l, logoBild: storyWerte.logoFrei ? 'freigestellt' : 'original' };
      z.aufbau = {};
      STIL_ELEMENTE.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(stilOriginal, k)) z.aufbau[k] = stilOriginal[k].slice(0, 400); });
      return z;
    },
    anwenden: function (a) {
      if (a.art === 'text') {
        if (!storySetzen(a.feld, a.wert)) return { fehler: STORY_FELDER[a.feld] + ' nicht gefunden' };
        if (a.wert === storyOriginal[a.feld]) delete storyWerte[a.feld]; else storyWerte[a.feld] = a.wert;
        storySpeichern();
        return { text: STORY_FELDER[a.feld] + ' geändert' };
      }
      if (a.art === 'farbe') {
        if (!storySetzen('farbe', a.wert)) return { fehler: 'Knopf nicht gefunden' };
        if (a.wert === storyOriginal.farbe) delete storyWerte.farbe; else storyWerte.farbe = a.wert;
        storySpeichern();
        return { text: 'Akzentfarbe ' + a.wert };
      }
      return storyGestaltung(a);
    },
    sichern: function () { return JSON.parse(JSON.stringify(storyWerte)); },
    zuruecksetzen: function (s) { storyAnwendenAlle(s); },
    original: {
      text: 'Original',
      geaendert: function () { return Object.keys(storyWerte).length > 0; },
      tun: function () { storyAnwendenAlle({}); }
    }
  };

  var ADAPTER = { reel: reel, story: story }[WZ];
  if (!ADAPTER) return;

  // ── Oberfläche ────────────────────────────────────────────────────────
  var KUPFER = '#BD843A', KUPFER_DUNKEL = '#94621F', ANTHRAZIT = '#4B575D';
  var STIL =
    ':host{all:initial}' +
    '*{box-sizing:border-box}' +
    '.knopf{position:fixed;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2147481980;' +
      'display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 18px;border:0;border-radius:999px;background:' + KUPFER_DUNKEL + ';color:#fff;' +
      'font:700 15px/1 "Roboto Condensed","Arial Narrow",Arial,sans-serif;letter-spacing:.02em;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.28)}' +
    '.knopf[hidden]{display:none}.knopf:hover{background:#7d5219}.knopf:focus-visible{outline:3px solid rgba(189,132,58,.6);outline-offset:2px}' +
    '.knopf svg{width:18px;height:18px}' +
    '.fenster{position:fixed;right:calc(44px + env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2147481985;' +
      'width:min(410px,calc(100vw - 60px));height:min(620px,calc(100vh - 32px));display:flex;flex-direction:column;background:#fff;color:#2b3138;' +
      'border:1px solid #e2ddd5;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.3);overflow:hidden;' +
      'font:15px/1.45 "Roboto Condensed","Arial Narrow",Arial,sans-serif}' +
    '.fenster[hidden]{display:none}' +
    '@media (max-width:600px){.fenster{left:8px;right:38px;bottom:calc(8px + env(safe-area-inset-bottom,0px));width:auto;height:min(78vh,620px)}}' +
    '.kopf{flex:none;display:flex;align-items:center;gap:10px;padding:12px 14px;background:' + ANTHRAZIT + ';color:#fff}' +
    '.kopf b{font-size:16px;flex:1;min-width:0}' +
    '.kopf button{font:inherit;font-size:13px;font-weight:700;border:1px solid rgba(255,255,255,.45);background:none;color:#fff;border-radius:999px;padding:5px 11px;cursor:pointer}' +
    '.kopf button:hover{border-color:#fff}' +
    '.kopf .zu{width:32px;height:32px;padding:0;font-size:18px;line-height:1;display:grid;place-items:center}' +
    '.hinweis{flex:none;margin:0;padding:8px 14px;font-size:13px;color:#5f6870;background:#f4f2ee;border-bottom:1px solid #e2ddd5}' +
    '.verlauf{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}' +
    '.nachricht{max-width:88%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '.nachricht.ich{align-self:flex-end;background:#f3e9dc;border-bottom-right-radius:4px}' +
    '.nachricht.ki{align-self:flex-start;background:#f1f2f3;border-bottom-left-radius:4px}' +
    '.nachricht.fehler{align-self:flex-start;background:#fbeae6;color:#8f2f20}' +
    '.nachricht ul{margin:6px 0 0;padding-left:18px;white-space:normal;font-size:14px;color:#3f4c57}' +
    '.nachricht li.nein{color:#8f2f20}' +
    '.nachricht .rueck{margin-top:8px;font:inherit;font-size:13px;font-weight:700;border:1px solid ' + KUPFER + ';background:#fff;color:' + KUPFER_DUNKEL + ';border-radius:999px;padding:5px 12px;cursor:pointer}' +
    '.nachricht .rueck:disabled{opacity:.55;cursor:default}' +
    '.leer{color:#5f6870;font-size:14px;display:grid;gap:8px}' +
    '.leer button{text-align:left;font:inherit;font-size:14px;border:1px solid #e2ddd5;background:#fff;color:#2b3138;border-radius:10px;padding:8px 11px;cursor:pointer}' +
    '.leer button:hover{border-color:' + KUPFER + '}' +
    '.denkt{align-self:flex-start;color:#5f6870;font-size:14px}' +
    'form{flex:none;display:flex;gap:8px;padding:10px;border-top:1px solid #e2ddd5;background:#fff}' +
    'textarea{flex:1;min-width:0;max-width:100%;resize:none;font:inherit;font-size:16px;line-height:1.35;padding:9px 11px;border:1px solid #c3cad0;border-radius:10px;color:#2b3138;background:#fff;height:44px;max-height:140px}' +
    'textarea:focus{outline:2px solid ' + KUPFER + ';outline-offset:0;border-color:' + KUPFER + '}' +
    'form button{flex:none;font:700 15px/1 "Roboto Condensed","Arial Narrow",Arial,sans-serif;border:0;border-radius:10px;padding:0 16px;background:' + KUPFER + ';color:#fff;cursor:pointer}' +
    'form button:hover{background:' + KUPFER_DUNKEL + '}form button:disabled{opacity:.55;cursor:wait}';

  var SPEICHER = 'jv-ki-chat.' + WZ;
  var MAX_VERLAUF = 16;
  var verlauf = [];   // { role, content, aenderungen?: [text], fehler?: [text] }
  try { verlauf = JSON.parse(sessionStorage.getItem(SPEICHER) || '[]') || []; } catch (e) { verlauf = []; }
  if (!Array.isArray(verlauf)) verlauf = [];
  verlauf = verlauf.filter(function (n) { return n && (n.role === 'user' || n.role === 'assistant') && typeof n.content === 'string'; }).slice(-MAX_VERLAUF * 2);
  function verlaufMerken() {
    try { sessionStorage.setItem(SPEICHER, JSON.stringify(verlauf.slice(-MAX_VERLAUF * 2))); } catch (e) { /* nur bis zum Neuladen */ }
  }

  var host, root, fenster, liste, feld, senden, origKnopf, laeuft = false;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function bauen() {
    host = document.createElement('div');
    host.setAttribute('data-jv-ki-chat', '');
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var stil = document.createElement('style');
    stil.textContent = STIL;
    root.appendChild(stil);

    var knopf = el('button', 'knopf');
    knopf.type = 'button';
    knopf.setAttribute('aria-expanded', 'false');
    knopf.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    knopf.appendChild(document.createTextNode('Claude'));
    knopf.title = 'Mit Claude chatten: Fragen stellen oder Änderungen verlangen';
    root.appendChild(knopf);

    fenster = el('section', 'fenster');
    fenster.hidden = true;
    fenster.setAttribute('role', 'dialog');
    fenster.setAttribute('aria-label', 'Chat mit Claude');
    var kopf = el('div', 'kopf');
    kopf.appendChild(el('b', null, 'Claude · ' + ADAPTER.name));
    if (ADAPTER.original) {
      origKnopf = el('button', null, ADAPTER.original.text);
      origKnopf.type = 'button';
      origKnopf.title = ADAPTER.original.titel || 'Alle Änderungen zurücknehmen und das Original zeigen';
      origKnopf.addEventListener('click', function () {
        var vorher = ADAPTER.sichern();
        ADAPTER.original.tun();
        zeigeKi({ antwort: WZ === 'reel' ? 'Logo, Farben und Ebenen sind wieder wie im Original.' : 'Das Original ist wiederhergestellt.', erledigt: [], fehler: [], vorher: vorher });
        origAktualisieren();
      });
      kopf.appendChild(origKnopf);
    }
    var neu = el('button', null, 'Neu');
    neu.type = 'button';
    neu.title = 'Gespräch leeren (Änderungen bleiben)';
    neu.addEventListener('click', function () { verlauf = []; verlaufMerken(); zeichnen(); feld.focus(); });
    kopf.appendChild(neu);
    var zu = el('button', 'zu', '×');
    zu.type = 'button';
    zu.setAttribute('aria-label', 'Chat schliessen');
    zu.addEventListener('click', function () { oeffnen(false); });
    kopf.appendChild(zu);
    fenster.appendChild(kopf);

    fenster.appendChild(el('p', 'hinweis', 'Claude sieht nur Texte und Einstellungen, keine Fotos. Bitte keine Kundennamen eingeben.'));
    liste = el('div', 'verlauf');
    liste.setAttribute('aria-live', 'polite');
    fenster.appendChild(liste);

    var form = el('form');
    feld = el('textarea');
    feld.rows = 1;
    feld.placeholder = 'Frage oder Änderung …';
    feld.setAttribute('aria-label', 'Nachricht an Claude');
    feld.setAttribute('autocomplete', 'off');
    feld.maxLength = 2000;
    feld.addEventListener('input', hoehe);
    feld.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); abschicken(); }
      if (e.key === 'Escape') oeffnen(false);
    });
    senden = el('button', null, 'Senden');
    senden.type = 'submit';
    form.appendChild(feld);
    form.appendChild(senden);
    form.addEventListener('submit', function (e) { e.preventDefault(); abschicken(); });
    fenster.appendChild(form);
    root.appendChild(fenster);

    knopf.addEventListener('click', function () { oeffnen(fenster.hidden); });
    // Tasten im Chat nicht an das Tool weitergeben (z. B. Leertaste = Abspielen)
    ['keydown', 'keyup', 'keypress'].forEach(function (ev) { fenster.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    document.body.appendChild(host);
    zeichnen();
  }

  function hoehe() {
    feld.style.height = '44px';
    feld.style.height = Math.min(140, feld.scrollHeight + 2) + 'px';
  }
  function oeffnen(auf) {
    fenster.hidden = !auf;
    var knopf = root.querySelector('.knopf');
    knopf.setAttribute('aria-expanded', auf ? 'true' : 'false');
    knopf.hidden = auf;   // offen liegt das Fenster darüber
    if (auf) { origAktualisieren(); setTimeout(function () { feld.focus(); liste.scrollTop = liste.scrollHeight; }, 20); }
  }
  function origAktualisieren() {
    if (origKnopf) origKnopf.hidden = !ADAPTER.original.geaendert();
  }

  function nachrichtEl(n) {
    var b = el('div', 'nachricht ' + (n.role === 'user' ? 'ich' : n.istFehler ? 'fehler' : 'ki'), n.anzeige || n.content);
    var punkte = (n.erledigt || []).map(function (t) { return [t, '']; }).concat((n.fehler || []).map(function (t) { return [t, 'nein']; }));
    if (punkte.length) {
      var ul = el('ul');
      punkte.forEach(function (p) { ul.appendChild(el('li', p[1], (p[1] ? '✕ ' : '✓ ') + p[0])); });
      b.appendChild(ul);
    }
    if (n.vorher) {
      var r = el('button', 'rueck', 'Rückgängig');
      r.type = 'button';
      r.addEventListener('click', function () {
        ADAPTER.zuruecksetzen(n.vorher);
        n.vorher = null;
        r.disabled = true;
        r.textContent = 'Zurückgenommen';
        origAktualisieren();
        verlauf.push({ role: 'user', content: '(Ich habe deine letzten Änderungen rückgängig gemacht.)', still: true });
        verlaufMerken();
      });
      b.appendChild(r);
    }
    return b;
  }

  function zeichnen() {
    liste.textContent = '';
    var sichtbar = verlauf.filter(function (n) { return !n.still; });
    if (!sichtbar.length) {
      var leer = el('div', 'leer');
      leer.appendChild(el('div', null, 'Fragt etwas zum ' + (WZ === 'reel' ? 'Reel' : 'Story') + '-Inhalt oder sagt, was Claude ändern soll. Zum Beispiel:'));
      ADAPTER.vorschlaege.forEach(function (v) {
        var b = el('button', null, v);
        b.type = 'button';
        b.addEventListener('click', function () { feld.value = v; hoehe(); abschicken(); });
        leer.appendChild(b);
      });
      liste.appendChild(leer);
    }
    sichtbar.forEach(function (n) { liste.appendChild(nachrichtEl(n)); });
    liste.scrollTop = liste.scrollHeight;
  }

  function zeigeKi(o) {
    var n = { role: 'assistant', content: o.antwort, erledigt: o.erledigt, fehler: o.fehler, vorher: o.vorher || null, istFehler: !!o.istFehler };
    // Für Claude im Verlauf: Antwort plus Zusammenfassung, was wirklich geändert wurde
    var zusatz = [];
    if (o.erledigt && o.erledigt.length) zusatz.push('Geändert: ' + o.erledigt.join('; '));
    if (o.fehler && o.fehler.length) zusatz.push('Nicht möglich: ' + o.fehler.join('; '));
    n.anzeige = o.antwort;
    n.content = o.antwort + (zusatz.length ? '\n(' + zusatz.join(' · ') + ')' : '');
    verlauf.push(n);
    verlaufMerken();
    zeichnen();
  }

  function anfrage(body) {
    var B = window.JVBridge;
    if (B && B.anfrage) {
      var frei = B.kiZustimmung ? B.kiZustimmung() : Promise.resolve(true);
      return frei.then(function (ok) {
        if (!ok) { var e = new Error('Die KI wurde nicht freigegeben.'); e.code = 'not_granted'; throw e; }
        return B.anfrage('/ki', { method: 'POST', body: body });
      });
    }
    return fetch('/api/ki', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-JV-Sitzung': '1' }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) throw new Error('Nicht angemeldet. Bitte das Tool über die JV-Plattform öffnen und anmelden.');
        if (!r.ok) throw new Error(j.error || ('Fehler ' + r.status));
        return j;
      });
    });
  }

  function abschicken() {
    var text = feld.value.trim();
    if (!text || laeuft) return;
    if (!ADAPTER.bereit()) { zeigeKi({ antwort: 'Das Tool ist noch nicht fertig geladen. Bitte einen Moment warten.', istFehler: true }); return; }
    laeuft = true;
    senden.disabled = true;
    feld.value = '';
    hoehe();
    verlauf.push({ role: 'user', content: text });
    verlaufMerken();
    zeichnen();
    var denkt = el('div', 'denkt', 'Claude denkt nach …');
    liste.appendChild(denkt);
    liste.scrollTop = liste.scrollHeight;

    var nachrichten = verlauf.filter(function (n) { return !n.istFehler; }).slice(-MAX_VERLAUF).map(function (n) {
      return { role: n.role, content: String(n.content).slice(0, 2000) };
    });
    anfrage({ action: 'chat', werkzeug: WZ, zustand: ADAPTER.zustand(), nachrichten: nachrichten }).then(function (r) {
      var aend = Array.isArray(r.aenderungen) ? r.aenderungen : [];
      var vorher = aend.length ? ADAPTER.sichern() : null;
      var erledigt = [], fehler = [];
      aend.forEach(function (a) {
        var e;
        try { e = ADAPTER.anwenden(a); } catch (err) { e = { fehler: 'Änderung fehlgeschlagen' }; }
        if (e.fehler) fehler.push(e.fehler); else erledigt.push(e.text);
      });
      if (r.verworfen) fehler.push(r.verworfen === 1 ? 'Eine vorgeschlagene Änderung war nicht zulässig' : r.verworfen + ' vorgeschlagene Änderungen waren nicht zulässig');
      if (r.gekuerzt) fehler.push('Die Antwort wurde abgeschnitten');
      zeigeKi({ antwort: r.antwort || '', erledigt: erledigt, fehler: fehler, vorher: erledigt.length ? vorher : null });
      origAktualisieren();
    }).catch(function (err) {
      zeigeKi({ antwort: (err && err.message) || 'Die Anfrage ist fehlgeschlagen.', istFehler: true });
    }).then(function () {
      laeuft = false;
      senden.disabled = false;
      feld.focus();
    });
  }

  function start() {
    if (WZ === 'story') storyStart();
    if (WZ === 'reel') reelStart();
    bauen();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
