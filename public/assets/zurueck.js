// zurueck.js — Lasche «Zurück» am linken Rand (Gegenstück zum Feedback-Knopf am rechten Rand)
//
// Robin, 2.11.2026: Was man in der JV-Plattform öffnet, öffnet im selben Tab; eine Lasche führt
// wieder zurück. Beim Klick auf einen Link merkt sich die Plattform die Ansicht, aus der er kam
// (sessionStorage «jv-zurueck» = Adresse und Text, gilt nur in diesem Tab, siehe assets/plattform.js).
//
//   <script src="/assets/zurueck.js" defer></script>
//       Tools: Lasche immer; ohne Merker führt sie zur Übersicht der Plattform.
//   <script src="/assets/zurueck.js" data-nur-plattform defer></script>
//       Kundenseiten: Lasche nur, wenn die Plattform die Seite in diesem Tab geöffnet hat
//       (Kundinnen und Kunden öffnen ihren Link nie aus der Plattform, sie sehen nichts).
(function () {
  'use strict';
  var skript = document.currentScript;
  var nurPlattform = !!(skript && skript.hasAttribute('data-nur-plattform'));
  if (window.top !== window) return;   // eingebettet (z. B. Vorschau): keine Lasche

  var merker = null;
  try { merker = JSON.parse(sessionStorage.getItem('jv-zurueck') || 'null'); } catch (e) { merker = null; }
  // Nur zurück auf die Plattform selbst (gleiche Herkunft, «/» oder «/index.html» mit Ansicht)
  var gueltig = !!(merker && typeof merker.url === 'string' && merker.url.length < 400 &&
    /^\/(index\.html)?(\?[^#\s\\]*)?(#[^\s\\]*)?$/.test(merker.url));
  if (!gueltig && nurPlattform) return;
  var ziel = gueltig ? merker.url : '/';
  var text = gueltig && typeof merker.text === 'string' && merker.text.trim() && merker.text.length <= 160
    ? merker.text.trim() : 'Zurück zur Übersicht der JV-Plattform';

  var STIL =
    ':host{all:initial}' +
    '.tab{position:fixed;left:0;top:50%;transform:translateY(-50%);z-index:2147481990;display:flex;flex-direction:column;' +
      'align-items:center;gap:7px;padding:11px 7px 14px;border-radius:0 8px 8px 0;background:#4b575d;color:#fff;' +
      'text-decoration:none;font-family:"JVFB Arimo",Arimo,Arial,Helvetica,sans-serif;font-weight:700;font-size:13px;' +
      'line-height:1;letter-spacing:.04em;box-shadow:2px 2px 12px rgba(40,50,60,.28);opacity:.92;' +
      '-webkit-tap-highlight-color:transparent}' +
    '.tab:hover,.tab:focus-visible{opacity:1;background:#3a4449;outline:none}' +
    '.tab:focus-visible{box-shadow:0 0 0 3px rgba(189,132,58,.55),2px 2px 12px rgba(40,50,60,.28)}' +
    '.tab span{writing-mode:vertical-rl}' +
    '.tab svg{width:15px;height:15px;flex:none}';

  function bauen() {
    if (!document.body || document.getElementById('jvzr-root')) return;
    var host = document.createElement('div');
    host.id = 'jvzr-root';
    host.setAttribute('data-html2canvas-ignore', 'true');   // nicht auf Feedback-Bildern
    var wurzel = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var stil = document.createElement('style');
    stil.textContent = STIL;
    var a = document.createElement('a');
    a.className = 'tab';
    a.setAttribute('href', ziel);
    a.setAttribute('title', text);
    a.setAttribute('aria-label', text);
    a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Zurück</span>';
    wurzel.appendChild(stil);
    wurzel.appendChild(a);
    document.body.appendChild(host);
    var druck = document.createElement('style');
    druck.textContent = '@media print{#jvzr-root{display:none!important}}';
    (document.head || document.body).appendChild(druck);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bauen);
  else bauen();
})();
