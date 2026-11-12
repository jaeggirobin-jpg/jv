// zurueck.js — Knopf «Zurück» vor dem Logo bzw. Lasche am linken Rand (Gegenstück zum Feedback-Knopf)
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
//   <script src="/assets/zurueck.js" data-logo=".top > img" defer></script>
//       Robin, 12.11.2026: Knopf «Zurück» oben links direkt vor dem Logo statt Lasche am Rand,
//       und ein Klick aufs Logo führt zur Übersicht der Plattform («/»). data-logo = CSS-Selektor
//       des Logos im Tool (gesetzt von werkzeuge/tools_einbinden.py). Ohne Treffer bleibt die Lasche.
(function () {
  'use strict';
  var skript = document.currentScript;
  var nurPlattform = !!(skript && skript.hasAttribute('data-nur-plattform'));
  var logoSelektor = (skript && skript.getAttribute('data-logo')) || '';
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
    '.tab svg{width:15px;height:15px;flex:none}' +
    // Knopf im Kopf des Tools (vor dem Logo)
    '.knopf{display:inline-flex;align-items:center;gap:5px;height:34px;padding:0 13px 0 9px;border-radius:999px;' +
      'background:#4b575d;color:#fff;text-decoration:none;font-family:"JVFB Arimo",Arimo,Arial,Helvetica,sans-serif;' +
      'font-weight:700;font-size:14px;line-height:1;white-space:nowrap;box-shadow:0 1px 4px rgba(40,50,60,.22);' +
      '-webkit-tap-highlight-color:transparent}' +
    '.knopf:hover,.knopf:focus-visible{background:#3a4449;outline:none}' +
    '.knopf:focus-visible{box-shadow:0 0 0 3px rgba(189,132,58,.55)}' +
    '.knopf svg{width:16px;height:16px;flex:none}';

  var PFEIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

  function hostBauen(id) {
    var host = document.createElement(id === 'jvzr-root' ? 'div' : 'span');
    host.id = id;
    host.setAttribute('data-html2canvas-ignore', 'true');   // nicht auf Feedback-Bildern
    var wurzel = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var stil = document.createElement('style');
    stil.textContent = STIL;
    wurzel.appendChild(stil);
    return { host: host, wurzel: wurzel };
  }

  function druckAus() {
    var druck = document.createElement('style');
    druck.textContent = '@media print{#jvzr-root,#jvzr-knopf{display:none!important}}';
    (document.head || document.body).appendChild(druck);
  }

  // Knopf vor das Logo setzen und das Logo zur Übersicht verlinken. false = kein Logo gefunden.
  function imKopf() {
    if (!logoSelektor) return false;
    var logo = null;
    try { logo = document.querySelector(logoSelektor); } catch (e) { logo = null; }
    if (!logo || !logo.parentNode) return false;
    var kopf = document.createElement('span');
    kopf.className = 'jvzr-kopf';
    kopf.style.cssText = 'display:inline-flex;align-items:center;gap:12px;flex-wrap:nowrap;max-width:100%';
    var h = hostBauen('jvzr-knopf');
    h.host.style.cssText = 'display:inline-flex;flex:none';
    var a = document.createElement('a');
    a.className = 'knopf';
    a.setAttribute('href', ziel);
    a.setAttribute('title', text);
    a.setAttribute('aria-label', text);
    a.innerHTML = PFEIL + '<span>Zurück</span>';
    h.wurzel.appendChild(a);
    var heim = document.createElement('a');
    heim.className = 'jvzr-heim';
    heim.setAttribute('href', '/');
    heim.setAttribute('title', 'Zur Übersicht der JV-Plattform');
    heim.setAttribute('aria-label', 'Zur Übersicht der JV-Plattform');
    heim.style.cssText = 'display:inline-flex;align-items:center;color:inherit;text-decoration:none;cursor:pointer;min-width:0';
    // Ist das Logo schon ein Link (Terminplaner: plattform.js verlinkt den Kopf), nur den Knopf davor
    var schonLink = logo.closest ? logo.closest('a') : null;
    if (schonLink && schonLink.parentNode) {
      schonLink.parentNode.insertBefore(kopf, schonLink);
      kopf.appendChild(h.host);
      kopf.appendChild(schonLink);
      return true;
    }
    logo.parentNode.insertBefore(kopf, logo);
    heim.appendChild(logo);
    kopf.appendChild(h.host);
    kopf.appendChild(heim);
    return true;
  }

  function bauen() {
    if (!document.body || document.getElementById('jvzr-root') || document.getElementById('jvzr-knopf')) return;
    druckAus();
    if (imKopf()) return;
    var h = hostBauen('jvzr-root');
    var a = document.createElement('a');
    a.className = 'tab';
    a.setAttribute('href', ziel);
    a.setAttribute('title', text);
    a.setAttribute('aria-label', text);
    a.innerHTML = PFEIL + '<span>Zurück</span>';
    h.wurzel.appendChild(a);
    document.body.appendChild(h.host);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bauen);
  else bauen();
})();
