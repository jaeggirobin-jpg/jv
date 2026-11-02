// daten.js — Objekte der Badvisualisierungen aus der JV-Plattform laden
//
// Im Original standen Objekte und Bilder fest im Tool (Kundendaten). In der Plattform liegen sie in der
// Datenbank (tool_docs badvis/objekte/<id>) und im privaten Bucket. Das Tool selbst bleibt unverändert:
// es bekommt dieselben Listen OBJ und IMG, nur eben von hier.
(function () {
  'use strict';

  function aufbereiten(docs) {
    var objekte = docs
      .map(function (d) { var o = d.data() || {}; o.id = d.id; return o; })
      .filter(function (o) { return Array.isArray(o.varianten) && o.varianten.length && o.bilder; })
      .sort(function (a, b) { return (a.reihenfolge || 0) - (b.reihenfolge || 0) || String(a.kunde).localeCompare(String(b.kunde), 'de'); });
    var bilder = {};
    objekte.forEach(function (o) {
      Object.keys(o.bilder).forEach(function (k) {
        if (/^[a-f0-9]{32}$/.test(o.bilder[k])) bilder['img/' + o.id + '/' + k + '.jpg'] = '/_blob/' + o.bilder[k];
      });
    });
    return { objekte: objekte, bilder: bilder };
  }

  window.JVBadvis = {
    // weiter(d) wird beim Laden und bei jeder Änderung aufgerufen
    laden: function (weiter) {
      window.claude.use('db').then(function (db) {
        db.collection('objekte').onSnapshot(function (snap) {
          weiter(aufbereiten(snap.docs));
        }, function () {
          weiter({ objekte: [], bilder: {} });
        });
      });
    },
    // Leere Übersicht: kurzer Hinweis, woher die Objekte kommen
    hinweis: function (obj) {
      if (obj.length || location.hash.length > 1) return;
      var app = document.getElementById('app');
      if (!app || app.querySelector('[data-jv-hinweis]')) return;
      var p = document.createElement('p');
      p.className = 'lead';
      p.setAttribute('data-jv-hinweis', '');
      p.textContent = 'Noch keine Visualisierungen gespeichert. In der JV-Plattform unter «Daten übernehmen» die Datei aus Claude einlesen.';
      app.appendChild(p);
    }
  };
})();
