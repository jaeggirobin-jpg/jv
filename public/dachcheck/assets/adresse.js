// adresse.js — Adress-Vorschläge im Formular (Drohnen-Check und KRV-Check)
//
// Beim Tippen in «Strasse» fragen wir die amtliche Adresssuche des Bundes ab
// (swisstopo, api3.geo.admin.ch, ohne Schlüssel, ohne Cookies). Wer einen Vorschlag
// wählt, bekommt Strasse, Nummer, PLZ und Ort ausgefüllt. Ohne Antwort der Suche
// funktioniert das Formular normal weiter; die Felder bleiben frei bearbeitbar.
(function () {
  'use strict';

  var URL = 'https://api3.geo.admin.ch/rest/services/api/SearchServer';
  var MIN_ZEICHEN = 3;
  var WARTEN_MS = 250;
  var MAX = 6;

  var strasse = document.getElementById('strasse');
  if (!strasse || !window.fetch) return;
  var felder = {
    hausnummer: document.getElementById('hausnummer'),
    plz: document.getElementById('plz'),
    ort: document.getElementById('ort')
  };

  var liste = document.createElement('ul');
  liste.id = 'adress-vorschlaege';
  liste.className = 'adress-vorschlaege';
  liste.setAttribute('role', 'listbox');
  liste.hidden = true;
  strasse.parentNode.classList.add('adress-feld');
  strasse.parentNode.appendChild(liste);
  strasse.setAttribute('autocomplete', 'off');   // sonst überdeckt die Browser-Liste unsere Vorschläge
  strasse.setAttribute('role', 'combobox');
  strasse.setAttribute('aria-autocomplete', 'list');
  strasse.setAttribute('aria-controls', liste.id);
  strasse.setAttribute('aria-expanded', 'false');

  var treffer = [];
  var aktiv = -1;
  var timer = null;
  var laufend = 0;

  // «Horburgstrasse 96 <b>4057 Basel</b>» → { strasse, nr, plz, ort }
  function zerlegen(label) {
    var text = String(label || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    var m = text.match(/^(.+?)\s+(\d+[a-zA-Z]?(?:\.\d+)?)\s+(\d{4})\s+(.+)$/);
    if (m) return { strasse: m[1], nr: m[2], plz: m[3], ort: m[4] };
    m = text.match(/^(.+?)\s+(\d{4})\s+(.+)$/);
    if (m) return { strasse: m[1], nr: '', plz: m[2], ort: m[3] };
    return null;
  }

  function schliessen() {
    liste.hidden = true;
    liste.innerHTML = '';
    treffer = [];
    aktiv = -1;
    strasse.setAttribute('aria-expanded', 'false');
    strasse.removeAttribute('aria-activedescendant');
  }

  function markieren(i) {
    aktiv = i;
    Array.prototype.forEach.call(liste.children, function (li, j) {
      li.setAttribute('aria-selected', j === i ? 'true' : 'false');
    });
    if (i >= 0) strasse.setAttribute('aria-activedescendant', 'adress-v-' + i);
    else strasse.removeAttribute('aria-activedescendant');
  }

  function zeigen() {
    liste.innerHTML = '';
    if (!treffer.length) { schliessen(); return; }
    treffer.forEach(function (t, i) {
      var li = document.createElement('li');
      li.id = 'adress-v-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      var oben = document.createElement('strong');
      oben.textContent = t.strasse + (t.nr ? ' ' + t.nr : '');
      var unten = document.createElement('span');
      unten.textContent = t.plz + ' ' + t.ort;
      li.appendChild(oben);
      li.appendChild(unten);
      // mousedown statt click, damit das Feld den Fokus nicht vorher verliert
      li.addEventListener('mousedown', function (e) { e.preventDefault(); waehlen(i); });
      liste.appendChild(li);
    });
    liste.hidden = false;
    strasse.setAttribute('aria-expanded', 'true');
    markieren(-1);
  }

  function setzen(feld, wert) {
    if (!feld) return;
    feld.value = wert;
    feld.dispatchEvent(new Event('input', { bubbles: true }));
    feld.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function waehlen(i) {
    var t = treffer[i];
    if (!t) return;
    schliessen();
    setzen(strasse, t.strasse);
    setzen(felder.hausnummer, t.nr);
    setzen(felder.plz, t.plz);
    setzen(felder.ort, t.ort);
    // Ohne Nummer im Vorschlag: gleich ins Nummernfeld, sonst weiter zum nächsten Feld
    if (!t.nr && felder.hausnummer) felder.hausnummer.focus();
  }

  function suchen(text) {
    var nr = ++laufend;
    var url = URL + '?type=locations&origins=address&limit=' + MAX + '&searchText=' + encodeURIComponent(text);
    fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (r) { return r.ok ? r.json() : { results: [] }; })
      .then(function (j) {
        if (nr !== laufend || document.activeElement !== strasse) return;
        var gesehen = {};
        treffer = (j.results || []).map(function (r) { return zerlegen(r.attrs && r.attrs.label); })
          .filter(function (t) {
            if (!t) return false;
            var k = t.strasse + '|' + t.nr + '|' + t.plz;
            if (gesehen[k]) return false;
            gesehen[k] = true;
            return true;
          });
        zeigen();
      })
      .catch(function () { /* Suche nicht erreichbar: Formular funktioniert ohne Vorschläge */ });
  }

  strasse.addEventListener('input', function (e) {
    if (!e.isTrusted) return;   // eigene Einträge aus waehlen() lösen keine neue Suche aus
    clearTimeout(timer);
    var text = strasse.value.trim();
    // Nummer schon eingetragen? Mit in die Suche nehmen, das trifft genauer.
    if (felder.hausnummer && felder.hausnummer.value.trim() && !/\d/.test(text)) text += ' ' + felder.hausnummer.value.trim();
    if (text.length < MIN_ZEICHEN) { laufend++; schliessen(); return; }
    timer = setTimeout(function () { suchen(text); }, WARTEN_MS);
  });

  strasse.addEventListener('keydown', function (e) {
    if (liste.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); markieren(Math.min(aktiv + 1, treffer.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); markieren(Math.max(aktiv - 1, -1)); }
    else if (e.key === 'Enter' && aktiv >= 0) { e.preventDefault(); e.stopPropagation(); waehlen(aktiv); }
    else if (e.key === 'Escape') { e.stopPropagation(); schliessen(); }
  });

  strasse.addEventListener('blur', function () { setTimeout(schliessen, 150); });
})();
