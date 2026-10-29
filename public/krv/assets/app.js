// app.js — Landingpage und Formular «Gratis KRV-Check»
// Vanilla JS, keine Abhängigkeiten. Alle Texte und Werte kommen aus config.js (window.KRV_CONFIG).
//
// Ablauf beim Absenden:
//  1. POST /api/krv-anfrage    → speichert die Angaben, liefert Referenz, Upload-Token und signierte Upload-URLs
//  2. PUT  je Foto             → Browser lädt die verkleinerten Fotos direkt in den privaten Bucket
//  3. POST /api/krv-fotos      → schliesst die Anfrage ab und löst die Info-Mail aus
(function () {
  'use strict';

  var C = window.KRV_CONFIG;
  var T = C.texte;
  var $ = function (id) { return document.getElementById(id); };

  function t(pfad) {
    return pfad.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, T);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // sessionStorage kann in In-App-Browsern (Instagram) oder im privaten Modus fehlen
  var speicher = {
    get: function (k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* egal */ } },
    weg: function (k) { try { sessionStorage.removeItem(k); } catch (e) { /* egal */ } }
  };
  var lokal = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } }
  };

  var ICONS = {
    kamera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    pruefen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M8 10.5l2 2 3.5-3.5"/></svg>',
    antwort: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>'
  };

  // ════════════════════════════════════════════════════════════════════
  // Seite aufbauen
  // ════════════════════════════════════════════════════════════════════
  var anleitungSzene = null;

  function seiteAufbauen() {
    document.querySelectorAll('[data-text]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-text')) || '';
    });
    document.querySelectorAll('[data-cta]').forEach(function (el) {
      el.textContent = T.cta;
      el.addEventListener('click', function () { formularOeffnen(); });
    });

    // Unterlagen von IWB (Broschüre, Online-Formular), nur wenn in config.js gesetzt
    var iwb = T.iwb || {};
    var iwbLinks = [];
    if (iwb.broschuere) iwbLinks.push('<a href="' + esc(iwb.broschuere) + '" target="_blank" rel="noopener">IWB-Broschüre herunterladen (PDF)</a>');
    if (iwb.formular) iwbLinks.push('<a href="' + esc(iwb.formular) + '" target="_blank" rel="noopener">Schon eingebaut? Online-Formular von IWB</a>');
    if (iwbLinks.length) { $('iwb-links').innerHTML = iwbLinks.join(''); $('iwb-links').hidden = false; }

    $('hero-punkte').innerHTML = T.hero.punkte.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');

    $('anleitung-schritte').innerHTML = T.anleitung.schritte.map(function (s, i) {
      return '<li><button type="button" data-anleitung="' + i + '"><span class="nr">' + (i + 1) + '</span>' +
        '<span><strong>' + esc(s.titel) + '</strong><span class="t">' + esc(s.text) + '</span></span></button></li>';
    }).join('');

    // Beispielbilder: so sehen Wasserzähler und Ventile aus
    [['zaehler-bilder', T.anleitung.zaehler], ['ventil-bilder', T.anleitung.ventile]].forEach(function (b) {
      $(b[0]).innerHTML = b[1].bilder.map(function (z) {
        return '<li><img src="' + esc(z.bild) + '" alt="' + esc(z.text) + '" width="480" height="480" loading="lazy"><span>' + esc(z.text) + '</span></li>';
      }).join('');
    });

    $('faq').innerHTML = T.faq.fragen.map(function (q) {
      return '<details><summary>' + esc(q.f) + '</summary><p>' + esc(q.a) + '</p></details>';
    }).join('');

    $('rollen').innerHTML = T.formular.rollen.map(function (r) {
      return '<label class="wahl"><input type="radio" name="rolle" value="' + esc(r.wert) + '"><span>' + esc(r.label) + '</span></label>';
    }).join('');

    var F = C.firma;
    var kontakt = '<a href="tel:' + esc(F.telefonLink) + '">' + esc(F.telefon) + '</a> oder <a href="mailto:' + esc(F.email) + '">' + esc(F.email) + '</a>';
    $('fuss-kontakt').innerHTML = esc(F.name) + '<br>' + esc(F.strasse) + '<br>' + esc(F.ort) + '<br>' +
      '<a href="tel:' + esc(F.telefonLink) + '">' + esc(F.telefon) + '</a><br>' +
      '<a href="mailto:' + esc(F.email) + '">' + esc(F.email) + '</a>';
    $('fuss-links').innerHTML =
      '<a href="' + esc(C.links.impressum) + '">Impressum</a>' +
      '<a href="' + esc(C.links.datenschutz) + '">Datenschutz</a>';
    $('link-datenschutz').href = C.links.datenschutz;
    $('formular-titel').textContent = T.formular.titel;
    $('ausserhalb-kontakt').innerHTML = kontakt;
    $('danke-schritte').innerHTML = T.danke.naechsteSchritte.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('danke-kontakt').innerHTML = 'Fragen? ' + kontakt;

    // Anleitung: Erklärvideo (läuft automatisch, stumm, in Schleife). Fällt das Video aus,
    // erscheinen stattdessen die gezeichnete Skizze und die Schritte als Liste.
    var ruhig = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    anleitungSzene = window.KRVSzene.erstellen($('szene'), { onSchritt: schrittMarkieren });
    anleitungsVideo(ruhig);
    $('anleitung-schritte').addEventListener('click', function (e) {
      var b = e.target.closest('[data-anleitung]');
      if (!b) return;
      var i = Number(b.getAttribute('data-anleitung'));
      if (anleitungVideo && anleitungVideo.springe(i)) return;
      anleitungSzene.stopp();
      anleitungSzene.zeige(i);
    });
  }

  function schrittMarkieren(i) {
    document.querySelectorAll('[data-anleitung]').forEach(function (b) {
      b.setAttribute('aria-current', String(Number(b.getAttribute('data-anleitung')) === i));
    });
  }

  // Startzeiten der Schritte im mitgelieferten Video assets/anleitung.mp4/.webm (7/5/7/5 s, danach 4 s Schlussbild).
  // In Schritt 1 und 3 zeigt das Video Beispielfotos von Zählern bzw. Ventilen.
  // Quelle des Videos: Projektordner krv-check/video-quelle/web.html
  var VIDEO_SCHRITTE = [0, 7, 12, 19];
  var VIDEO_ENDE = 24;
  var anleitungVideo = null;

  function anleitungsVideo(ruhig) {
    var box = $('anleitung-video');
    var v = document.createElement('video');
    var eigenes = true; // true = mitgeliefertes Video, dessen Zeiten wir kennen
    v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.preload = 'metadata';
    v.poster = 'assets/anleitung.jpg';
    // MP4 (H.264) für fast alle Browser, WebM als Ersatz (z. B. Chromium ohne H.264)
    v.src = v.canPlayType('video/mp4; codecs="avc1.42E01E"') ? 'assets/anleitung.mp4' : 'assets/anleitung.webm';
    v.setAttribute('aria-label', 'Erklärvideo: wo und wie Sie die Armatur beim Wasserzähler fotografieren');
    if (ruhig) v.controls = true;
    box.appendChild(v);

    // Fortschrittsbalken über dem Video: einer pro Schritt, anklickbar
    var leiste = document.createElement('div');
    leiste.className = 'krv-video__balken';
    leiste.innerHTML = VIDEO_SCHRITTE.map(function (s, i) {
      return '<button type="button" data-video-schritt="' + i + '" aria-label="Schritt ' + (i + 1) + ': ' +
        esc(T.anleitung.schritte[i].titel) + '"><span><i></i></span></button>';
    }).join('');
    box.appendChild(leiste);
    var fuellungen = leiste.querySelectorAll('i');
    leiste.addEventListener('click', function (e) {
      var b = e.target.closest('[data-video-schritt]');
      if (b) anleitungVideo.springe(Number(b.getAttribute('data-video-schritt')));
    });
    function balkenZeichnen() {
      var t = v.currentTime;
      for (var k = 0; k < fuellungen.length; k++) {
        var ende = k + 1 < VIDEO_SCHRITTE.length ? VIDEO_SCHRITTE[k + 1] : VIDEO_ENDE;
        var anteil = t >= VIDEO_ENDE ? 1 : Math.max(0, Math.min(1, (t - VIDEO_SCHRITTE[k]) / (ende - VIDEO_SCHRITTE[k])));
        fuellungen[k].style.transform = 'scaleX(' + anteil + ')';
      }
    }
    function schleife() {
      balkenZeichnen();
      if (!v.paused && !v.ended) requestAnimationFrame(schleife);
    }
    v.addEventListener('play', function () { requestAnimationFrame(schleife); });
    v.addEventListener('seeked', balkenZeichnen);
    balkenZeichnen();

    box.hidden = false;
    $('szene').hidden = true;

    function skizzeStatt() {
      box.hidden = true;
      $('beispiel-bilder').hidden = false;
      $('szene').hidden = false;
      $('anleitung-schritte').hidden = false;
      $('anleitung-box').classList.add('mit-liste');
      anleitungVideo = null;
      if (!ruhig && 'IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (e) {
          if (e[0].isIntersecting) { anleitungSzene.start(5000); io.disconnect(); }
        }, { threshold: 0.4 });
        io.observe($('szene'));
      }
    }
    v.addEventListener('error', function () { if (eigenes) skizzeStatt(); });

    // Schritt in der Liste mitlaufen lassen
    v.addEventListener('timeupdate', function () {
      if (!eigenes) return;
      var t = v.currentTime, i = -1;
      if (t < VIDEO_ENDE) VIDEO_SCHRITTE.forEach(function (s, k) { if (t >= s) i = k; });
      schrittMarkieren(i);
    });

    // Erst abspielen, wenn das Video sichtbar ist; ausserhalb anhalten
    if (!ruhig) {
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (e) {
          if (e[0].isIntersecting) { var p = v.play(); if (p && p.catch) p.catch(function () { v.controls = true; }); }
          else v.pause();
        }, { threshold: 0.35 }).observe(box);
      } else {
        v.autoplay = true;
      }
    }

    anleitungVideo = {
      springe: function (i) {
        if (!eigenes || box.hidden) return false;
        v.currentTime = VIDEO_SCHRITTE[i] || 0;
        balkenZeichnen();
        var p = v.play(); if (p && p.catch) p.catch(function () {});
        return true;
      }
    };

    // Im Admin importiertes Video ersetzt das mitgelieferte
    fetch('/api/krv-medien').then(function (res) { return res.ok ? res.json() : {}; }).then(function (M) {
      if (!M.video) return;
      if (/\.webm$/.test(M.video) && v.canPlayType('video/webm') === '') return;
      eigenes = false;
      $('beispiel-bilder').hidden = false;
      schrittMarkieren(-1);
      leiste.hidden = true;
      v.controls = true;
      v.poster = M.poster || '';
      v.src = M.video;
      if (!ruhig && !v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    }).catch(function () { /* mitgeliefertes Video bleibt */ });
  }

  // ════════════════════════════════════════════════════════════════════
  // UTM-Parameter merken
  // ════════════════════════════════════════════════════════════════════
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];
  function utmErfassen() {
    var params = new URLSearchParams(location.search);
    var utm = speicher.get('krv_utm') || {};
    var neu = false;
    UTM_KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) { utm[k] = v.slice(0, 200); neu = true; }
    });
    if (neu || !utm.landing) {
      utm.landing = location.pathname + location.search;
      utm.referrer = document.referrer ? document.referrer.slice(0, 300) : '';
    }
    speicher.set('krv_utm', utm);
  }

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
  // Fotos: im Browser verkleinern (spart Datenvolumen, entfernt Standortdaten)
  // ════════════════════════════════════════════════════════════════════
  var fotos = [];   // [{ blob, url }]
  var fotoArbeit = Promise.resolve();

  function verkleinern(datei) {
    var laden = window.createImageBitmap
      ? createImageBitmap(datei, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(datei); })
      : Promise.reject(new Error('alt'));
    return laden.catch(function () {
      // Fallback für ältere Browser
      return new Promise(function (ok, nein) {
        var img = new Image();
        img.onload = function () { ok(img); };
        img.onerror = nein;
        img.src = URL.createObjectURL(datei);
      });
    }).then(function (bild) {
      var b = bild.width, h = bild.height;
      var f = Math.min(1, C.fotos.maxKante / Math.max(b, h));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(b * f); canvas.height = Math.round(h * f);
      canvas.getContext('2d').drawImage(bild, 0, 0, canvas.width, canvas.height);
      if (bild.close) bild.close();
      return new Promise(function (ok, nein) {
        canvas.toBlob(function (blob) { blob ? ok(blob) : nein(new Error('leer')); }, 'image/jpeg', 0.82);
      });
    }, function () {
      throw new Error('Dieses Bildformat kann Ihr Browser nicht lesen. Bitte ein JPG-Foto wählen oder direkt mit der Kamera aufnehmen.');
    });
  }

  function fotoStatus(text, istFehler) {
    var s = $('foto-status');
    s.textContent = text || '';
    s.classList.toggle('fehler', !!istFehler);
  }

  function fotosZeigen() {
    $('fotos').innerHTML = fotos.map(function (f, i) {
      return '<div class="krv-foto"><img src="' + f.url + '" alt="Foto ' + (i + 1) + '">' +
        '<button type="button" data-foto-weg="' + i + '" aria-label="Foto ' + (i + 1) + ' entfernen">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>';
    }).join('');
    $('foto-knopf').classList.toggle('voll', fotos.length >= C.fotos.max);
    if (fotos.length) $('c-keine-fotos').classList.remove('fehler');
  }

  function fotosHinzufuegen(dateien) {
    var platz = C.fotos.max - fotos.length;
    if (dateien.length > platz) fotoStatus('Höchstens ' + C.fotos.max + ' Fotos. Die ersten ' + platz + ' wurden übernommen.', true);
    dateien = dateien.slice(0, Math.max(0, platz));
    dateien.forEach(function (datei) {
      fotoArbeit = fotoArbeit.then(function () {
        fotoStatus('Foto wird vorbereitet …');
        return verkleinern(datei).then(function (blob) {
          fotos.push({ blob: blob, url: URL.createObjectURL(blob) });
          fotosZeigen();
          fotoStatus('');
          form.elements.keine_fotos.checked = false;
        }).catch(function (e) { fotoStatus(e.message, true); });
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Formular
  // ════════════════════════════════════════════════════════════════════
  var form = $('anfrage');
  var aktuell = 'fotos';
  var gesendet = false;
  var upload = null;   // laufender Versand: { referenz, token, uploads, erledigt }

  function feldWerte() {
    var fd = new FormData(form);
    var w = {};
    fd.forEach(function (v, k) { if (typeof v === 'string') w[k] = v.trim(); });
    return w;
  }

  function sichern() {
    if (gesendet) return;
    var w = feldWerte();
    delete w.firma_website;
    speicher.set('krv_formular', w);
  }
  function wiederherstellen() {
    var w = speicher.get('krv_formular');
    if (!w) return;
    Object.keys(w).forEach(function (k) {
      var el = form.elements[k];
      if (!el) return;
      if (el.length && el[0] && el[0].type === 'radio') {
        Array.prototype.forEach.call(el, function (r) { r.checked = r.value === w[k]; });
      } else if (el.type === 'checkbox') el.checked = w[k] === 'ja';
      else if (el.type !== 'file') el.value = w[k];
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
    weiter.hidden = id === 'senden';
    $('zurueck').hidden = !(id === 'kontakt' || id === 'ausserhalb');
    if (id === 'fotos') weiter.textContent = T.formular.weiter;
    else if (id === 'kontakt') weiter.textContent = T.formular.absenden;
    else weiter.textContent = 'Schliessen';

    var balken = $('fortschritt');
    balken.hidden = !(id === 'fotos' || id === 'kontakt');
    balken.children[0].className = 'an';
    balken.children[1].className = id === 'kontakt' ? 'an' : '';

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

  function pruefeFotos() {
    if (fotos.length || form.elements.keine_fotos.checked) return true;
    $('c-keine-fotos').classList.add('fehler');
    fotoStatus('Bitte laden Sie mindestens ein Foto hoch oder kreuzen Sie an, dass wir Sie anrufen sollen.', true);
    return false;
  }

  function pruefeKontakt() {
    var w = feldWerte();
    var ok = true;
    var erstes = null;
    function check(el, fehler) {
      if (!markiere(el, fehler)) { ok = false; if (!erstes) erstes = el; }
    }
    check($('vorname'), !w.vorname);
    check($('nachname'), !w.nachname);
    check($('email'), !EMAIL_RE.test(w.email || ''));
    check($('telefon'), (w.telefon || '').replace(/\D/g, '').length < 9);
    check($('strasse'), !w.strasse);
    check($('hausnummer'), !w.hausnummer);
    check($('plz'), !/^\d{4}$/.test(w.plz || ''));
    check($('ort'), !w.ort);
    check($('f-rolle'), !w.rolle);
    check($('c-einwilligung'), w.einwilligung !== 'ja');
    if (erstes) {
      var ziel = erstes.tagName === 'INPUT' ? erstes : erstes.querySelector('input');
      if (ziel && ziel.focus) ziel.focus();
    }
    return ok;
  }

  function weiter() {
    if (aktuell === 'danke' || aktuell === 'ausserhalb') { formularSchliessen(); return; }
    if (aktuell === 'fotos') {
      fotoArbeit.then(function () {
        if (!pruefeFotos()) return;
        zeigeSchritt('kontakt');
      });
      return;
    }
    if (aktuell === 'kontakt') {
      if (!pruefeKontakt()) return;
      sichern();
      if (!imEinzugsgebiet(feldWerte().plz)) { zeigeSchritt('ausserhalb'); return; }
      absenden();
    }
  }

  function zeigeFehler(text) {
    $('formular-fehler').textContent = text;
    $('formular-fehler').hidden = false;
    form.scrollTop = 0;
  }

  function fortschritt(anteil, text) {
    $('balken').style.width = Math.round(anteil * 100) + '%';
    $('senden-text').textContent = text;
  }

  function jsonPost(pfad, daten) {
    return fetch(pfad, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(daten)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) { var e = new Error(j.error || 'Fehler ' + res.status); e.server = true; throw e; }
        return j;
      });
    });
  }

  var FEHLER_ALLGEMEIN = 'Das hat leider nicht geklappt. Bitte versuchen Sie es nochmals oder rufen Sie uns an: ' + C.firma.telefon + '.';

  function absenden() {
    zeigeSchritt('senden');
    fortschritt(0.05, 'Angaben werden gesendet …');

    // Wiederholung nach einem Abbruch: Anfrage existiert schon, nur Fotos nachreichen
    var schritt1 = upload ? Promise.resolve(upload) : (function () {
      var w = feldWerte();
      var keine = !fotos.length;
      return jsonPost('/api/krv-anfrage', {
        vorname: w.vorname, nachname: w.nachname, email: w.email, telefon: w.telefon,
        strasse: w.strasse, hausnummer: w.hausnummer, plz: w.plz, ort: w.ort,
        rolle: w.rolle, iwb_brief: w.iwb_brief === 'ja', bemerkung: w.bemerkung || '',
        einwilligung: w.einwilligung === 'ja',
        keine_fotos: keine,
        fotos: fotos.map(function (f) { return { groesse: f.blob.size }; }),
        firma_website: w.firma_website || '',
        utm: speicher.get('krv_utm') || {}
      }).then(function (j) {
        upload = { referenz: j.referenz, token: j.upload_token, uploads: j.uploads || [], erledigt: [] };
        return upload;
      });
    })();

    schritt1.then(function (u) {
      // Fotos nacheinander hochladen (schont schwache Mobilverbindungen)
      var kette = Promise.resolve();
      u.uploads.forEach(function (ziel, i) {
        kette = kette.then(function () {
          if (u.erledigt[i]) return;
          fortschritt(0.1 + 0.8 * i / u.uploads.length, 'Foto ' + (i + 1) + ' von ' + u.uploads.length + ' wird hochgeladen …');
          return fetch(ziel.upload_url, {
            method: 'PUT',
            headers: { 'content-type': 'image/jpeg', 'x-upsert': 'true' },
            body: fotos[i].blob
          }).then(function (res) {
            if (!res.ok) throw new Error('Upload ' + res.status);
            u.erledigt[i] = true;
          });
        });
      });
      return kette.then(function () {
        fortschritt(0.95, 'Wird abgeschlossen …');
        return u.token ? jsonPost('/api/krv-fotos', { referenz: u.referenz, upload_token: u.token }) : null;
      }).then(function () { return u; });
    }).then(function (u) {
      gesendet = true;
      speicher.weg('krv_formular');
      fortschritt(1, '');
      $('danke-ref').textContent = u.referenz;
      zeigeSchritt('danke');
      pixelEreignis('Lead');
    }).catch(function (e) {
      // Bei Validierungsfehlern zurück zu den Angaben, sonst Wiederholen anbieten
      zeigeSchritt(upload ? 'senden' : 'kontakt');
      if (upload) {
        $('weiter').hidden = false;
        $('weiter').textContent = 'Nochmals versuchen';
        aktuell = 'wiederholen';
        fortschritt(0, '');
      }
      zeigeFehler(e.server ? e.message : (upload
        ? 'Die Verbindung ist abgebrochen. Ihre Angaben sind gespeichert, bitte tippen Sie auf «Nochmals versuchen», um die Fotos zu senden.'
        : 'Keine Verbindung. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es nochmals.'));
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
    zeigeSchritt(gesendet ? 'danke' : (aktuell === 'senden' || aktuell === 'wiederholen' ? 'senden' : aktuell));
    if (aktuell === 'senden' && upload) { $('weiter').hidden = false; $('weiter').textContent = 'Nochmals versuchen'; aktuell = 'wiederholen'; }
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
    var wahl = lokal.get('krv_tracking');
    if (wahl === 'ja') { pixelLaden(); return; }
    if (wahl === 'nein') return;
    $('cookie-text').textContent = T.cookie.text + ' ';
    var link = document.createElement('a');
    link.href = C.links.datenschutz; link.textContent = 'Mehr dazu';
    $('cookie-text').appendChild(link);
    $('cookie-ja').textContent = T.cookie.ja;
    $('cookie-nein').textContent = T.cookie.nein;
    $('cookie').hidden = false;
    $('cookie-ja').addEventListener('click', function () { lokal.set('krv_tracking', 'ja'); $('cookie').hidden = true; pixelLaden(); });
    $('cookie-nein').addEventListener('click', function () { lokal.set('krv_tracking', 'nein'); $('cookie').hidden = true; });
  }

  // ════════════════════════════════════════════════════════════════════
  // Start
  // ════════════════════════════════════════════════════════════════════
  seiteAufbauen();
  utmErfassen();
  wiederherstellen();
  cookieHinweis();

  $('weiter').addEventListener('click', function () {
    if (aktuell === 'wiederholen') { absenden(); return; }
    weiter();
  });
  $('zurueck').addEventListener('click', function () {
    if (aktuell === 'ausserhalb') { zeigeSchritt('kontakt'); $('plz').focus(); }
    else zeigeSchritt('fotos');
  });
  $('formular-schliessen').addEventListener('click', function () { sichern(); formularSchliessen(); });
  $('foto-input').addEventListener('change', function (e) {
    var dateien = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    if (dateien.length) fotosHinzufuegen(dateien);
  });
  $('fotos').addEventListener('click', function (e) {
    var b = e.target.closest('[data-foto-weg]');
    if (!b) return;
    var i = Number(b.getAttribute('data-foto-weg'));
    URL.revokeObjectURL(fotos[i].url);
    fotos.splice(i, 1);
    fotosZeigen();
  });
  $('link-anleitung').addEventListener('click', function (e) {
    e.preventDefault();
    sichern();
    formularSchliessen();
    setTimeout(function () { $('anleitung').scrollIntoView(); }, 50);
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); weiter(); });
  form.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && ['checkbox', 'radio', 'file'].indexOf(e.target.type) < 0) {
      e.preventDefault(); weiter();
    }
  });
  form.addEventListener('change', function (e) {
    var feld = e.target.closest('.fehler');
    if (feld) feld.classList.remove('fehler');
    if (e.target.name === 'keine_fotos' && e.target.checked) fotoStatus('');
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

  if (location.hash === '#anfrage') formularOeffnen();
})();
