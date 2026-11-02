// plattform.js — JV-Plattform: Übersicht, Projekte, Projektseite und Datenübernahme
//
// Läuft nach dem Skript des Admin-Panels (public/index.html) und nutzt dessen Funktionen
// (apiCall, openKundeDetail, closeDetail, bereichOeffnen). Die Daten der Tools kommen über
// /api/tool-db (Anmeldung und Speicher aus /tools/assets/jv-bridge.js), Adressen und Karten
// über geo.admin.ch (/tools/assets/geo-admin.js).
//
// «Ein Projekt für alles»: Das Projekt des Bau-Terminplaners (tool_docs terminplaner/projects/<id>)
// ist das Projekt der ganzen Plattform. Darauf verweisen kunden.projekt_id (Kundenzugang, Dokumente),
// badvis/objekte/<id>.projektId (Badvisualisierungen) und gaeste-wc/projects/<id>.projektId (3D-Vorschau).
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var bridge = window.JVBridge;
  var geo = window.JVGeo;
  var STATUS = ['Entwurf', 'Freigegeben', 'In Ausführung', 'Abgeschlossen'];
  var STATUS_ORDNUNG = { 'In Ausführung': 0, 'Freigegeben': 1, 'Entwurf': 2, 'Abgeschlossen': 3 };
  var WC_BEISPIEL = 'gaeste-wc';      // fest eingebautes Projekt des Gäste-WC-Tools (Scan aus der Datenübernahme)
  var CACHE_MS = 15000;
  var GEO_KARTE = /^https:\/\/wms\.geo\.admin\.ch\//;
  var PIN = '<svg viewBox="0 0 18 26" aria-hidden="true"><path d="M9 25C9 25 1 15.5 1 9a8 8 0 0 1 16 0c0 6.5-8 16-8 16z" fill="#B98140" stroke="#fff" stroke-width="1.5"/><circle cx="9" cy="9" r="3" fill="#fff"/></svg>';
  var TITEL = {
    uebersicht: 'Übersicht', projekte: 'Projekte', projekt: 'Projekt', kunden: 'Kunden', katalog: 'Katalog',
    drohnencheck: 'Drohnen-Check', krv: 'KRV-Check', 'import': 'Daten übernehmen', feedback: 'Feedback', zugaenge: 'Logins'
  };
  // Welcher Bereich (Recht des Logins) zu welcher Ansicht gehört; «verwaltung» = nur Admins
  var VIEW_BEREICH = {
    projekte: 'projekte', projekt: 'projekte', kunden: 'kunden', katalog: 'katalog', drohnencheck: 'anfragen', krv: 'anfragen',
    'import': 'verwaltung', feedback: 'verwaltung', zugaenge: 'verwaltung'
  };

  // ── Hilfen ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function zweistellig(n) { return (n < 10 ? '0' : '') + n; }
  function isoTag(d) { return d.getFullYear() + '-' + zweistellig(d.getMonth() + 1) + '-' + zweistellig(d.getDate()); }
  function isoHeute() { return isoTag(new Date()); }
  function datum(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? m[3] + '.' + m[2] + '.' + m[1] : '';
  }
  function datumLang(d) { return d.toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function naechsterMontag() {
    var d = new Date();
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return isoTag(d);
  }
  function neueId() {
    var z = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var b = new Uint8Array(10);
    crypto.getRandomValues(b);
    var s = '';
    for (var i = 0; i < b.length; i++) s += z[b[i] % z.length];
    return s;
  }
  function meldung(el, text, art) {
    if (typeof el === 'string') el = $(el);
    if (!el) return;
    el.innerHTML = text ? '<div class="msg ' + (art || 'info') + '">' + esc(text) + '</div>' : '';
  }
  function kopieren(text) {
    if (!navigator.clipboard) return Promise.resolve(false);
    return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
  }
  function anfrage(pfad, optionen) { return bridge.anfrage(pfad, optionen); }

  // ── Angemeldete Person und ihre Rechte ────────────────────────────────
  function ich() { return (bridge.benutzer && bridge.benutzer()) || null; }
  function darf(bereich) {
    var b = ich();
    if (!b) return false;
    if (!bereich || b.rolle === 'admin') return true;
    if (bereich === 'verwaltung') return false;
    return (b.bereiche || []).indexOf(bereich) >= 0;
  }
  function kuerzel(name) {
    var t = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!t.length) return '?';
    return ((t[0][0] || '') + (t.length > 1 ? t[t.length - 1][0] : (t[0][1] || ''))).toUpperCase();
  }
  function benutzerAnzeigen() {
    var b = ich();
    if (!b) return;
    $('benutzerKuerzel').textContent = b.hauptzugang ? 'JV' : kuerzel(b.name);
    $('benutzerKurzname').textContent = b.hauptzugang ? 'Hauptzugang' : String(b.name || '').split(' ')[0];
    $('benutzerName').textContent = b.name || '';
    $('benutzerInfo').textContent = b.hauptzugang ? 'Admin (Hauptpasswort)' : [b.email, b.rolle === 'admin' ? 'Admin' : 'Mitarbeiter'].filter(Boolean).join(' · ');
    $('passwortBtn').hidden = !!b.hauptzugang;
  }
  // Navigation, Kacheln und Gruppen nur zeigen, wenn das Login den Bereich hat
  function rechteAnwenden() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-bereich]'), function (el) {
      el.hidden = !darf(el.getAttribute('data-bereich'));
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-nur-admin]'), function (el) {
      el.hidden = !darf('verwaltung');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.kachel--gruppe'), function (g) {
      var el = g.nextElementSibling, sichtbar = false;
      while (el && !el.classList.contains('kachel--gruppe')) {
        if (!el.hidden) sichtbar = true;
        el = el.nextElementSibling;
      }
      g.hidden = !sichtbar || (g.hasAttribute('data-nur-admin') && !darf('verwaltung'));
    });
  }
  window.JVP = { darf: darf, ich: ich, esc: esc };
  function toolSchreiben(tool, aktion, pfad, daten) {
    return anfrage('/tool-db', { method: 'POST', body: { tool: tool, aktion: aktion, pfad: pfad, daten: daten } });
  }
  function admin(pfad, daten) {
    return window.apiCall(pfad, daten ? { method: 'POST', body: JSON.stringify(daten) } : undefined);
  }

  // ── Daten (kurz zwischengespeichert, Neuladen bei jedem Seitenwechsel nach 15 s) ──
  var D = { projekte: {}, config: {}, objekte: {}, wc: {}, kunden: [], links: [] };
  var stand = {};
  var laufend = {};

  function toolLaden(tool, sammlungen) {
    return anfrage('/tool-db?tool=' + tool + '&sammlungen=' + sammlungen.join(',')).then(function (r) {
      var aus = {};
      sammlungen.forEach(function (s) { aus[s] = {}; });
      (r.docs || []).forEach(function (d) {
        var t = String(d.pfad).split('/');
        if (aus[t[0]]) aus[t[0]][t[1]] = d.daten || {};
      });
      return aus;
    });
  }

  var LADER = {
    projekte: function () {
      return toolLaden('terminplaner', ['projects', 'config']).then(function (a) {
        Object.keys(a.projects).forEach(function (id) { a.projects[id].id = id; });
        D.projekte = a.projects;
        D.config = a.config.main || {};
      });
    },
    objekte: function () {
      return toolLaden('badvis', ['objekte']).then(function (a) {
        Object.keys(a.objekte).forEach(function (id) { a.objekte[id].id = id; });
        D.objekte = a.objekte;
      });
    },
    wc: function () { return toolLaden('gaeste-wc', ['projects']).then(function (a) { D.wc = a.projects; }); },
    kunden: function () { return admin('/list-kunden').then(function (r) { D.kunden = r.kunden || []; }); },
    links: function () { return admin('/visualisierung-links').then(function (r) { D.links = r.links || []; }); }
  };

  function laden(namen, frisch) {
    return Promise.all(namen.map(function (n) {
      if (!frisch && stand[n] && Date.now() - stand[n] < CACHE_MS) return null;
      if (laufend[n]) return laufend[n];
      laufend[n] = LADER[n]().then(function () {
        stand[n] = Date.now();
        delete laufend[n];
      }, function (e) {
        delete laufend[n];
        throw e;
      });
      return laufend[n];
    }));
  }
  function veraltet() {
    Array.prototype.forEach.call(arguments, function (n) { delete stand[n]; });
  }

  // ── Projekt-Hilfen ────────────────────────────────────────────────────
  function projektListe() {
    return Object.keys(D.projekte).map(function (id) { return D.projekte[id]; });
  }
  function leiterVon(p) {
    var L = D.config.leaders || [];
    for (var i = 0; i < L.length; i++) if (L[i].id === p.leader) return L[i];
    return null;
  }
  function leiterName(p) {
    var l = leiterVon(p);
    return (l && l.name) || p.author || '';
  }
  function kundeName(k) {
    var a = { frau: 'Frau ', herr: 'Herr ', familie: 'Familie ' };
    return (a[k.anrede_typ] || '') + (k.anrede_typ !== 'familie' && k.vorname ? k.vorname + ' ' : '') + (k.nachname || '');
  }
  function kundenVon(pid) { return D.kunden.filter(function (k) { return k.projekt_id === pid; }); }
  function objekteListe() {
    return Object.keys(D.objekte).map(function (id) { return D.objekte[id]; })
      .sort(function (a, b) { return (a.reihenfolge || 0) - (b.reihenfolge || 0); });
  }
  function objekteVon(pid) { return objekteListe().filter(function (o) { return o.projektId === pid; }); }
  function wcListe() {
    var liste = Object.keys(D.wc).filter(function (id) { return id !== WC_BEISPIEL && !D.wc[id].builtin; })
      .map(function (id) { return Object.assign({}, D.wc[id], { id: id, vorhanden: true }); })
      .sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
    var b = D.wc[WC_BEISPIEL] || {};
    liste.unshift({
      id: WC_BEISPIEL, name: b.name || 'Gäste-WC Duggingen', customer: b.customer || '', scanDate: b.scanDate || '',
      projektId: b.projektId || null, builtin: true, vorhanden: !!D.wc[WC_BEISPIEL]
    });
    return liste;
  }
  function wcVon(pid) { return wcListe().filter(function (w) { return w.projektId === pid; }); }
  function gewerke(p) {
    return (Array.isArray(p.phases) ? p.phases : []).reduce(function (a, ph) { return a + ((ph && ph.tasks) || []).length; }, 0);
  }
  function nachAenderung(a, b) { return String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || '')); }
  function nachStatus(a, b) {
    var d = (STATUS_ORDNUNG[a.state || 'Entwurf'] || 0) - (STATUS_ORDNUNG[b.state || 'Entwurf'] || 0);
    return d || nachAenderung(a, b);
  }

  // Kartenausschnitt der Projektadresse (geo.admin.ch). Alte Bilder aus dem claude.ai-Speicher (/_blob/…)
  // gibt es in der Plattform nicht: diese Karten werden neu erzeugt.
  function kartenUrl(p, px) {
    var bg = p && p.mapBg;
    if (!bg || !bg.url || (bg.addr || '') !== (p.address || '') || !GEO_KARTE.test(bg.url)) return '';
    return px ? bg.url.replace(/WIDTH=\d+/, 'WIDTH=' + px).replace(/HEIGHT=\d+/, 'HEIGHT=' + px) : bg.url;
  }

  var KOORD = {};      // Adresse → { e, n } aus der Vorschlagsliste
  var kartenLauf = {};
  function karteErzeugen(id) {
    var p = D.projekte[id];
    if (!p || !String(p.address || '').trim()) return Promise.resolve(null);
    if (kartenLauf[id]) return kartenLauf[id];
    var adresse = p.address;
    var bg = p.mapBg;
    var bekannt = KOORD[adresse.trim()] ||
      (bg && bg.addr === adresse && +bg.e > 2e6 && +bg.n > 1e6 ? { e: +bg.e, n: +bg.n } : null);
    kartenLauf[id] = geo.karteFuerAdresse(adresse, bekannt).then(function (k) {
      if (!k) return null;
      var neu = { addr: adresse, url: k.url, e: k.e, n: k.n, fy: geo.KARTE.fy, src: k.quelle, created: isoHeute() };
      return toolSchreiben('terminplaner', 'patch', 'projects/' + id, { mapBg: neu }).then(function () {
        var p2 = D.projekte[id];
        if (p2 && p2.address === adresse) p2.mapBg = neu;
        if (aktuell === 'projekt' && aktuellesProjekt === id) kopfKarte(p2);
        return neu;
      });
    }).catch(function () { return null; }).then(function (r) {
      delete kartenLauf[id];
      return r;
    });
    return kartenLauf[id];
  }

  function karteHtml(p, px, mitLabel) {
    var url = kartenUrl(p, px);
    if (!url) {
      return '<span class="ohne">' + (p.address ? 'Karte der Projektadresse wird erstellt …' : 'Noch keine Adresse') + '</span>';
    }
    var q = (geo.QUELLEN && geo.QUELLEN[p.mapBg.src]) || 'Karte © swisstopo';
    return '<img src="' + esc(url) + '" alt="Karte: Umgebung von ' + esc(p.address) + '" loading="lazy" referrerpolicy="no-referrer">' +
      (mitLabel
        ? '<div class="pin">' + PIN + '<span>' + esc(p.address) + '</span></div><span class="quelle">' + esc(q) + '</span>'
        : '<svg class="pin" viewBox="0 0 18 26" aria-hidden="true"><path d="M9 25C9 25 1 15.5 1 9a8 8 0 0 1 16 0c0 6.5-8 16-8 16z" fill="#B98140" stroke="#fff" stroke-width="1.5"/><circle cx="9" cy="9" r="3" fill="#fff"/></svg>');
  }

  function projektKachel(p, zusatz) {
    return '<a class="kachel kachel--projekt" href="#/projekt/' + encodeURIComponent(p.id) + '">' +
      '<div class="karte">' + karteHtml(p, 480, false) + '</div>' +
      '<div class="inhalt"><span class="tag">' + esc(p.state || 'Entwurf') + '</span>' +
      '<span class="n">' + esc(p.name || 'Ohne Namen') + '</span>' +
      '<span class="d">' + esc([p.address, p.client].filter(Boolean).join(' · ') || 'Keine Adresse') + '</span>' +
      (zusatz || '') + '</div></a>';
  }

  function projektPillen(p) {
    var pillen = [];
    var leiter = leiterName(p);
    if (leiter) pillen.push('<span class="pille">PL ' + esc(leiter) + '</span>');
    var start = p.first || p.start;
    if (start) pillen.push('<span class="pille">Start ' + esc(datum(start)) + '</span>');
    var k = kundenVon(p.id).length;
    if (k) pillen.push('<span class="pille pille--kupfer">' + (k === 1 ? 'Kundenzugang' : k + ' Kundenzugänge') + '</span>');
    var o = objekteVon(p.id).length;
    if (o) pillen.push('<span class="pille pille--kupfer">' + o + (o === 1 ? ' Visualisierung' : ' Visualisierungen') + '</span>');
    if (wcVon(p.id).length) pillen.push('<span class="pille pille--kupfer">3D-Vorschau</span>');
    return pillen.length ? '<span class="meta">' + pillen.join('') + '</span>' : '';
  }

  // ── Router ────────────────────────────────────────────────────────────
  var aktuell = null;
  var aktuellesProjekt = null;

  function route() {
    var h = String(location.hash || '').replace(/^#\/?/, '');
    var teile = h.split('/');
    var name = teile[0] || 'uebersicht';
    var arg = '';
    try { arg = decodeURIComponent(teile.slice(1).join('/')); } catch (e) { arg = ''; }
    if (!TITEL[name] || (name === 'projekt' && !arg)) name = name === 'projekt' ? 'projekte' : 'uebersicht';
    if (VIEW_BEREICH[name] && !darf(VIEW_BEREICH[name])) name = 'uebersicht';

    if (typeof window.closeDetail === 'function') window.closeDetail();
    var dlg = $('projektDialog');
    if (dlg && dlg.open) dlg.close();
    Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (s) {
      s.hidden = s.getAttribute('data-view') !== name;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.jvp-nav a'), function (a) {
      var n = a.getAttribute('data-nav');
      if (n === name || (n === 'projekte' && name === 'projekt')) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.title = TITEL[name] + ' · JV-Plattform';
    if (aktuell !== name || name === 'projekt') window.scrollTo(0, 0);
    aktuell = name;
    if (window.JVFeedback) window.JVFeedback.seite('plattform-' + name, 'Plattform · ' + TITEL[name]);
    var menue = $('benutzerMenue');
    if (menue) menue.open = false;

    if (name === 'uebersicht') uebersicht();
    else if (name === 'projekte') projekte();
    else if (name === 'projekt') projekt(arg);
    else if (name === 'import') importBereit();
    else if (name === 'feedback') window.JVFeedbackBoard.zeigen();
    else if (name === 'zugaenge') window.JVZugaenge.zeigen();
    else if (name === 'kunden') {
      laden(['projekte']).catch(function () { /* ohne Projekte: Kunden trotzdem zeigen */ }).then(function () {
        kundenProjektAuswahl();
        window.bereichOeffnen('kunden');
      });
    } else window.bereichOeffnen(name);
  }

  // ── Übersicht ─────────────────────────────────────────────────────────
  function uebersicht() {
    var ziel = $('uebersichtProjekte');
    ziel.parentNode.hidden = !darf('projekte');
    if (window.JVFeedbackBoard && darf('verwaltung')) window.JVFeedbackBoard.zahlAnzeigen($('feedbackKachelZahl'));
    if (!darf('projekte')) {
      $('uebersichtFuss').textContent = 'Stand ' + datumLang(new Date());
      return;
    }
    laden(['projekte']).then(function () {
      var alle = projektListe();
      var liste = alle.filter(function (p) { return p.state !== 'Abgeschlossen'; }).sort(nachAenderung).slice(0, 6);
      ziel.innerHTML = liste.length
        ? liste.map(function (p) { return projektKachel(p); }).join('')
        : '<p class="jvp-leer">Noch keine Projekte. Unter <a href="#/projekte">Projekte</a> anlegen oder unter <a href="#/import">Daten übernehmen</a> aus dem Terminplaner einlesen.</p>';
      $('uebersichtFuss').textContent = '5 Tools · ' + alle.length + (alle.length === 1 ? ' Projekt' : ' Projekte') + ' · Stand ' + datumLang(new Date());
    }).catch(function (e) {
      ziel.innerHTML = '<div class="msg error">' + esc('Projekte konnten nicht geladen werden: ' + e.message) + '</div>';
    });
  }

  // ── Projektliste ──────────────────────────────────────────────────────
  var filter = { status: '', suche: '' };

  function projekte() {
    if (!projektListe().length) $('projekteListe').innerHTML = '<p class="jvp-leer">Wird geladen …</p>';
    laden(['projekte']).then(function () {
      listeZeigen();
      // Zuordnungen (Kundenzugang, Visualisierungen, 3D) nachladen
      return laden(['kunden', 'objekte', 'wc']).then(listeZeigen, function () { /* Pillen fehlen dann */ });
    }).catch(function (e) {
      meldung('projekteMsg', 'Projekte konnten nicht geladen werden: ' + e.message, 'error');
    });
  }

  function listeZeigen() {
    if (aktuell !== 'projekte') return;
    var alle = projektListe();
    var anzahl = { '': alle.length };
    alle.forEach(function (p) { var s = p.state || 'Entwurf'; anzahl[s] = (anzahl[s] || 0) + 1; });
    $('projektChips').innerHTML = [''].concat(STATUS).map(function (s) {
      return '<button type="button" data-status="' + esc(s) + '" aria-pressed="' + (filter.status === s) + '">' +
        esc(s || 'Alle') + ' <span class="muted">' + (anzahl[s] || 0) + '</span></button>';
    }).join('');
    var q = filter.suche.toLowerCase();
    var liste = alle.filter(function (p) {
      if (filter.status && (p.state || 'Entwurf') !== filter.status) return false;
      if (!q) return true;
      return [p.name, p.address, p.client, leiterName(p)].join(' ').toLowerCase().indexOf(q) !== -1;
    }).sort(nachStatus);
    $('projekteListe').innerHTML = liste.length
      ? liste.map(function (p) { return projektKachel(p, projektPillen(p)); }).join('')
      : '<p class="jvp-leer">' + (alle.length ? 'Keine passenden Projekte.' : 'Noch keine Projekte. Mit «Neues Projekt» anlegen oder unter <a href="#/import">Daten übernehmen</a> aus dem Terminplaner einlesen.') + '</p>';
  }

  $('projektSuche').addEventListener('input', function () {
    filter.suche = this.value.trim();
    listeZeigen();
  });
  $('projektChips').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-status]');
    if (!b) return;
    filter.status = b.getAttribute('data-status');
    listeZeigen();
  });

  // ── Neues Projekt ─────────────────────────────────────────────────────
  function leiterOptionen(gewaehlt) {
    var L = D.config.leaders || [];
    if (!L.length) return '<option value="">– Projektleiter im Terminplaner unter Einstellungen erfassen –</option>';
    return L.map(function (l) {
      return '<option value="' + esc(l.id) + '"' + (l.id === gewaehlt ? ' selected' : '') + '>' + esc(l.name || 'Ohne Namen') + '</option>';
    }).join('');
  }

  function dialogOeffnen() {
    var dlg = $('projektDialog');
    $('projektForm').reset();
    meldung('projektDialogMsg', '');
    $('pj-start').value = naechsterMontag();
    var ich = '';
    try { ich = localStorage.getItem('tp_me') || ''; } catch (e) { /* egal */ }
    $('pj-leiter').innerHTML = leiterOptionen(ich);
    laden(['projekte']).then(function () { $('pj-leiter').innerHTML = leiterOptionen(ich || $('pj-leiter').value); }, function () { /* egal */ });
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    $('pj-name').focus();
  }
  $('projektNeuBtn').addEventListener('click', dialogOeffnen);
  $('projektAbbrechen').addEventListener('click', function () { $('projektDialog').close(); });

  $('projektForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = $('pj-name').value.trim();
    if (!name) { meldung('projektDialogMsg', 'Bitte einen Projektnamen eingeben.', 'error'); return; }
    var leiterId = $('pj-leiter').value;
    var leiter = (D.config.leaders || []).filter(function (l) { return l.id === leiterId; })[0];
    var start = $('pj-start').value || naechsterMontag();
    var jetzt = new Date().toISOString();
    var id = neueId();
    // Gleicher Aufbau wie «Neues Projekt» im Terminplaner; Phasen kommen dort über «Vorlage einfügen»
    var daten = {
      name: name, address: $('pj-adresse').value.trim(), client: $('pj-bauherr').value.trim(),
      start: start, first: start, end: start, leader: leiterId, author: leiter ? leiter.name || '' : '', phone: '',
      version: '1.0', state: 'Entwurf', created: jetzt, updated: jetzt,
      phases: [], contacts: [], images: [], attachPlan: true, chain2: true, planMode: 'start', targetEnd: '', moveIn: ''
    };
    var knopf = $('projektAnlegen');
    knopf.disabled = true;
    meldung('projektDialogMsg', 'Wird angelegt …', 'info');
    toolSchreiben('terminplaner', 'set', 'projects/' + id, daten).then(function () {
      daten.id = id;
      D.projekte[id] = daten;
      $('projektDialog').close();
      location.hash = '#/projekt/' + encodeURIComponent(id);
      if (daten.address) karteErzeugen(id);
    }).catch(function (e) {
      meldung('projektDialogMsg', 'Projekt konnte nicht angelegt werden: ' + e.message, 'error');
    }).then(function () { knopf.disabled = false; });
  });

  // ── Projektseite ──────────────────────────────────────────────────────
  var offen = {};   // aufgeklappte Formulare der Projektseite (bleiben beim Neuzeichnen offen)

  function projekt(id) {
    aktuellesProjekt = id;
    var ziel = $('projektInhalt');
    if (!D.projekte[id]) ziel.innerHTML = '<p class="jvp-leer">Wird geladen …</p>';
    else zeichnen(id);
    laden(['projekte', 'objekte', 'wc'].concat(darf('kunden') ? ['kunden', 'links'] : [])).then(function () {
      if (aktuell !== 'projekt' || aktuellesProjekt !== id) return;
      zeichnen(id);
      var p = D.projekte[id];
      if (p && p.address && !kartenUrl(p)) karteErzeugen(id);
    }).catch(function (e) {
      if (aktuellesProjekt === id) {
        ziel.insertAdjacentHTML('afterbegin', '<div class="msg error">' + esc('Daten konnten nicht vollständig geladen werden: ' + e.message) + '</div>');
      }
    });
  }

  function neuZeichnen(namen) {
    var id = aktuellesProjekt;
    return laden(namen, true).then(function () {
      if (aktuell === 'projekt' && aktuellesProjekt === id) zeichnen(id);
    });
  }

  function zeichnen(id) {
    var p = D.projekte[id];
    var ziel = $('projektInhalt');
    if (!p) {
      ziel.innerHTML = '<div class="card"><h2>Projekt nicht gefunden</h2><p class="jvp-leer">Vielleicht wurde es im Terminplaner gelöscht.</p></div>';
      return;
    }
    document.title = (p.name || 'Projekt') + ' · JV-Plattform';
    var aktiv = document.activeElement && document.activeElement.id;
    ziel.innerHTML =
      '<div class="jvp-stapel">' +
        '<div class="jvp-karte" id="projektKarte">' + karteHtml(p, 0, true) + '</div>' +
        '<header class="jvp-titel jvp-titel--zeile">' +
          '<div><span class="eb">Projekt · ' + esc(p.state || 'Entwurf') + '</span>' +
          '<h1>' + esc(p.name || 'Ohne Namen') + '</h1>' +
          '<p class="sub">' + esc([p.address || 'Keine Adresse', p.client ? 'Bauherrschaft ' + p.client : ''].filter(Boolean).join(' · ')) + '</p></div>' +
          '<div class="jvp-titel__knoepfe">' +
            '<button type="button" class="jvp-knopf" data-a="bearbeiten" aria-expanded="' + !!offen.bearbeiten + '">Projektdaten bearbeiten</button>' +
            '<a class="jvp-knopf jvp-knopf--primaer" href="' + terminplanUrl(p) + '">' + (gewerke(p) ? 'Terminplan öffnen' : 'Terminplan erstellen') + '</a>' +
          '</div>' +
        '</header>' +
        bearbeitenHtml(p) +
        faktenHtml(p) +
      '</div>' +
      '<div class="jvp-panels">' + (darf('kunden') ? panelKunden(p) : '') + panelVisualisierungen(p) + panelWc(p) + panelTerminplan(p) + '</div>';
    if (aktiv && $(aktiv)) $(aktiv).focus();
  }

  function kopfKarte(p) {
    var el = $('projektKarte');
    if (el && p) el.innerHTML = karteHtml(p, 0, true);
  }

  function terminplanUrl(p) {
    return '/tools/terminplaner/?projekt=' + encodeURIComponent(p.id) + (gewerke(p) ? '' : '&vorlage=1');
  }

  function faktenHtml(p) {
    var f = [
      ['Status', p.state || 'Entwurf'],
      ['Projektleiter', leiterName(p) || '–'],
      ['Start', datum(p.first || p.start) || '–'],
      ['Fertig', gewerke(p) ? datum(p.end) || '–' : '–'],
      ['Bauherrschaft', p.client || '–'],
      ['Zuletzt geändert', p.updated ? new Date(p.updated).toLocaleDateString('de-CH') : '–']
    ];
    return '<dl class="jvp-fakten">' + f.map(function (x) {
      return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>';
    }).join('') + '</dl>';
  }

  function bearbeitenHtml(p) {
    if (!offen.bearbeiten) return '';
    return '<form class="card" data-form="projekt" autocomplete="off">' +
      '<h2>Projektdaten bearbeiten</h2>' +
      '<p class="muted">Gilt überall: im Terminplan, auf dieser Seite und für neue Kundenzugänge.</p>' +
      '<label for="pb-name">Projektname</label><input type="text" id="pb-name" value="' + esc(p.name) + '" required>' +
      '<label for="pb-adresse">Adresse</label><input type="text" id="pb-adresse" value="' + esc(p.address) + '" placeholder="Strasse Nr, PLZ Ort">' +
      '<div class="form-row"><div><label for="pb-bauherr">Bauherrschaft</label><input type="text" id="pb-bauherr" value="' + esc(p.client) + '"></div>' +
      '<div><label for="pb-leiter">Projektleiter JV</label><select id="pb-leiter">' + leiterOptionen(p.leader) + '</select></div></div>' +
      '<label for="pb-status">Status</label><select id="pb-status">' + STATUS.map(function (s) {
        return '<option' + ((p.state || 'Entwurf') === s ? ' selected' : '') + '>' + esc(s) + '</option>';
      }).join('') + '</select>' +
      '<div data-meldung="projekt"></div>' +
      '<div class="jvp-knopfreihe" style="margin-top:14px"><button type="submit" class="jvp-knopf jvp-knopf--primaer">Speichern</button>' +
      '<button type="button" class="jvp-knopf" data-a="bearbeiten">Abbrechen</button></div>' +
      '</form>';
  }

  // Kundenzugang: Inspiration, Swipe und Dokumente (Tabelle kunden)
  function panelKunden(p) {
    var eigene = kundenVon(p.id);
    var andere = D.kunden.filter(function (k) { return k.projekt_id !== p.id; });
    var html = '<section class="card" aria-labelledby="pkKundenTitel"><h2 id="pkKundenTitel">Kundenzugang</h2>' +
      '<p class="muted">Inspiration, Swipe und Dokumente (PDF) für die Bauherrschaft.</p>';
    if (eigene.length) {
      html += '<ul class="jvp-liste">' + eigene.map(function (k) {
        var aktiv = k.status === 'aktiv';
        return '<li><div class="haupt"><b>' + esc(kundeName(k)) + '</b>' +
          '<span class="muted">' + esc([k.email, k.besuche ? k.besuche + ' Besuche' : 'noch nicht geöffnet'].filter(Boolean).join(' · ')) + '</span></div>' +
          '<span class="status ' + (aktiv ? 'active' : 'inactive') + '">' + esc(k.status) + '</span>' +
          '<div class="actions">' +
            '<button type="button" data-a="kunde-details" data-id="' + esc(k.id) + '">Details und Dokumente</button>' +
            '<button type="button" data-a="kunde-link" data-art="inspiration" data-token="' + esc(k.access_token) + '">Inspiration-Link</button>' +
            '<button type="button" data-a="kunde-link" data-art="swipe" data-token="' + esc(k.access_token) + '">Swipe-Link</button>' +
            '<button type="button" class="danger" data-a="kunde-loesen" data-id="' + esc(k.id) + '">Vom Projekt lösen</button>' +
          '</div></li>';
      }).join('') + '</ul>';
    } else {
      html += '<p class="jvp-leer">Noch kein Kundenzugang für dieses Projekt.</p>';
    }
    if (andere.length) {
      html += '<div class="jvp-zuordnen"><select id="pkKundeWahl" aria-label="Bestehenden Kunden zuordnen"><option value="">Bestehenden Kunden zuordnen …</option>' +
        andere.map(function (k) {
          var bei = k.projekt_id && D.projekte[k.projekt_id] ? ' (bei ' + (D.projekte[k.projekt_id].name || 'anderem Projekt') + ')' : '';
          return '<option value="' + esc(k.id) + '">' + esc(kundeName(k) + bei) + '</option>';
        }).join('') + '</select><button type="button" class="jvp-knopf jvp-knopf--klein" data-a="kunde-zuordnen">Zuordnen</button></div>';
    }
    if (offen.kundeNeu) {
      html += '<form class="jvp-stapel" data-form="kunde" autocomplete="off" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">' +
        '<h3 style="margin:0">Neuer Kundenzugang</h3>' +
        '<div class="form-row"><div><label for="pkk-anrede">Anrede</label><select id="pkk-anrede"><option value="frau">Frau</option><option value="herr">Herr</option><option value="familie">Familie</option></select></div>' +
        '<div><label for="pkk-vorname">Vorname</label><input type="text" id="pkk-vorname" autocomplete="off"></div></div>' +
        '<label for="pkk-nachname">Nachname *</label><input type="text" id="pkk-nachname" autocomplete="off" required>' +
        '<div class="form-row"><div><label for="pkk-email">E-Mail</label><input type="email" id="pkk-email" autocomplete="new-password"></div>' +
        '<div><label for="pkk-telefon">Telefon</label><input type="tel" id="pkk-telefon" autocomplete="off"></div></div>' +
        '<p class="muted" style="margin:6px 0 0">Adresse: ' + esc(p.address || '–') + '. Sichtbar sind alle Katalog-Punkte; anpassen unter «Details».</p>' +
        '<div class="jvp-knopfreihe"><button type="submit" class="jvp-knopf jvp-knopf--primaer">Kundenzugang anlegen</button>' +
        '<button type="button" class="jvp-knopf" data-a="kunde-neu">Abbrechen</button></div></form>';
    } else {
      html += '<div class="jvp-knopfreihe" style="margin-top:14px"><button type="button" class="jvp-knopf" data-a="kunde-neu">Neuen Kundenzugang anlegen</button></div>';
    }
    return html + '<div data-meldung="kunden" aria-live="polite"></div></section>';
  }

  // Badvisualisierungen mit geschützten Kundenlinks
  function panelVisualisierungen(p) {
    var eigene = objekteVon(p.id);
    var frei = objekteListe().filter(function (o) { return !o.projektId || !D.projekte[o.projektId]; });
    var kunden = kundenVon(p.id);
    var html = '<section class="card" aria-labelledby="pkVisTitel"><h2 id="pkVisTitel">Badvisualisierungen</h2>' +
      '<p class="muted">Vorher/Nachher mit Farbwahl. Für Kunden über einen geschützten Link mit Wasserzeichen, jederzeit deaktivierbar.</p>';
    if (eigene.length) {
      html += '<ul class="jvp-liste">' + eigene.map(function (o) {
        var bild = o.bilder && o.bilder.vorher ? '<img class="bild" src="/_blob/' + esc(o.bilder.vorher) + '" alt="" loading="lazy">' : '';
        var links = D.links.filter(function (l) { return l.objekt_id === o.id; });
        var li = '<li>' + bild + '<div class="haupt"><b>' + esc(o.titel || o.raum || o.id) + '</b>' +
          '<span class="muted">' + esc([o.raum, o.kunde, o.datum].filter(Boolean).join(' · ')) + '</span></div>' +
          '<div class="actions">' +
            '<a class="jvp-knopf jvp-knopf--klein" href="/tools/badvisualisierungen/#' + encodeURIComponent(o.id) + '">Ansehen</a>' +
            (darf('kunden') ? '<button type="button" data-a="link-neu" data-objekt="' + esc(o.id) + '">Kundenlink erstellen</button>' : '') +
            '<button type="button" class="danger" data-a="vis-loesen" data-id="' + esc(o.id) + '">Vom Projekt lösen</button>' +
          '</div>';
        if (links.length) {
          li += '<ul class="jvp-unterliste">' + links.map(function (l) {
            return '<li><div class="haupt"><b>Link für ' + esc(l.kunde_name) + '</b> <span class="muted">' +
              esc((l.view_count || 0) + ' Aufrufe' + (l.last_viewed_at ? ', zuletzt ' + new Date(l.last_viewed_at).toLocaleDateString('de-CH') : '')) + '</span></div>' +
              '<span class="status ' + (l.is_active ? 'active' : 'inactive') + '">' + (l.is_active ? 'Aktiv' : 'Inaktiv') + '</span>' +
              '<div class="actions"><button type="button" data-a="link-kopieren" data-token="' + esc(l.token) + '">Link kopieren</button>' +
              '<button type="button" data-a="link-aktiv" data-id="' + esc(l.id) + '" data-aktiv="' + (l.is_active ? '1' : '0') + '">' + (l.is_active ? 'Deaktivieren' : 'Aktivieren') + '</button>' +
              '<button type="button" class="danger" data-a="link-loeschen" data-id="' + esc(l.id) + '">Löschen</button></div></li>';
          }).join('') + '</ul>';
        }
        if (offen.linkNeu === o.id) {
          var vorschlag = kunden.length ? kundeName(kunden[0]) : (p.client || '');
          li += '<form class="jvp-unterliste" data-form="link" data-objekt="' + esc(o.id) + '" autocomplete="off" style="display:block;padding:12px;background:#f6f7f8;border-radius:6px">' +
            '<div class="form-row"><div><label for="pvl-kunde">Kundenzugang</label><select id="pvl-kunde">' +
              kunden.map(function (k, i) { return '<option value="' + esc(k.id) + '"' + (i === 0 ? ' selected' : '') + '>' + esc(kundeName(k)) + '</option>'; }).join('') +
              '<option value="">– ohne Kundenzugang –</option></select></div>' +
            '<div><label for="pvl-name">Name im Wasserzeichen *</label><input type="text" id="pvl-name" value="' + esc(vorschlag) + '" required autocomplete="off"></div></div>' +
            '<p class="muted" style="margin:6px 0 0">Mit Kundenzugang gilt: Wird der Kunde deaktiviert, ist auch dieser Link gesperrt.</p>' +
            '<div class="jvp-knopfreihe" style="margin-top:10px"><button type="submit" class="jvp-knopf jvp-knopf--primaer jvp-knopf--klein">Link erstellen und kopieren</button>' +
            '<button type="button" class="jvp-knopf jvp-knopf--klein" data-a="link-neu" data-objekt="' + esc(o.id) + '">Abbrechen</button></div></form>';
        }
        return li + '</li>';
      }).join('') + '</ul>';
    } else {
      html += '<p class="jvp-leer">Noch keine Visualisierung zugeordnet.</p>';
    }
    if (frei.length) {
      html += '<div class="jvp-zuordnen"><select id="pkVisWahl" aria-label="Visualisierung zuordnen"><option value="">Visualisierung zuordnen …</option>' +
        frei.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc([o.kunde, o.raum, o.titel].filter(Boolean).join(' · ') || o.id) + '</option>'; }).join('') +
        '</select><button type="button" class="jvp-knopf jvp-knopf--klein" data-a="vis-zuordnen">Zuordnen</button></div>';
    } else if (!objekteListe().length) {
      html += '<p class="muted" style="margin-top:10px">Visualisierungen kommen aus dem Tool «JV Badvisualisierungen»' + (darf('verwaltung') ? ' (<a href="#/import">Daten übernehmen</a>)' : '') + '.</p>';
    }
    return html + '<div data-meldung="vis" aria-live="polite"></div></section>';
  }

  // Gäste-WC: 3D-Vorschau
  function panelWc(p) {
    var eigene = wcVon(p.id);
    var frei = wcListe().filter(function (w) { return !w.projektId || !D.projekte[w.projektId]; });
    var html = '<section class="card" aria-labelledby="pkWcTitel"><h2 id="pkWcTitel">Gäste-WC 3D-Vorschau</h2>' +
      '<p class="muted">3D-Scan des Raums mit Vorher/Nachher und Materialwahl.</p>';
    if (eigene.length) {
      html += '<ul class="jvp-liste">' + eigene.map(function (w) {
        return '<li><div class="haupt"><b>' + esc(w.name || 'Ohne Namen') + '</b><span class="muted">' +
          esc([w.customer, w.scanDate ? 'Scan ' + w.scanDate : '', w.builtin ? 'Scan aus der Datenübernahme' : ''].filter(Boolean).join(' · ')) + '</span></div>' +
          '<div class="actions"><a class="jvp-knopf jvp-knopf--klein" href="/tools/gaeste-wc/?projekt=' + encodeURIComponent(w.id) + '">Öffnen</a>' +
          '<button type="button" class="danger" data-a="wc-loesen" data-id="' + esc(w.id) + '">Vom Projekt lösen</button></div></li>';
      }).join('') + '</ul>';
    } else {
      html += '<p class="jvp-leer">Keine 3D-Vorschau zugeordnet. Neue Scans im Tool unter «Projekte» hochladen.</p>';
    }
    if (frei.length) {
      html += '<div class="jvp-zuordnen"><select id="pkWcWahl" aria-label="3D-Vorschau zuordnen"><option value="">3D-Vorschau zuordnen …</option>' +
        frei.map(function (w) { return '<option value="' + esc(w.id) + '">' + esc([w.name, w.customer].filter(Boolean).join(' · ')) + '</option>'; }).join('') +
        '</select><button type="button" class="jvp-knopf jvp-knopf--klein" data-a="wc-zuordnen">Zuordnen</button></div>';
    }
    return html + '<div data-meldung="wc" aria-live="polite"></div></section>';
  }

  function panelTerminplan(p) {
    var phasen = Array.isArray(p.phases) ? p.phases.length : 0;
    var n = gewerke(p);
    var f = [
      ['Phasen', String(phasen)], ['Gewerke', String(n)],
      ['Zieltermin', datum(p.targetEnd) || '–'], ['Bezug', datum(p.moveIn) || '–'],
      ['Version', p.version || '1.0'], ['Verzögerungen', String((p.delays || []).length)]
    ];
    return '<section class="card" aria-labelledby="pkTpTitel"><h2 id="pkTpTitel">Terminplan</h2>' +
      (n ? '<dl class="jvp-fakten">' + f.map(function (x) { return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; }).join('') + '</dl>'
        : '<p class="jvp-leer">Noch keine Gewerke. Im Terminplaner eine Vorlage einfügen (z.B. Badsanierung).</p>') +
      '<div class="jvp-knopfreihe" style="margin-top:14px"><a class="jvp-knopf" href="' + terminplanUrl(p) + '">' +
      (n ? 'Im Terminplaner öffnen' : 'Terminplan erstellen') + '</a></div></section>';
  }

  function panelMeldung(name, text, art) {
    var el = document.querySelector('#projektInhalt [data-meldung="' + name + '"]');
    meldung(el, text, art);
  }

  function wcZuordnen(wid, projektId) {
    if (D.wc[wid]) return toolSchreiben('gaeste-wc', 'patch', 'projects/' + wid, { projektId: projektId });
    // Das eingebaute Projekt des Tools hat noch keinen Eintrag: mit builtin anlegen, damit es das Tool nicht doppelt zeigt
    if (wid === WC_BEISPIEL) return toolSchreiben('gaeste-wc', 'set', 'projects/' + wid, { builtin: true, projektId: projektId });
    return Promise.reject(new Error('3D-Projekt nicht gefunden'));
  }

  $('projektInhalt').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-a]');
    if (!b || b.tagName === 'SELECT') return;
    var a = b.getAttribute('data-a');
    var p = D.projekte[aktuellesProjekt];
    if (!p) return;
    var id = b.getAttribute('data-id');

    if (a === 'bearbeiten') { offen.bearbeiten = !offen.bearbeiten; zeichnen(p.id); if (offen.bearbeiten && $('pb-name')) $('pb-name').focus(); return; }
    if (a === 'kunde-neu') { offen.kundeNeu = !offen.kundeNeu; zeichnen(p.id); if (offen.kundeNeu && $('pkk-nachname')) $('pkk-nachname').focus(); return; }
    if (a === 'link-neu') {
      var o = b.getAttribute('data-objekt');
      offen.linkNeu = offen.linkNeu === o ? null : o;
      zeichnen(p.id);
      if (offen.linkNeu && $('pvl-name')) $('pvl-name').focus();
      return;
    }
    if (a === 'kunde-details') { window.openKundeDetail(id); return; }
    if (a === 'kunde-link') {
      var url = location.origin + '/' + (b.getAttribute('data-art') === 'swipe' ? 'swipe' : 'inspiration') + '.html?t=' + b.getAttribute('data-token');
      kopieren(url).then(function (ok) { panelMeldung('kunden', ok ? 'Link kopiert.' : 'Link: ' + url, ok ? 'success' : 'info'); });
      return;
    }
    if (a === 'link-kopieren') {
      var vurl = location.origin + '/visualisierung.html?t=' + b.getAttribute('data-token');
      kopieren(vurl).then(function (ok) { panelMeldung('vis', ok ? 'Kundenlink kopiert.' : 'Kundenlink: ' + vurl, ok ? 'success' : 'info'); });
      return;
    }

    var aufgabe = null, bereich = null, nachher = null;
    if (a === 'kunde-zuordnen' || a === 'kunde-loesen') {
      var kid = a === 'kunde-zuordnen' ? $('pkKundeWahl').value : id;
      if (!kid) return;
      bereich = 'kunden';
      aufgabe = function () { return admin('/update-kunde', { id: kid, projekt_id: a === 'kunde-zuordnen' ? p.id : null }); };
      nachher = ['kunden'];
    } else if (a === 'vis-zuordnen' || a === 'vis-loesen') {
      var oid = a === 'vis-zuordnen' ? $('pkVisWahl').value : id;
      if (!oid) return;
      bereich = 'vis';
      aufgabe = function () { return toolSchreiben('badvis', 'patch', 'objekte/' + oid, { projektId: a === 'vis-zuordnen' ? p.id : null }); };
      nachher = ['objekte'];
    } else if (a === 'wc-zuordnen' || a === 'wc-loesen') {
      var wid = a === 'wc-zuordnen' ? $('pkWcWahl').value : id;
      if (!wid) return;
      bereich = 'wc';
      aufgabe = function () { return wcZuordnen(wid, a === 'wc-zuordnen' ? p.id : null); };
      nachher = ['wc'];
    } else if (a === 'link-aktiv') {
      bereich = 'vis';
      aufgabe = function () { return admin('/visualisierung-links', { aktion: 'aktiv', id: id, is_active: b.getAttribute('data-aktiv') !== '1' }); };
      nachher = ['links'];
    } else if (a === 'link-loeschen') {
      if (!confirm('Kundenlink löschen? Der Link funktioniert danach nicht mehr.')) return;
      bereich = 'vis';
      aufgabe = function () { return admin('/visualisierung-links', { aktion: 'loeschen', id: id }); };
      nachher = ['links'];
    }
    if (!aufgabe) return;
    b.disabled = true;
    aufgabe().then(function () {
      return neuZeichnen(nachher);
    }).catch(function (e) {
      b.disabled = false;
      panelMeldung(bereich, 'Fehler: ' + e.message, 'error');
    });
  });

  $('projektInhalt').addEventListener('change', function (ev) {
    // Kundenzugang gewählt: Name im Wasserzeichen vorschlagen
    if (ev.target.id === 'pvl-kunde') {
      var k = D.kunden.filter(function (x) { return x.id === ev.target.value; })[0];
      if (k) $('pvl-name').value = kundeName(k);
    }
  });

  $('projektInhalt').addEventListener('submit', function (ev) {
    var form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    var p = D.projekte[aktuellesProjekt];
    if (!p) return;
    var art = form.getAttribute('data-form');
    var knopf = form.querySelector('button[type=submit]');
    if (knopf) knopf.disabled = true;
    var fertig = function () { if (knopf) knopf.disabled = false; };

    if (art === 'projekt') {
      var name = $('pb-name').value.trim();
      if (!name) { fertig(); return; }
      var leiterId = $('pb-leiter').value;
      var leiter = (D.config.leaders || []).filter(function (l) { return l.id === leiterId; })[0];
      var neu = {
        name: name, address: $('pb-adresse').value.trim(), client: $('pb-bauherr').value.trim(),
        leader: leiterId, author: leiter ? leiter.name || '' : p.author || '', state: $('pb-status').value,
        updated: new Date().toISOString()
      };
      var adresseNeu = neu.address !== (p.address || '');
      toolSchreiben('terminplaner', 'patch', 'projects/' + p.id, neu).then(function (r) {
        var d = (r && r.daten) || Object.assign({}, p, neu);
        d.id = p.id;
        D.projekte[p.id] = d;
        offen.bearbeiten = false;
        zeichnen(p.id);
        if (adresseNeu && d.address) karteErzeugen(p.id);
      }).catch(function (e) {
        fertig();
        meldung(form.querySelector('[data-meldung]'), 'Speichern fehlgeschlagen: ' + e.message, 'error');
      });
      return;
    }

    if (art === 'kunde') {
      var nachname = $('pkk-nachname').value.trim();
      if (!nachname) { fertig(); return; }
      admin('/create-kunde', {
        anrede_typ: $('pkk-anrede').value, vorname: $('pkk-vorname').value.trim(), nachname: nachname,
        email: $('pkk-email').value.trim(), telefon: $('pkk-telefon').value.trim(),
        projekt_adresse: p.address || '', projekt_id: p.id, sichtbare_punkte: null
      }).then(function (r) {
        offen.kundeNeu = false;
        var url = location.origin + '/inspiration.html?t=' + r.kunde.access_token;
        return neuZeichnen(['kunden']).then(function () {
          return kopieren(url).then(function (ok) {
            panelMeldung('kunden', ok ? 'Kundenzugang angelegt, Inspiration-Link kopiert.' : 'Kundenzugang angelegt. Link: ' + url, 'success');
          });
        });
      }).catch(function (e) {
        fertig();
        panelMeldung('kunden', 'Fehler: ' + e.message, 'error');
      });
      return;
    }

    if (art === 'link') {
      var objekt = form.getAttribute('data-objekt');
      var kname = $('pvl-name').value.trim();
      if (!kname) { fertig(); return; }
      admin('/visualisierung-links', {
        aktion: 'erstellen', objekt_id: objekt, kunde_name: kname, kunde_id: $('pvl-kunde').value || null, projekt_id: p.id
      }).then(function (r) {
        offen.linkNeu = null;
        var url = location.origin + '/visualisierung.html?t=' + r.link.token;
        return neuZeichnen(['links']).then(function () {
          return kopieren(url).then(function (ok) {
            panelMeldung('vis', ok ? 'Kundenlink erstellt und kopiert.' : 'Kundenlink: ' + url, 'success');
          });
        });
      }).catch(function (e) {
        fertig();
        panelMeldung('vis', 'Fehler: ' + e.message, 'error');
      });
    }
  });

  // ── Kunden: Projekt-Auswahl (Hooks für das Skript des Admin-Panels) ────
  function projektOptionen(gewaehlt) {
    var liste = projektListe().sort(nachStatus);
    var html = '<option value="">– Kein Projekt –</option>';
    if (gewaehlt && !D.projekte[gewaehlt]) html += '<option value="' + esc(gewaehlt) + '" selected>(unbekanntes Projekt)</option>';
    return html + liste.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === gewaehlt ? ' selected' : '') + '>' +
        esc((p.name || 'Ohne Namen') + (p.address ? ' · ' + p.address : '')) + '</option>';
    }).join('');
  }
  function kundenProjektAuswahl() {
    var sel = $('k-projekt');
    if (sel) sel.innerHTML = projektOptionen(sel.value);
  }
  $('k-projekt').addEventListener('change', function () {
    var p = D.projekte[this.value];
    if (p && p.address && !$('k-adresse').value.trim()) $('k-adresse').value = p.address;
  });

  // Ergänzt window.JVP (oben mit darf/ich/esc angelegt), nicht ersetzen
  Object.assign(window.JVP, {
    projektZelle: function (pid) {
      if (!pid) return '<span class="muted">–</span>';
      var p = D.projekte[pid];
      return p ? '<a href="#/projekt/' + encodeURIComponent(pid) + '">' + esc(p.name || 'Ohne Namen') + '</a>' : '<span class="muted">–</span>';
    },
    projektOptionen: projektOptionen,
    kundeGeaendert: function () { veraltet('kunden'); }
  });

  // Adressvorschläge (geo.admin.ch) in allen Adressfeldern der Plattform
  if (geo) {
    geo.vorschlaege('#k-adresse, #dk-adresse, #pj-adresse, #pb-adresse', {
      beiAuswahl: function (t) { KOORD[t.text] = { e: t.e, n: t.n }; }
    });
  }

  // ── Daten übernehmen (Michis Claude-Tools) ────────────────────────────
  var befund = null;   // { terminplaner, badvis, wc, andere: [] }

  function importBereit() {
    laden(['projekte', 'objekte', 'wc']).catch(function () { /* Zählung «schon vorhanden» fehlt dann */ });
  }

  // ZIP lesen ohne Zusatzbibliothek (Zentralverzeichnis + DecompressionStream)
  function zipLesen(datei) {
    return datei.arrayBuffer().then(function (buf) {
      var dv = new DataView(buf);
      var u8 = new Uint8Array(buf);
      var ende = -1;
      for (var i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { ende = i; break; }
      }
      if (ende < 0) throw new Error(datei.name + ' ist keine gültige ZIP-Datei');
      var anzahl = dv.getUint16(ende + 10, true);
      var pos = dv.getUint32(ende + 16, true);
      var eintraege = [];
      var dec = new TextDecoder();
      for (var n = 0; n < anzahl; n++) {
        if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error('ZIP-Verzeichnis beschädigt');
        var e = {
          methode: dv.getUint16(pos + 10, true),
          gepackt: dv.getUint32(pos + 20, true),
          groesse: dv.getUint32(pos + 24, true),
          lokal: dv.getUint32(pos + 42, true)
        };
        var nameL = dv.getUint16(pos + 28, true);
        e.pfad = dec.decode(u8.subarray(pos + 46, pos + 46 + nameL));
        pos += 46 + nameL + dv.getUint16(pos + 30, true) + dv.getUint16(pos + 32, true);
        var kurz = e.pfad.split('/').pop();
        if (!kurz || /^__MACOSX\//.test(e.pfad) || /^\._/.test(kurz)) continue;
        e.name = kurz;
        eintraege.push(e);
      }
      return eintraege.map(function (e) {
        return {
          name: e.name,
          groesse: e.groesse,
          text: function () {
            var l = e.lokal;
            if (dv.getUint32(l, true) !== 0x04034b50) return Promise.reject(new Error('ZIP-Eintrag beschädigt: ' + e.name));
            var start = l + 30 + dv.getUint16(l + 26, true) + dv.getUint16(l + 28, true);
            var roh = u8.subarray(start, start + e.gepackt);
            if (e.methode === 0) return Promise.resolve(dec.decode(roh));
            if (e.methode !== 8) return Promise.reject(new Error('Nicht unterstützte Kompression in ' + e.name));
            if (typeof DecompressionStream === 'undefined') {
              return Promise.reject(new Error('Dieser Browser kann ZIP-Dateien nicht entpacken. Bitte die Dateien einzeln wählen.'));
            }
            return new Response(new Blob([roh]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
          }
        };
      });
    });
  }

  // JSON-Wert (Array oder Objekt) direkt nach einer Marke im Quelltext eines Tools herauslösen
  function jsonText(text, marke) {
    var i = text.indexOf(marke);
    if (i < 0) return null;
    i += marke.length;
    while (i < text.length && /\s/.test(text[i])) i++;
    var auf = text[i];
    if (auf !== '[' && auf !== '{') return null;
    var tiefe = 0, inText = false, maskiert = false;
    for (var k = i; k < text.length; k++) {
      var c = text[k];
      if (inText) {
        if (maskiert) maskiert = false;
        else if (c === '\\') maskiert = true;
        else if (c === '"') inText = false;
        continue;
      }
      if (c === '"') inText = true;
      else if (c === '[' || c === '{') tiefe++;
      else if (c === ']' || c === '}') {
        tiefe--;
        if (tiefe === 0) return text.slice(i, k + 1);
      }
    }
    return null;
  }

  function einordnen(name, text, b) {
    if (/\.json$/i.test(name)) {
      try {
        var j = JSON.parse(text);
        if (j && j.app === 'terminplaner-jv' && j.projects) { b.terminplaner = { name: name, daten: j }; return; }
      } catch (e) { /* unten: unbekannt */ }
      b.andere.push(name + ' (unbekannte Daten, übersprungen)');
      return;
    }
    if (/\.html?$/i.test(name)) {
      if (text.indexOf('const OBJ=') !== -1 && text.indexOf('const IMG=') !== -1) {
        var obj = JSON.parse(jsonText(text, 'const OBJ=') || 'null');
        var img = JSON.parse(jsonText(text, 'const IMG=') || 'null');
        if (Array.isArray(obj) && img) { b.badvis = { name: name, objekte: obj, bilder: img }; return; }
      }
      if (text.indexOf('window.__SCAN=') !== -1) {
        var scan = jsonText(text, 'window.__SCAN=');
        if (scan) { JSON.parse(scan); b.wc = { name: name, scan: scan }; return; }
      }
      b.andere.push(name + ' (Tool ist bereits eingebunden, keine Daten nötig)');
      return;
    }
    b.andere.push(name + ' (übersprungen)');
  }

  function dateienPruefen(dateien) {
    var b = { terminplaner: null, badvis: null, wc: null, andere: [] };
    meldung('importMsg', 'Dateien werden gelesen …', 'info');
    $('importBefund').hidden = true;
    $('importKnoepfe').hidden = true;
    $('importProtokoll').hidden = true;
    var quellen = [];
    var kette = Promise.resolve();
    Array.prototype.forEach.call(dateien, function (d) {
      kette = kette.then(function () {
        if (/\.zip$/i.test(d.name) || d.type === 'application/zip') {
          return zipLesen(d).then(function (liste) { quellen = quellen.concat(liste); });
        }
        quellen.push({ name: d.name, groesse: d.size, text: function () { return d.text(); } });
      });
    });
    return kette.then(function () {
      var k2 = Promise.resolve();
      quellen.forEach(function (q) {
        k2 = k2.then(function () { return q.text(); }).then(function (t) { einordnen(q.name, t, b); });
      });
      return k2;
    }).then(function () {
      return laden(['projekte', 'objekte', 'wc']).catch(function () { /* ohne Vergleich */ });
    }).then(function () {
      befund = b;
      befundZeigen();
    }).catch(function (e) {
      meldung('importMsg', 'Lesen fehlgeschlagen: ' + e.message, 'error');
    });
  }

  function groesse(bytes) {
    return bytes > 1048576 ? (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  function befundZeigen() {
    var b = befund;
    var teile = [];
    if (b.terminplaner) {
      var j = b.terminplaner.daten;
      var pids = Object.keys(j.projects || {});
      var fids = Object.keys(j.firms || {});
      var schon = pids.filter(function (id) { return D.projekte[id]; }).length;
      teile.push('<label class="wahl"><input type="checkbox" data-teil="terminplaner" checked><span><b>Bau-Terminplaner</b>: ' +
        pids.length + ' Projekte, ' + fids.length + ' Firmen' + (j.cfg ? ', Einstellungen (Projektleiter, Gewerke, Absender)' : '') +
        '<br><span class="muted">' + esc(b.terminplaner.name) + (schon ? ' · ' + schon + ' Projekte sind schon vorhanden und werden ersetzt' : '') +
        '. Die Karten der Projektadressen werden neu von geo.admin.ch erstellt.</span></span></label>');
    }
    if (b.badvis) {
      var nb = Object.keys(b.badvis.bilder).length;
      var bytes = Object.keys(b.badvis.bilder).reduce(function (a, k) { return a + Math.round(String(b.badvis.bilder[k]).length * 0.75); }, 0);
      var schonB = b.badvis.objekte.filter(function (o) { return D.objekte[o.id]; }).length;
      teile.push('<label class="wahl"><input type="checkbox" data-teil="badvis" checked><span><b>Badvisualisierungen</b>: ' +
        b.badvis.objekte.length + ' Objekte mit ' + nb + ' Bildern (' + groesse(bytes) + ')' +
        '<br><span class="muted">' + esc(b.badvis.name) + (schonB ? ' · ' + schonB + ' schon vorhanden: werden ersetzt, die Zuordnung zum Projekt bleibt' : '') + '</span></span></label>');
    }
    if (b.wc) {
      teile.push('<label class="wahl"><input type="checkbox" data-teil="wc" checked><span><b>Gäste-WC Umbauvorschau</b>: 3D-Scan (' + groesse(b.wc.scan.length) + ')' +
        '<br><span class="muted">' + esc(b.wc.name) + ' · ersetzt den bisherigen Scan des eingebauten Projekts</span></span></label>');
    }
    if (b.andere.length) {
      teile.push('<p class="muted" style="margin:0">' + b.andere.map(esc).join('<br>') + '</p>');
    }
    var etwas = !!(b.terminplaner || b.badvis || b.wc);
    $('importBefund').innerHTML = teile.join('');
    $('importBefund').hidden = !teile.length;
    $('importKnoepfe').hidden = !etwas;
    meldung('importMsg', etwas ? 'Gefunden. Auswahl prüfen und übernehmen.' : 'In diesen Dateien sind keine Daten zum Übernehmen.', etwas ? 'info' : 'error');
  }

  function protokoll(text) {
    var el = $('importProtokoll');
    el.hidden = false;
    el.textContent += text + '\n';
    el.scrollTop = el.scrollHeight;
  }

  function teilGewaehlt(name) {
    var cb = document.querySelector('#importBefund input[data-teil="' + name + '"]');
    return !!(cb && cb.checked);
  }

  function ohneId(x) {
    var c = JSON.parse(JSON.stringify(x || {}));
    delete c.id;
    return c;
  }

  // Karte für ein übernommenes Projekt: vorhandene Koordinaten nutzen, Bild neu bei geo.admin.ch
  function karteFuerImport(p) {
    var bg = p.mapBg;
    var adresse = String(p.address || '');
    if (!adresse.trim()) return Promise.resolve(null);
    if (bg && bg.addr === adresse && GEO_KARTE.test(bg.url || '')) return Promise.resolve(bg);
    var bekannt = bg && bg.addr === adresse && +bg.e > 2e6 && +bg.n > 1e6 ? { e: +bg.e, n: +bg.n } : null;
    return geo.karteFuerAdresse(adresse, bekannt).then(function (k) {
      if (k) return { addr: adresse, url: k.url, e: k.e, n: k.n, fy: geo.KARTE.fy, src: k.quelle, created: isoHeute() };
      // Ohne Bild: Koordinaten behalten, der Terminplaner erzeugt die Karte später
      return bekannt ? { addr: adresse, url: '', e: bekannt.e, n: bekannt.n, fy: geo.KARTE.fy, src: 'av', created: isoHeute() } : null;
    }, function () { return null; });
  }

  function inPaketen(docs, maxBytes) {
    var pakete = [[]], groesseJetzt = 0;
    docs.forEach(function (d) {
      var g = JSON.stringify(d).length;
      if (pakete[pakete.length - 1].length && (groesseJetzt + g > maxBytes || pakete[pakete.length - 1].length >= 200)) {
        pakete.push([]);
        groesseJetzt = 0;
      }
      pakete[pakete.length - 1].push(d);
      groesseJetzt += g;
    });
    return pakete;
  }

  // Mehrere Aufgaben mit höchstens «n» gleichzeitig abarbeiten
  function nebeneinander(liste, n, fn) {
    var rest = liste.slice();
    function arbeiter() {
      if (!rest.length) return Promise.resolve();
      var x = rest.shift();
      return Promise.resolve().then(function () { return fn(x); }).then(arbeiter);
    }
    var arbeiterListe = [];
    for (var i = 0; i < Math.min(n, liste.length); i++) arbeiterListe.push(arbeiter());
    return Promise.all(arbeiterListe);
  }

  var BLOB_RE = /^\/_blob\/([a-f0-9]{32})$/;

  function terminplanerUebernehmen(j) {
    var pids = Object.keys(j.projects || {});
    var fids = Object.keys(j.firms || {});
    var docs = [];
    var firmen = {};
    var alteLogos = {};
    var neueLogos = [];
    var dateien = bridge.assets('terminplaner');
    protokoll('Terminplaner: ' + pids.length + ' Projekte, Karten werden erstellt …');
    var kette = Promise.resolve();
    pids.forEach(function (id) {
      kette = kette.then(function () {
        var p = ohneId(j.projects[id]);
        return karteFuerImport(p).then(function (bg) {
          if (bg) p.mapBg = bg; else delete p.mapBg;
          docs.push({ pfad: 'projects/' + id, daten: p });
          protokoll('  ✓ ' + (p.name || id) + (bg && bg.url ? ' (mit Karte)' : p.address ? ' (Karte folgt im Terminplaner)' : ''));
        });
      });
    });
    return kette.then(function () {
      // Bisherige Firmen: deren Logos werden nach dem Speichern aufgeräumt
      return toolLaden('terminplaner', ['firms']).then(function (a) {
        Object.keys(a.firms).forEach(function (id) {
          var m = BLOB_RE.exec(String(a.firms[id].logo || ''));
          if (m) alteLogos[id] = m[1];
        });
      }, function () { /* ohne Aufräumen weiter */ });
    }).then(function () {
      // Firmenlogos liegen im Export als Bilddaten vor: wie im Terminplaner selbst als Datei speichern
      fids.forEach(function (id) { firmen[id] = ohneId(j.firms[id]); });
      var mitLogo = fids.filter(function (id) { return /^data:image\//.test(String(firmen[id].logo || '')); });
      if (mitLogo.length) protokoll('  Firmenlogos: ' + mitLogo.length + ' werden gespeichert …');
      return nebeneinander(mitLogo, 3, function (id) {
        var blob = dataUrlBlob(firmen[id].logo);
        if (!blob) return null;
        return dateien.upload(blob, { type: blob.type }).then(function (r) {
          firmen[id].logo = r.url;
          neueLogos.push(r.id);
        }, function () { /* Logo bleibt als Bilddaten, der Terminplaner kann beides */ });
      });
    }).then(function () {
      fids.forEach(function (id) { docs.push({ pfad: 'firms/' + id, daten: firmen[id] }); });
      if (j.cfg && typeof j.cfg === 'object') docs.push({ pfad: 'config/main', daten: JSON.parse(JSON.stringify(j.cfg)) });
      var pakete = inPaketen(docs, 4 * 1024 * 1024);
      var k2 = Promise.resolve();
      pakete.forEach(function (paket) {
        k2 = k2.then(function () {
          return anfrage('/tool-db', { method: 'POST', body: { tool: 'terminplaner', aktion: 'set_viele', docs: paket } });
        });
      });
      return k2.catch(function (e) {
        // Nicht gespeichert: neue Logos wieder entfernen
        return Promise.all(neueLogos.map(function (x) { return dateien.delete(x).catch(function () {}); })).then(function () { throw e; });
      });
    }).then(function () {
      // Logos der ersetzten Firmen entfernen
      var weg = Object.keys(alteLogos).filter(function (id) {
        return firmen[id] && String(firmen[id].logo || '') !== '/_blob/' + alteLogos[id];
      }).map(function (id) { return alteLogos[id]; });
      return Promise.all(weg.map(function (x) { return dateien.delete(x).catch(function () {}); }));
    }).then(function () {
      protokoll('✓ Terminplaner: ' + pids.length + ' Projekte, ' + fids.length + ' Firmen' + (j.cfg ? ' und Einstellungen' : '') + ' gespeichert');
    });
  }

  function dataUrlBlob(u) {
    var komma = u.indexOf(',');
    if (u.slice(0, 5) !== 'data:' || komma < 0) return null;
    var kopf = u.slice(5, komma);
    var typ = kopf.split(';')[0] || 'application/octet-stream';
    var roh = /;base64$/.test(kopf) ? atob(u.slice(komma + 1)) : decodeURIComponent(u.slice(komma + 1));
    var b = new Uint8Array(roh.length);
    for (var i = 0; i < roh.length; i++) b[i] = roh.charCodeAt(i);
    return new Blob([b], { type: typ });
  }

  function badvisUebernehmen(bv) {
    var dateien = bridge.assets('badvis');
    protokoll('Badvisualisierungen: ' + bv.objekte.length + ' Objekte …');
    var kette = Promise.resolve();
    var fertig = 0;
    bv.objekte.forEach(function (o, index) {
      kette = kette.then(function () {
        if (!o || !/^[A-Za-z0-9_-]{1,120}$/.test(String(o.id || ''))) { protokoll('  ✗ Objekt ohne gültige Kennung übersprungen'); return; }
        var praefix = 'img/' + o.id + '/';
        var schluessel = Object.keys(bv.bilder).filter(function (k) { return k.indexOf(praefix) === 0; });
        var bilder = {};
        var neueIds = [];
        var aufraeumen = function (e) {
          // Objekt nicht gespeichert: hochgeladene Bilder wieder löschen
          return Promise.all(neueIds.map(function (x) { return dateien.delete(x).catch(function () {}); })).then(function () { throw e; });
        };
        // Bilder hochladen, je 3 gleichzeitig
        return nebeneinander(schluessel, 3, function (k) {
          var blob = dataUrlBlob(String(bv.bilder[k]));
          if (!blob) return null;
          return dateien.upload(blob, { type: blob.type }).then(function (r) {
            bilder[k.slice(praefix.length).replace(/\.[a-z]+$/i, '')] = r.id;
            neueIds.push(r.id);
          });
        }).catch(aufraeumen).then(function () {
          var alt = D.objekte[o.id];
          var daten = ohneId(o);
          daten.bilder = bilder;
          daten.reihenfolge = index;
          daten.projektId = (alt && alt.projektId) || null;
          daten.importiert = new Date().toISOString();
          return toolSchreiben('badvis', 'set', 'objekte/' + o.id, daten).then(function () {
            fertig++;
            protokoll('  ✓ ' + [o.kunde, o.raum].filter(Boolean).join(' · ') + ' (' + neueIds.length + ' Bilder)');
            // Bilder einer früheren Übernahme aufräumen
            var altIds = alt && alt.bilder ? Object.keys(alt.bilder).map(function (k) { return alt.bilder[k]; }) : [];
            return Promise.all(altIds.filter(function (x) { return neueIds.indexOf(x) === -1; }).map(function (x) {
              return dateien.delete(x).catch(function () { /* bleibt liegen, stört nicht */ });
            }));
          }, aufraeumen);
        });
      });
    });
    return kette.then(function () { protokoll('✓ Badvisualisierungen: ' + fertig + ' Objekte gespeichert'); });
  }

  function wcUebernehmen(wc) {
    protokoll('Gäste-WC: 3D-Scan wird hochgeladen (' + groesse(wc.scan.length) + ') …');
    var blob = new Blob([wc.scan], { type: 'application/json' });
    return bridge.assets('gaeste-wc').dateiErsetzen('gaeste-wc-scan', blob, 'application/json').then(function () {
      protokoll('✓ Gäste-WC: 3D-Scan gespeichert');
    });
  }

  $('importDatei').addEventListener('change', function () {
    if (this.files && this.files.length) dateienPruefen(this.files);
  });
  var ablage = $('importAblage');
  ['dragenter', 'dragover'].forEach(function (n) {
    ablage.addEventListener(n, function (ev) { ev.preventDefault(); ablage.classList.add('ist-drueber'); });
  });
  ['dragleave', 'drop'].forEach(function (n) {
    ablage.addEventListener(n, function () { ablage.classList.remove('ist-drueber'); });
  });
  ablage.addEventListener('drop', function (ev) {
    ev.preventDefault();
    if (ev.dataTransfer && ev.dataTransfer.files.length) dateienPruefen(ev.dataTransfer.files);
  });

  $('importStart').addEventListener('click', function () {
    if (!befund) return;
    var knopf = this;
    var schritte = [];
    if (befund.terminplaner && teilGewaehlt('terminplaner')) schritte.push(function () { return terminplanerUebernehmen(befund.terminplaner.daten); });
    if (befund.badvis && teilGewaehlt('badvis')) schritte.push(function () { return badvisUebernehmen(befund.badvis); });
    if (befund.wc && teilGewaehlt('wc')) schritte.push(function () { return wcUebernehmen(befund.wc); });
    if (!schritte.length) { meldung('importMsg', 'Nichts ausgewählt.', 'error'); return; }
    knopf.disabled = true;
    $('importProtokoll').textContent = '';
    meldung('importMsg', 'Wird übernommen … Fenster bitte offen lassen.', 'info');
    var fehler = 0;
    // Aktueller Stand (was schon da ist, wird ersetzt und seine alten Bilder aufgeräumt)
    var kette = laden(['projekte', 'objekte', 'wc'], true).catch(function () { /* ohne Vergleich weiter */ });
    schritte.forEach(function (s) {
      kette = kette.then(s).catch(function (e) {
        fehler++;
        protokoll('✗ Fehler: ' + e.message);
      });
    });
    kette.then(function () {
      veraltet('projekte', 'objekte', 'wc');
      knopf.disabled = false;
      if (fehler) meldung('importMsg', 'Übernahme mit Fehlern beendet. Siehe Protokoll; erneut starten ist möglich.', 'error');
      else {
        $('importMsg').innerHTML = '<div class="msg success">Fertig. Weiter zu den <a href="#/projekte">Projekten</a>.</div>';
      }
    });
  });

  // ── Abmelden, Start ───────────────────────────────────────────────────
  $('logoutBtn').addEventListener('click', function () {
    fetch('/api/sitzung', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-JV-Sitzung': '1' },
      body: JSON.stringify({ aktion: 'abmelden' })
    }).catch(function () { /* trotzdem neu laden */ }).then(function () {
      location.replace(location.pathname);
    });
  });

  // Menü der angemeldeten Person
  $('passwortBtn').addEventListener('click', function () {
    $('benutzerMenue').open = false;
    bridge.passwortAendern().then(function (ok) {
      if (ok && window.JVFeedback) window.JVFeedback.meldung('Passwort geändert. Andere Geräte sind abgemeldet.');
    });
  });
  document.addEventListener('click', function (ev) {
    var m = $('benutzerMenue');
    if (m && m.open && !m.contains(ev.target)) m.open = false;
  });

  // Zurück aus Tools und Seiten (Robin, 2.11.2026: alles öffnet im selben Tab). Führt ein Link aus der
  // Plattform hinaus, merkt sich der Tab die Ansicht; assets/zurueck.js zeigt dort die Lasche «Zurück».
  function zurueckText() {
    if (aktuell === 'projekt') {
      var p = D.projekte[aktuellesProjekt];
      return 'Zurück zum Projekt «' + ((p && p.name) || 'Ohne Namen') + '»';
    }
    var texte = {
      uebersicht: 'Zurück zur Übersicht', projekte: 'Zurück zu den Projekten', kunden: 'Zurück zu den Kunden',
      katalog: 'Zurück zum Katalog', feedback: 'Zurück zum Feedback-Board'
    };
    return texte[aktuell] || 'Zurück zu «' + (TITEL[aktuell] || 'Übersicht') + '»';
  }
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    var ziel;
    try { ziel = new URL(a.getAttribute('href'), location.href); } catch (e) { return; }
    if (ziel.origin !== location.origin || ziel.pathname === location.pathname ||
        ziel.pathname === '/' || ziel.pathname === '/index.html') return;   // Ansichten der Plattform selbst
    try {
      sessionStorage.setItem('jv-zurueck', JSON.stringify({
        url: location.pathname + location.search + location.hash, text: zurueckText(), zeit: Date.now()
      }));
    } catch (e) { /* ohne sessionStorage führt die Lasche zur Übersicht */ }
  }, true);
  document.addEventListener('keydown', function (ev) {
    var m = $('benutzerMenue');
    if (ev.key === 'Escape' && m && m.open) { m.open = false; m.querySelector('summary').focus(); }
  });
  window.addEventListener('jv-benutzer', function () {
    if (!ich()) return;
    benutzerAnzeigen();
    rechteAnwenden();
  });

  window.addEventListener('hashchange', route);
  bridge.sitzungSicherstellen().then(function () {
    benutzerAnzeigen();
    rechteAnwenden();
    $('start').hidden = true;
    $('app').hidden = false;
    route();
  });
})();
