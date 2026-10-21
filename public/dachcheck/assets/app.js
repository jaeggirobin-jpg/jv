// app.js — Landingpage und einseitiges Anmeldeformular «Gratis Drohnen-Rinnen-Check»
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

  // ── Icons (inline, keine externen Ressourcen) ──────────────────────────
  var ICONS = {
    anfrage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
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
    heroMedien();

    $('schritte').innerHTML = T.ablauf.schritte.map(function (s, i) {
      return '<li class="schritt"><div class="schritt__icon">' + (ICONS[s.icon] || '') + '</div>' +
        '<div><h3><span>' + (i + 1) + '</span>' + esc(s.titel) + '</h3><p>' + esc(s.text) + '</p></div></li>';
    }).join('');

    $('ampel').innerHTML = T.report.ampel.map(function (a) {
      return '<li><span class="ampel__marke stufe-' + a.stufe + '"><span class="ampel__punkt" aria-hidden="true"></span>' + esc(a.wort) + '</span><p>' + esc(a.text) + '</p></li>';
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

  // Titelvideo: wird im Admin importiert (Tab «Landingpage») und hier nachgeladen.
  // Ohne Video bleibt der ruhige Hintergrund. Bei «Bewegung reduzieren» oder Datensparmodus nur das Standbild.
  function heroMedien() {
    fetch('/api/dachcheck-medien').then(function (res) { return res.ok ? res.json() : {}; }).then(function (M) {
      var box = $('hero-medien');
      var ruhig = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var sparen = navigator.connection && navigator.connection.saveData;
      // WebM (Fallback des Imports) können ältere iPhones nicht abspielen: dann nur das Standbild
      var abspielbar = M.video && (!/\.webm$/.test(M.video) || document.createElement('video').canPlayType('video/webm') !== '');
      if (abspielbar && !ruhig && !sparen) {
        var v = document.createElement('video');
        v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true;
        v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
        v.preload = 'auto';
        if (M.poster) v.poster = M.poster;
        v.src = M.video;
        box.appendChild(v);
        var p = v.play();
        if (p && p.catch) p.catch(function () { /* Autoplay blockiert: Standbild bleibt */ });
      } else if (M.poster) {
        var img = document.createElement('img');
        img.src = M.poster; img.alt = '';
        box.appendChild(img);
      }
    }).catch(function () { /* ohne Video weiter */ });
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
  // Formular (eine Seite)
  // ════════════════════════════════════════════════════════════════════
  var form = $('anfrage');
  var aktuell = 'formular';
  var gesendet = false;

  function feldWerte() {
    var fd = new FormData(form);
    var w = {};
    fd.forEach(function (v, k) { w[k] = typeof v === 'string' ? v.trim() : v; });
    return w;
  }

  // Eingaben sichern, damit sie beim Schliessen oder Neuladen erhalten bleiben
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
      var el = form.elements[k];
      if (!el || el.length) return;
      if (el.type === 'checkbox') el.checked = w[k] === 'ja';
      else el.value = w[k];
    });
  }

  function zeigeSchritt(id) {
    aktuell = id;
    form.querySelectorAll('.schritt-panel').forEach(function (p) {
      p.hidden = p.getAttribute('data-schritt') !== id;
    });
    $('formular-fehler').hidden = true;

    var weiter = $('weiter');
    weiter.disabled = false;
    $('zurueck').hidden = id !== 'ausserhalb' || !$('warteliste-danke').hidden;
    if (id === 'formular') weiter.textContent = T.formular.absenden;
    else if (id === 'ausserhalb') weiter.textContent = $('warteliste-danke').hidden ? T.formular.ausserhalb.button : 'Schliessen';
    else weiter.textContent = 'Schliessen';

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

  function pruefen() {
    var w = feldWerte();
    var ok = true;
    var erstesFehler = null;
    function check(el, fehler) {
      if (!markiere(el, fehler)) { ok = false; if (!erstesFehler) erstesFehler = el; }
    }
    check($('vorname'), !w.vorname);
    check($('nachname'), !w.nachname);
    check($('email'), !EMAIL_RE.test(w.email || ''));
    check($('telefon'), (w.telefon || '').replace(/\D/g, '').length < 9);
    check($('strasse'), !w.strasse);
    check($('hausnummer'), !w.hausnummer);
    check($('plz'), !/^\d{4}$/.test(w.plz || ''));
    check($('ort'), !w.ort);
    check($('c-einwilligung'), w.einwilligung !== 'ja');
    if (erstesFehler) {
      var ziel = erstesFehler.querySelector ? (erstesFehler.querySelector('input') || erstesFehler) : erstesFehler;
      if (ziel.focus) ziel.focus();
    }
    return ok;
  }

  function weiter() {
    if (aktuell === 'danke') { formularSchliessen(); return; }
    if (aktuell === 'ausserhalb') {
      if (!$('warteliste-danke').hidden) { formularSchliessen(); return; }
      wartelisteSenden();
      return;
    }
    if (!pruefen()) return;
    sichern();
    if (!imEinzugsgebiet(feldWerte().plz)) { zeigeSchritt('ausserhalb'); return; }
    absenden();
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
      vorname: w.vorname, nachname: w.nachname, email: w.email, telefon: w.telefon,
      strasse: w.strasse, hausnummer: w.hausnummer, plz: w.plz, ort: w.ort,
      einwilligung: w.einwilligung === 'ja',
      einwilligung_kommunikation: w.einwilligung_kommunikation === 'ja',
      firma_website: w.firma_website || '',
      utm: speicher.get('dc_utm') || {}
    };
    setzeLaden(true);
    fetch('/api/dachcheck-anfrage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(daten)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) { return { ok: res.ok, j: j }; });
    }).then(function (r) {
      if (!r.ok || !r.j.referenz) {
        zeigeSchritt('formular');
        zeigeFehler(r.j.error || 'Das hat leider nicht geklappt. Bitte versuchen Sie es nochmals oder rufen Sie uns an: ' + C.firma.telefon + '.');
        return;
      }
      gesendet = true;
      try { sessionStorage.removeItem('dc_formular'); } catch (e) { /* egal */ }
      $('danke-ref').textContent = r.j.referenz;
      zeigeSchritt('danke');
      pixelEreignis('Lead');
    }).catch(function () {
      zeigeSchritt('formular');
      zeigeFehler('Keine Verbindung. Bitte prüfen Sie Ihre Internetverbindung und tippen Sie nochmals auf «' + T.formular.absenden + '».');
    });
  }

  // Warteliste mit der bereits eingegebenen E-Mail-Adresse
  function wartelisteSenden() {
    var w = feldWerte();
    setzeLaden(true);
    fetch('/api/dachcheck-warteliste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: w.email, plz: w.plz, ort: w.ort, firma_website: w.firma_website || '', utm: speicher.get('dc_utm') || {} })
    }).then(function (res) {
      if (!res.ok) throw new Error('fehler');
      $('warteliste-danke').hidden = false;
      zeigeSchritt('ausserhalb');
    }).catch(function () {
      zeigeSchritt('ausserhalb');
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
  wiederherstellen();
  cookieHinweis();

  $('weiter').addEventListener('click', weiter);
  $('zurueck').addEventListener('click', function () { zeigeSchritt('formular'); $('plz').focus(); });
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

  // Direktlink …/#anfrage öffnet das Formular
  if (location.hash === '#anfrage') formularOeffnen();
})();
