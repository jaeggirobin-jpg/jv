/* Service Worker der JV-Plattform (installierbare App, PWA).
 *
 * Speichert bewusst NUR die Offline-Seite (/offline.html). Seiten, Daten, Bilder und PDFs kommen immer
 * frisch vom Server (Sicherheits-Prinzipien in CLAUDE.md: nichts im Browser-Speicher, Zugang bei jedem
 * Aufruf geprüft).
 *
 * Er greift nur bei Seitenaufrufen der Plattform ein (/, /index.html, /tools/…): ohne Verbindung zeigt
 * er die Offline-Seite statt der Fehlerseite des Browsers. Kundenseiten (view.html, visualisierung.html,
 * inspiration.html, swipe.html), Drohnen-Check, KRV-Check, /api/, /_blob/ und alle Dateien laufen
 * unverändert am Worker vorbei.
 *
 * Offline-Seite geändert → VERSION hochzählen (sonst zeigen installierte Apps weiter die alte).
 */
'use strict';

var VERSION = 'jv-app-v1';
var OFFLINE = '/offline.html';

self.addEventListener('install', function (event) {
  event.waitUntil(
    fetch(new Request(OFFLINE, { cache: 'reload' }))
      .then(function (antwort) {
        if (!antwort.ok) throw new Error('Offline-Seite nicht geladen: HTTP ' + antwort.status);
        // Als frische Antwort ablegen: eine umgeleitete Antwort (z. B. /offline.html → /offline) dürfte der
        // Browser bei einem Seitenaufruf nicht anzeigen. Nur Inhaltstyp und Sicherheits-Header übernehmen
        // (Content-Encoding & Co. passen nicht mehr zum entpackten Inhalt).
        var kopf = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
        ['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Content-Security-Policy', 'Permissions-Policy']
          .forEach(function (n) { var w = antwort.headers.get(n); if (w) kopf.set(n, w); });
        return antwort.blob().then(function (inhalt) {
          return new Response(inhalt, { status: 200, statusText: 'OK', headers: kopf });
        });
      })
      .then(function (antwort) {
        return caches.open(VERSION).then(function (cache) { return cache.put(OFFLINE, antwort); });
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (namen) {
        // nur eigene, ältere Speicher löschen
        return Promise.all(namen
          .filter(function (n) { return n.indexOf('jv-app-') === 0 && n !== VERSION; })
          .map(function (n) { return caches.delete(n); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// Seiten der Plattform: Übersicht und Michis Tools (sonst nichts)
function plattformSeite(url) {
  if (url.origin !== self.location.origin) return false;
  var p = url.pathname;
  return p === '/' || p === '/index.html' || p.indexOf('/tools/') === 0;
}

function offlineSeite() {
  return caches.open(VERSION)
    .then(function (cache) { return cache.match(OFFLINE); })
    .then(function (antwort) {
      return antwort || new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>Keine Verbindung</title><p style="font:16px/1.5 system-ui,sans-serif;margin:32px">' +
        'Keine Verbindung zum Internet. Bitte später nochmals versuchen.</p>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  // nur ganze Seitenaufrufe im Fenster: eingebettete Rahmen (iframe) laufen am Worker vorbei,
  // die Seiten verbieten das Einbetten ohnehin (X-Frame-Options DENY)
  if (req.method !== 'GET' || req.mode !== 'navigate' || req.destination !== 'document') return;
  if (!plattformSeite(new URL(req.url))) return;
  // immer zuerst das Netz; nur wenn es gar nicht antwortet, die Offline-Seite
  event.respondWith(fetch(req).catch(offlineSeite));
});
