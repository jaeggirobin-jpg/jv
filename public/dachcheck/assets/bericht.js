// bericht.js — Kundenansicht des Drohnen-Check-Berichts (bericht.html?t=TOKEN)
// Lädt den veröffentlichten Bericht über die Function dachcheck-bericht-ansehen.
// Die Bilder kommen als kurz gültige signierte URLs aus dem privaten Bucket.
(function () {
  'use strict';

  var C = window.DC_CONFIG;
  var T = C.texte;
  var F = C.firma;
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Absätze aus Freitext (Zeilenumbrüche bleiben erhalten)
  function absaetze(text) {
    return String(text || '').split(/\n{2,}/).map(function (p) {
      return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function datum(iso) {
    if (!iso) return '';
    var d = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
    return d.toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  $('fuss-kontakt').innerHTML = esc(F.name) + '<br>' + esc(F.strasse) + '<br>' + esc(F.ort) + '<br>' +
    '<a href="tel:' + esc(F.telefonLink) + '">' + esc(F.telefon) + '</a><br>' +
    '<a href="mailto:' + esc(F.email) + '">' + esc(F.email) + '</a>';
  $('fuss-links').innerHTML = '<a href="' + esc(C.links.impressum) + '">Impressum</a><a href="' + esc(C.links.datenschutz) + '">Datenschutz</a>';

  function fehler(text) {
    $('bericht').innerHTML = '<h1>' + esc(T.bericht.titel) + '</h1><p class="bericht__fehler">' + esc(text) + '</p>' +
      '<p><a href="tel:' + esc(F.telefonLink) + '">' + esc(F.telefon) + '</a> · <a href="mailto:' + esc(F.email) + '">' + esc(F.email) + '</a></p>';
  }

  function zeigen(b) {
    var stufe = T.report.ampel.filter(function (a) { return a.stufe === b.ampel; })[0];
    var html =
      '<p class="bericht__ref">' + esc(b.referenz) + (b.flugdatum ? ' · Flug vom ' + esc(datum(b.flugdatum)) : '') + '</p>' +
      '<h1>' + esc(T.bericht.titel) + '</h1>' +
      '<p class="bericht__adresse">' + esc(b.name) + '<br>' + esc(b.adresse) + '</p>';

    if (stufe) {
      html += '<div class="bericht__ampel stufe-' + esc(stufe.stufe) + '">' +
        '<span class="ampel__punkt" aria-hidden="true"></span>' +
        '<div><strong>' + esc(stufe.wort) + '</strong><p>' + esc(stufe.text) + '</p></div></div>';
    }
    if (b.zusammenfassung) html += '<section class="bericht__text">' + absaetze(b.zusammenfassung) + '</section>';
    if (b.empfehlung) html += '<section class="bericht__text"><h2>' + esc(T.bericht.empfehlungTitel) + '</h2>' + absaetze(b.empfehlung) + '</section>';

    if (b.bilder && b.bilder.length) {
      html += '<section><h2>' + esc(T.bericht.fotosTitel) + '</h2><div class="bericht__fotos" data-bildgruppe>' +
        b.bilder.map(function (x, i) {
          return '<figure><a href="' + esc(x.url) + '" target="_blank" rel="noopener" data-gross data-titel="' + esc(x.beschriftung || '') + '">' +
            '<img src="' + esc(x.url) + '" alt="' + esc(x.beschriftung || 'Foto ' + (i + 1)) + '" loading="' + (i < 2 ? 'eager' : 'lazy') + '"></a>' +
            (x.beschriftung ? '<figcaption>' + esc(x.beschriftung) + '</figcaption>' : '') + '</figure>';
        }).join('') + '</div></section>';
    }

    html += '<section class="bericht__kontakt"><p>' + esc(T.bericht.kontaktText) + '</p>' +
      '<div class="bericht__knoepfe"><a class="btn" href="tel:' + esc(F.telefonLink) + '">' + esc(F.telefon) + '</a>' +
      '<a class="btn btn--sekundaer" href="mailto:' + esc(F.email) + '?subject=' + encodeURIComponent('Drohnen-Check ' + b.referenz) + '">E-Mail schreiben</a></div></section>';

    html += '<p class="klein bericht__fuss">Bericht vom ' + esc(datum(b.erstellt)) + '.' +
      (b.loeschdatum ? ' Er ist bis ' + esc(datum(b.loeschdatum)) + ' abrufbar. Danach löschen wir Bericht und Aufnahmen.' : '') + '</p>';

    $('bericht').innerHTML = html;
    document.title = T.bericht.titel + ' ' + b.referenz + ' | Jäggi Vollmer';
  }

  // Kein Drucken / Speichern als PDF (Robins Vorgabe). Hohe Hürde, kein absoluter Schutz:
  // Bildschirmfotos bleiben möglich. Beim Drucken zeigt bericht.css nur einen Hinweis.
  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === 'p' || k === 's')) e.preventDefault();
  });
  document.addEventListener('contextmenu', function (e) {
    if (e.target.closest && e.target.closest('img, .bildansicht')) e.preventDefault();
  });
  document.addEventListener('dragstart', function (e) {
    if (e.target.tagName === 'IMG') e.preventDefault();
  });

  var token = new URLSearchParams(location.search).get('t') || '';
  if (!/^[a-f0-9]{32}$/.test(token)) { fehler(T.bericht.nichtGefunden); return; }

  fetch('/api/dachcheck-bericht-ansehen?t=' + token, { cache: 'no-store' })
    .then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) { return { ok: res.ok, status: res.status, j: j }; });
    })
    .then(function (r) {
      if (r.status === 404) { fehler(T.bericht.nichtGefunden); return; }
      if (!r.ok) { fehler('Der Bericht konnte nicht geladen werden. Bitte versuchen Sie es später nochmals.'); return; }
      zeigen(r.j);
    })
    .catch(function () { fehler('Keine Verbindung. Bitte prüfen Sie Ihre Internetverbindung und laden Sie die Seite neu.'); });
})();
