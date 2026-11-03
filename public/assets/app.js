/* app.js — JV-Plattform als installierbare App (PWA)
 *
 * - meldet den Service Worker an (/sw.js: speichert nur die Offline-Seite, nie Daten oder PDFs)
 * - Benutzermenü: Knopf «Als App installieren» (Chrome, Edge, Android) bzw. Hinweis auf den Weg
 *   über das Teilen-Menü (iPhone, iPad) oder «Ablage → Zum Dock hinzufügen» (Safari auf dem Mac)
 * - in der installierten App erscheint nichts davon
 */
(function () {
  'use strict';

  var aufforderung = null;   // gemerktes Ereignis «beforeinstallprompt» (nur Chrome, Edge, Android)

  function $(id) { return document.getElementById(id); }

  function alsApp() {
    try {
      if (window.matchMedia && ['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen'].some(function (m) {
        return window.matchMedia('(display-mode: ' + m + ')').matches;
      })) return true;
    } catch (e) { /* ältere Browser */ }
    return window.navigator.standalone === true;   // iPhone, iPad
  }

  // Weg zur App auf Apple-Geräten (dort gibt es keinen Installieren-Knopf für Webseiten)
  function appleHinweis() {
    var ua = navigator.userAgent || '';
    var ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (ios) return 'Als App: im Teilen-Menü (in Safari auch unter «…») «Zum Home-Bildschirm» wählen.';
    var safariMac = /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|OPR/.test(ua);
    if (safariMac) return 'Als App: in Safari im Menü «Ablage» «Zum Dock hinzufügen» wählen.';
    return '';
  }

  function anzeigen() {
    var knopf = $('appBtn'), hinweis = $('appHinweis');
    if (!knopf || !hinweis) return;
    var app = alsApp();
    knopf.hidden = app || !aufforderung;
    var text = app || aufforderung ? '' : appleHinweis();
    hinweis.textContent = text;
    hinweis.hidden = !text;
  }

  function melden(text) {
    if (window.JVFeedback && window.JVFeedback.meldung) window.JVFeedback.meldung(text);
  }

  function installieren() {
    var a = aufforderung;
    if (!a) return;
    aufforderung = null;          // jedes Ereignis lässt sich nur einmal verwenden
    var menue = $('benutzerMenue');
    if (menue) menue.open = false;
    anzeigen();
    try {
      var p = a.prompt();
      if (p && p.catch) p.catch(function () { /* abgebrochen */ });
    } catch (e) { return; }
    if (a.userChoice && a.userChoice.then) {
      a.userChoice.then(function (wahl) {
        if (wahl && wahl.outcome === 'accepted') melden('Die JV-Plattform wird als App installiert.');
      }, function () { /* abgebrochen */ });
    }
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();             // eigener Knopf im Benutzermenü statt Leiste des Browsers
    aufforderung = e;
    anzeigen();
  });

  window.addEventListener('appinstalled', function () {
    aufforderung = null;
    anzeigen();
    melden('Installiert: Die JV-Plattform startet jetzt auch über das App-Symbol.');
  });

  function start() {
    var knopf = $('appBtn');
    if (knopf) knopf.addEventListener('click', installieren);
    anzeigen();
    try {
      var m = window.matchMedia && window.matchMedia('(display-mode: standalone)');
      if (m && m.addEventListener) m.addEventListener('change', anzeigen);
    } catch (e) { /* ältere Browser */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  // Service Worker erst nach dem Laden anmelden (bremst den Seitenaufbau nicht)
  if ('serviceWorker' in navigator) {
    var anmelden = function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () { /* ohne Worker läuft alles wie bisher */ });
    };
    if (document.readyState === 'complete') anmelden();
    else window.addEventListener('load', anmelden);
  }
})();
