// bildansicht.js — Bilder gross auf derselben Seite anzeigen, mit «Schliessen» (statt neuem Tab)
//
// Jeder Link <a href="BILD" data-gross data-titel="…"> öffnet das Bild in einem Overlay.
// Bilder im selben Element mit [data-bildgruppe] lassen sich mit ‹ › oder Wischen durchblättern.
// Ohne <dialog>-Unterstützung oder mit Ctrl/Cmd-Klick öffnet der Link wie bisher.
(function () {
  'use strict';
  if (!window.HTMLDialogElement) return;

  var dlg, bild, text, zaehler, zurueck, weiter;
  var liste = [];
  var pos = 0;

  function bauen() {
    dlg = document.createElement('dialog');
    dlg.className = 'bildansicht';
    dlg.setAttribute('aria-label', 'Bild gross');
    dlg.innerHTML =
      '<button type="button" class="bildansicht__zu" data-ba="zu">Schliessen <span aria-hidden="true">✕</span></button>' +
      '<figure class="bildansicht__figur"><img alt=""><figcaption></figcaption></figure>' +
      '<button type="button" class="bildansicht__nav bildansicht__nav--zurueck" data-ba="zurueck" aria-label="Vorheriges Bild">‹</button>' +
      '<button type="button" class="bildansicht__nav bildansicht__nav--weiter" data-ba="weiter" aria-label="Nächstes Bild">›</button>' +
      '<p class="bildansicht__zaehler" aria-live="polite"></p>';
    document.body.appendChild(dlg);
    bild = dlg.querySelector('img');
    text = dlg.querySelector('figcaption');
    zaehler = dlg.querySelector('.bildansicht__zaehler');
    zurueck = dlg.querySelector('[data-ba="zurueck"]');
    weiter = dlg.querySelector('[data-ba="weiter"]');

    dlg.addEventListener('click', function (e) {
      var k = e.target.closest('[data-ba]');
      if (k) {
        if (k.dataset.ba === 'zu') dlg.close();
        else zeigen(pos + (k.dataset.ba === 'weiter' ? 1 : -1));
        return;
      }
      // Klick neben das Bild schliesst
      if (e.target === dlg || e.target.classList.contains('bildansicht__figur')) dlg.close();
    });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') zeigen(pos + 1);
      else if (e.key === 'ArrowLeft') zeigen(pos - 1);
    });
    var startX = null;
    dlg.addEventListener('touchstart', function (e) { startX = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    dlg.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) zeigen(pos + (dx < 0 ? 1 : -1));
    });
    dlg.addEventListener('close', function () { bild.removeAttribute('src'); document.documentElement.classList.remove('bildansicht-offen'); });
  }

  function zeigen(i) {
    if (i < 0 || i >= liste.length) return;
    pos = i;
    var a = liste[i];
    bild.src = a.href;
    bild.alt = a.dataset.titel || (a.querySelector('img') && a.querySelector('img').alt) || 'Bild ' + (i + 1);
    text.textContent = a.dataset.titel || '';
    text.hidden = !a.dataset.titel;
    var mehrere = liste.length > 1;
    zurueck.hidden = weiter.hidden = zaehler.hidden = !mehrere;
    zurueck.disabled = i === 0;
    weiter.disabled = i === liste.length - 1;
    zaehler.textContent = (i + 1) + ' / ' + liste.length;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-gross]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (!dlg) bauen();
    var gruppe = a.closest('[data-bildgruppe]');
    liste = gruppe ? Array.prototype.slice.call(gruppe.querySelectorAll('a[data-gross]')) : [a];
    zeigen(Math.max(0, liste.indexOf(a)));
    document.documentElement.classList.add('bildansicht-offen');
    dlg.showModal();
    dlg.querySelector('[data-ba="zu"]').focus();
  });
})();
