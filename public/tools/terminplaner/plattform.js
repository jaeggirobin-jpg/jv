// plattform.js — Ergänzungen der JV-Plattform für den Bau-Terminplaner (läuft nach dem Skript des Tools)
//
// 1. Karte nur im PDF (Robin, 2.11.2026): Statt der festen Google-Karte liegt die Umgebung der
//    Projektadresse (geo.admin.ch) als Hintergrund in den PDF-Exporten, schwarz-weiss; nur ein Kreis
//    um die Adresse bleibt farbig. Im Terminplan steht der Punkt in der Mitte zwischen dem Ende der
//    Tabelle und der Legende (frame() und die Legende merken sich ihre Lage, siehe
//    werkzeuge/tools_einbinden.py); eine Seite ohne Platz dafür bleibt ohne Karte. In den übrigen
//    PDFs steht der Punkt wie bisher unten in der Mitte. Am Bildschirm erscheint keine Karte mehr.
//    Die Karte wird automatisch erzeugt, sobald ein Projekt eine Adresse hat oder die Adresse ändert.
// 2. Adressvorschläge (geo.admin.ch) in «Neues Projekt» und im Projektkopf.
// 3. Aufruf aus der Plattform: ?projekt=<id> öffnet das Projekt (siehe jv-bridge.js),
//    &vorlage=1 bietet bei einem leeren Projekt gleich «Vorlage einfügen» an.
// 4. Projekte suchen: Der Knopf «Projekte» öffnet eine Suche, der Cursor steht im Suchfeld
//    (die Auswahlliste im Kopf entfällt, siehe werkzeuge/tools_einbinden.py).
// 5. Feedback 4.11.2026: Logo führt zur Übersicht der Plattform, «Heute» und «Projektdaten
//    ausblenden» wieder an ihrem Platz, Wochenkopf nur «KW nn» (mittig), Text eines Balkens mit
//    Wochenende (oder der im Balken keinen Platz hat) steht nach dem letzten Balken, Spalten der
//    Tabelle: Breite am Rand im Kopf ziehen, Rechtsklick auf den Kopf = Spalten ein- und ausblenden.
(function () {
  'use strict';
  if (typeof S === 'undefined' || typeof cur !== 'function' || !window.JVGeo) return;

  var KOORD = {};   // Adresse → { e, n } aus der Vorschlagsliste (spart eine zweite Suche)
  var FEHL = {};    // Adresse → Zeitpunkt der letzten erfolglosen Suche
  var laeuft = false;

  // Kartenausschnitt fürs PDF: 600 m im Quadrat, die Adresse etwas unterhalb der Mitte, damit jede
  // Lage des Punkts auf dem Blatt gedeckt ist. Massstab wie bisher: 480 m über die lange Blattseite.
  var AUSSCHNITT = { px: 2000, mpp: 0.3, fx: 0.5, fy: 0.66 };
  var SEITE_PX = 1600;    // Bildpunkte über die lange Blattseite (480 m)
  var KREIS_M = 40;       // farbiger Kreis: Halbmesser höchstens 40 m
  var KREIS_MIN = 12;     // mm; weniger Platz zwischen Tabelle und Legende: diese Seite ohne Karte
  var KUPFER = [189, 132, 58];
  var KACHEL = {};        // Adresse der Kachel → { zeit, ok, fehler, img }
  var BILDER = {};        // fertige Seitenbilder (schwarz-weiss, Kreis farbig)
  var BILDER_REIHE = [];
  var bilderZahl = 0;

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

  // Kachel fürs PDF aus der gespeicherten Karte (Ebene und Koordinaten); alte Karten aus dem
  // claude.ai-Speicher oder ohne Koordinaten: keine
  function kachelUrl(bg) {
    if (!bg || !(+bg.e > 2e6) || !(+bg.n > 1e6)) return '';
    var ebene = window.JVGeo.ebeneVonUrl(bg.url);
    return ebene < 0 ? '' : window.JVGeo.karte(+bg.e, +bg.n, ebene, AUSSCHNITT).url;
  }
  function karteDa(p) {
    return typeof mapOk === 'function' && mapOk(p) ? kachelUrl(p.mapBg) : '';
  }

  function pruefen() {
    if (laeuft || !S.loaded) return;
    var p = cur();
    if (!p) return;
    var adresse = String(p.address || '');
    if (!adresse.trim()) return;
    var bg = p.mapBg;
    if (karteDa(p)) return;   // Karte passt zur Adresse
    if (adressfeldAktiv()) return;
    if (FEHL[adresse] && Date.now() - FEHL[adresse] < 10 * 60 * 1000) return;

    var bekannt = KOORD[adresse.trim()] ||
      (bg && (bg.addr || '') === adresse && +bg.e > 2e6 && +bg.n > 1e6 ? { e: +bg.e, n: +bg.n } : null);
    laeuft = true;
    window.JVGeo.karteFuerAdresse(adresse, bekannt).then(function (k) {
      var p2 = S.projects[p.id];
      if (!p2 || String(p2.address || '') !== adresse) return;   // inzwischen geändert
      if (!k) { FEHL[adresse] = Date.now(); return; }
      // gespeichert wird die Karte wie bisher (die Projektseite der Plattform zeigt sie)
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
  setInterval(pruefen, 1500);

  function kachelLaden(url) {
    if (!url) return null;
    var k = KACHEL[url];
    if (k && !(k.fehler && Date.now() - k.zeit > 60000)) return k;   // lädt, ist da oder eben gescheitert
    var alte = Object.keys(KACHEL).filter(function (u) { return u !== url; })
      .sort(function (a, b) { return KACHEL[b].zeit - KACHEL[a].zeit; });
    alte.slice(2).forEach(function (u) { delete KACHEL[u]; });   // höchstens drei Kacheln im Speicher
    k = KACHEL[url] = { zeit: Date.now() };
    var im = new Image();
    im.crossOrigin = 'anonymous';   // geo.admin.ch erlaubt das Auslesen (schwarz-weiss rechnen)
    im.onload = function () { k.ok = true; k.img = im; k.zeit = Date.now(); };
    im.onerror = function () { k.fehler = true; k.zeit = Date.now(); };
    im.src = url;
    return k;
  }

  // Wartet vor einem PDF höchstens ms auf die Kachel des offenen Projekts
  function karteAbwarten(ms) {
    return new Promise(function (fertig) {
      var p = S.loaded ? cur() : null;
      var k = p ? kachelLaden(karteDa(p)) : null;
      if (!k) return fertig();
      var ende = Date.now() + ms;
      (function warten() {
        if (k.ok || k.fehler || Date.now() > ende) return fertig();
        setTimeout(warten, 100);
      })();
    });
  }

  // Kachel im Hintergrund vorladen (erst nach zwei Sekunden, das Tool soll zuerst starten)
  var VORLADEN = {};
  window.ensureMap = function (p) {
    try {
      var url = karteDa(p);
      if (!url || KACHEL[url] || VORLADEN[url]) return;
      VORLADEN[url] = setTimeout(function () {
        delete VORLADEN[url];
        var q = S.loaded ? cur() : null;
        if (q && karteDa(q) === url) kachelLaden(url);
      }, 2000);
    } catch (e) { /* ohne Karte */ }
  };

  // Am Bildschirm keine Karte
  var ohneKarte = document.createElement('style');
  ohneKarte.textContent = '#objbg{display:none!important}';
  document.head.appendChild(ohneKarte);
  window.updObjBg = function () {
    var el = document.getElementById('objbg');
    if (el && !el.hidden) el.hidden = true;
  };
  try { window.updObjBg(); } catch (e) { /* egal */ }

  // Jeder PDF-Export lädt zuerst jsPDF (loadLib 'pdf'): dabei auch auf die Kachel warten
  if (typeof loadLib === 'function') {
    var libLaden = loadLib;
    window.loadLib = function (key) {
      var lib = libLaden.apply(this, arguments);
      if (key !== 'pdf') return lib;
      return lib.then(function (x) { return karteAbwarten(6000).then(function () { return x; }); });
    };
  }

  // PDF: Die Karte kommt erst beim Ausgeben aufs Blatt (erst dann ist bekannt, wo die Tabelle endet)
  // und wird an den Anfang jeder Seite gesetzt, also unter alles andere.
  window.pdfBg = function (doc, land, p) {
    try {
      var url = karteDa(p), k = url ? KACHEL[url] : null;
      if (!k || !k.ok || !doc || typeof doc.output !== 'function') return;
      doc.jvKarte = { land: !!land, p: p, url: url, img: k.img, fertig: {} };
      var ausgeben = doc.output;
      doc.output = function () {
        try { karteZeichnen(doc); } catch (e) { /* PDF ohne Karte */ }
        return ausgeben.apply(doc, arguments);
      };
    } catch (e) { /* PDF ohne Karte */ }
  };

  function karteZeichnen(doc) {
    var k = doc.jvKarte, seiten = doc.internal && doc.internal.pages;
    if (!k || !seiten || typeof doc.setPage !== 'function') return;
    var n = doc.getNumberOfPages();
    var vorher = doc.internal.getCurrentPageInfo().pageNumber;
    for (var i = 1; i <= n; i++) {
      if (k.fertig[i] || !seiten[i]) continue;
      k.fertig[i] = true;
      var lage = kartenLage(doc, k, i);
      var bild = lage && seitenBild(k, lage);
      if (!bild) continue;
      doc.setPage(i);
      var inhalt = seiten[i], start = inhalt.length;
      try {
        doc.addImage(bild.url, 'JPEG', 0, 0, lage.pw, lage.ph, bild.alias, 'FAST');
        markieren(doc, k.p, lage);
      } catch (e) {
        inhalt.splice(start);
        continue;
      }
      var neu = inhalt.splice(start);
      inhalt.splice.apply(inhalt, [0, 0, 'q'].concat(neu, ['Q']));   // zuunterst, eigener Grafikzustand
    }
    doc.setPage(vorher);
  }

  // Lage des Punkts auf Seite i (mm) oder null (kein Platz)
  function kartenLage(doc, k, i) {
    var pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
    var rMax = KREIS_M * (k.land ? pw : ph) / (SEITE_PX * AUSSCHNITT.mpp);
    var leg = doc.jvLegende;
    if (leg) {
      // Terminplan: in der Mitte zwischen dem Ende der Tabelle und der Legende
      var unten = doc.jvUnten && doc.jvUnten[i];
      if (!(unten > 0) || !(leg.y > unten)) return null;
      var luecke = leg.y - unten, r = Math.min(rMax, luecke / 2 - 3);
      if (r < KREIS_MIN) return null;
      return { pw: pw, ph: ph, x: pw / 2, y: unten + luecke / 2, r: r, qx: leg.x + leg.w - 1.5, qy: leg.y - 1.6 };
    }
    return { pw: pw, ph: ph, x: pw / 2, y: ph * 0.82, r: rMax, qx: pw - 3, qy: ph - 2 };
  }

  // Seitenbild: Karte schwarz-weiss, im Kreis um die Adresse farbig
  function seitenBild(k, lage) {
    var schluessel = [k.url, k.land ? 'q' : 'h', lage.pw, lage.ph, lage.x.toFixed(1), lage.y.toFixed(1), lage.r.toFixed(1)].join('|');
    if (BILDER[schluessel]) return BILDER[schluessel];
    var proMm = SEITE_PX / (k.land ? lage.pw : lage.ph);
    var W = Math.round(lage.pw * proMm), H = Math.round(lage.ph * proMm);
    var sx = AUSSCHNITT.fx * AUSSCHNITT.px - lage.x * proMm;   // Kachelpunkt der linken oberen Blattecke
    var sy = AUSSCHNITT.fy * AUSSCHNITT.px - lage.y * proMm;
    var c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    var g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
    ausschnitt(g, k.img, sx, sy, W, H);
    var daten = g.getImageData(0, 0, W, H), d = daten.data;
    for (var j = 0; j < d.length; j += 4) {
      d[j] = d[j + 1] = d[j + 2] = Math.round(0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]);
    }
    g.putImageData(daten, 0, 0);
    g.save();
    g.beginPath();
    g.arc(lage.x * proMm, lage.y * proMm, lage.r * proMm, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
    ausschnitt(g, k.img, sx, sy, W, H);
    g.restore();
    var bild = { url: c.toDataURL('image/jpeg', 0.82), alias: 'jvkarte' + (++bilderZahl) };
    BILDER[schluessel] = bild;
    BILDER_REIHE.push(schluessel);
    while (BILDER_REIHE.length > 6) delete BILDER[BILDER_REIHE.shift()];
    return bild;
  }

  // Teil der Kachel, der aufs Blatt fällt (die Kachel kann auch in anderer Grösse kommen)
  function ausschnitt(g, img, sx, sy, W, H) {
    var A = AUSSCHNITT.px;
    var fx = (img.naturalWidth || A) / A, fy = (img.naturalHeight || A) / A;
    var x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(A, sx + W), y1 = Math.min(A, sy + H);
    if (x1 <= x0 || y1 <= y0) return;
    g.drawImage(img, x0 * fx, y0 * fy, (x1 - x0) * fx, (y1 - y0) * fy, x0 - sx, y0 - sy, x1 - x0, y1 - y0);
  }

  // Kreis, Stecknadel und Beschriftung (wie im Terminplaner) und die Quellenangabe
  function markieren(doc, p, lage) {
    var x = lage.x, y = lage.y, k = lage.pw / 297, r = 2.6 * Math.min(k, 1.25);
    doc.setDrawColor(KUPFER[0], KUPFER[1], KUPFER[2]);
    doc.setLineWidth(0.45 * Math.min(k, 1.25));
    doc.circle(x, y, lage.r, 'S');
    doc.setFillColor(185, 129, 64);
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.5);
    doc.triangle(x - r * 0.82, y - r * 1.55, x + r * 0.82, y - r * 1.55, x, y, 'F');
    doc.circle(x, y - r * 2.1, r, 'FD');
    doc.setFillColor(255, 255, 255);
    doc.circle(x, y - r * 2.1, r * 0.38, 'F');
    var f = Math.min(k, 1.2), t1 = p.address || p.name || '', t2 = [p.client, 'Objekt'].filter(Boolean).join(' · ');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2 * f);
    var w1 = doc.getTextWidth(t1);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.4 * f);
    var w2 = doc.getTextWidth(t2);
    var bw = Math.max(w1, w2) + 4, bh = 8.6 * f, bx = x + r + 1.5, by = y - r * 2.1 - bh / 2;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(220, 214, 205);
    doc.setLineWidth(0.2);
    doc.roundedRect(bx, by, bw, bh, 1.6, 1.6, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2 * f);
    doc.setTextColor(60, 56, 50);
    doc.text(t1, bx + 2, by + 3.6 * f);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.4 * f);
    doc.setTextColor(110, 104, 96);
    doc.text(t2, bx + 2, by + bh - 1.6 * f);
    var quelle = (typeof MAP_SRC !== 'undefined' && p.mapBg && MAP_SRC[p.mapBg.src]) || 'Kartendaten';
    doc.setFontSize(4.5);
    var qw = doc.getTextWidth(quelle);
    doc.setFillColor(255, 255, 255);
    doc.rect(lage.qx - qw - 1, lage.qy - 1.9, qw + 2, 2.6, 'F');
    doc.setTextColor(120, 120, 120);
    doc.text(quelle, lage.qx, lage.qy, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);
  }

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

  // ── 4. Projekte suchen (Robin, 2.11.2026: «intelligente Suche, Fokus direkt im Suchfeld») ──
  // Gesucht wird in Name, Adresse, Bauherrschaft, Projektleiter, Status, Gewerken, Firmen,
  // Kontakten und Daten. Akzente, «ä»/«ae» und Gross/klein zählen nicht, mehrere Wörter müssen
  // alle vorkommen; kurze Wörter (1–2 Zeichen) nur am Wortanfang. Ohne genauen Treffer gilt ein
  // Tippfehler je Wort (ab 4 Zeichen), das wird benannt. Pfeiltasten wählen, Enter öffnet,
  // Escape leert zuerst die Suche und schliesst danach.
  if (typeof projectsModal === 'function' && typeof openModal === 'function' &&
      typeof ACT !== 'undefined' && ACT.openProj && typeof esc === 'function') {
    var SUCHE = { q: '', aktiv: 0, treffer: [] };
    var ART = { bauherrschaft: 'Bauherrschaft', projektleiter: 'Projektleitung', status: 'Status',
      gewerk: 'Gewerk', firma: 'Firma', kontakt: 'Kontakt', termine: 'Termine' };
    var LUPE = '<svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg>';

    var stil = document.createElement('style');
    stil.textContent =
      '.pjs-kopf{position:sticky;top:-20px;margin-top:-20px;padding-top:20px;padding-bottom:4px;z-index:2;' +
        'background:var(--surface);display:flex;flex-direction:column;gap:8px}' +
      '.pjs-feld{position:relative;display:block}' +
      '.pjs-feld .ico{position:absolute;left:11px;top:50%;transform:translateY(-50%);width:18px;height:18px;opacity:.6;pointer-events:none}' +
      '#pjs-q{padding:10px 12px 10px 38px;font-size:16px;border-radius:10px}' +
      // .ph-list .ph-li.pjs-z: die Stile des Tools stehen im <body> und gewännen sonst (padding:10px 0),
      // der Text klebte am Kupferbalken der gewählten Zeile (Feedback 4.11.2026 «Anzeige komisch»)
      '.ph-list .ph-li.pjs-z{cursor:pointer;border-radius:8px;padding:10px 12px 10px 14px;margin:0 -12px}' +
      '.pjs-z:hover{background:var(--slate-soft,rgba(0,0,0,.04))}' +
      '.pjs-z.pjs-aktiv{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}' +
      '.pjs-z mark{background:var(--accent-soft);color:inherit;border-radius:2px;padding:0 1px;box-shadow:0 1px 0 var(--accent)}' +
      '.pjs-z.pjs-aktiv mark{background:transparent}' +
      '.pjs-grund{font-size:12px;margin-top:3px;color:var(--muted)}' +
      '.pjs-leer{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:8px 0}';
    document.head.appendChild(stil);

    // Für die Suche: Akzente weg, ä = ae = a, ß = ss, nur Buchstaben und Ziffern
    var suchText = function (s) {
      return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/ß/g, 'ss').replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
        .replace(/[^a-z0-9]+/g, ' ').trim();
    };
    // Für die Markierung: gleich lang wie das Original (Zeichen für Zeichen)
    var zeichenText = function (c) {
      return c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    };

    var felder = function (p) {
      var f = [];
      var add = function (art, g, wert) {
        wert = wert == null ? '' : String(wert);
        if (wert.trim()) f.push({ art: art, g: g, wert: wert, n: ' ' + suchText(wert) + ' ' });
      };
      add('name', 100, p.name);
      add('adresse', 60, p.address);
      add('bauherrschaft', 50, p.client);
      try { add('projektleiter', 40, leaderOf(p).name); } catch (e) { /* ohne Projektleiter */ }
      add('status', 25, p.state || 'Entwurf');
      var gewerke = {}, firmen = {};
      try {
        allTasks(p).forEach(function (t) {
          if (t.name) gewerke[t.name] = 1;
          var fi = t.firm && S.firms[t.firm];
          if (fi && fi.name) firmen[fi.name] = 1;
        });
      } catch (e) { /* Projekt ohne Gewerke */ }
      Object.keys(gewerke).forEach(function (w) { add('gewerk', 20, w); });
      Object.keys(firmen).forEach(function (w) { add('firma', 20, w); });
      (p.contacts || []).forEach(function (c) {
        add('kontakt', 20, [c && c.name, c && c.company].filter(Boolean).join(', '));
      });
      try { add('termine', 10, fmt(p.first) + ' ' + fmt(p.end)); } catch (e) { /* ohne Termine */ }
      return f;
    };

    // 3 = ganzes Wort, 2 = Wortanfang, 1 = mitten im Wort (erst ab 3 Zeichen)
    var trifft = function (n, w) {
      if (n.indexOf(' ' + w + ' ') >= 0) return 3;
      if (n.indexOf(' ' + w) >= 0) return 2;
      return w.length >= 3 && n.indexOf(w) >= 0 ? 1 : 0;
    };
    // Abstand mit Vertauschung zweier Nachbarzeichen (ein Tippfehler = 1)
    var abstand = function (a, b, max) {
      if (Math.abs(a.length - b.length) > max) return max + 1;
      var d = [], i, j;
      for (i = 0; i <= a.length; i++) { d[i] = [i]; }
      for (j = 0; j <= b.length; j++) { d[0][j] = j; }
      for (i = 1; i <= a.length; i++) {
        var zeileMin = Infinity;
        for (j = 1; j <= b.length; j++) {
          var k = a[i - 1] === b[j - 1] ? 0 : 1;
          d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + k);
          if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
          zeileMin = Math.min(zeileMin, d[i][j]);
        }
        if (zeileMin > max) return max + 1;
      }
      return d[a.length][b.length];
    };
    var aehnlich = function (n, w) {
      if (w.length < 4) return false;
      var max = w.length >= 8 ? 2 : 1;
      return n.trim().split(' ').some(function (t) {
        // ganzes Wort oder Wortanfang (z. B. «horbrug» → «horburgstrasse»)
        return abstand(t, w, max) <= max || (t.length > w.length && abstand(t.slice(0, w.length), w, max) <= max);
      });
    };

    var bewerten = function (e, woerter, unscharf) {
      var f = e.f, punkte = 0, gruende = [];
      for (var i = 0; i < woerter.length; i++) {
        var w = woerter[i], best = 0, feld = null;
        for (var j = 0; j < f.length; j++) {
          var s = trifft(f[j].n, w);
          if (!s && unscharf && aehnlich(f[j].n, w)) s = 0.5;
          var wert = s ? f[j].g * (1 + s / 3) : 0;
          if (wert > best) { best = wert; feld = f[j]; }
        }
        if (!feld) return null;
        punkte += best;
        if (ART[feld.art] && gruende.indexOf(feld) < 0) gruende.push(feld);
      }
      return { p: e.p, punkte: punkte, gruende: gruende };
    };

    var nachDatum = function (a, b) { return String(b.updated || '').localeCompare(String(a.updated || '')); };

    // Suchtexte einmal je Öffnen bilden (nicht bei jedem Tastendruck)
    var indexBauen = function () {
      SUCHE.index = Object.keys(S.projects).map(function (id) { return S.projects[id]; }).filter(Boolean).map(function (p) {
        try { recalc(p); } catch (e) { /* Anzeige ohne Termine */ }
        return { p: p, f: felder(p) };
      });
    };

    var suchen = function (q) {
      var alle = SUCHE.index || [];
      var woerter = suchText(q).split(' ').filter(Boolean);
      if (!woerter.length) {
        return { liste: alle.map(function (e) { return e.p; }).sort(nachDatum).map(function (p) { return { p: p, gruende: [] }; }), unscharf: false };
      }
      var r = alle.map(function (e) { return bewerten(e, woerter, false); }).filter(Boolean);
      var unscharf = false;
      if (!r.length) {
        r = alle.map(function (e) { return bewerten(e, woerter, true); }).filter(Boolean);
        unscharf = r.length > 0;
      }
      r.sort(function (a, b) { return b.punkte - a.punkte || nachDatum(a.p, b.p); });
      return { liste: r, unscharf: unscharf };
    };

    // Suchwörter im Originaltext hervorheben (Akzente und Gross/klein egal)
    var markiert = function (text, q) {
      text = String(text == null ? '' : text);
      var roh = '', karte = [];
      for (var i = 0; i < text.length; i++) {
        var z = zeichenText(text[i]);
        for (var k = 0; k < z.length; k++) { roh += z[k]; karte.push(i); }
      }
      var bereiche = [];
      zeichenText(String(q || '')).split(/[^a-z0-9ß]+/).filter(function (w) { return w.length >= 1; }).forEach(function (w) {
        var von = 0, pos;
        while ((pos = roh.indexOf(w, von)) >= 0) {
          var amAnfang = pos === 0 || !/[a-z0-9ß]/.test(roh[pos - 1]);
          if (w.length >= 3 || amAnfang) bereiche.push([karte[pos], karte[pos + w.length - 1] + 1]);
          von = pos + 1;
        }
      });
      if (!bereiche.length) return esc(text);
      bereiche.sort(function (a, b) { return a[0] - b[0]; });
      var html = '', bis = 0;
      bereiche.forEach(function (b) {
        if (b[1] <= bis) return;
        var a = Math.max(b[0], bis);
        html += esc(text.slice(bis, a)) + '<mark>' + esc(text.slice(a, b[1])) + '</mark>';
        bis = b[1];
      });
      return html + esc(text.slice(bis));
    };

    var zeileHtml = function (t, i) {
      var p = t.p, id = esc(p.id), q = SUCHE.q;
      var zeit = '';
      try { zeit = '<span class="mono">' + esc(fmt(p.first)) + ' – ' + esc(fmt(p.end)) + '</span>'; } catch (e) { /* ohne Termine */ }
      var gewerke = 0;
      try { gewerke = allTasks(p).length; } catch (e) { /* ohne Gewerke */ }
      var unter = [p.address ? markiert(p.address, q) : '', zeit, gewerke + ' Gewerke', esc(p.state || 'Entwurf')]
        .filter(Boolean).join(' · ');
      var grund = t.gruende.length ? '<div class="pjs-grund">' + t.gruende.map(function (g) {
        return esc(ART[g.art]) + ': ' + markiert(g.wert, q);
      }).join(' · ') + '</div>' : '';
      return '<div class="ph-li pjs-z' + (i === SUCHE.aktiv ? ' pjs-aktiv' : '') + '" id="pjs-z' + i + '" role="option" aria-selected="' +
        (i === SUCHE.aktiv) + '" data-act="openProj" data-id="' + id + '">' +
        '<div><b>' + markiert(p.name || 'Ohne Namen', q) + '</b> ' + (p.id === S.cur ? '<span class="chip">offen</span>' : '') +
        '<div class="muted small">' + unter + '</div>' + grund + '</div>' +
        '<div style="display:flex;gap:4px"><button class="btn sm" data-act="openProj" data-id="' + id + '">Öffnen</button>' +
        '<button class="iconbtn" data-act="renameProj" data-id="' + id + '" title="Umbenennen">' + IC.edit + '</button>' +
        '<button class="iconbtn" data-act="dupProj" data-id="' + id + '" title="Duplizieren">' + IC.dup + '</button>' +
        '<button class="iconbtn" data-act="delProjAsk" data-id="' + id + '" title="Löschen">' + IC.trash + '</button></div></div>';
    };

    var zeichnen = function () {
      var liste = document.getElementById('pjs-liste'), zahl = document.getElementById('pjs-zahl');
      var feld = document.getElementById('pjs-q');
      if (!liste || !zahl) return;
      var r = suchen(SUCHE.q), total = (SUCHE.index || []).length, q = SUCHE.q.trim();
      SUCHE.treffer = r.liste;
      if (SUCHE.aktiv >= r.liste.length) SUCHE.aktiv = Math.max(0, r.liste.length - 1);
      if (!total) {
        zahl.textContent = '';
        liste.innerHTML = '<p class="muted">Noch keine Projekte.</p>';
      } else if (!r.liste.length) {
        zahl.textContent = 'Kein Projekt gefunden.';
        liste.innerHTML = '<div class="pjs-leer"><span class="muted">Kein Projekt passt zu «' + esc(q) + '».</span>' +
          '<button class="btn" data-act="pjsNeu">' + IC.plus + '«' + esc(q) + '» als neues Projekt anlegen</button></div>';
      } else {
        var maus = window.matchMedia && window.matchMedia('(pointer:fine)').matches;
        zahl.textContent = (q ? r.liste.length + ' von ' + total + (total === 1 ? ' Projekt' : ' Projekten')
          : total + (total === 1 ? ' Projekt' : ' Projekte')) +
          (r.unscharf ? ' · kein genauer Treffer, ähnliche Schreibweise' : '') +
          (maus && r.liste.length > 1 ? ' · ↑↓ wählen, Enter öffnet' : maus ? ' · Enter öffnet' : '');
        liste.innerHTML = r.liste.map(zeileHtml).join('');
      }
      if (feld) {
        if (r.liste.length) feld.setAttribute('aria-activedescendant', 'pjs-z' + SUCHE.aktiv);
        else feld.removeAttribute('aria-activedescendant');
      }
    };

    var aktivZeigen = function () {
      var feld = document.getElementById('pjs-q'), box = feld && feld.closest('.modal-b');
      var zeilen = document.querySelectorAll('#pjs-liste .pjs-z');
      for (var i = 0; i < zeilen.length; i++) {
        zeilen[i].classList.toggle('pjs-aktiv', i === SUCHE.aktiv);
        zeilen[i].setAttribute('aria-selected', String(i === SUCHE.aktiv));
      }
      var z = zeilen[SUCHE.aktiv], kopf = box && box.querySelector('.pjs-kopf');
      if (feld) feld.setAttribute('aria-activedescendant', 'pjs-z' + SUCHE.aktiv);
      if (!z || !box || !kopf) return;
      var zr = z.getBoundingClientRect(), kr = kopf.getBoundingClientRect(), br = box.getBoundingClientRect();
      if (zr.top < kr.bottom) box.scrollTop -= kr.bottom - zr.top;
      else if (zr.bottom > br.bottom) box.scrollTop += zr.bottom - br.bottom;
    };

    var taste = function (e) {
      var n = SUCHE.treffer.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!n) return;
        e.preventDefault();
        SUCHE.aktiv = (SUCHE.aktiv + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        aktivZeigen();
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        var t = SUCHE.treffer[SUCHE.aktiv];
        if (t) ACT.openProj({ dataset: { id: t.p.id } });
        else if (SUCHE.q.trim()) ACT.pjsNeu();
      } else if (e.key === 'Escape' && e.target.value) {
        // erst die Suche leeren, ein zweites Escape schliesst (Handler des Terminplaners)
        e.preventDefault();
        e.stopPropagation();
        e.target.value = '';
        SUCHE.q = '';
        SUCHE.aktiv = 0;
        zeichnen();
      }
    };

    var projektSuche = function (neu) {
      if (neu) SUCHE.q = '';
      SUCHE.aktiv = 0;
      indexBauen();
      openModal('Projekte',
        '<div class="pjs-kopf"><label class="pjs-feld">' + LUPE +
        '<input class="inp" id="pjs-q" type="search" autocomplete="off" spellcheck="false" enterkeyhint="go" ' +
        'role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="pjs-liste" aria-label="Projekt suchen" ' +
        'placeholder="Projekt suchen: Name, Adresse, Bauherrschaft, Firma …" value="' + esc(SUCHE.q) + '"></label>' +
        '<div class="muted small" id="pjs-zahl" aria-live="polite"></div><div id="m-confirm"></div></div>' +
        '<div class="ph-list" id="pjs-liste" role="listbox" aria-label="Projekte"></div>',
        '<span class="sp"></span><button class="btn pri" data-act="newProject">' + IC.plus + 'Neues Projekt</button>');
      var feld = document.getElementById('pjs-q');
      if (!feld) return;
      zeichnen();
      feld.addEventListener('input', function () { SUCHE.q = feld.value; SUCHE.aktiv = 0; zeichnen(); });
      feld.addEventListener('keydown', taste);
      try { feld.focus({ preventScroll: true }); if (feld.value) feld.select(); } catch (e) { /* Fokus egal */ }
    };

    // Wechsel in ein anderes Projekt wie früher über die Auswahlliste: Simulation zurücksetzen,
    // zum heutigen Tag scrollen und ?projekt= nachführen (sonst öffnet ein Neuladen das alte Projekt)
    var altOeffnen = ACT.openProj;
    ACT.openProj = function (el) {
      var id = el && el.dataset && el.dataset.id;
      if (id && id !== S.cur) {
        S.simOpen = false;
        S.sim = null;
        S.scrollToday = true;
        try {
          var u = new URL(location.href);
          if (u.searchParams.has('projekt')) {
            u.searchParams.set('projekt', id);
            history.replaceState(history.state, '', u.pathname + u.search + u.hash);
          }
        } catch (e) { /* ohne URL-API bleibt die Adresse */ }
      }
      return altOeffnen.apply(this, arguments);
    };
    ACT.pjsNeu = function () {
      var name = SUCHE.q.trim();
      ACT.newProject();
      var f = document.getElementById('np-name');
      if (f && !f.value && name) f.value = name;
    };
    // Kopfknopf: neue, leere Suche; «Zurück» (Umbenennen) und nach dem Löschen: Suche bleibt
    ACT.projects = function (el) { projektSuche(!!(el && el.closest && el.closest('#projpick'))); };
    window.projectsModal = function () { projektSuche(false); };
  }
  // ── 5. Feedback 4.11.2026 ─────────────────────────────────────────────
  (function () {
    var stil5 = document.createElement('style');
    stil5.textContent =
      // «Heute» und «Projektdaten ausblenden» tragen die Klasse .ghost, die das Tool auch für den
      // gestrichelten Basisplan-Balken braucht (position:absolute; top:6px): beide Knöpfe landeten oben
      // links unter dem Kopf. Hier wieder normale Knöpfe im Fluss.
      '.btn.ghost{position:relative;top:auto;height:auto;opacity:1;pointer-events:auto;border-style:solid}' +
      // Logo = Weg zur Übersicht der Plattform
      'a.jv-brand{display:block;color:inherit;text-decoration:none;border-radius:10px}' +
      'a.jv-brand:focus-visible{outline:2px solid var(--accent,#BD843A);outline-offset:3px}' +
      // Wochenkopf: nur «KW nn», mittig (die Tage stehen in der Zeile darunter, das Datum im Tooltip)
      '#gscroll .kw-row div{text-align:center}' +
      '#gscroll .kw-row div span{display:none}' +
      // Spalten: Griff am rechten Rand jeder Kopfzelle
      '#gscroll .g-head .g-l>span{position:relative;min-width:0;overflow:visible}' +
      '#gscroll .jv-sp-griff{position:absolute;top:-8px;bottom:-6px;right:-5px;width:9px;cursor:col-resize;z-index:2;touch-action:none}' +
      '#gscroll .jv-sp-griff::after{content:"";position:absolute;top:4px;bottom:2px;left:4px;width:1px;background:var(--line,#ddd);opacity:0;transition:opacity .15s}' +
      '#gscroll .g-head .g-l:hover .jv-sp-griff::after{opacity:1}' +
      '#gscroll .jv-sp-griff:hover::after,#gscroll .jv-sp-griff.jv-zieht::after{opacity:1;background:var(--accent,#BD843A);width:2px;left:3.5px}' +
      'body.jv-sp-ziehen,body.jv-sp-ziehen *{cursor:col-resize!important;user-select:none!important}' +
      // Menü «Spalten»
      '.jv-sp-menue{position:fixed;z-index:2147480000;min-width:230px;max-width:calc(100vw - 16px);padding:6px;border-radius:10px;' +
        'background:var(--surface,#fff);color:var(--fg,#222);border:1px solid var(--line,#ddd);box-shadow:0 10px 30px rgba(0,0,0,.18);font-size:13px}' +
      '.jv-sp-menue h3{margin:4px 8px 6px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted,#777)}' +
      '.jv-sp-menue label,.jv-sp-menue button{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:7px 8px;' +
        'border:0;background:none;border-radius:6px;font:inherit;color:inherit;text-align:left;cursor:pointer}' +
      '.jv-sp-menue label:hover,.jv-sp-menue button:hover,.jv-sp-menue button:focus-visible{background:var(--surface-2,#f3f3f3);outline:none}' +
      '.jv-sp-menue input{margin:0;accent-color:var(--accent,#BD843A)}' +
      '.jv-sp-menue hr{border:0;border-top:1px solid var(--line,#ddd);margin:5px 4px}' +
      '.jv-sp-menue .jv-sp-hinweis{padding:4px 8px 6px;color:var(--muted,#777);font-size:12px}';
    document.head.appendChild(stil5);

    // ── Logo: zur Übersicht der Plattform (gleicher Tab, wie die Lasche «Zurück») ──
    var brand = document.querySelector('header.top .brand');
    if (brand && !brand.closest('a')) {
      var a = document.createElement('a');
      a.className = 'jv-brand';
      a.href = '/';
      a.title = 'Zur Übersicht der JV-Plattform';
      a.setAttribute('aria-label', 'Zur Übersicht der JV-Plattform');
      brand.parentNode.insertBefore(a, brand);
      a.appendChild(brand);
    }

    // ── Spalten der Tabelle: Breite und Sichtbarkeit (je Gerät, je Bildschirmbreite des Tools) ──
    var SP_KEY = 'jv-tp-spalten-v1';
    var SPALTEN = {
      5: { lay: 'n', keys: ['ord', 'name', 'firm', 'dur', 'del'] },
      7: { lay: 'm', keys: ['ord', 'name', 'firm', 'dur', 'end', 'edit', 'del'] },
      9: { lay: 'w', keys: ['ord', 'name', 'firm', 'start', 'dur', 'end', 'prog', 'edit', 'del'] }
    };
    var NAMEN = {
      ord: 'Reihenfolge (▲▼)', name: 'Gewerk / Arbeit', firm: 'Ausführende Firma', start: 'Start',
      dur: 'AT (Arbeitstage)', end: 'Ende', prog: '% (Fortschritt)', edit: 'Bearbeiten', del: 'Löschen'
    };
    var MIN = { name: 90, firm: 70, start: 70 };
    var GRIFF = { name: 1, firm: 1, start: 1, dur: 1, end: 1, prog: 1 };

    var spLesen = function () {
      try { var o = JSON.parse(localStorage.getItem(SP_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; }
      catch (e) { return {}; }
    };
    var SP = spLesen();
    var spSchreiben = function () {
      try { localStorage.setItem(SP_KEY, JSON.stringify(SP)); } catch (e) { /* ohne localStorage gilt es nur bis zum Neuladen */ }
    };
    var spStand = function (lay) {
      var s = SP[lay];
      if (!s || typeof s !== 'object') s = SP[lay] = {};
      if (!s.w || typeof s.w !== 'object') s.w = {};
      if (!Array.isArray(s.aus)) s.aus = [];
      return s;
    };

    // Grundwerte der frisch gezeichneten Tabelle merken (vor jeder eigenen Änderung)
    var grundwerte = function (sc) {
      if (sc._jvSp) return sc._jvSp;
      var cols = (sc.style.getPropertyValue('--cols') || '').trim().split(/\s+/);
      var info = SPALTEN[cols.length];
      var head = sc.querySelector('.g-head .g-l');
      var inner = sc.querySelector('.g-inner');
      var lw = parseFloat(sc.style.getPropertyValue('--lw'));
      if (!info || !head || !inner || !(lw > 0) || head.children.length !== cols.length) return null;
      var gap = parseFloat(getComputedStyle(head).columnGap) || 0;
      var def = cols.map(function (c, i) {
        return i === 1 ? head.children[1].getBoundingClientRect().width : (parseFloat(c) || 0);
      });
      var summe = def.reduce(function (a, b) { return a + b; }, 0);
      sc._jvSp = {
        lay: info.lay, keys: info.keys, cols: cols, def: def, gap: gap,
        rest: lw - summe - gap * (cols.length - 1),        // Innenabstand und Rand der linken Spalte
        W: (parseFloat(inner.style.width) || 0) - lw        // Breite der Zeitachse
      };
      return sc._jvSp;
    };

    var spAnwenden = function (sc) {
      var g = grundwerte(sc);
      if (!g) return;
      var st = spStand(g.lay);
      var tpl = [], lw = g.rest, sichtbar = 0, versteckt = [];
      g.keys.forEach(function (k, i) {
        if (k !== 'name' && st.aus.indexOf(k) >= 0) { versteckt.push(i + 1); return; }
        var w = +st.w[k] > 0 ? Math.max(MIN[k] || 20, Math.min(900, +st.w[k])) : g.def[i];
        tpl.push(k === 'name' ? 'minmax(0,1fr)' : Math.round(w) + 'px');
        lw += w;
        sichtbar++;
      });
      lw = Math.round(lw + g.gap * (sichtbar - 1));
      sc.style.setProperty('--cols', tpl.join(' '));
      sc.style.setProperty('--lw', lw + 'px');
      var inner = sc.querySelector('.g-inner');
      if (inner) inner.style.width = (lw + g.W) + 'px';
      var ov = sc.querySelector('.g-ov');
      if (ov) ov.style.left = lw + 'px';
      // ausgeblendete Spalten: im Kopf und in den Zeilen der Arbeiten (Phasen haben ein eigenes Raster)
      var css = versteckt.map(function (n) {
        return '#gscroll .g-row.task>.g-l>:nth-child(' + n + '),#gscroll .g-head>.g-l>:nth-child(' + n + ')';
      }).join(',');
      var el = document.getElementById('jv-sp-aus');
      if (!el) { el = document.createElement('style'); el.id = 'jv-sp-aus'; document.head.appendChild(el); }
      el.textContent = css ? css + '{display:none!important}' : '';
    };

    var spGriffe = function (sc) {
      var g = grundwerte(sc);
      var head = sc.querySelector('.g-head .g-l');
      if (!g || !head || head._jvGriffe) return;
      head._jvGriffe = true;
      head.title = 'Rand ziehen: Spaltenbreite ändern · Doppelklick auf den Rand: zurücksetzen · Rechtsklick: Spalten ein- und ausblenden';
      g.keys.forEach(function (k, i) {
        var zelle = head.children[i];
        if (!GRIFF[k] || !zelle) return;
        var griff = document.createElement('i');
        griff.className = 'jv-sp-griff';
        griff.setAttribute('aria-hidden', 'true');
        griff.dataset.k = k;
        zelle.appendChild(griff);
      });
      head.addEventListener('pointerdown', function (e) {
        var griff = e.target.closest && e.target.closest('.jv-sp-griff');
        if (!griff || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var k = griff.dataset.k, i = g.keys.indexOf(k);
        var st = spStand(g.lay);
        var start = griff.parentNode.getBoundingClientRect().width, x0 = e.clientX;
        griff.classList.add('jv-zieht');
        document.body.classList.add('jv-sp-ziehen');
        try { griff.setPointerCapture(e.pointerId); } catch (er) { /* ohne Capture */ }
        var bewegen = function (ev) {
          st.w[k] = Math.round(Math.max(MIN[k] || 20, Math.min(900, start + ev.clientX - x0)));
          spAnwenden(sc);
        };
        var fertig = function () {
          griff.classList.remove('jv-zieht');
          document.body.classList.remove('jv-sp-ziehen');
          griff.removeEventListener('pointermove', bewegen);
          griff.removeEventListener('pointerup', fertig);
          griff.removeEventListener('pointercancel', fertig);
          if (Math.abs((st.w[k] || 0) - g.def[i]) < 1) delete st.w[k];
          spSchreiben();
        };
        griff.addEventListener('pointermove', bewegen);
        griff.addEventListener('pointerup', fertig);
        griff.addEventListener('pointercancel', fertig);
      });
      head.addEventListener('dblclick', function (e) {
        var griff = e.target.closest && e.target.closest('.jv-sp-griff');
        if (!griff) return;
        delete spStand(g.lay).w[griff.dataset.k];
        spSchreiben();
        spAnwenden(sc);
      });
      head.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        menueZeigen(sc, e.clientX, e.clientY);
      });
    };

    var menue = null;
    var menueZu = function () {
      if (!menue) return;
      menue.remove();
      menue = null;
      document.removeEventListener('pointerdown', ausserhalb, true);
      document.removeEventListener('keydown', taste5, true);
      window.removeEventListener('resize', menueZu);
      window.removeEventListener('scroll', menueZu, true);
    };
    var ausserhalb = function (e) { if (menue && !menue.contains(e.target)) menueZu(); };
    var taste5 = function (e) { if (e.key === 'Escape') { e.stopPropagation(); menueZu(); } };

    var menueZeigen = function (sc, x, y) {
      menueZu();
      var g = grundwerte(sc);
      if (!g) return;
      var st = spStand(g.lay);
      menue = document.createElement('div');
      menue.className = 'jv-sp-menue';
      menue.setAttribute('role', 'menu');
      var html = '<h3>Spalten anzeigen</h3>';
      g.keys.forEach(function (k) {
        if (k === 'name') return;
        html += '<label role="menuitemcheckbox"><input type="checkbox" data-k="' + k + '"' +
          (st.aus.indexOf(k) < 0 ? ' checked' : '') + '>' + esc(NAMEN[k]) + '</label>';
      });
      html += '<hr><button type="button" data-a="alle">Alle Spalten zeigen</button>' +
        '<button type="button" data-a="breite">Spaltenbreiten zurücksetzen</button>' +
        '<div class="jv-sp-hinweis">Breite: Rand im Kopf ziehen. Gilt auf diesem Gerät.</div>';
      menue.innerHTML = html;
      document.body.appendChild(menue);
      var r = menue.getBoundingClientRect();
      menue.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
      menue.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
      menue.addEventListener('change', function (e) {
        var k = e.target.dataset && e.target.dataset.k;
        if (!k) return;
        st.aus = st.aus.filter(function (x) { return x !== k; });
        if (!e.target.checked) st.aus.push(k);
        spSchreiben();
        spAnwenden(document.getElementById('gscroll') || sc);
      });
      menue.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('button[data-a]');
        if (!b) return;
        if (b.dataset.a === 'alle') st.aus = [];
        else st.w = {};
        spSchreiben();
        spAnwenden(document.getElementById('gscroll') || sc);
        menueZu();
      });
      setTimeout(function () {
        document.addEventListener('pointerdown', ausserhalb, true);
        document.addEventListener('keydown', taste5, true);
        window.addEventListener('resize', menueZu);
        window.addEventListener('scroll', menueZu, true);
      }, 0);
      var erstes = menue.querySelector('input');
      if (erstes) try { erstes.focus({ preventScroll: true }); } catch (e) { /* Fokus egal */ }
    };

    // ── Text der Balken: mit Wochenende (mehrere Stücke) oder zu lang für den Balken → danach ──
    var balkenText = function (sc) {
      sc.querySelectorAll('.g-row.task .g-tl').forEach(function (tl) {
        var stuecke = tl.querySelectorAll('.bar[data-bar]');
        if (!stuecke.length || tl.querySelector('.bar-out')) return;
        var mitText = null;
        stuecke.forEach(function (b) { var s = b.querySelector('span'); if (s && s.innerHTML) mitText = s; });
        if (!mitText) return;
        var abgeschnitten = mitText.scrollWidth > mitText.clientWidth + 1;
        if (stuecke.length < 2 && !abgeschnitten) return;
        var letztes = stuecke[stuecke.length - 1];
        var rechts = (parseFloat(letztes.style.left) || 0) + (parseFloat(letztes.style.width) || 0);
        var out = document.createElement('div');
        out.className = 'bar-out';
        out.dataset.barl = letztes.dataset.bar;
        out.style.left = (rechts + 6) + 'px';
        out.innerHTML = mitText.innerHTML;
        mitText.innerHTML = '';
        tl.appendChild(out);
      });
    };

    var nachRender = function () {
      var sc = document.getElementById('gscroll');
      if (!sc) { menueZu(); return; }
      spAnwenden(sc);
      spGriffe(sc);
      balkenText(sc);
    };

    if (typeof render === 'function') {
      var altRender = render;
      render = function () {
        var r = altRender.apply(this, arguments);
        try { nachRender(); } catch (e) { console.error('plattform.js: Nachbearbeitung der Tabelle', e); }
        return r;
      };
      try { nachRender(); } catch (e) { /* noch nichts gezeichnet */ }
    }
  })();
})();
