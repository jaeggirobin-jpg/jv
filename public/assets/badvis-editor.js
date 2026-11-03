// badvis-editor.js — Badvisualisierungen in der Plattform erstellen, bearbeiten und löschen
//
// Robin (3.11.2026): «bei der badvisualisierung gibt es die option eine neue zu erstellen nicht».
// Bisher kamen Visualisierungen nur aus Michis Claude-Tool (Daten übernehmen). Dieser Editor schreibt
// dasselbe Dokument, das das Tool und der Kundenlink lesen (tool_docs badvis/objekte/<id>):
//   { kunde, raum, titel, datum, lead, hinweis, aspect: '4/3' | '3/4', start (Index der ersten Farbe),
//     varianten: [{ id, name, swatch, glossy }], spec: [[Bauteil, Wert als HTML]],
//     bilder: { vorher, 'room-<variante>', 'mock-<variante>' } (Asset-IDs im privaten Bucket «tools»),
//     projektId, reihenfolge, erstellt, geaendert }
// Felder, die der Editor nicht kennt, bleiben beim Speichern erhalten.
//
// Ansichten (Router in plattform.js):
//   #/visualisierung/neu[?projekt=<id>][&von=tool]   neue Visualisierung
//   #/visualisierung/<id>[?von=tool]                 bestehende bearbeiten
// «von=tool»: geöffnet aus der Kopfzeile des Tools (tools/badvisualisierungen/daten.js), zurück geht es dorthin.
//
// Fotos zeichnet der Browser neu (JPEG, längste Seite höchstens 2000 px). Dabei fallen die Kameradaten
// weg (Ort, Gerät, Aufnahmezeit), bevor etwas hochgeladen wird. Hochgeladen wird erst beim Speichern;
// misslingt es, werden die neuen Fotos wieder gelöscht (ohne Verbindung nicht: vielleicht ist das Dokument
// doch gespeichert, der nächste Versuch nimmt dieselben Fotos). Ersetzte Fotos löscht der Editor nach dem
// Speichern, wenn kein anderes Objekt sie nutzt. Löschen der Visualisierung: tool-db.js nimmt Kundenlinks
// und Fotos mit.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var wurzel = $('visInhalt');
  var zurueckLink = $('visZurueck');
  var bridge = window.JVBridge;
  if (!wurzel || !bridge) return;

  var ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
  var VAR_RE = /^[A-Za-z0-9_-]{1,60}$/;
  var ASSET_RE = /^[a-f0-9]{32}$/;
  var HEX_RE = /^#[0-9a-fA-F]{6}$/;
  var BILD_RE = /^(vorher|(room|mock)-.+)$/;   // Bilder, die der Editor verwaltet (andere bleiben unberührt)
  var ASPECT_RE = /^\d{1,2}\/\d{1,2}$/;
  var SLOT_RE = /^(room|mock)-(\d+)$/;
  var MAX_VARIANTEN = 24;
  var MAX_ZEILEN = 30;
  var MAX_DATEI = 40 * 1024 * 1024;
  var MAX_PX = 2000;
  var QUALITAET = 0.85;
  var ABWEICHUNG = 0.03;          // Seitenverhältnis: ab 3 % Unterschied ein Hinweis
  var GLEICHZEITIG = 3;           // Fotos, die gleichzeitig hochgeladen werden
  var HINWEIS_VORGABE = 'Visualisierung zur Orientierung. Farben, Materialien und Proportionen können in der Ausführung abweichen.';
  var LAENGE = { kunde: 120, raum: 80, titel: 120, datum: 40, lead: 600, hinweis: 600 };
  var RAEUME = ['Badezimmer', 'Dusche/WC', 'Gäste-WC', 'Küche', 'Waschküche'];
  var BAUTEILE = ['Keramik', 'Waschtisch', 'Badewanne', 'Dusche', 'WC', 'Armaturen', 'Wandplatten', 'Bodenplatten',
    'Möbel', 'Spiegel', 'Beleuchtung', 'Farbe'];
  var FORMAT_FEHLER = 'Dieses Format kann der Browser nicht öffnen. Bitte als JPG oder PNG speichern ' +
    '(iPhone: Einstellungen › Kamera › Formate › «Maximale Kompatibilität»).';

  var S = null;                 // Zustand der offenen Ansicht (null = keine offen)
  var lauf = 0;                 // zählt jedes Öffnen und Schliessen: späte Antworten einer alten Ansicht verwerfen
  var zaehler = 0;              // Schlüssel für Farbvarianten und Zeilen (bleiben beim Verschieben gleich)
  var letzterArg = '';
  var naechsteMeldung = null;   // { id, text, art }: nach dem Speichern ohne Projekt in der neuen Ansicht zeigen

  // ── Hilfen ────────────────────────────────────────────────────────────
  function P() { return window.JVP; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function text(x) { return typeof x === 'string' ? x : x == null ? '' : String(x); }
  function toast(t) { if (window.JVFeedback && window.JVFeedback.meldung) window.JVFeedback.meldung(t); }
  function netzFehler(e) { return !!e && !e.code && e.name === 'TypeError'; }   // fetch ohne Verbindung
  function monatJahr() { return new Date().toLocaleDateString('de-CH', { month: 'long', year: 'numeric' }); }

  // Farbfeld (input type="color") braucht #rrggbb
  function farbeFuerFeld(s) {
    s = text(s).trim();
    if (HEX_RE.test(s)) return s.toLowerCase();
    var m = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(s);
    return m ? ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase() : '#cccccc';
  }

  // Wert einer Ausführungs-Zeile (HTML wie im Tool): Text und erstes Farbmuster. DOMParser führt nichts aus.
  function specLesen(html) {
    var doc = new DOMParser().parseFromString('<!doctype html><body>' + text(html), 'text/html');
    Array.prototype.forEach.call(doc.querySelectorAll('br'), function (br) { br.replaceWith(' '); });
    var sw = doc.querySelector('span.sw');
    var m = sw && /background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6})(?![0-9a-fA-F])/.exec(sw.getAttribute('style') || '');
    return { text: doc.body.textContent.replace(/\s+/g, ' ').trim(), farbe: m ? farbeFuerFeld(m[1]) : null };
  }

  // Kennung einer neuen Farbvariante aus dem Namen («Weiss matt» → «weiss-matt»)
  function kennung(name) {
    return text(name).toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  }

  function formatName(a) {
    return a === '4/3' ? 'quer 4:3' : a === '3/4' ? 'hoch 3:4' : String(a).replace('/', ':');
  }
  function verhaeltnis(a) {
    var t = String(a).split('/');
    var r = Number(t[0]) / Number(t[1]);
    return isFinite(r) && r > 0 ? r : null;
  }
  function abweichend(r, ziel) { return !!(r && ziel) && Math.abs(r / ziel - 1) > ABWEICHUNG; }

  // ── Zustand ───────────────────────────────────────────────────────────
  function bildAus(asset) {
    return ASSET_RE.test(text(asset)) ? { asset: asset, blob: null, url: '/_blob/' + asset, breite: 0, hoehe: 0, fehlt: false } : null;
  }
  function variante(k) {
    for (var i = 0; i < S.varianten.length; i++) if (S.varianten[i].k === k) return S.varianten[i];
    return null;
  }
  function zeile(k) {
    for (var i = 0; i < S.spec.length; i++) if (S.spec[i].k === k) return S.spec[i];
    return null;
  }
  function varianteVon(el) { var c = el.closest('[data-variante]'); return c ? variante(+c.getAttribute('data-variante')) : null; }
  function zeileVon(el) { var c = el.closest('[data-zeile]'); return c ? zeile(+c.getAttribute('data-zeile')) : null; }
  function bildVon(slot) {
    if (slot === 'vorher') return S.vorher;
    var m = SLOT_RE.exec(slot);
    var v = m && variante(+m[2]);
    return v ? v[m[1]] : null;
  }
  function bildSetzen(slot, b) {
    if (slot === 'vorher') { S.vorher = b; return true; }
    var m = SLOT_RE.exec(slot);
    var v = m && variante(+m[2]);
    if (!v) return false;
    v[m[1]] = b;
    return true;
  }
  function slotGibt(slot) {
    var m = SLOT_RE.exec(slot);
    return slot === 'vorher' || !!(m && variante(+m[2]));
  }
  function alleBilder(s) {
    var l = [];
    if (s.vorher) l.push(s.vorher);
    s.varianten.forEach(function (v) { if (v.room) l.push(v.room); if (v.mock) l.push(v.mock); });
    return l;
  }
  function bilderIds(daten) {
    var b = daten && daten.bilder && typeof daten.bilder === 'object' ? daten.bilder : {};
    return Object.keys(b).map(function (k) { return b[k]; }).filter(function (x) { return ASSET_RE.test(text(x)); });
  }

  function kundeVorschlag(pid) {
    var p = P();
    if (!pid) return '';
    var k = p.kundenVon(pid)[0];
    if (k) return p.kundeName(k);
    var pr = p.daten().projekte[pid];
    return text(pr && pr.client);
  }
  function neueVariante() {
    return { k: ++zaehler, id: null, orig: null, name: '', swatch: '#e8e4dc', swatchOrig: '', swatchGeaendert: true, glossy: false, room: null, mock: null };
  }
  function neueZeile() {
    return { k: ++zaehler, label: '', text: '', farbeAn: false, farbe: '#cccccc', orig: null, wertGeaendert: true };
  }

  function zustandAus(id, alt, von, projektVorgabe) {
    var D = P().daten();
    var s = {
      id: id, neueId: 'bv-' + P().neueId(), alt: alt, von: von, projektVorgabe: projektVorgabe,
      f: {}, kundeAuto: !alt, aspektAuto: !alt,
      vorher: null, varianten: [], startK: null, spec: [], urls: [], dirty: false, laeuft: false
    };
    if (alt) {
      ['kunde', 'raum', 'titel', 'datum', 'lead', 'hinweis'].forEach(function (k) { s.f[k] = text(alt[k]); });
      s.f.projektId = ID_RE.test(text(alt.projektId)) ? alt.projektId : '';
      s.f.aspect = ASPECT_RE.test(text(alt.aspect)) ? alt.aspect : '4/3';
      var b = alt.bilder && typeof alt.bilder === 'object' ? alt.bilder : {};
      s.vorher = bildAus(b.vorher);
      var vergeben = {};
      (Array.isArray(alt.varianten) ? alt.varianten : []).forEach(function (v) {
        if (!v || typeof v !== 'object') return;
        var vid = text(v.id);
        // Ungültige oder doppelte Kennung: bekommt beim Speichern eine neue (das Tool zeigt sie sonst nicht)
        var gueltig = VAR_RE.test(vid) && !vergeben[vid];
        if (gueltig) vergeben[vid] = true;
        s.varianten.push({
          k: ++zaehler, id: gueltig ? vid : null, orig: v,
          name: text(v.name), swatch: farbeFuerFeld(v.swatch), swatchOrig: text(v.swatch), swatchGeaendert: false,
          glossy: !!v.glossy, room: bildAus(b['room-' + vid]), mock: bildAus(b['mock-' + vid])
        });
      });
      var st = parseInt(alt.start, 10) || 0;
      if (s.varianten[st]) s.startK = s.varianten[st].k;
      (Array.isArray(alt.spec) ? alt.spec : []).forEach(function (z) {
        if (!Array.isArray(z) || z.length < 2) return;
        var w = specLesen(z[1]);
        s.spec.push({ k: ++zaehler, label: text(z[0]), text: w.text, farbeAn: !!w.farbe, farbe: w.farbe || '#cccccc', orig: text(z[1]), wertGeaendert: false });
      });
    } else {
      var pid = projektVorgabe && D.projekte[projektVorgabe] ? projektVorgabe : '';
      s.f = { projektId: pid, kunde: kundeVorschlag(pid), raum: '', titel: '', datum: monatJahr(), lead: '', hinweis: HINWEIS_VORGABE, aspect: '4/3' };
      s.spec.push(neueZeile());
    }
    if (!s.varianten.length) s.varianten.push(neueVariante());
    if (s.startK === null) s.startK = s.varianten[0].k;
    return s;
  }

  // ── Zurück: ins Tool, zum Projekt oder zur Projektliste ────────────────
  function zurueckZiel(s) {
    var D = P().daten();
    if (s && s.von === 'tool') {
      return { href: '/tools/badvisualisierungen/' + (s.id ? '#' + encodeURIComponent(s.id) : ''), text: '← Zurück zu den Badvisualisierungen', tool: true };
    }
    var pid = s ? (s.projektVorgabe || (s.alt && s.alt.projektId) || '') : '';
    if (pid && D.projekte[pid]) {
      return { href: '#/projekt/' + encodeURIComponent(pid), text: '← Zurück zum Projekt «' + (D.projekte[pid].name || 'Ohne Namen') + '»', tool: false };
    }
    return { href: '#/projekte', text: '← Alle Projekte', tool: false };
  }
  function zurueckSetzen(z) {
    if (!zurueckLink) return;
    zurueckLink.setAttribute('href', z.href);
    zurueckLink.textContent = z.text;
    // Ins Tool zurück: plattform.js soll dort keine Lasche «Zurück zum Bearbeiten» anbieten
    if (z.tool) zurueckLink.setAttribute('data-ohne-zurueck', '');
    else zurueckLink.removeAttribute('data-ohne-zurueck');
  }

  // ── Öffnen ────────────────────────────────────────────────────────────
  function zeigen(arg) {
    schliessen();
    letzterArg = arg || '';
    var meinLauf = lauf;
    var teile = String(arg || '').split('?');
    var id = teile[0] || 'neu';
    var q = new URLSearchParams(teile.slice(1).join('?'));
    var von = q.get('von') === 'tool' ? 'tool' : '';
    var projektVorgabe = ID_RE.test(q.get('projekt') || '') ? q.get('projekt') : '';
    zurueckSetzen(zurueckZiel({ von: von, id: id === 'neu' ? null : id, projektVorgabe: projektVorgabe, alt: null }));
    wurzel.innerHTML = '<p class="jvp-leer">Wird geladen …</p>';
    var p = P();
    var auftraege = [
      p.laden(['objekte'], true),
      p.laden(['projekte']).catch(function () { return null; })   // ohne Projekte: Auswahl bleibt leer
    ];
    if (p.darf('kunden')) auftraege.push(p.laden(['kunden', 'links']).catch(function () { return null; }));
    Promise.all(auftraege).then(function () {
      if (meinLauf !== lauf) return;
      var D = p.daten();
      var neu = id === 'neu';
      var alt = neu ? null : D.objekte[id];
      if (!neu && (!ID_RE.test(id) || !alt)) {
        wurzel.innerHTML = '<div class="card"><h2>Visualisierung nicht gefunden</h2>' +
          '<p class="jvp-leer">Vielleicht wurde sie gelöscht.</p>' +
          '<div class="jvp-knopfreihe"><a class="jvp-knopf jvp-knopf--primaer" href="#/visualisierung/neu' + (von ? '?von=tool' : '') + '">＋ Neue Visualisierung</a></div></div>';
        return;
      }
      S = zustandAus(neu ? null : id, alt, von, projektVorgabe);
      rendern();
      if (naechsteMeldung && naechsteMeldung.id === S.id) meldungZeigen(naechsteMeldung.text, naechsteMeldung.art);
      naechsteMeldung = null;
    }, function (e) {
      if (meinLauf !== lauf) return;
      wurzel.innerHTML = '<div class="card"><h2>Daten konnten nicht geladen werden</h2>' +
        '<p class="muted">' + esc(netzFehler(e) ? 'Keine Verbindung zum Server.' : e.message) + '</p>' +
        '<div class="jvp-knopfreihe"><button type="button" class="jvp-knopf" data-bve="nochmals">Nochmals versuchen</button></div></div>';
    });
  }

  function schliessen() {
    lauf++;
    if (S) S.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* schon frei */ } });
    S = null;
  }

  // Darf die Ansicht verlassen werden? seite = ganze Seite wird verlassen (Tool, Neuladen)
  function verlassen(seite) {
    if (!S) return true;
    if (S.laeuft) {
      if (seite) {
        alert('Die Visualisierung wird noch gespeichert. Bitte einen Moment warten.');
        return false;
      }
      if (!confirm('Die Visualisierung wird noch gespeichert. Ansicht trotzdem wechseln? Das Speichern läuft weiter.')) return false;
      schliessen();
      return true;
    }
    if (S.dirty && !confirm('Änderungen an der Visualisierung verwerfen?')) return false;
    schliessen();
    return true;
  }

  // ── Darstellung ───────────────────────────────────────────────────────
  function rendern() {
    var s = S;
    var neu = !s.id;
    zurueckSetzen(zurueckZiel(s));
    document.title = (neu ? 'Neue Badvisualisierung' : 'Badvisualisierung bearbeiten') + ' · JV-Plattform';
    wurzel.innerHTML =
      '<form id="bveForm" class="bve" novalidate autocomplete="off">' +
        '<fieldset id="bveAlles" class="bve-alles">' +
          '<header class="jvp-titel jvp-titel--zeile"><div>' +
            '<span class="eb">Badvisualisierung · ' + (neu ? 'neu' : 'bearbeiten') + '</span>' +
            '<h1>' + esc(neu ? 'Neue Badvisualisierung' : (s.f.titel || s.f.raum || 'Badvisualisierung')) + '</h1>' +
            '<p class="sub">Vorher-Foto, je Farbe ein Nachher-Foto und die Angaben zur Ausführung. ' +
              'So erscheint sie im Tool und im Kundenlink.</p></div>' +
            (!neu && s.von !== 'tool' ? '<div class="jvp-titel__knoepfe"><a class="jvp-knopf" href="/tools/badvisualisierungen/#' +
              encodeURIComponent(s.id) + '">Im Tool ansehen</a></div>' : '') +
          '</header>' +
          abschnittAngaben() + abschnittVorher() + abschnittVarianten() + abschnittAusfuehrung() +
        '</fieldset>' +
        fussHtml() +
      '</form>' + listenHtml();
  }

  function feldText(k, label, pflicht, platzhalter, liste) {
    var id = 'bve-' + k;
    return '<div class="bve-feld"><label for="' + id + '">' + esc(label) + (pflicht ? ' *' : '') + '</label>' +
      '<input type="text" id="' + id + '" data-f="' + k + '" value="' + esc(S.f[k]) + '" maxlength="' + LAENGE[k] + '"' +
      (platzhalter ? ' placeholder="' + esc(platzhalter) + '"' : '') + (liste ? ' list="' + liste + '"' : '') +
      (pflicht ? ' aria-required="true"' : '') + ' autocomplete="off"></div>';
  }
  function feldLang(k, label, hilfe) {
    var id = 'bve-' + k;
    return '<div class="bve-feld bve-feld--breit"><label for="' + id + '">' + esc(label) + '</label>' +
      '<textarea id="' + id + '" data-f="' + k + '" rows="3" maxlength="' + LAENGE[k] + '"' +
      (hilfe ? ' aria-describedby="' + id + '-h"' : '') + '>' + esc(S.f[k]) + '</textarea>' +
      (hilfe ? '<p class="muted bve-hilfe" id="' + id + '-h">' + esc(hilfe) + '</p>' : '') + '</div>';
  }
  function wahl(name, wert, label, an) {
    return '<label class="bve-wahl"><input type="radio" name="' + name + '" value="' + esc(wert) + '"' + (an ? ' checked' : '') + '> ' + esc(label) + '</label>';
  }

  function abschnittAngaben() {
    return '<section class="card bve-abschnitt" aria-labelledby="bveA1"><h2 id="bveA1">1. Angaben</h2>' +
      '<div class="bve-raster">' +
        '<div class="bve-feld bve-feld--breit"><label for="bveProjekt">Projekt</label>' +
          '<select id="bveProjekt" aria-describedby="bveProjektH">' + P().projektOptionen(S.f.projektId) + '</select>' +
          '<p class="muted bve-hilfe" id="bveProjektH">Für einen Kundenlink muss die Visualisierung einem Projekt zugeordnet sein.</p></div>' +
        feldText('kunde', 'Kunde', true, 'z. B. Familie Muster') +
        feldText('raum', 'Raum', true, 'z. B. Badezimmer', 'bveRaeume') +
        feldText('titel', 'Titel', true, 'z. B. Neues Bad im Obergeschoss') +
        feldText('datum', 'Datum', true, 'z. B. ' + monatJahr()) +
        feldLang('lead', 'Einleitung', 'Kurzer Text unter dem Titel, freiwillig.') +
      '</div></section>';
  }

  function abschnittVorher() {
    var a = S.f.aspect;
    var anders = a !== '4/3' && a !== '3/4';
    return '<section class="card bve-abschnitt" aria-labelledby="bveA2"><h2 id="bveA2">2. Vorher-Foto</h2>' +
      '<p class="muted">So sieht der Raum heute aus. Die Nachher-Fotos brauchen dieselbe Sicht und dasselbe Seitenverhältnis.</p>' +
      slotHtml('vorher') +
      '<fieldset class="bve-format"><legend>Format der Ansicht</legend><div class="bve-wahlen">' +
        wahl('bveFormat', '4/3', 'Quer (4:3)', a === '4/3') + wahl('bveFormat', '3/4', 'Hoch (3:4)', a === '3/4') +
        (anders ? wahl('bveFormat', a, 'Wie bisher (' + formatName(a) + ')', true) : '') +
      '</div></fieldset></section>';
  }

  function abschnittVarianten() {
    return '<section class="card bve-abschnitt" aria-labelledby="bveA3"><h2 id="bveA3">3. Nachher je Farbe</h2>' +
      '<p class="muted">Je Farbvariante ein Nachher-Foto. Ab zwei Varianten wählt der Kunde die Farbe im Tool und im Kundenlink.</p>' +
      '<div id="bveVarianten" class="bve-varianten">' + variantenHtml() + '</div>' +
      '<div class="jvp-knopfreihe bve-reihe"><button type="button" class="jvp-knopf" data-bve="variante-neu" id="bveVarianteNeu"' +
        (S.varianten.length >= MAX_VARIANTEN ? ' disabled' : '') + '>＋ Weitere Farbvariante</button></div>' +
      '</section>';
  }

  function variantenHtml() {
    var n = S.varianten.length;
    return S.varianten.map(function (v, i) { return varianteHtml(v, i, n); }).join('');
  }

  function varianteKopf(v, i) {
    return 'Farbvariante ' + (i + 1) + (v.name.trim() ? ' · ' + v.name.trim() : '');
  }

  function varianteHtml(v, i, n) {
    var nr = i + 1;
    var mehrere = n > 1;
    var kn = function (aktion, zeichen, label, aus) {
      return '<button type="button" class="jvp-knopf jvp-knopf--klein jvp-knopf--leise" data-bve="' + aktion + '" aria-label="' + esc(label) + '"' + (aus ? ' disabled' : '') + '>' + zeichen + '</button>';
    };
    return '<div class="bve-variante" role="group" aria-labelledby="bveV' + v.k + '" data-variante="' + v.k + '">' +
      '<div class="bve-variante__kopf"><h3 id="bveV' + v.k + '">' + esc(varianteKopf(v, i)) + '</h3>' +
        '<div class="bve-variante__knoepfe">' +
          (mehrere ? '<label class="bve-wahl"><input type="radio" name="bveStart" value="' + v.k + '"' + (S.startK === v.k ? ' checked' : '') + '> Wird zuerst gezeigt</label>' : '') +
          (mehrere ? kn('var-hoch', '↑', 'Farbvariante ' + nr + ' nach oben', i === 0) + kn('var-runter', '↓', 'Farbvariante ' + nr + ' nach unten', i === n - 1) : '') +
          (mehrere ? kn('var-weg', 'Entfernen', 'Farbvariante ' + nr + ' entfernen', false) : '') +
        '</div></div>' +
      '<div class="bve-raster">' +
        '<div class="bve-feld"><label for="bveVN' + v.k + '">Name' + (mehrere ? ' *' : '') + '</label>' +
          '<input type="text" id="bveVN' + v.k + '" data-v="name" value="' + esc(v.name) + '" maxlength="60" placeholder="z. B. Pergamon"' +
          (mehrere ? ' aria-required="true"' : '') + ' autocomplete="off"></div>' +
        '<div class="bve-feld"><label for="bveVF' + v.k + '">Farbmuster</label><div class="bve-farbe">' +
          '<input type="color" id="bveVF' + v.k + '" data-v="swatch" value="' + esc(v.swatch) + '">' +
          '<label class="bve-wahl"><input type="checkbox" data-v="glossy"' + (v.glossy ? ' checked' : '') + '> glänzend</label></div></div>' +
        (mehrere ? '' : '<p class="muted bve-hilfe bve-feld--breit">Name und Farbmuster erscheinen erst ab zwei Farbvarianten.</p>') +
      '</div>' +
      '<div class="bve-slots">' + slotHtml('room-' + v.k) + slotHtml('mock-' + v.k) + '</div>' +
    '</div>';
  }

  function abschnittAusfuehrung() {
    return '<section class="card bve-abschnitt" aria-labelledby="bveA4"><h2 id="bveA4">4. Ausführung und Hinweis</h2>' +
      '<p class="muted">Angaben neben dem Bild, z. B. Keramik, Armaturen, Platten. Leere Zeilen fallen weg.</p>' +
      '<div id="bveZeilen" class="bve-zeilen">' + zeilenHtml() + '</div>' +
      '<div class="jvp-knopfreihe bve-reihe"><button type="button" class="jvp-knopf jvp-knopf--klein" data-bve="zeile-neu" id="bveZeileNeu"' +
        (S.spec.length >= MAX_ZEILEN ? ' disabled' : '') + '>＋ Zeile</button></div>' +
      '<div class="bve-raster">' + feldLang('hinweis', 'Hinweis', 'Steht klein unter der Visualisierung.') + '</div>' +
      '</section>';
  }

  function zeilenHtml() {
    var n = S.spec.length;
    return S.spec.map(function (z, i) {
      var nr = i + 1;
      var kn = function (aktion, zeichen, label, aus) {
        return '<button type="button" class="jvp-knopf jvp-knopf--klein jvp-knopf--leise" data-bve="' + aktion + '" aria-label="' + esc(label) + '"' + (aus ? ' disabled' : '') + '>' + zeichen + '</button>';
      };
      return '<div class="bve-zeile" role="group" aria-label="Zeile ' + nr + '" data-zeile="' + z.k + '">' +
        '<div class="bve-zfeld"><label class="bve-zlabel" for="bveZL' + z.k + '">Bauteil</label>' +
          '<input type="text" id="bveZL' + z.k + '" data-z="label" value="' + esc(z.label) + '" maxlength="60" list="bveBauteile" placeholder="z. B. Keramik" autocomplete="off"></div>' +
        '<div class="bve-zfeld"><label class="bve-zlabel" for="bveZT' + z.k + '">Beschreibung</label>' +
          '<input type="text" id="bveZT' + z.k + '" data-z="text" value="' + esc(z.text) + '" maxlength="300" placeholder="z. B. Pergamon, glänzend" autocomplete="off"></div>' +
        '<div class="bve-zfarbe"><label class="bve-wahl"><input type="checkbox" data-z="farbeAn"' + (z.farbeAn ? ' checked' : '') + '> Farbmuster</label>' +
          '<input type="color" data-z="farbe" value="' + esc(z.farbe) + '" aria-label="Farbmuster Zeile ' + nr + '"' + (z.farbeAn ? '' : ' disabled') + '></div>' +
        '<div class="bve-zknoepfe">' + kn('zeile-hoch', '↑', 'Zeile ' + nr + ' nach oben', i === 0) +
          kn('zeile-runter', '↓', 'Zeile ' + nr + ' nach unten', i === n - 1) + kn('zeile-weg', '✕', 'Zeile ' + nr + ' entfernen', false) + '</div>' +
      '</div>';
    }).join('');
  }

  function fussHtml() {
    var z = zurueckZiel(S);
    return '<div class="bve-fuss">' +
      '<div class="bve-meldung" id="bveMeldung" aria-live="polite"></div>' +
      '<div class="bve-fuss__knoepfe">' +
        (S.id ? '<button type="button" class="jvp-knopf jvp-knopf--leise jvp-knopf--gefahr" data-bve="loeschen">Löschen</button>' : '') +
        '<a class="jvp-knopf" id="bveAbbrechen" href="' + esc(z.href) + '"' + (z.tool ? ' data-ohne-zurueck' : '') + '>Abbrechen</a>' +
        '<button type="submit" class="jvp-knopf jvp-knopf--primaer" id="bveSpeichern">Speichern</button>' +
      '</div></div>';
  }

  // Vorschläge für Raum und Bauteil: feste Liste und was in anderen Visualisierungen steht
  function listenHtml() {
    var D = P().daten();
    var raeume = RAEUME.slice(), bauteile = BAUTEILE.slice();
    Object.keys(D.objekte).forEach(function (k) {
      var o = D.objekte[k];
      var r = text(o.raum).trim();
      if (r && raeume.indexOf(r) < 0) raeume.push(r);
      (Array.isArray(o.spec) ? o.spec : []).forEach(function (z) {
        var l = Array.isArray(z) ? text(z[0]).trim() : '';
        if (l && bauteile.indexOf(l) < 0) bauteile.push(l);
      });
    });
    var opt = function (x) { return '<option value="' + esc(x) + '"></option>'; };
    return '<datalist id="bveRaeume">' + raeume.slice(0, 60).map(opt).join('') + '</datalist>' +
      '<datalist id="bveBauteile">' + bauteile.slice(0, 80).map(opt).join('') + '</datalist>';
  }

  // ── Fotos ─────────────────────────────────────────────────────────────
  function slotOptionen(slot) {
    if (slot === 'vorher') return { titel: 'Vorher-Foto', pflicht: true, gross: true, name: 'Vorher-Foto' };
    var m = SLOT_RE.exec(slot);
    var nr = S.varianten.indexOf(variante(+m[2])) + 1;
    if (m[1] === 'room') return { titel: 'Nachher-Foto', pflicht: true, name: 'Nachher-Foto der Farbvariante ' + nr };
    return { titel: 'Mockup der Teile', freiwillig: true, name: 'Mockup der Farbvariante ' + nr };
  }

  function infoFuer(slot) {
    var b = bildVon(slot);
    var mock = slot.indexOf('mock-') === 0;
    if (!b) return { text: mock ? 'Teile in dieser Farbe, wird im Format 4:3 gezeigt.' : '', art: '' };
    if (b.fehlt) return { text: 'Das Foto konnte nicht geladen werden. Bitte prüfen oder neu wählen.', art: 'warn' };
    var teile = [];
    var warnung = '';
    if (b.breite && b.hoehe) {
      teile.push(b.breite + ' × ' + b.hoehe + ' px');
      var r = b.breite / b.hoehe;
      if (slot === 'vorher') {
        if (abweichend(r, verhaeltnis(S.f.aspect))) warnung = 'Wird im Format ' + formatName(S.f.aspect) + ' gezeigt, Ränder fallen weg.';
      } else if (mock) {
        if (abweichend(r, 4 / 3)) warnung = 'Wird im Format 4:3 gezeigt, Ränder fallen weg.';
      } else {
        var v = S.vorher;
        if (v && v.breite && v.hoehe && abweichend(r, v.breite / v.hoehe)) {
          warnung = 'Anderes Seitenverhältnis als das Vorher-Foto: Vorher und Nachher liegen im Regler nicht genau übereinander.';
        }
      }
    }
    if (b.blob) teile.push('noch nicht gespeichert');
    return { text: teile.join(' · ') + (warnung ? (teile.length ? '. ' : '') + warnung : ''), art: warnung ? 'warn' : '' };
  }

  function slotHtml(slot) {
    var o = slotOptionen(slot);
    var b = bildVon(slot);
    var fid = 'bveF-' + slot;
    var info = infoFuer(slot);
    var bild = b && !b.fehlt
      ? '<img data-bve-bild src="' + esc(b.url) + '" alt="' + esc(o.name) + '">'
      : '<span class="bve-slot__leer">' + (b ? 'Foto nicht gefunden.' : 'Noch kein Foto.') + '<span class="bve-ziehen"> Hierher ziehen oder wählen.</span></span>';
    return '<div class="bve-slot' + (o.gross ? ' bve-slot--gross' : '') + '" data-slot="' + slot + '">' +
      '<div class="bve-slot__titel">' + esc(o.titel) + (o.pflicht ? ' *' : '') + (o.freiwillig ? ' <span class="muted">(freiwillig)</span>' : '') + '</div>' +
      '<div class="bve-slot__bild">' + bild + '</div>' +
      '<div class="bve-slot__knoepfe">' +
        '<input type="file" accept="image/*" id="' + fid + '" class="sr" data-bve-datei aria-label="' + esc(o.name + (b ? ' ersetzen' : ' wählen')) + '">' +
        '<label class="jvp-knopf jvp-knopf--klein" for="' + fid + '" aria-hidden="true">' + (b ? 'Ersetzen' : 'Foto wählen') + '</label>' +
        (o.freiwillig && b ? '<button type="button" class="jvp-knopf jvp-knopf--klein jvp-knopf--leise" data-bve="foto-weg" aria-label="' + esc(o.name + ' entfernen') + '">Entfernen</button>' : '') +
      '</div>' +
      '<p class="bve-slot__info muted' + (info.art ? ' ist-' + info.art : '') + '" data-info>' + esc(info.text) + '</p>' +
    '</div>';
  }

  function slotEl(slot) { return wurzel.querySelector('[data-slot="' + slot + '"]'); }

  function slotZeichnen(slot) {
    var el = slotEl(slot);
    if (!el) return;
    var fokus = document.activeElement && el.contains(document.activeElement);
    el.outerHTML = slotHtml(slot);
    if (fokus) { var f = $('bveF-' + slot); if (f) f.focus({ preventScroll: true }); }
  }
  function infoText(slot, t, art) {
    var el = wurzel.querySelector('[data-slot="' + slot + '"] [data-info]');
    if (!el) return;
    el.textContent = t;
    el.className = 'bve-slot__info muted' + (art ? ' ist-' + art : '');
  }
  function infoZeichnen(slot) { var i = infoFuer(slot); infoText(slot, i.text, i.art); }
  function nachherInfosZeichnen() { S.varianten.forEach(function (v) { infoZeichnen('room-' + v.k); }); }

  // Foto im Browser neu zeichnen: JPEG, höchstens MAX_PX, ohne Kameradaten
  function fotoVerarbeiten(datei) {
    return new Promise(function (fertig, fehler) {
      if (datei.size > MAX_DATEI) { fehler(new Error('Das Foto ist zu gross (höchstens 40 MB).')); return; }
      if (datei.type && !/^image\//.test(datei.type)) { fehler(new Error('Das ist kein Foto. Bitte eine Bilddatei wählen (JPG oder PNG).')); return; }
      var url = URL.createObjectURL(datei);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { fehler(new Error(FORMAT_FEHLER)); return; }
        var f = Math.min(1, MAX_PX / Math.max(w, h));
        var bw = Math.max(1, Math.round(w * f)), bh = Math.max(1, Math.round(h * f));
        var c = document.createElement('canvas');
        c.width = bw;
        c.height = bh;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';                // durchsichtige PNG: weiss statt schwarz
        ctx.fillRect(0, 0, bw, bh);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, bw, bh);
        c.toBlob(function (blob) {
          if (!blob) { fehler(new Error('Das Foto konnte nicht verarbeitet werden.')); return; }
          fertig({ blob: blob, breite: bw, hoehe: bh });
        }, 'image/jpeg', QUALITAET);
      };
      img.onerror = function () { URL.revokeObjectURL(url); fehler(new Error(FORMAT_FEHLER)); };
      img.src = url;
    });
  }

  function fotoSetzen(slot, datei) {
    var s = S;
    if (!s || s.laeuft || !datei) return;
    infoText(slot, 'Foto wird vorbereitet …', '');
    fotoVerarbeiten(datei).then(function (r) {
      if (S !== s || s.laeuft || !slotGibt(slot)) return;
      var alt = bildVon(slot);
      if (alt && alt.blob) { try { URL.revokeObjectURL(alt.url); } catch (e) { /* schon frei */ } }
      var url = URL.createObjectURL(r.blob);
      s.urls.push(url);
      bildSetzen(slot, { asset: null, blob: r.blob, url: url, breite: r.breite, hoehe: r.hoehe, fehlt: false });
      s.dirty = true;
      if (slot === 'vorher' && s.aspektAuto) {
        s.f.aspect = r.hoehe > r.breite ? '3/4' : '4/3';
        var radio = wurzel.querySelector('input[name="bveFormat"][value="' + s.f.aspect + '"]');
        if (radio) radio.checked = true;
      }
      slotZeichnen(slot);
      if (slot === 'vorher') nachherInfosZeichnen();
    }, function (e) {
      if (S !== s || !slotGibt(slot)) return;
      infoText(slot, e.message, 'fehler');
    });
  }

  // ── Farbvarianten und Zeilen neu zeichnen (Fokus bleibt, wo er war) ─────
  function variantenZeichnen(fokusId) {
    var ziel = $('bveVarianten');
    if (!ziel) return;
    ziel.innerHTML = variantenHtml();
    var neu = $('bveVarianteNeu');
    if (neu) neu.disabled = S.varianten.length >= MAX_VARIANTEN;
    fokusSetzen(fokusId);
  }
  function zeilenZeichnen(fokusId) {
    var ziel = $('bveZeilen');
    if (!ziel) return;
    ziel.innerHTML = zeilenHtml();
    var neu = $('bveZeileNeu');
    if (neu) neu.disabled = S.spec.length >= MAX_ZEILEN;
    fokusSetzen(fokusId);
  }
  // fokusId: Element-ID oder [Container-Selektor, Aktion]
  function fokusSetzen(ziel) {
    var el = null;
    if (typeof ziel === 'string') el = $(ziel);
    else if (ziel) {
      var c = wurzel.querySelector(ziel[0]);
      el = c && c.querySelector('[data-bve="' + ziel[1] + '"]:not([disabled])');
      if (!el && c) el = c.querySelector('[data-bve]:not([disabled])');
    }
    if (el) el.focus();
  }

  function verschieben(liste, i, richtung) {
    var j = i + richtung;
    if (j < 0 || j >= liste.length) return false;
    var x = liste[i];
    liste[i] = liste[j];
    liste[j] = x;
    return true;
  }

  // ── Prüfen ────────────────────────────────────────────────────────────
  function zeileLeer(z) { return !z.label.trim() && !z.text.trim() && !z.farbeAn; }

  function markieren(el) { if (el) el.setAttribute('aria-invalid', 'true'); }
  function ungueltigWeg(el) { if (el && el.getAttribute('aria-invalid') && String(el.value || '').trim()) el.removeAttribute('aria-invalid'); }

  function pruefen() {
    var s = S;
    var fehlt = [];   // { el, text }
    Array.prototype.forEach.call(wurzel.querySelectorAll('[aria-invalid]'), function (el) { el.removeAttribute('aria-invalid'); });
    Array.prototype.forEach.call(wurzel.querySelectorAll('.bve-slot.ist-fehler'), function (el) { el.classList.remove('ist-fehler'); });
    function feld(id, wert, name) {
      if (String(wert || '').trim()) return;
      var el = $(id);
      markieren(el);
      fehlt.push({ el: el, text: name });
    }
    function foto(slot, name) {
      var el = slotEl(slot);
      if (el) el.classList.add('ist-fehler');
      infoText(slot, 'Bitte ein Foto wählen.', 'fehler');
      fehlt.push({ el: el, fokus: $('bveF-' + slot), text: name });
    }
    feld('bve-kunde', s.f.kunde, 'Kunde');
    feld('bve-raum', s.f.raum, 'Raum');
    feld('bve-titel', s.f.titel, 'Titel');
    feld('bve-datum', s.f.datum, 'Datum');
    if (!s.vorher) foto('vorher', 'Vorher-Foto');
    var mehrere = s.varianten.length > 1;
    s.varianten.forEach(function (v, i) {
      var zusatz = mehrere ? ' (Farbvariante ' + (i + 1) + ')' : '';
      if (mehrere) feld('bveVN' + v.k, v.name, 'Name der Farbvariante ' + (i + 1));
      if (!v.room) foto('room-' + v.k, 'Nachher-Foto' + zusatz);
    });
    s.spec.forEach(function (z, i) {
      if (zeileLeer(z)) return;
      feld('bveZL' + z.k, z.label, 'Bauteil in Zeile ' + (i + 1));
      if (!z.farbeAn) feld('bveZT' + z.k, z.text, 'Beschreibung in Zeile ' + (i + 1));
    });
    if (!fehlt.length) return true;
    var namen = fehlt.slice(0, 6).map(function (x) { return x.text; }).join(', ');
    meldungZeigen('Bitte ergänzen: ' + namen + (fehlt.length > 6 ? ' und ' + (fehlt.length - 6) + ' weitere' : '') + '.', 'error');
    var erst = fehlt[0];
    if (erst.el) {
      erst.el.scrollIntoView({ block: 'center' });
      var f = erst.fokus || erst.el;
      if (f.focus) f.focus({ preventScroll: true });
    }
    return false;
  }

  // ── Speichern ─────────────────────────────────────────────────────────
  function meldungZeigen(t, art) {
    var el = $('bveMeldung');
    if (el) el.innerHTML = t ? '<div class="msg ' + (art || 'info') + '">' + esc(t) + '</div>' : '';
  }

  var fokusVorher = null;
  function sperren(an) {
    if (an) fokusVorher = document.activeElement;
    var fs = $('bveAlles');
    if (fs) fs.disabled = an;
    Array.prototype.forEach.call(wurzel.querySelectorAll('.bve-fuss button'), function (b) { b.disabled = an; });
    var form = $('bveForm');
    if (form) form.setAttribute('aria-busy', an ? 'true' : 'false');
    if (!an && fokusVorher && document.contains(fokusVorher) && fokusVorher.focus) fokusVorher.focus({ preventScroll: true });
    if (!an) fokusVorher = null;
  }

  // Kennungen der Farbvarianten: bestehende bleiben (das Tool merkt sich die gewählte Farbe darüber)
  function variantenIds(s) {
    var belegt = {};
    s.varianten.forEach(function (v) { if (v.id) belegt[v.id] = true; });
    return s.varianten.map(function (v, i) {
      if (v.id) return v.id;
      var basis = kennung(v.name) || 'farbe-' + (i + 1);
      var id = basis, n = 2;
      while (belegt[id]) id = basis.slice(0, 54) + '-' + (n++);
      belegt[id] = true;
      v.id = id;   // ein zweiter Versuch nach einem Fehler nimmt dieselbe Kennung
      return id;
    });
  }

  function neueReihenfolge() {
    var D = P().daten(), min = null;
    Object.keys(D.objekte).forEach(function (k) {
      var r = Number(D.objekte[k].reihenfolge) || 0;
      min = min === null ? r : Math.min(min, r);
    });
    return min === null ? 0 : min - 1;   // neue Visualisierung zuerst
  }

  function datenAus(s, vids) {
    var alt = s.alt || {};
    var d = {};
    Object.keys(alt).forEach(function (k) { if (k !== 'id') d[k] = alt[k]; });
    var bilder = {};
    var altB = alt.bilder && typeof alt.bilder === 'object' ? alt.bilder : {};
    Object.keys(altB).forEach(function (k) { if (!BILD_RE.test(k)) bilder[k] = altB[k]; });
    bilder.vorher = s.vorher.asset;
    s.varianten.forEach(function (v, i) {
      bilder['room-' + vids[i]] = v.room.asset;
      if (v.mock && v.mock.asset) bilder['mock-' + vids[i]] = v.mock.asset;
    });
    d.bilder = bilder;
    ['kunde', 'raum', 'titel', 'datum', 'lead', 'hinweis'].forEach(function (k) { d[k] = text(s.f[k]).trim(); });
    d.aspect = s.f.aspect;
    d.varianten = s.varianten.map(function (v, i) {
      var o = v.orig && typeof v.orig === 'object' ? v.orig : {};
      return Object.assign({}, o, {
        id: vids[i],
        name: v.name.trim(),
        swatch: v.swatchGeaendert || !v.swatchOrig ? v.swatch : v.swatchOrig,
        glossy: !!v.glossy
      });
    });
    d.start = 0;
    s.varianten.forEach(function (v, i) { if (v.k === s.startK) d.start = i; });
    d.spec = s.spec.filter(function (z) { return !zeileLeer(z); }).map(function (z) {
      var wert = z.orig != null && !z.wertGeaendert ? z.orig
        : (z.farbeAn && HEX_RE.test(z.farbe) ? '<span class="sw" style="background:' + z.farbe + '"></span>' : '') + esc(z.text.trim());
      return [z.label.trim(), wert];
    });
    d.projektId = s.f.projektId || null;
    d.geaendert = new Date().toISOString();
    if (!s.alt) {
      d.erstellt = d.geaendert;
      d.reihenfolge = neueReihenfolge();
    }
    return d;
  }

  // Liste nebeneinander abarbeiten (höchstens n gleichzeitig); nach dem ersten Fehler startet nichts Neues
  function nebeneinander(liste, n, fn) {
    return new Promise(function (fertig, abbruch) {
      var i = 0, laufend = 0, fehler = null;
      function starten(x) {
        laufend++;
        Promise.resolve().then(function () { return fn(x); }).then(function () {
          laufend--;
          weiter();
        }, function (e) {
          laufend--;
          if (!fehler) fehler = e;
          weiter();
        });
      }
      function weiter() {
        while (!fehler && laufend < n && i < liste.length) starten(liste[i++]);
        if (!laufend && (fehler || i >= liste.length)) {
          if (fehler) abbruch(fehler);
          else fertig();
        }
      }
      weiter();
    });
  }

  function speichern() {
    var s = S;
    if (!s || s.laeuft) return;
    if (!pruefen()) return;
    var id = s.id || s.neueId;
    var vids = variantenIds(s);
    var offen = alleBilder(s).filter(function (b) { return b.blob && !b.asset; });
    var dieses = [];   // in diesem Durchgang hochgeladen
    var fertigZahl = 0;
    var dateien = bridge.assets('badvis');
    s.laeuft = true;
    sperren(true);
    if (offen.length) meldungZeigen('Fotos werden hochgeladen (0 von ' + offen.length + ') …', 'info');
    nebeneinander(offen, GLEICHZEITIG, function (b) {
      return dateien.upload(b.blob, { type: 'image/jpeg' }).then(function (r) {
        b.asset = r.id;
        dieses.push(r.id);
        fertigZahl++;
        if (S === s) meldungZeigen('Fotos werden hochgeladen (' + fertigZahl + ' von ' + offen.length + ') …', 'info');
      });
    }).then(function () {
      if (S === s) meldungZeigen('Wird gespeichert …', 'info');
      var daten = datenAus(s, vids);
      return P().toolSchreiben('badvis', 'set', 'objekte/' + id, daten).then(function () { return daten; }, function (e) {
        if (e) e.beimSchreiben = true;
        throw e;
      });
    }).then(function (daten) {
      gespeichert(s, id, daten);
    }, function (e) {
      fehlgeschlagen(s, e, dieses);
    });
  }

  function gespeichert(s, id, daten) {
    var p = P(), D = p.daten();
    var altIds = bilderIds(s.alt);
    D.objekte[id] = Object.assign({}, daten, { id: id });
    p.veraltet('objekte');
    s.dirty = false;
    s.laeuft = false;
    var aufgeraeumt = bilderAufraeumen(altIds.filter(function (x) { return bilderIds(daten).indexOf(x) < 0; }));
    var t = 'Visualisierung «' + (daten.titel || daten.raum) + '» gespeichert.';
    if (S !== s) { toast(t); return; }
    if (s.von === 'tool') {
      // Zurück ins Tool verlässt die Seite: erst die ersetzten Fotos löschen (höchstens 4 s), sonst bricht
      // der Browser das Löschen ab und die Fotos bleiben im Speicher liegen
      var ins = function () { location.replace('/tools/badvisualisierungen/#' + encodeURIComponent(id)); };
      Promise.race([aufgeraeumt, new Promise(function (r) { setTimeout(r, 4000); })]).then(ins, ins);
      return;
    }
    var pid = daten.projektId;
    if (pid && D.projekte[pid]) {
      p.spaeterMelden(pid, 'vis', t);
      location.replace('#/projekt/' + encodeURIComponent(pid));
      return;
    }
    naechsteMeldung = { id: id, text: 'Gespeichert. Für einen Kundenlink die Visualisierung einem Projekt zuordnen.', art: 'success' };
    var ziel = '#/visualisierung/' + encodeURIComponent(id);
    if (location.hash === ziel) zeigen(letzterArg);
    else location.replace(ziel);
  }

  // Ersetzte Fotos löschen, wenn sie kein anderes Objekt nutzt (Fehler: Foto bleibt liegen, stört nicht).
  // Das Versprechen gilt immer (auch bei Fehlern), sobald alles erledigt ist.
  function bilderAufraeumen(ids) {
    if (!ids.length) return Promise.resolve();
    var p = P();
    return p.laden(['objekte'], true).then(function () {
      var D = p.daten(), genutzt = {};
      Object.keys(D.objekte).forEach(function (k) { bilderIds(D.objekte[k]).forEach(function (x) { genutzt[x] = true; }); });
      var dateien = bridge.assets('badvis');
      return Promise.all(ids.filter(function (x) { return !genutzt[x]; }).map(function (x) {
        return dateien.delete(x).catch(function () { /* bleibt liegen */ });
      }));
    }).catch(function () { /* ohne aktuelle Liste nichts löschen */ });
  }

  function fehlgeschlagen(s, e, dieses) {
    // Ohne Verbindung beim Schreiben ist unklar, ob das Dokument gespeichert ist: Fotos behalten
    var unklar = !!(e && e.beimSchreiben) && netzFehler(e);
    if (!unklar && dieses.length) {
      var dateien = bridge.assets('badvis');
      dieses.forEach(function (x) { dateien.delete(x).catch(function () { /* bleibt liegen */ }); });
      alleBilder(s).forEach(function (b) { if (b.asset && dieses.indexOf(b.asset) >= 0) b.asset = null; });
    }
    s.laeuft = false;
    var t = netzFehler(e) ? 'Keine Verbindung zum Server. Bitte nochmals speichern.'
      : 'Speichern fehlgeschlagen: ' + ((e && e.message) || 'unbekannter Fehler');
    if (S !== s) { toast(t); return; }
    sperren(false);
    meldungZeigen(t, 'error');
  }

  // ── Löschen ───────────────────────────────────────────────────────────
  function loeschen() {
    var s = S, p = P(), D = p.daten();
    if (!s || !s.id || s.laeuft) return;
    var name = text(s.alt && (s.alt.titel || s.alt.raum)) || 'ohne Titel';
    var links = p.darf('kunden') ? D.links.filter(function (l) { return l.objekt_id === s.id; }).length : -1;
    var frage = 'Visualisierung «' + name + '» löschen?' +
      (links === 1 ? ' Der Kundenlink dazu wird ebenfalls gelöscht.'
        : links > 1 ? ' Die ' + links + ' Kundenlinks dazu werden ebenfalls gelöscht.'
        : links < 0 ? ' Kundenlinks dazu werden ebenfalls gelöscht.' : '') +
      ' Das lässt sich nicht rückgängig machen.';
    if (!confirm(frage)) return;
    s.laeuft = true;
    sperren(true);
    meldungZeigen('Wird gelöscht …', 'info');
    p.toolSchreiben('badvis', 'delete', 'objekte/' + s.id).then(function (r) {
      delete D.objekte[s.id];
      p.veraltet('objekte', 'links');
      s.dirty = false;
      s.laeuft = false;
      var n = r && typeof r.links === 'number' ? r.links : 0;
      var t = 'Visualisierung «' + name + '» gelöscht.' +
        (n === 1 ? ' Der Kundenlink wurde entfernt.' : n > 1 ? ' ' + n + ' Kundenlinks wurden entfernt.' : '');
      if (S !== s) { toast(t); return; }
      if (s.von === 'tool') { location.replace('/tools/badvisualisierungen/'); return; }
      var pid = s.projektVorgabe || (s.alt && s.alt.projektId);
      if (pid && D.projekte[pid]) {
        p.spaeterMelden(pid, 'vis', t);
        location.replace('#/projekt/' + encodeURIComponent(pid));
        return;
      }
      toast(t);
      location.replace('#/projekte');
    }, function (e) {
      s.laeuft = false;
      var t = 'Löschen fehlgeschlagen: ' + (netzFehler(e) ? 'keine Verbindung zum Server.' : e.message);
      if (S !== s) { toast(t); return; }
      sperren(false);
      meldungZeigen(t, 'error');
    });
  }

  // ── Ereignisse ────────────────────────────────────────────────────────
  wurzel.addEventListener('input', function (ev) {
    if (!S) return;
    var t = ev.target;
    var f = t.getAttribute('data-f');
    if (f) {
      S.f[f] = t.value;
      S.dirty = true;
      if (f === 'kunde') S.kundeAuto = false;
      ungueltigWeg(t);
      return;
    }
    var v = t.getAttribute('data-v');
    if (v === 'name' || v === 'swatch') {
      var va = varianteVon(t);
      if (!va) return;
      if (v === 'name') {
        va.name = t.value;
        var kopf = $('bveV' + va.k);
        if (kopf) kopf.textContent = varianteKopf(va, S.varianten.indexOf(va));
      } else {
        va.swatch = t.value;
        va.swatchGeaendert = true;
      }
      S.dirty = true;
      ungueltigWeg(t);
      return;
    }
    var z = t.getAttribute('data-z');
    if (z === 'label' || z === 'text' || z === 'farbe') {
      var ze = zeileVon(t);
      if (!ze) return;
      if (z === 'label') ze.label = t.value;
      else { ze[z] = t.value; ze.wertGeaendert = true; }
      S.dirty = true;
      ungueltigWeg(t);
    }
  });

  wurzel.addEventListener('change', function (ev) {
    if (!S) return;
    var t = ev.target;
    if (t.id === 'bveProjekt') {
      S.f.projektId = t.value;
      S.dirty = true;
      if (S.kundeAuto) {
        S.f.kunde = kundeVorschlag(t.value);
        var k = $('bve-kunde');
        if (k) { k.value = S.f.kunde; ungueltigWeg(k); }
      }
      return;
    }
    if (t.name === 'bveFormat') {
      S.f.aspect = t.value;
      S.aspektAuto = false;
      S.dirty = true;
      infoZeichnen('vorher');
      return;
    }
    if (t.name === 'bveStart') { S.startK = +t.value; S.dirty = true; return; }
    if (t.hasAttribute('data-bve-datei')) {
      var datei = t.files && t.files[0];
      var slot = t.closest('[data-slot]').getAttribute('data-slot');
      t.value = '';
      if (datei) fotoSetzen(slot, datei);
      return;
    }
    if (t.getAttribute('data-v') === 'glossy') {
      var va = varianteVon(t);
      if (va) { va.glossy = t.checked; S.dirty = true; }
      return;
    }
    if (t.getAttribute('data-z') === 'farbeAn') {
      var ze = zeileVon(t);
      if (!ze) return;
      ze.farbeAn = t.checked;
      ze.wertGeaendert = true;
      S.dirty = true;
      var reihe = t.closest('[data-zeile]');
      var farbe = reihe && reihe.querySelector('[data-z="farbe"]');
      if (farbe) farbe.disabled = !t.checked;
      if (t.checked && reihe) { var txt = reihe.querySelector('[data-z="text"]'); if (txt) txt.removeAttribute('aria-invalid'); }
    }
  });

  wurzel.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-bve]') : null;
    if (!b || b.disabled) return;
    var a = b.getAttribute('data-bve');
    if (a === 'nochmals') { zeigen(letzterArg); return; }
    if (!S || S.laeuft) return;

    if (a === 'loeschen') { loeschen(); return; }

    if (a === 'variante-neu') {
      if (S.varianten.length >= MAX_VARIANTEN) return;
      var nv = neueVariante();
      S.varianten.push(nv);
      S.dirty = true;
      variantenZeichnen('bveVN' + nv.k);
      return;
    }
    if (a === 'zeile-neu') {
      if (S.spec.length >= MAX_ZEILEN) return;
      var nz = neueZeile();
      S.spec.push(nz);
      S.dirty = true;
      zeilenZeichnen('bveZL' + nz.k);
      return;
    }

    var va = varianteVon(b);
    if (va && (a === 'var-hoch' || a === 'var-runter')) {
      if (verschieben(S.varianten, S.varianten.indexOf(va), a === 'var-hoch' ? -1 : 1)) {
        S.dirty = true;
        variantenZeichnen(['[data-variante="' + va.k + '"]', a]);
      }
      return;
    }
    if (va && a === 'var-weg') {
      if (S.varianten.length < 2) return;
      var i = S.varianten.indexOf(va);
      if ((va.name.trim() || va.room || va.mock) &&
          !confirm('Farbvariante ' + (i + 1) + (va.name.trim() ? ' «' + va.name.trim() + '»' : '') + ' mit ihren Fotos entfernen?')) return;
      [va.room, va.mock].forEach(function (x) { if (x && x.blob) { try { URL.revokeObjectURL(x.url); } catch (e) { /* frei */ } } });
      S.varianten.splice(i, 1);
      if (S.startK === va.k) S.startK = S.varianten[0].k;
      S.dirty = true;
      var naechste = S.varianten[Math.min(i, S.varianten.length - 1)];
      variantenZeichnen('bveVN' + naechste.k);
      return;
    }

    var ze = zeileVon(b);
    if (ze && (a === 'zeile-hoch' || a === 'zeile-runter')) {
      if (verschieben(S.spec, S.spec.indexOf(ze), a === 'zeile-hoch' ? -1 : 1)) {
        S.dirty = true;
        zeilenZeichnen(['[data-zeile="' + ze.k + '"]', a]);
      }
      return;
    }
    if (ze && a === 'zeile-weg') {
      var j = S.spec.indexOf(ze);
      S.spec.splice(j, 1);
      S.dirty = true;
      var nachher = S.spec[Math.min(j, S.spec.length - 1)];
      zeilenZeichnen(nachher ? 'bveZL' + nachher.k : 'bveZeileNeu');
      return;
    }

    if (a === 'foto-weg') {
      var slot = b.closest('[data-slot]').getAttribute('data-slot');
      var alt = bildVon(slot);
      if (alt && alt.blob) { try { URL.revokeObjectURL(alt.url); } catch (e) { /* frei */ } }
      bildSetzen(slot, null);
      S.dirty = true;
      slotZeichnen(slot);
      var f = $('bveF-' + slot);
      if (f) f.focus({ preventScroll: true });
    }
  });

  wurzel.addEventListener('submit', function (ev) {
    if (ev.target.id !== 'bveForm') return;
    ev.preventDefault();
    speichern();
  });

  // Grösse geladener Fotos (für die Hinweise zum Seitenverhältnis) und fehlende Fotos
  wurzel.addEventListener('load', function (ev) {
    var img = ev.target;
    if (!S || !img.hasAttribute || !img.hasAttribute('data-bve-bild')) return;
    var slot = img.closest('[data-slot]').getAttribute('data-slot');
    var b = bildVon(slot);
    if (!b) return;
    if (!b.breite) { b.breite = img.naturalWidth; b.hoehe = img.naturalHeight; }
    infoZeichnen(slot);
    if (slot === 'vorher') nachherInfosZeichnen();
  }, true);
  wurzel.addEventListener('error', function (ev) {
    var img = ev.target;
    if (!S || !img.hasAttribute || !img.hasAttribute('data-bve-bild')) return;
    var slot = img.closest('[data-slot]').getAttribute('data-slot');
    var b = bildVon(slot);
    if (!b || b.blob) return;
    b.fehlt = true;
    slotZeichnen(slot);
  }, true);

  // Fotos auf ein Feld ziehen
  function mitDateien(ev) {
    var t = ev.dataTransfer && ev.dataTransfer.types;
    if (!t) return false;
    for (var i = 0; i < t.length; i++) if (t[i] === 'Files') return true;
    return false;
  }
  function hervorheben(slotEl) {
    Array.prototype.forEach.call(wurzel.querySelectorAll('.bve-slot.ist-drueber'), function (el) {
      if (el !== slotEl) el.classList.remove('ist-drueber');
    });
    if (slotEl) slotEl.classList.add('ist-drueber');
  }
  wurzel.addEventListener('dragover', function (ev) {
    var slot = ev.target.closest ? ev.target.closest('.bve-slot') : null;
    if (!S || !slot || !mitDateien(ev)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = S.laeuft ? 'none' : 'copy';
    hervorheben(slot);
  });
  wurzel.addEventListener('dragleave', function (ev) {
    var slot = ev.target.closest ? ev.target.closest('.bve-slot') : null;
    if (slot && !slot.contains(ev.relatedTarget)) slot.classList.remove('ist-drueber');
  });
  wurzel.addEventListener('drop', function (ev) {
    var slot = ev.target.closest ? ev.target.closest('.bve-slot') : null;
    if (!S || !slot) return;
    ev.preventDefault();
    hervorheben(null);
    var datei = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (datei && !S.laeuft) fotoSetzen(slot.getAttribute('data-slot'), datei);
  });
  // Daneben fallen gelassen: sonst öffnet der Browser das Foto anstelle der Plattform
  document.addEventListener('dragover', function (ev) { if (S && mitDateien(ev)) ev.preventDefault(); });
  document.addEventListener('drop', function (ev) {
    if (!S || !mitDateien(ev)) return;
    ev.preventDefault();
    hervorheben(null);
  });

  // Ansicht oder Seite über einen Link verlassen: ungespeicherte Änderungen nicht stillschweigend verlieren.
  // Schon beim Klick fragen, dann bleibt bei «Abbrechen» der Verlauf unberührt. Zurück/Vor im Browser
  // prüft route() in plattform.js.
  // Am window: läuft vor dem Klick-Hörer von plattform.js, der sich die Ansicht für «Zurück» merkt.
  window.addEventListener('click', function (ev) {
    if (!S || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    var ziel;
    try { ziel = new URL(a.getAttribute('href'), location.href); } catch (e) { return; }
    if (!/^https?:$/.test(ziel.protocol)) return;
    // Nur der Anker ändert sich: andere Ansicht der Plattform (ohne Anker lädt der Browser die Seite neu)
    var gleicheSeite = ziel.origin === location.origin && ziel.pathname === location.pathname &&
      ziel.search === location.search && !!ziel.hash;
    if (gleicheSeite && ziel.hash === location.hash) return;   // es ändert sich nichts
    if (!verlassen(!gleicheSeite)) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener('beforeunload', function (ev) {
    if (S && (S.dirty || S.laeuft)) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });

  window.JVBadvisEditor = { zeigen: zeigen, verlassen: function () { return verlassen(false); } };
})();
