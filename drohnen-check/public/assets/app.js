// app.js — Landingpage und mehrstufiges Anmeldeformular «Gratis Drohnen-Rinnen-Check»
// Vanilla JS, keine Abhängigkeiten. Alle Texte und Werte kommen aus config.js (window.DC_CONFIG).
(function () {
  'use strict';

  var C = window.DC_CONFIG;
  var T = C.texte;
  var $ = function (id) { return document.getElementById(id); };

  // Wert aus T per Pfad lesen, z. B. 'hero.titel'
  function t(pfad) {
    return pfad.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, T);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // sessionStorage kann in In-App-Browsern oder im privaten Modus fehlen
  var speicher = {
    get: function (k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* egal */ } }
  };
  var lokal = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } }
  };

  function chf(betrag) {
    return 'CHF ' + Number(betrag).toLocaleString('de-CH', { minimumFractionDigits: 0 }).replace(/,/g, '’');
  }

  // ── Icons (inline, keine externen Ressourcen) ──────────────────────────
  var ICONS = {
    anfrage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
    termin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h3"/></svg>',
    drohne: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="10" width="6" height="4" rx="1"/><path d="M9 11L6 8M15 11l3-3M9 13l-3 3M15 13l3 3"/><path d="M3 7h6M15 7h6M3 17h6M15 17h6"/></svg>',
    report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><circle cx="9" cy="14" r="1.2"/><circle cx="12" cy="14" r="1.2"/><circle cx="15" cy="14" r="1.2"/></svg>'
  };

  // ════════════════════════════════════════════════════════════════════
  // Seite aufbauen
  // ════════════════════════════════════════════════════════════════════
  function seiteAufbauen() {
    document.querySelectorAll('[data-text]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-text')) || '';
    });
    document.querySelectorAll('[data-cta]').forEach(function (el) {
      el.textContent = T.cta;
      el.addEventListener('click', function () { formularOeffnen(); });
    });
    $('hero-bild').setAttribute('aria-label', T.hero.bildHinweis);
    $('team-bild').setAttribute('aria-label', T.vertrauen.bildHinweis);
    bildSetzen($('hero-bild'), C.bilder.hero);
    bildSetzen($('team-bild'), C.bilder.team);

    $('schritte').innerHTML = T.ablauf.schritte.map(function (s, i) {
      return '<li class="schritt"><div class="schritt__icon">' + (ICONS[s.icon] || '') + '</div>' +
        '<div><h3><span>' + (i + 1) + '</span>' + esc(s.titel) + '</h3><p>' + esc(s.text) + '</p></div></li>';
    }).join('');

    // Muster-Report (bis das echte Muster-PDF als Bild vorliegt)
    $('report-vorschau').innerHTML =
      '<div class="muster" role="img" aria-label="' + esc(T.report.bildHinweis) + '">' +
        '<div class="muster__kopf"><strong>Rinnen-Check</strong><span>DC-2026-0001</span></div>' +
        '<div class="muster__ampel stufe-beobachten"><span class="ampel__punkt"></span>Beobachten</div>' +
        '<div class="muster__zeile"></div><div class="muster__zeile muster__zeile--kurz"></div>' +
        '<div class="muster__fotos"><div class="platzhalter"><span class="platzhalter__label">Foto 1</span></div>' +
        '<div class="platzhalter"><span class="platzhalter__label">Foto 2</span></div>' +
        '<div class="platzhalter"><span class="platzhalter__label">Foto 3</span></div>' +
        '<div class="platzhalter"><span class="platzhalter__label">Übersicht</span></div></div>' +
        '<div class="muster__zeile"></div><div class="muster__zeile muster__zeile--kurz"></div>' +
        '<div class="muster__hinweis">' + esc(T.report.bildHinweis) + '</div>' +
      '</div>';

    if (C.bilder.report) {
      $('report-vorschau').innerHTML = '<img src="' + esc(C.bilder.report) + '" alt="Muster-Kurzreport" loading="lazy" style="width:100%;height:100%;object-fit:cover">';
    }

    $('ampel').innerHTML = T.report.ampel.map(function (a) {
      return '<li><span class="ampel__marke stufe-' + a.stufe + '"><span class="ampel__punkt" aria-hidden="true"></span>' + esc(a.wort) + '</span><p>' + esc(a.text) + '</p></li>';
    }).join('');

    $('karten').innerHTML = T.mehr.karten.map(function (k) {
      var preis = C.preise[k.preisKey];
      var zeile;
      if (preis == null) {
        zeile = 'Preis auf Anfrage';
      } else {
        zeile = chf(preis) + (k.preisZusatz === 'proJahr' ? ' pro Jahr' : '');
      }
      var klein = '';
      if (k.preisZusatz === 'anrechnung' && preis != null && C.preise.dachkontrolleAnrechnungAb != null) {
        klein = '<small>Bei Auftrag ab ' + chf(C.preise.dachkontrolleAnrechnungAb) + ' angerechnet.</small>';
      }
      return '<article class="karte"><h3>' + esc(k.titel) + '</h3><p>' + esc(k.text) + '</p><p class="karte__preis">' + zeile + klein + '</p></article>';
    }).join('');

    $('fakten').innerHTML = T.vertrauen.punkte.map(function (p) {
      return '<div class="fakt"><strong>' + esc(p.zahl) + '</strong><span>' + esc(p.text) + '</span></div>';
    }).join('');

    $('faq').innerHTML = T.faq.fragen.map(function (q) {
      return '<details><summary>' + esc(q.f) + '</summary><p>' + esc(q.a) + '</p></details>';
    }).join('');

    var F = C.firma;
    $('fuss-kontakt').innerHTML = esc(F.name) + '<br>' + esc(F.strasse) + '<br>' + esc(F.ort) + '<br>' +
      '<a href="tel:' + esc(F.telefonLink) + '">' + esc(F.telefon) + '</a><br>' +
      '<a href="mailto:' + esc(F.email) + '">' + esc(F.email) + '</a>';
    $('fuss-links').innerHTML =
      '<a href="' + esc(C.links.impressum) + '">Impressum</a>' +
      '<a href="' + esc(C.links.datenschutz) + '">Datenschutz</a>';
    $('link-datenschutz').href = C.links.datenschutz;
    $('formular-titel').textContent = T.formular.titel;

    $('danke-schritte').innerHTML = T.danke.naechsteSchritte.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('danke-kontakt').innerHTML = 'Fragen? <a href="tel:' + esc(F.telefonLink) + '">' + esc(F.telefon) + '</a> oder <a href="mailto:' + esc(F.email) + '">' + esc(F.email) + '</a>';
  }

  // Echtes Bild statt Platzhalter, sobald in config.js hinterlegt
  function bildSetzen(el, src) {
    if (!src) return;
    el.classList.remove('platzhalter');
    el.style.background = '#3d4248 url("' + encodeURI(src) + '") center / cover no-repeat';
    var label = el.querySelector('.platzhalter__label');
    if (label) label.remove();
  }

  // ════════════════════════════════════════════════════════════════════
  // UTM-Parameter merken (bleiben für die Sitzung erhalten)
  // ════════════════════════════════════════════════════════════════════
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];
  function utmErfassen() {
    var params = new URLSearchParams(location.search);
    var utm = speicher.get('dc_utm') || {};
    var neu = false;
    UTM_KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) { utm[k] = v.slice(0, 200); neu = true; }
    });
    if (neu || !utm.landing) {
      utm.landing = location.pathname + location.search;
      utm.referrer = document.referrer ? document.referrer.slice(0, 300) : '';
    }
    speicher.set('dc_utm', utm);
    return utm;
  }

  // ════════════════════════════════════════════════════════════════════
  // Einzugsgebiet
  // ════════════════════════════════════════════════════════════════════
  function imEinzugsgebiet(plz) {
    var n = parseInt(plz, 10);
    if (!n) return false;
    return C.einzugsgebiet.plz.some(function (e) {
      if (typeof e === 'number') return e === n;
      var teile = String(e).split('-');
      return n >= parseInt(teile[0], 10) && n <= parseInt(teile[1] || teile[0], 10);
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Wunschtermine (Halbtage Mo–Fr, nächste X Wochen)
  // ════════════════════════════════════════════════════════════════════
  var WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  function isoDatum(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function terminLabel(wert) {
    var teile = wert.split('_');
    var d = new Date(teile[0] + 'T12:00:00');
    return WOCHENTAGE[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '. ' + (teile[1] === 'vm' ? 'Vormittag' : 'Nachmittag');
  }
  function termineAufbauen() {
    var tage = [];
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    var werktage = 0;
    while (werktage < C.termine.vorlaufTage) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) werktage++;
    }
    var ende = new Date(); ende.setDate(ende.getDate() + 7 * C.termine.wochenVoraus);
    while (d <= ende) {
      if (d.getDay() !== 0 && d.getDay() !== 6) tage.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    // nach Kalenderwoche gruppieren
    var gruppen = [];
    tage.forEach(function (tag) {
      var montag = new Date(tag); montag.setDate(tag.getDate() - ((tag.getDay() + 6) % 7));
      var key = isoDatum(montag);
      var g = gruppen[gruppen.length - 1];
      if (!g || g.key !== key) { g = { key: key, montag: montag, tage: [] }; gruppen.push(g); }
      g.tage.push(tag);
    });
    $('termine').innerHTML = gruppen.map(function (g) {
      var fr = new Date(g.montag); fr.setDate(g.montag.getDate() + 4);
      return '<div class="woche"><div class="woche__titel">Woche ' + g.montag.getDate() + '.' + (g.montag.getMonth() + 1) + '. bis ' + fr.getDate() + '.' + (fr.getMonth() + 1) + '.</div><div class="tage">' +
        g.tage.map(function (tag) {
          var iso = isoDatum(tag);
          var name = WOCHENTAGE[tag.getDay()] + ' ' + tag.getDate() + '.' + (tag.getMonth() + 1) + '.';
          return '<div class="tag" role="group" aria-label="' + name + '"><span class="tag__name">' + name + '</span>' +
            '<label class="wahl"><input type="checkbox" name="termin" value="' + iso + '_vm"><span>Vormittag</span></label>' +
            '<label class="wahl"><input type="checkbox" name="termin" value="' + iso + '_nm"><span>Nachmittag</span></label></div>';
        }).join('') + '</div></div>';
    }).join('');
  }
  function terminZaehler() {
    var n = document.querySelectorAll('input[name="termin"]:checked').length;
    var min = C.termine.minAuswahl, max = C.termine.maxAuswahl;
    $('termin-zaehler').textContent = 'Wählen Sie ' + min + ' bis ' + max + ' Halbtage aus. Ausgewählt: ' + n + '.';
    document.querySelectorAll('input[name="termin"]').forEach(function (cb) {
      cb.disabled = !cb.checked && n >= max;
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Formular
  // ════════════════════════════════════════════════════════════════════
  var form = $('anfrage');
  var SCHRITTE = ['1', '2', '3', '4', '5'];
  var aktuell = '1';
  var gesendet = false;

  function feldWerte() {
    var fd = new FormData(form);
    var w = {};
    fd.forEach(function (v, k) {
      if (k === 'termin') { (w.termine = w.termine || []).push(v); }
      else { w[k] = typeof v === 'string' ? v.trim() : v; }
    });
    w.termine = w.termine || [];
    return w;
  }

  // Eingaben sichern, damit sie beim Zurückgehen oder Neuladen erhalten bleiben
  function sichern() {
    if (gesendet) return;
    var w = feldWerte();
    delete w.firma_website;
    speicher.set('dc_formular', w);
  }
  function wiederherstellen() {
    var w = speicher.get('dc_formular');
    if (!w) return;
    Object.keys(w).forEach(function (k) {
      if (k === 'termine') return;
      var els = form.elements[k];
      if (!els) return;
      if (els.length && els[0] && (els[0].type === 'radio')) {
        Array.prototype.forEach.call(els, function (r) { r.checked = (r.value === w[k]); });
      } else if (els.type === 'checkbox') {
        els.checked = w[k] === 'ja';
      } else if (els.type !== 'radio') {
        els.value = w[k];
      }
    });
    (w.termine || []).forEach(function (v) {
      var cb = form.querySelector('input[name="termin"][value="' + v + '"]');
      if (cb) cb.checked = true;
    });
  }

  function zeigeSchritt(id) {
    aktuell = id;
    form.querySelectorAll('.schritt-panel').forEach(function (p) {
      p.hidden = p.getAttribute('data-schritt') !== id;
    });
    $('formular-fehler').hidden = true;

    var idx = SCHRITTE.indexOf(id);
    var fortschritt = $('fortschritt');
    if (idx >= 0) {
      fortschritt.hidden = false;
      $('fortschritt-text').textContent = 'Schritt ' + (idx + 1) + ' von ' + SCHRITTE.length + ': ' + T.formular.schritte[idx];
      $('fortschritt-balken').style.width = ((idx + 1) / SCHRITTE.length * 100) + '%';
    } else {
      fortschritt.hidden = true;
    }

    var zurueck = $('zurueck'), weiter = $('weiter');
    zurueck.hidden = (id === '1' || id === 'danke');
    weiter.disabled = false;
    if (id === '5') weiter.textContent = T.formular.absenden;
    else if (id === 'ausserhalb') weiter.textContent = T.formular.ausserhalb.button;
    else if (id === 'danke') weiter.textContent = 'Schliessen';
    else weiter.textContent = 'Weiter';
    if (id === 'ausserhalb' && !$('warteliste-danke').hidden) weiter.textContent = 'Schliessen';

    if (id === '4') terminZaehler();
    if (id === '5') zusammenfassen();

    form.scrollTop = 0;
    var h = form.querySelector('.schritt-panel[data-schritt="' + id + '"] h2');
    if (h) h.focus({ preventScroll: true });
  }

  function markiere(el, fehler) {
    var feld = el.closest('.feld') || el.closest('.check') || el;
    feld.classList.toggle('fehler', !!fehler);
    return !fehler;
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function pruefeSchritt(id) {
    var w = feldWerte();
    var ok = true;
    var erstesFehler = null;
    function check(el, fehler) {
      if (!markiere(el, fehler)) { ok = false; if (!erstesFehler) erstesFehler = el; }
    }
    if (id === '1') {
      check($('strasse'), !w.strasse);
      check($('hausnummer'), !w.hausnummer);
      check($('plz'), !/^\d{4}$/.test(w.plz || ''));
      check($('ort'), !w.ort);
    }
    if (id === '2') {
      check($('f-gebaeudetyp'), !w.gebaeudetyp);
      check($('f-dachform'), !w.dachform);
      check($('f-rolle'), !w.rolle);
      check($('baujahr'), w.baujahr && !/^\d{4}$/.test(w.baujahr));
    }
    if (id === '3') {
      check($('vorname'), !w.vorname);
      check($('nachname'), !w.nachname);
      check($('telefon'), (w.telefon || '').replace(/\D/g, '').length < 9);
      check($('email'), !EMAIL_RE.test(w.email || ''));
      check($('f-kanal'), !w.kanal);
    }
    if (id === '4') {
      var n = w.termine.length;
      var zuWenig = n < C.termine.minAuswahl;
      $('termin-fehler').textContent = 'Bitte wählen Sie mindestens ' + C.termine.minAuswahl + ' Halbtage aus.';
      check($('f-termine'), zuWenig);
    }
    if (id === '5') {
      check($('c-berechtigt'), w.einwilligung_berechtigt !== 'ja');
      check($('c-aufnahmen'), w.einwilligung_aufnahmen !== 'ja');
      if (!ok) {
        $('formular-fehler').textContent = 'Bitte bestätigen Sie die beiden Pflichtfelder.';
        $('formular-fehler').hidden = false;
      }
    }
    if (erstesFehler) {
      var ziel = erstesFehler.querySelector ? (erstesFehler.querySelector('input') || erstesFehler) : erstesFehler;
      if (ziel.focus) ziel.focus();
    }
    return ok;
  }

  function zusammenfassen() {
    var w = feldWerte();
    var zeilen = [
      ['Adresse', w.strasse + ' ' + w.hausnummer + ', ' + w.plz + ' ' + w.ort],
      ['Gebäude', [w.gebaeudetyp, w.dachform].filter(Boolean).join(', ')],
      ['Sie sind', w.rolle],
      ['Kontakt', w.vorname + ' ' + w.nachname + ', ' + w.telefon],
      ['E-Mail', w.email],
      ['Report per', w.kanal],
      ['Wunschtermine', w.termine.map(terminLabel).join('; ')]
    ];
    $('zusammenfassung').innerHTML = '<dl>' + zeilen.map(function (z) {
      return '<dt>' + esc(z[0]) + '</dt><dd>' + esc(z[1]) + '</dd>';
    }).join('') + '</dl>';
  }

  function weiter() {
    if (aktuell === 'danke') { formularSchliessen(); return; }
    if (aktuell === 'ausserhalb') {
      if (!$('warteliste-danke').hidden) { formularSchliessen(); return; }
      wartelisteSenden();
      return;
    }
    if (!pruefeSchritt(aktuell)) return;
    sichern();
    if (aktuell === '1' && !imEinzugsgebiet(feldWerte().plz)) { zeigeSchritt('ausserhalb'); return; }
    if (aktuell === '5') { absenden(); return; }
    zeigeSchritt(SCHRITTE[SCHRITTE.indexOf(aktuell) + 1]);
  }

  function zurueck() {
    sichern();
    if (aktuell === 'ausserhalb') { zeigeSchritt('1'); return; }
    var idx = SCHRITTE.indexOf(aktuell);
    if (idx > 0) zeigeSchritt(SCHRITTE[idx - 1]);
  }

  function setzeLaden(laden) {
    var b = $('weiter');
    b.disabled = laden;
    if (laden) b.textContent = 'Wird gesendet …';
  }

  function zeigeFehler(text) {
    $('formular-fehler').textContent = text;
    $('formular-fehler').hidden = false;
    form.scrollTop = 0;
  }

  function absenden() {
    var w = feldWerte();
    var daten = {
      strasse: w.strasse, hausnummer: w.hausnummer, plz: w.plz, ort: w.ort,
      gebaeudetyp: w.gebaeudetyp, dachform: w.dachform, rolle: w.rolle,
      baujahr: w.baujahr || null, bemerkung: w.bemerkung || null,
      vorname: w.vorname, nachname: w.nachname, telefon: w.telefon, email: w.email,
      kanal: w.kanal, termine: w.termine,
      einwilligung_berechtigt: w.einwilligung_berechtigt === 'ja',
      einwilligung_aufnahmen: w.einwilligung_aufnahmen === 'ja',
      einwilligung_kommunikation: w.einwilligung_kommunikation === 'ja',
      firma_website: w.firma_website || '',
      utm: speicher.get('dc_utm') || {}
    };
    setzeLaden(true);
    fetch('/api/anfrage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(daten)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) { return { ok: res.ok, j: j }; });
    }).then(function (r) {
      if (!r.ok || !r.j.referenz) {
        setzeLaden(false); zeigeSchritt('5');
        zeigeFehler(r.j.error || 'Das hat leider nicht geklappt. Bitte versuchen Sie es nochmals oder rufen Sie uns an: ' + C.firma.telefon + '.');
        return;
      }
      gesendet = true;
      try { sessionStorage.removeItem('dc_formular'); } catch (e) { /* egal */ }
      $('danke-ref').textContent = r.j.referenz;
      zeigeSchritt('danke');
      pixelEreignis('Lead');
    }).catch(function () {
      setzeLaden(false); zeigeSchritt('5');
      zeigeFehler('Keine Verbindung. Bitte prüfen Sie Ihre Internetverbindung und tippen Sie nochmals auf «' + T.formular.absenden + '».');
    });
  }

  function wartelisteSenden() {
    var input = $('warteliste-email');
    var email = input.value.trim();
    if (!markiere(input, !EMAIL_RE.test(email))) { input.focus(); return; }
    var w = feldWerte();
    setzeLaden(true);
    fetch('/api/warteliste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, plz: w.plz, ort: w.ort, firma_website: w.firma_website || '', utm: speicher.get('dc_utm') || {} })
    }).then(function (res) {
      if (!res.ok) throw new Error('fehler');
      $('warteliste-eingabe').hidden = true;
      $('warteliste-danke').hidden = false;
      zeigeSchritt('ausserhalb');
    }).catch(function () {
      setzeLaden(false); zeigeSchritt('ausserhalb');
      zeigeFehler('Das hat leider nicht geklappt. Bitte versuchen Sie es nochmals.');
    });
  }

  // ── Öffnen / Schliessen ────────────────────────────────────────────────
  var letzterFokus = null;
  function formularOeffnen() {
    letzterFokus = document.activeElement;
    $('formular').classList.add('offen');
    document.body.classList.add('formular-offen');
    if (location.hash !== '#anfrage') {
      try { history.pushState({ formular: true }, '', '#anfrage'); } catch (e) { /* egal */ }
    }
    zeigeSchritt(gesendet ? 'danke' : aktuell);
  }
  function formularSchliessen(ausHistory) {
    $('formular').classList.remove('offen');
    document.body.classList.remove('formular-offen');
    if (!ausHistory && location.hash === '#anfrage') {
      try { history.back(); } catch (e) { /* egal */ }
    }
    if (letzterFokus && letzterFokus.focus) letzterFokus.focus();
  }

  // ════════════════════════════════════════════════════════════════════
  // Tracking: Meta Pixel nur nach Zustimmung
  // ════════════════════════════════════════════════════════════════════
  var pixelGeladen = false;
  function pixelLaden() {
    var id = C.tracking.metaPixelId;
    if (!id || pixelGeladen) return;
    pixelGeladen = true;
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', id);
    window.fbq('track', 'PageView');
  }
  function pixelEreignis(name) {
    if (pixelGeladen && window.fbq) window.fbq('track', name);
  }
  function cookieHinweis() {
    if (!C.tracking.metaPixelId) return;
    var wahl = lokal.get('dc_tracking');
    if (wahl === 'ja') { pixelLaden(); return; }
    if (wahl === 'nein') return;
    $('cookie-text').textContent = T.cookie.text + ' ';
    var link = document.createElement('a');
    link.href = C.links.datenschutz; link.textContent = 'Mehr dazu';
    $('cookie-text').appendChild(link);
    $('cookie-ja').textContent = T.cookie.ja;
    $('cookie-nein').textContent = T.cookie.nein;
    $('cookie').hidden = false;
    $('cookie-ja').addEventListener('click', function () { lokal.set('dc_tracking', 'ja'); $('cookie').hidden = true; pixelLaden(); });
    $('cookie-nein').addEventListener('click', function () { lokal.set('dc_tracking', 'nein'); $('cookie').hidden = true; });
  }

  // ════════════════════════════════════════════════════════════════════
  // Start
  // ════════════════════════════════════════════════════════════════════
  seiteAufbauen();
  utmErfassen();
  termineAufbauen();
  wiederherstellen();
  cookieHinweis();

  $('weiter').addEventListener('click', weiter);
  $('zurueck').addEventListener('click', zurueck);
  $('formular-schliessen').addEventListener('click', function () { sichern(); formularSchliessen(); });
  form.addEventListener('submit', function (e) { e.preventDefault(); weiter(); });
  form.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'radio') {
      e.preventDefault(); weiter();
    }
  });
  form.addEventListener('change', function (e) {
    var feld = e.target.closest('.fehler');
    if (feld) feld.classList.remove('fehler');
    if (e.target.name === 'rolle') $('mieter-hinweis').hidden = e.target.value !== 'Mieter';
    if (e.target.name === 'termin') terminZaehler();
    sichern();
  });
  form.addEventListener('input', function (e) {
    var feld = e.target.closest('.fehler');
    if (feld) feld.classList.remove('fehler');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('formular').classList.contains('offen')) { sichern(); formularSchliessen(); }
  });
  window.addEventListener('popstate', function () {
    if ($('formular').classList.contains('offen') && location.hash !== '#anfrage') formularSchliessen(true);
    else if (!$('formular').classList.contains('offen') && location.hash === '#anfrage') formularOeffnen();
  });

  var rolle = form.querySelector('input[name="rolle"]:checked');
  $('mieter-hinweis').hidden = !(rolle && rolle.value === 'Mieter');

  // Direktlink …/#anfrage öffnet das Formular
  if (location.hash === '#anfrage') formularOeffnen();
})();
