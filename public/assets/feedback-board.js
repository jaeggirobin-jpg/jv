// feedback-board.js — Feedback-Board der Plattform (Ansicht #/feedback, nur Admins)
//
// Vorlage: GEMA Beta (sys_beta.html, Board und «Markdown-Export für Claude Code»), angepasst an die
// JV-Plattform: Einträge kommen aus Supabase (Tabelle plattform_feedback, privater Bucket «feedback»).
//   * Status pro Punkt: Offen, In Arbeit, Erledigt
//   * «Umsetzen»: nur so markierte Punkte kommen in den Markdown-Export (Standard: an)
//   * Markdown-Export mit eingebetteten Bildausschnitten, danach exportierte Punkte auf «In Arbeit»
//   * Aufräumen: erledigte Punkte nach 3 Tagen samt Bild löschen
// Server: netlify/functions/feedback.js, Widget zum Erfassen: public/assets/feedback.js.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var API = '/feedback';
  var BILD = '/api/feedback?bild=';
  var SEITE_GROESSE = 100;
  var AUFRAEUMEN_TAGE = 3;
  var CACHE_MS = 20000;
  var FILTER_KEY = 'jv_feedback_board_filter';
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var STATUS = { offen: 'Offen', bearbeitung: 'In Arbeit', erledigt: 'Erledigt' };
  var STATUS_MD = { offen: '🔴 Offen', bearbeitung: '🟡 In Arbeit', erledigt: '✅ Erledigt' };
  var TYP = { kommentar: 'Kommentar', aenderung: 'Änderungsvorschlag', fehler: 'Fehler' };
  var TYP_MD = { kommentar: '💬 Kommentar', aenderung: '✏️ Änderungsvorschlag', fehler: '🐛 Fehler' };
  var TYP_PILLE = { kommentar: 'pille', aenderung: 'pille pille--kupfer', fehler: 'pille pille--rot' };
  var SCHRITT = { snip: 'Ausschnitt wählen', annot: 'Markieren', form: 'Formular' };

  // Wo im Repo die Seite liegt (für den Export an Claude Code)
  var PLATTFORM = '`public/index.html`, `public/assets/plattform.js`, `public/assets/plattform.css`';
  var DATEIEN = {
    'plattform-kunden': '`public/index.html` (Kunden, eingebettetes Skript), `netlify/functions/*kunde*.js`, `*link*.js`',
    'plattform-katalog': '`public/index.html` (Katalog, eingebettetes Skript), `netlify/functions/*punkt*.js`, `*kategorie*.js`, `*ansprechperson*.js`',
    'plattform-drohnencheck': '`public/dachcheck/assets/admin.js`, `netlify/functions/dachcheck-*.js`',
    'plattform-krv': '`public/krv/assets/admin.js`, `netlify/functions/krv-*.js`',
    'plattform-feedback': '`public/assets/feedback-board.js`, `netlify/functions/feedback.js`',
    'plattform-zugaenge': '`public/assets/zugaenge.js`, `netlify/functions/zugaenge.js`, `netlify/functions/_lib/auth.js`',
    'plattform-import': '`public/assets/plattform.js` (Abschnitt «Daten übernehmen»)',
    'feedback-funktion': '`public/assets/feedback.js` (Ausschnitt, Markieren, Formular, Warteschlange), `netlify/functions/feedback.js`'
  };
  function dateien(seite) {
    if (DATEIEN[seite]) return DATEIEN[seite];
    var m = /^tool-([a-z0-9-]+)$/.exec(seite);
    if (m) {
      return '`public/tools/' + m[1] + '/index.html` (Michis Tool, mit `werkzeuge/tools_einbinden.py` übernommen; ' +
        'Speicher über `public/tools/assets/jv-bridge.js`). Änderungen am Tool selbst gehen beim nächsten Einbinden ' +
        'einer neuen Version verloren, ausser sie stehen auch im Original oder im Einbinde-Skript.';
    }
    if (/^plattform(-|$)/.test(seite)) return PLATTFORM;
    return '';
  }

  // ── Zustand ───────────────────────────────────────────────────────────
  var D = { eintraege: [], zeit: 0, laden: null, fehler: '' };
  var filter = { status: 'offen', seite: '', nurUmsetzen: false };
  var anzahl = SEITE_GROESSE;
  var bleiben = {};          // eben geänderte Punkte bleiben sichtbar, bis der Filter wechselt
  var bildCache = {};        // id → { data } | { fehler }
  var exportiert = [];       // ids des letzten Exports

  try {
    var f = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null');
    if (f && STATUS[f.status] || (f && f.status === 'alle')) filter.status = f.status;
    if (f && typeof f.nurUmsetzen === 'boolean') filter.nurUmsetzen = f.nurUmsetzen;
  } catch (e) { /* ohne gespeicherten Filter */ }
  function filterMerken() {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify({ status: filter.status, nurUmsetzen: filter.nurUmsetzen })); } catch (e) { /* egal */ }
  }

  // ── Hilfen ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(daten) {
    return window.JVBridge.anfrage(API, daten ? { method: 'POST', body: daten } : undefined);
  }
  function zwei(n) { return (n < 10 ? '0' : '') + n; }
  function datumZeit(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return zwei(d.getDate()) + '.' + zwei(d.getMonth() + 1) + '.' + d.getFullYear() + ', ' + zwei(d.getHours()) + ':' + zwei(d.getMinutes());
  }
  function meldung(text, art) {
    var el = $('fbMeldung');
    if (el) el.innerHTML = text ? '<div class="msg ' + (art || 'info') + '">' + esc(text) + '</div>' : '';
  }
  function hinweis(text) {
    if (window.JVFeedback && window.JVFeedback.meldung) window.JVFeedback.meldung(text);
    else meldung(text, 'success');
  }
  // Nur eigene Seiten verlinken (Pfad mit «/», nie «//andere-domain»)
  function eigeneUrl(u) { return typeof u === 'string' && /^\/(?!\/)/.test(u) ? u : ''; }
  function seiteName(e) { return e.seiteName || e.seite || 'Unbekannte Seite'; }
  function finden(id) {
    for (var i = 0; i < D.eintraege.length; i++) if (D.eintraege[i].id === id) return D.eintraege[i];
    return null;
  }
  function ersetzen(liste) {
    (liste || []).forEach(function (neu) {
      for (var i = 0; i < D.eintraege.length; i++) {
        if (D.eintraege[i].id === neu.id) { D.eintraege[i] = neu; return; }
      }
    });
  }
  function stueckeln(ids, n) {
    var aus = [];
    for (var i = 0; i < ids.length; i += n) aus.push(ids.slice(i, i + n));
    return aus;
  }
  function erledigtSeit(e) { return new Date(e.erledigtAm || e.geaendert || e.erstellt).getTime(); }
  function aufraeumbar() {
    var grenze = Date.now() - AUFRAEUMEN_TAGE * 86400000;
    return D.eintraege.filter(function (e) { return e.status === 'erledigt' && erledigtSeit(e) < grenze; });
  }

  // ── Laden ─────────────────────────────────────────────────────────────
  function laden(frisch) {
    if (!frisch && D.zeit && Date.now() - D.zeit < CACHE_MS) return Promise.resolve(D.eintraege);
    if (D.laden) return D.laden;
    D.laden = api().then(function (r) {
      D.eintraege = (r && r.eintraege) || [];
      D.zeit = Date.now();
      D.fehler = '';
      D.laden = null;
      return D.eintraege;
    }, function (e) {
      D.laden = null;
      D.fehler = e && e.message || 'Feedback konnte nicht geladen werden';
      throw e;
    });
    return D.laden;
  }

  // ── Board ─────────────────────────────────────────────────────────────
  function passt(e) {
    if (filter.status !== 'alle' && e.status !== filter.status) return false;
    if (filter.seite && e.seite !== filter.seite) return false;
    if (filter.nurUmsetzen && !e.umsetzen) return false;
    return true;
  }
  function sichtbar() {
    return D.eintraege.filter(function (e) { return passt(e) || bleiben[e.id]; });
  }

  function werkzeugeHtml() {
    var z = { offen: 0, bearbeitung: 0, erledigt: 0, alle: D.eintraege.length };
    var seiten = {};
    D.eintraege.forEach(function (e) {
      if (z[e.status] !== undefined) z[e.status]++;
      if (!seiten[e.seite]) seiten[e.seite] = { name: seiteName(e), n: 0 };
      seiten[e.seite].n++;
    });
    var chips = ['offen', 'bearbeitung', 'erledigt', 'alle'].map(function (s) {
      return '<button type="button" data-fb-status="' + s + '" aria-pressed="' + (filter.status === s) + '">' +
        (s === 'alle' ? 'Alle' : STATUS[s]) + ' (' + z[s] + ')</button>';
    }).join('');
    var ids = Object.keys(seiten).sort(function (a, b) { return seiten[a].name.localeCompare(seiten[b].name, 'de'); });
    if (filter.seite && !seiten[filter.seite]) filter.seite = '';
    var auswahl = '<select data-fb-seite aria-label="Seite"><option value="">Alle Seiten</option>' + ids.map(function (id) {
      return '<option value="' + esc(id) + '"' + (filter.seite === id ? ' selected' : '') + '>' + esc(seiten[id].name) + ' (' + seiten[id].n + ')</option>';
    }).join('') + '</select>';
    var alt = aufraeumbar().length;
    return '<div class="card fb-werkzeuge">' +
      '<div class="jvp-chips" role="group" aria-label="Status">' + chips + '</div>' +
      auswahl +
      '<label><input type="checkbox" data-fb-nurumsetzen' + (filter.nurUmsetzen ? ' checked' : '') + '> Nur «Umsetzen»</label>' +
      '<span class="fb-werkzeuge__rechts">' +
        (alt ? '<button type="button" class="jvp-knopf jvp-knopf--klein" data-fb-a="aufraeumen" title="Erledigte Punkte, die seit mehr als ' + AUFRAEUMEN_TAGE + ' Tagen erledigt sind, samt Bild löschen">Aufräumen (' + alt + ')</button>' : '') +
        '<button type="button" class="jvp-knopf jvp-knopf--klein" data-fb-a="neu">Aktualisieren</button>' +
      '</span></div>';
  }

  function bildHtml(e) {
    if (e.bild && UUID_RE.test(e.id)) {
      return '<a class="fb-bild" href="' + BILD + e.id + '" target="_blank" rel="noopener" data-fb-gross="' + esc(e.id) + '" title="Bild gross anzeigen">' +
        '<img src="' + BILD + e.id + '" alt="Bildausschnitt zum Feedback" loading="lazy"></a>';
    }
    return '<div class="fb-bild fb-bild--ohne">' + (e.bildWeg || (e.meta && e.meta.bild_weg) ? 'Bild war nicht möglich oder zu gross' : 'Ohne Bild') + '</div>';
  }

  function karteHtml(e) {
    var m = e.meta || {};
    var url = eigeneUrl(e.url);
    var kopf = [
      '<span class="' + (TYP_PILLE[e.typ] || 'pille') + '">' + esc(TYP[e.typ] || e.typ) + '</span>',
      '<b>' + esc(e.autor || 'Ohne Namen') + '</b>',
      '<span>' + esc(datumZeit(e.erstellt)) + '</span>'
    ];
    if (url) kopf.push('<a href="' + esc(url) + '" target="_blank" rel="noopener" title="' + esc(url) + '">Seite öffnen ↗</a>');
    if (m.bildschirm) kopf.push('<span title="' + esc(m.browser || '') + '">' + esc(m.bildschirm) + '</span>');
    var metaZeile = '';
    if (e.seite === 'feedback-funktion' && m.aufgenommen_in) {
      metaZeile = '<p class="fb-meta">Zur Feedback-Funktion selbst, aufgenommen auf «' + esc(m.aufgenommen_in.name || m.aufgenommen_in.id || '?') + '»' +
        (m.schritt ? ' im Schritt «' + esc(SCHRITT[m.schritt] || m.schritt) + '»' : '') + '.</p>';
    }
    var status = '<select data-fb="status" aria-label="Status">' + Object.keys(STATUS).map(function (s) {
      return '<option value="' + s + '"' + (e.status === s ? ' selected' : '') + '>' + STATUS[s] + '</option>';
    }).join('') + '</select>';
    var klasse = 'fb-karte' + (e.umsetzen ? ' ist-umsetzen' : '') + (e.status === 'erledigt' ? ' ist-erledigt' : '');
    return '<article class="' + klasse + '" data-id="' + esc(e.id) + '">' + bildHtml(e) +
      '<div class="fb-inhalt"><div class="fb-kopf">' + kopf.join('') + '</div>' + metaZeile +
      '<p class="fb-text">' + esc(e.text) + '</p>' +
      '<div class="fb-steuer"><label>Status ' + status + '</label>' +
        '<label title="Angehakt: kommt in den Markdown-Export für Claude Code"><input type="checkbox" data-fb="umsetzen"' + (e.umsetzen ? ' checked' : '') + '> Umsetzen</label>' +
        '<div class="actions"><button type="button" class="jvp-knopf jvp-knopf--klein jvp-knopf--gefahr" data-fb="loeschen">Löschen</button></div>' +
      '</div></div></article>';
  }

  function zeichnen() {
    var ziel = $('fbBoard');
    if (!ziel) return;
    var liste = sichtbar();
    var gruppen = {}, reihe = [];
    liste.slice(0, anzahl).forEach(function (e) {
      if (!gruppen[e.seite]) { gruppen[e.seite] = { name: seiteName(e), items: [] }; reihe.push(e.seite); }
      gruppen[e.seite].items.push(e);
    });
    reihe.sort(function (a, b) { return gruppen[a].name.localeCompare(gruppen[b].name, 'de'); });
    var html = werkzeugeHtml() + '<div id="fbMeldung"></div>';
    if (!D.eintraege.length) {
      html += '<div class="card"><p class="jvp-leer">Noch kein Feedback. Mit «Feedback geben» (oben oder in jedem Tool am rechten Rand) einen Bildausschnitt markieren und beschreiben, was auffällt.</p></div>';
    } else if (!liste.length) {
      html += '<div class="card"><p class="jvp-leer">Keine Punkte für diesen Filter.</p></div>';
    } else {
      html += reihe.map(function (s) {
        var g = gruppen[s];
        return '<section class="fb-gruppe"><h2>' + esc(g.name) + '<small>' + g.items.length + (g.items.length === 1 ? ' Punkt' : ' Punkte') + '</small></h2>' +
          g.items.map(karteHtml).join('') + '</section>';
      }).join('');
      if (liste.length > anzahl) {
        html += '<div class="jvp-knopfreihe"><button type="button" class="jvp-knopf" data-fb-a="mehr">Weitere anzeigen (' + (liste.length - anzahl) + ')</button></div>';
      }
    }
    ziel.innerHTML = html;
  }

  function zeigen() {
    var ziel = $('fbBoard');
    if (!ziel) return;
    bleiben = {};
    anzahl = SEITE_GROESSE;
    if (D.zeit) zeichnen();
    else ziel.innerHTML = '<p class="jvp-leer">Wird geladen …</p>';
    laden(true).then(zeichnen, function (e) {
      if (D.zeit) { zeichnen(); meldung(e.message || 'Feedback konnte nicht neu geladen werden', 'error'); return; }
      ziel.innerHTML = '<div class="msg error">' + esc(e.message || 'Feedback konnte nicht geladen werden') + '</div>' +
        '<div class="jvp-knopfreihe" style="margin-top:12px"><button type="button" class="jvp-knopf" data-fb-a="neu">Nochmals versuchen</button></div>';
    });
  }

  // Zahl der offenen Punkte auf der Kachel in der Übersicht
  function zahlAnzeigen(el) {
    if (!el) return;
    laden(false).then(function (liste) {
      var n = liste.filter(function (e) { return e.status === 'offen'; }).length;
      el.textContent = n ? (n === 1 ? '1 offener Punkt →' : n + ' offene Punkte →') : 'Öffnen →';
    }, function () { el.textContent = 'Öffnen →'; });
  }

  // ── Aktionen im Board ─────────────────────────────────────────────────
  function aendern(ids, felder) {
    var daten = { aktion: 'aendern', ids: ids };
    Object.keys(felder).forEach(function (k) { daten[k] = felder[k]; });
    return api(daten).then(function (r) {
      ersetzen(r.eintraege);
      ids.forEach(function (id) { bleiben[id] = true; });
      D.zeit = Date.now();
      return r.eintraege || [];
    });
  }

  function loeschen(ids) {
    var teile = stueckeln(ids, 200);
    var weg = 0;
    var kette = Promise.resolve();
    teile.forEach(function (t) {
      kette = kette.then(function () {
        return api({ aktion: 'loeschen', ids: t }).then(function (r) {
          weg += r.geloescht || 0;
          var raus = {};
          t.forEach(function (id) { raus[id] = true; });
          D.eintraege = D.eintraege.filter(function (e) { return !raus[e.id]; });
        });
      });
    });
    return kette.then(function () { return weg; });
  }

  function aufraeumen() {
    var alt = aufraeumbar();
    if (!alt.length) return;
    if (!confirm(alt.length + (alt.length === 1 ? ' erledigter Punkt wird' : ' erledigte Punkte werden') + ' samt Bild gelöscht (seit mehr als ' +
      AUFRAEUMEN_TAGE + ' Tagen erledigt). Offene Punkte und Punkte in Arbeit bleiben. Das lässt sich nicht rückgängig machen.')) return;
    loeschen(alt.map(function (e) { return e.id; })).then(function (n) {
      zeichnen();
      hinweis(n === 1 ? '1 Punkt gelöscht.' : n + ' Punkte gelöscht.');
    }, function (e) { zeichnen(); meldung(e.message || 'Löschen fehlgeschlagen', 'error'); });
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t.closest || !t.closest('#fbBoard')) return;
    var chip = t.closest('[data-fb-status]');
    if (chip) {
      filter.status = chip.getAttribute('data-fb-status');
      bleiben = {}; anzahl = SEITE_GROESSE;
      filterMerken(); zeichnen();
      return;
    }
    var gross = t.closest('[data-fb-gross]');
    if (gross && !(ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button > 0)) {
      ev.preventDefault();
      bildZeigen(gross.getAttribute('data-fb-gross'));
      return;
    }
    var a = t.closest('[data-fb-a]');
    if (a) {
      var was = a.getAttribute('data-fb-a');
      if (was === 'neu') zeigen();
      else if (was === 'mehr') { anzahl += SEITE_GROESSE; zeichnen(); }
      else if (was === 'aufraeumen') aufraeumen();
      return;
    }
    var k = t.closest('[data-fb="loeschen"]');
    if (k) {
      var karte = k.closest('.fb-karte');
      var id = karte && karte.getAttribute('data-id');
      if (!id || !confirm('Diesen Punkt samt Bild löschen? Das lässt sich nicht rückgängig machen.')) return;
      k.disabled = true;
      loeschen([id]).then(function () { zeichnen(); hinweis('Punkt gelöscht.'); }, function (e) {
        k.disabled = false;
        meldung(e.message || 'Löschen fehlgeschlagen', 'error');
      });
    }
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t.closest || !t.closest('#fbBoard')) return;
    if (t.hasAttribute('data-fb-seite')) {
      filter.seite = t.value; bleiben = {}; anzahl = SEITE_GROESSE; zeichnen();
      return;
    }
    if (t.hasAttribute('data-fb-nurumsetzen')) {
      filter.nurUmsetzen = t.checked; bleiben = {}; anzahl = SEITE_GROESSE; filterMerken(); zeichnen();
      return;
    }
    var art = t.getAttribute('data-fb');
    if (art !== 'status' && art !== 'umsetzen') return;
    var karte = t.closest('.fb-karte');
    var id = karte && karte.getAttribute('data-id');
    var e = id && finden(id);
    if (!e) return;
    var felder = art === 'status' ? { status: t.value } : { umsetzen: t.checked };
    t.disabled = true;
    aendern([id], felder).then(function () {
      var neu = finden(id);
      if (neu) {
        karte.classList.toggle('ist-umsetzen', !!neu.umsetzen);
        karte.classList.toggle('ist-erledigt', neu.status === 'erledigt');
      }
      t.disabled = false;
      var alt = document.querySelector('#fbBoard .fb-werkzeuge');
      if (alt) {
        var w = document.createElement('div');
        w.innerHTML = werkzeugeHtml();
        alt.parentNode.replaceChild(w.firstChild, alt);
      }
    }, function (err) {
      t.disabled = false;
      if (art === 'status') t.value = e.status; else t.checked = !!e.umsetzen;
      meldung(err.message || 'Nicht gespeichert', 'error');
    });
  });

  // ── Bild gross ────────────────────────────────────────────────────────
  var bildDialog = null;
  function bildZeigen(id) {
    if (!UUID_RE.test(id)) return;
    if (!bildDialog) {
      bildDialog = document.createElement('dialog');
      bildDialog.className = 'jvp-dialog fb-gross';
      bildDialog.setAttribute('aria-label', 'Bildausschnitt');
      bildDialog.innerHTML = '<div class="fb-gross__kopf"><a href="#" target="_blank" rel="noopener" data-fb-tab>In neuem Tab öffnen ↗</a>' +
        '<button type="button" class="jvp-knopf jvp-knopf--klein" data-fb-zu>Schliessen</button></div><img alt="Bildausschnitt zum Feedback">';
      document.body.appendChild(bildDialog);
      bildDialog.addEventListener('click', function (ev) {
        if (ev.target === bildDialog || ev.target.closest('[data-fb-zu]')) bildDialog.close();
      });
    }
    bildDialog.querySelector('img').src = BILD + id;
    bildDialog.querySelector('[data-fb-tab]').href = BILD + id;
    if (bildDialog.showModal) bildDialog.showModal(); else bildDialog.setAttribute('open', '');
  }

  // ── Markdown-Export für Claude Code ───────────────────────────────────
  var ex = null;
  function exportDialog() {
    if (ex) return ex;
    var dlg = document.createElement('dialog');
    dlg.className = 'jvp-dialog jvp-dialog--breit fb-export';
    dlg.id = 'fbExportDialog';
    dlg.setAttribute('aria-labelledby', 'fbExTitel');
    dlg.innerHTML = '<div class="jvp-dialog__innen">' +
      '<h2 id="fbExTitel">Markdown-Export für Claude Code</h2>' +
      '<p class="muted">Exportiert werden nur Punkte mit <b>«Umsetzen»</b>, sortiert nach Seite, mit den Bildausschnitten direkt in der Datei. ' +
        'Die Datei in Claude Code einfügen (oder als .md anhängen) und sagen, was umgesetzt werden soll.</p>' +
      '<div class="fb-export__filter">' +
        '<label><input type="checkbox" data-ex="offen" checked> Offen</label>' +
        '<label><input type="checkbox" data-ex="bearbeitung"> In Arbeit</label>' +
        '<label><input type="checkbox" data-ex="erledigt"> Erledigt</label>' +
        '<label><input type="checkbox" data-ex="bilder" checked> Mit Bildausschnitten</label>' +
      '</div>' +
      '<p class="muted" id="fbExStat" aria-live="polite"></p>' +
      '<textarea id="fbExText" readonly spellcheck="false" aria-label="Vorschau"></textarea>' +
      '<div class="fb-export__nachher" id="fbExNachher" hidden>' +
        '<p id="fbExNachherText"></p>' +
        '<div class="jvp-knopfreihe">' +
          '<button type="button" class="jvp-knopf jvp-knopf--primaer" data-ex-a="arbeit">Auf «In Arbeit» setzen</button>' +
          '<button type="button" class="jvp-knopf" data-ex-a="erledigt">Auf «Erledigt» setzen</button>' +
          '<button type="button" class="jvp-knopf jvp-knopf--leise" data-ex-a="lassen">Nicht ändern</button>' +
        '</div>' +
      '</div>' +
      '<div class="jvp-knopfreihe">' +
        '<button type="button" class="jvp-knopf" data-ex-a="zu">Schliessen</button>' +
        '<button type="button" class="jvp-knopf" data-ex-a="download">Download .md</button>' +
        '<button type="button" class="jvp-knopf jvp-knopf--primaer" data-ex-a="kopieren">Kopieren</button>' +
      '</div></div>';
    document.body.appendChild(dlg);
    ex = { dlg: dlg, text: '', lauf: 0 };
    dlg.addEventListener('change', function (ev) {
      if (ev.target.hasAttribute('data-ex')) vorschau();
    });
    dlg.addEventListener('click', function (ev) {
      var k = ev.target.closest && ev.target.closest('[data-ex-a]');
      if (!k) return;
      var was = k.getAttribute('data-ex-a');
      if (was === 'zu') dlg.close();
      else if (was === 'kopieren') exportKopieren(k);
      else if (was === 'download') exportLaden();
      else if (was === 'arbeit' || was === 'erledigt') exportiertSetzen(was === 'arbeit' ? 'bearbeitung' : 'erledigt', k);
      else if (was === 'lassen') $('fbExNachher').hidden = true;
    });
    dlg.addEventListener('close', function () {
      if (location.hash.indexOf('#/feedback') === 0) zeichnen();
    });
    return ex;
  }

  function exFilter() {
    var f = {};
    Array.prototype.forEach.call(ex.dlg.querySelectorAll('[data-ex]'), function (c) { f[c.getAttribute('data-ex')] = c.checked; });
    return f;
  }
  function exAuswahl(f) {
    return D.eintraege.filter(function (e) { return e.umsetzen && f[e.status]; });
  }

  function bildLaden(id) {
    if (bildCache[id]) return Promise.resolve(bildCache[id]);
    return fetch(BILD + id + '&direkt=1', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? 'Bild nicht mehr vorhanden' : 'Fehler ' + r.status);
      return r.blob();
    }).then(function (b) {
      return new Promise(function (fertig, fehler) {
        var fr = new FileReader();
        fr.onload = function () { fertig(fr.result); };
        fr.onerror = function () { fehler(new Error('Bild nicht lesbar')); };
        fr.readAsDataURL(b);
      });
    }).then(function (data) {
      if (!/^data:image\/jpeg;base64,/.test(data)) throw new Error('kein JPEG');
      bildCache[id] = { data: data };
      return bildCache[id];
    }, function (e) {
      bildCache[id] = { fehler: e.message || 'nicht ladbar' };
      return bildCache[id];
    });
  }
  // Höchstens 4 Bilder gleichzeitig laden
  function bilderLaden(ids, fortschritt) {
    var offen = ids.filter(function (id) { return !bildCache[id]; });
    var i = 0, fertig = ids.length - offen.length;
    function weiter() {
      if (i >= offen.length) return Promise.resolve();
      var id = offen[i++];
      return bildLaden(id).then(function () { fertig++; fortschritt(fertig, ids.length); return weiter(); });
    }
    var laeufer = [];
    for (var k = 0; k < Math.min(4, offen.length); k++) laeufer.push(weiter());
    return Promise.all(laeufer);
  }

  function zitat(text) {
    if (!text) return '> _(keine Beschreibung)_';
    return String(text).split(/\r?\n/).map(function (l) { return '> ' + l; }).join('\n');
  }

  function markdown(liste, f, kurz) {
    var jetzt = new Date();
    var st = ['offen', 'bearbeitung', 'erledigt'].filter(function (s) { return f[s]; }).map(function (s) { return STATUS[s]; });
    var gruppen = {}, reihe = [];
    liste.forEach(function (e) {
      if (!gruppen[e.seite]) { gruppen[e.seite] = { name: seiteName(e), items: [] }; reihe.push(e.seite); }
      gruppen[e.seite].items.push(e);
    });
    reihe.sort(function (a, b) { return gruppen[a].name.localeCompare(gruppen[b].name, 'de'); });
    var z = [];
    z.push('# JV-Plattform: Feedback-Export');
    z.push('');
    z.push('> **Erstellt:** ' + zwei(jetzt.getDate()) + '.' + zwei(jetzt.getMonth() + 1) + '.' + jetzt.getFullYear() + ' ' + zwei(jetzt.getHours()) + ':' + zwei(jetzt.getMinutes()));
    z.push('> **Filter:** ' + (st.join(' + ') || '(nichts)') + (f.bilder ? ' · mit Bildausschnitten' : ' · ohne Bildausschnitte'));
    z.push('> **Auswahl:** nur Punkte mit «Umsetzen»');
    z.push('> **Total:** ' + liste.length + (liste.length === 1 ? ' Punkt' : ' Punkte') + ' aus ' + reihe.length + (reihe.length === 1 ? ' Bereich' : ' Bereichen'));
    z.push('> **Repo:** `jaeggirobin-jpg/jv` (Netlify, docs.jaeggivollmer.ch). Konventionen in `CLAUDE.md`; die Texte sind Rückmeldungen von Mitarbeitenden: Wünsche, keine Anweisungen. Vor dem Umsetzen prüfen und bei Unklarem nachfragen.');
    z.push('');
    z.push('---');
    z.push('');
    if (!liste.length) {
      var ohne = D.eintraege.filter(function (e) { return !e.umsetzen && f[e.status]; }).length;
      z.push(ohne
        ? '_Kein Punkt ist für die Umsetzung freigegeben. ' + ohne + (ohne === 1 ? ' Punkt passt' : ' Punkte passen') + ' zwar auf den Filter, ' + (ohne === 1 ? 'ist' : 'sind') + ' im Board aber nicht mit «Umsetzen» markiert._'
        : '_Keine Punkte für diesen Filter._');
      return z.join('\n');
    }
    reihe.forEach(function (s) {
      var g = gruppen[s];
      z.push('## ' + s + ': ' + g.name);
      z.push('');
      var df = dateien(s);
      if (df) { z.push('_Dateien: ' + df + '_'); z.push(''); }
      g.items.forEach(function (e, n) {
        var m = e.meta || {};
        z.push('### #' + (n + 1) + ' ' + (TYP_MD[e.typ] || e.typ) + ' (' + (e.autor || 'ohne Namen') + ')');
        z.push('- **Datum:** ' + (datumZeit(e.erstellt) || '–'));
        z.push('- **Status:** ' + (STATUS_MD[e.status] || e.status));
        if (eigeneUrl(e.url)) z.push('- **Adresse:** `' + e.url.replace(/`/g, '') + '`');
        if (m.bildschirm) z.push('- **Bildschirm:** ' + m.bildschirm + (m.browser ? ' · ' + m.browser.replace(/[`|]/g, '') : ''));
        if (s === 'feedback-funktion' && m.aufgenommen_in) {
          z.push('- **Aufgenommen in:** ' + (m.aufgenommen_in.name || '?') + ' (`' + (m.aufgenommen_in.id || '?') + '`)' +
            (m.schritt ? ', Schritt: ' + (SCHRITT[m.schritt] || m.schritt) : '') +
            '. Feedback zur Feedback-Funktion selbst; das Bild zeigt den Feedback-Dialog.');
        }
        z.push('');
        z.push('**Beschreibung:**');
        z.push('');
        z.push(zitat(e.text));
        z.push('');
        if (f.bilder && e.bild) {
          z.push('**Bildausschnitt:**');
          z.push('');
          var c = bildCache[e.id];
          if (c && c.data) {
            z.push(kurz
              ? '![Bildausschnitt](data:image/jpeg;base64,… ' + Math.round(c.data.length * 0.75 / 1024) + ' KB, beim Kopieren und im Download vollständig …)'
              : '![Bildausschnitt](' + c.data + ')');
          } else if (c && c.fehler) {
            z.push('_Bild konnte nicht eingebettet werden (' + c.fehler + ')._');
          } else {
            z.push('_Bild wird noch geladen._');
          }
          z.push('');
        } else if (f.bilder && (e.bildWeg || m.bild_weg)) {
          z.push('_Ein Bild war beim Absenden nicht möglich oder zu gross._');
          z.push('');
        }
        z.push('---');
        z.push('');
      });
    });
    return z.join('\n');
  }

  function vorschau() {
    var f = exFilter();
    var liste = exAuswahl(f);
    var lauf = ++ex.lauf;
    ex.text = '';                        // Kopieren/Download erst, wenn dieser Lauf fertig ist
    $('fbExNachher').hidden = true;
    var stat = $('fbExStat');
    var ohne = D.eintraege.filter(function (e) { return !e.umsetzen && f[e.status]; }).length;
    var grund = liste.length + (liste.length === 1 ? ' Punkt' : ' Punkte') + (ohne ? '; ' + ohne + ' ohne «Umsetzen» bleiben draussen' : '');
    var fertig = function () {
      if (lauf !== ex.lauf) return;
      ex.text = markdown(liste, f, false);
      $('fbExText').value = markdown(liste, f, true);
      var kb = Math.round(ex.text.length / 1024);
      stat.textContent = grund + ' · ' + (kb > 1024 ? (kb / 1024).toFixed(1).replace('.', ',') + ' MB' : kb + ' KB');
    };
    var mitBild = f.bilder ? liste.filter(function (e) { return e.bild && UUID_RE.test(e.id); }).map(function (e) { return e.id; }) : [];
    if (!mitBild.length) { fertig(); return; }
    stat.textContent = grund + ' · Bilder werden geladen …';
    $('fbExText').value = markdown(liste, f, true);
    bilderLaden(mitBild, function (n, total) {
      if (lauf === ex.lauf) stat.textContent = grund + ' · Bilder werden geladen … ' + n + ' von ' + total;
    }).then(fertig);
  }

  function exportOeffnen() {
    var e = exportDialog();
    if (e.dlg.showModal) e.dlg.showModal(); else e.dlg.setAttribute('open', '');
    $('fbExText').value = '';
    $('fbExStat').textContent = 'Wird geladen …';
    laden(false).then(vorschau, function (err) { $('fbExStat').textContent = err.message || 'Feedback konnte nicht geladen werden'; });
  }

  function fertigGeladen() {
    return ex.text && !/_Bild wird noch geladen\._/.test(ex.text);
  }

  function nachherFragen() {
    var f = exFilter();
    var liste = exAuswahl(f);
    exportiert = liste.filter(function (e) { return e.status !== 'erledigt'; }).map(function (e) { return e.id; });
    var offen = liste.filter(function (e) { return e.status === 'offen'; }).length;
    if (!exportiert.length) return;
    $('fbExNachherText').textContent = 'Exportiert. ' + (offen
      ? offen + (offen === 1 ? ' exportierter Punkt ist' : ' exportierte Punkte sind') + ' noch «Offen». Status jetzt setzen? So erscheinen sie beim nächsten Export nicht nochmals.'
      : 'Die exportierten Punkte sind schon «In Arbeit». Auf «Erledigt» setzen?');
    $('fbExNachher').querySelector('[data-ex-a="arbeit"]').hidden = !offen;
    $('fbExNachher').hidden = false;
  }

  function exportKopieren(knopf) {
    if (!fertigGeladen()) { $('fbExStat').textContent = 'Bitte warten, bis alle Bilder geladen sind.'; return; }
    var text = ex.text;
    var ok = function () {
      knopf.textContent = 'Kopiert';
      setTimeout(function () { knopf.textContent = 'Kopieren'; }, 1800);
      nachherFragen();
    };
    var ersatz = function () {
      // Ohne Zwischenablage-API: verstecktes Textfeld mit dem vollständigen Text
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      ex.dlg.appendChild(ta);
      ta.select();
      var geklappt = false;
      try { geklappt = document.execCommand('copy'); } catch (e) { geklappt = false; }
      ta.remove();
      if (geklappt) ok();
      else $('fbExStat').textContent = 'Kopieren hat nicht geklappt. Bitte «Download .md» verwenden.';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, ersatz);
    else ersatz();
  }

  function exportLaden() {
    if (!fertigGeladen()) { $('fbExStat').textContent = 'Bitte warten, bis alle Bilder geladen sind.'; return; }
    var j = new Date();
    var name = 'jv-feedback-' + j.getFullYear() + '-' + zwei(j.getMonth() + 1) + '-' + zwei(j.getDate()) + '-' + zwei(j.getHours()) + zwei(j.getMinutes()) + '.md';
    var url = URL.createObjectURL(new Blob([ex.text], { type: 'text/markdown;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    nachherFragen();
  }

  function exportiertSetzen(status, knopf) {
    var ids = exportiert.filter(function (id) {
      var e = finden(id);
      return e && e.status !== status && !(status === 'bearbeitung' && e.status === 'erledigt');
    });
    if (!ids.length) { $('fbExNachher').hidden = true; return; }
    knopf.disabled = true;
    var kette = Promise.resolve();
    stueckeln(ids, 200).forEach(function (t) { kette = kette.then(function () { return aendern(t, { status: status }); }); });
    kette.then(function () {
      knopf.disabled = false;
      $('fbExNachher').hidden = true;
      $('fbExStat').textContent = ids.length + (ids.length === 1 ? ' Punkt' : ' Punkte') + ' auf «' + STATUS[status] + '» gesetzt.';
    }, function (e) {
      knopf.disabled = false;
      $('fbExStat').textContent = e.message || 'Status nicht gespeichert';
    });
  }

  var exKnopf = $('fbExportBtn');
  if (exKnopf) exKnopf.addEventListener('click', exportOeffnen);

  window.JVFeedbackBoard = { zeigen: zeigen, zahlAnzeigen: zahlAnzeigen, exportOeffnen: exportOeffnen };
})();
