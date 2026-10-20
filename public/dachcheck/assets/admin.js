// admin.js — Übersicht der Drohnen-Check-Anfragen
// Wird an zwei Orten verwendet:
//  1. admin.html auf dachcheck.jaeggivollmer.ch (eigener Login, Link aus der Info-Mail)
//  2. Tab «Drohnen-Check» im bestehenden Admin-Panel (public/index.html)
// Beide nutzen dasselbe ADMIN_PASSWORD und die Functions dachcheck-admin-*.
(function () {
  'use strict';

  var STATUS = [
    { wert: 'neu', label: 'Neu' },
    { wert: 'termin', label: 'Termin vereinbart' },
    { wert: 'geflogen', label: 'Geflogen' },
    { wert: 'report', label: 'Report versendet' },
    { wert: 'auftrag', label: 'Auftrag' },
    { wert: 'abgeschlossen', label: 'Abgeschlossen' },
    { wert: 'abgesagt', label: 'Abgesagt' }
  ];
  var LOESCHFRIST = (window.DC_CONFIG && window.DC_CONFIG.loeschfristTage) || 60;
  var WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function statusLabel(w) {
    for (var i = 0; i < STATUS.length; i++) if (STATUS[i].wert === w) return STATUS[i].label;
    return w;
  }
  function datum(iso, mitZeit) {
    if (!iso) return '–';
    var d = new Date(iso);
    var o = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (mitZeit) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return d.toLocaleString('de-CH', o);
  }
  function terminLabel(wert) {
    var t = String(wert).split('_');
    var d = new Date(t[0] + 'T12:00:00');
    if (isNaN(d)) return wert;
    return WOCHENTAGE[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + (t[1] === 'vm' ? 'Vormittag' : 'Nachmittag');
  }
  // Schweizer Nummer für WhatsApp-Link: 079 123 45 67 → 41791234567
  function waNummer(tel) {
    var n = String(tel || '').replace(/[^\d+]/g, '');
    if (n.indexOf('+') === 0) n = n.slice(1);
    else if (n.indexOf('00') === 0) n = n.slice(2);
    else if (n.indexOf('0') === 0) n = '41' + n.slice(1);
    return n;
  }
  function lokalesDatetime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // ════════════════════════════════════════════════════════════════════
  // Übersicht in ein Element einhängen
  // ════════════════════════════════════════════════════════════════════
  function mount(root, opts) {
    opts = opts || {};
    var getPwd = opts.getPwd;
    var onUnauthorized = opts.onUnauthorized || function () {};
    var api = opts.api || '/api';

    var zustand = root._dc || { anfragen: [], warteliste: [], filter: 'offen', suche: '', aktiv: null, tab: 'anfragen' };
    root._dc = zustand;

    if (!root._dcAufgebaut) {
      root._dcAufgebaut = true;
      root.classList.add('dc-admin');
      root.innerHTML =
        '<div class="dc-kopfzeile"><h2>Drohnen-Check</h2><div class="dc-aktionen">' +
          '<button type="button" class="dc-btn" data-a="laden">Aktualisieren</button>' +
          '<button type="button" class="dc-btn" data-a="csv">CSV exportieren</button></div></div>' +
        '<div class="dc-tabs" role="tablist">' +
          '<button type="button" role="tab" data-tab="anfragen" aria-selected="true">Anfragen <span data-anz="anfragen"></span></button>' +
          '<button type="button" role="tab" data-tab="warteliste" aria-selected="false">Warteliste <span data-anz="warteliste"></span></button></div>' +
        '<section data-panel="anfragen">' +
          '<div class="dc-filter"><input type="search" data-a="suche" placeholder="Suchen: Name, Ort, Referenz, Telefon …" autocomplete="off" aria-label="Anfragen durchsuchen">' +
          '<div class="dc-chips" data-a="chips" role="group" aria-label="Nach Status filtern"></div></div>' +
          '<div class="dc-layout"><ul class="dc-liste" data-a="liste"></ul><article class="dc-detail" data-a="detail" hidden></article></div>' +
        '</section>' +
        '<section data-panel="warteliste" hidden>' +
          '<p class="dc-hinweis">Personen ausserhalb des Einzugsgebiets, die benachrichtigt werden möchten. Einträge werden nach 24 Monaten gelöscht.</p>' +
          '<button type="button" class="dc-btn" data-a="emails">Alle E-Mail-Adressen kopieren</button>' +
          '<div class="dc-tabelle"><table><thead><tr><th>Datum</th><th>E-Mail</th><th>PLZ</th><th>Ort</th></tr></thead><tbody data-a="warteliste"></tbody></table></div>' +
        '</section>' +
        '<p class="dc-fehler" data-a="fehler" role="alert" hidden></p>';

      root.addEventListener('click', klick);
      root.querySelector('[data-a="suche"]').addEventListener('input', function (e) {
        zustand.suche = e.target.value.trim().toLowerCase();
        liste();
      });
    }

    function el(name) { return root.querySelector('[data-a="' + name + '"]'); }

    function aufruf(pfad, optionen) {
      optionen = optionen || {};
      var h = { Authorization: 'Bearer ' + getPwd() };
      if (optionen.body) h['Content-Type'] = 'application/json';
      return fetch(api + pfad, { method: optionen.method || 'GET', headers: h, body: optionen.body }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (res.status === 401) { onUnauthorized(); throw new Error('Nicht angemeldet'); }
          if (!res.ok) throw new Error(j.error || 'Fehler ' + res.status);
          return j;
        });
      });
    }

    function fehler(text) {
      var f = el('fehler');
      f.textContent = text || '';
      f.hidden = !text;
    }

    function laden() {
      fehler('');
      return aufruf('/dachcheck-admin-liste').then(function (j) {
        zustand.anfragen = j.anfragen || [];
        zustand.warteliste = j.warteliste || [];
        chips();
        liste();
        warteliste();
        // Direktlink aus der Info-Mail: …/admin.html#DC-2026-0001
        var ref = opts.startReferenz && opts.startReferenz();
        if (ref && zustand.anfragen.some(function (a) { return a.referenz === ref; })) {
          zustand.filter = 'alle'; chips(); liste();
          zeige(ref);
        } else if (zustand.aktiv) {
          zeige(zustand.aktiv);
        }
      }).catch(function (e) { fehler('Die Anfragen konnten nicht geladen werden: ' + e.message); });
    }

    function gefiltert() {
      return zustand.anfragen.filter(function (a) {
        if (zustand.filter === 'offen' && ['abgeschlossen', 'abgesagt'].indexOf(a.status) >= 0) return false;
        if (zustand.filter !== 'offen' && zustand.filter !== 'alle' && a.status !== zustand.filter) return false;
        if (!zustand.suche) return true;
        var heu = [a.referenz, a.vorname, a.nachname, a.strasse, a.plz, a.ort, a.telefon, a.email].join(' ').toLowerCase();
        return heu.indexOf(zustand.suche) >= 0;
      });
    }

    function chips() {
      var zaehl = function (f) {
        return zustand.anfragen.filter(function (a) {
          if (f === 'alle') return true;
          if (f === 'offen') return ['abgeschlossen', 'abgesagt'].indexOf(a.status) < 0;
          return a.status === f;
        }).length;
      };
      var filter = [{ wert: 'offen', label: 'Offen' }, { wert: 'alle', label: 'Alle' }].concat(STATUS);
      el('chips').innerHTML = filter.map(function (f) {
        return '<button type="button" data-filter="' + f.wert + '" aria-pressed="' + (zustand.filter === f.wert) + '">' + esc(f.label) + ' (' + zaehl(f.wert) + ')</button>';
      }).join('');
      root.querySelector('[data-anz="anfragen"]').textContent = '(' + zustand.anfragen.length + ')';
      root.querySelector('[data-anz="warteliste"]').textContent = '(' + zustand.warteliste.length + ')';
    }

    function liste() {
      var daten = gefiltert();
      if (!daten.length) {
        el('liste').innerHTML = '<li class="dc-leer">' + (zustand.anfragen.length ? 'Keine Anfragen für diesen Filter.' : 'Noch keine Anfragen.') + '</li>';
        return;
      }
      el('liste').innerHTML = daten.map(function (a) {
        return '<li><button type="button" data-ref="' + esc(a.referenz) + '"' + (zustand.aktiv === a.referenz ? ' aria-current="true"' : '') + '>' +
          '<span class="dc-zeile1"><span class="dc-name">' + esc(a.vorname + ' ' + a.nachname) + '</span>' +
          '<span class="dc-badge s-' + esc(a.status) + '">' + esc(statusLabel(a.status)) + '</span></span>' +
          '<span class="dc-meta">' + esc(a.strasse + ' ' + a.hausnummer + ', ' + a.plz + ' ' + a.ort) + '</span>' +
          '<span class="dc-meta">' + esc(a.referenz) + ' · ' + datum(a.created_at) + ' · ' + esc(a.gebaeudetyp) +
          (a.rolle === 'Mieter' ? ' · <span class="dc-badge mieter">Mieter</span>' : '') + '</span>' +
          '</button></li>';
      }).join('');
    }

    function zeile(k, v, roh) {
      return '<dt>' + esc(k) + '</dt><dd>' + (roh ? v : esc(v == null || v === '' ? '–' : v)) + '</dd>';
    }

    function zeige(ref) {
      var a = zustand.anfragen.filter(function (x) { return x.referenz === ref; })[0];
      var d = el('detail');
      if (!a) { d.hidden = true; root.querySelector('.dc-layout').classList.remove('detail-offen'); return; }
      zustand.aktiv = ref;
      liste();

      var adresse = a.strasse + ' ' + a.hausnummer + ', ' + a.plz + ' ' + a.ort;
      var maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(adresse + ', Schweiz');
      var extra = a.utm_extra || {};
      var loeschDatum = new Date(new Date(a.created_at).getTime() + LOESCHFRIST * 864e5);
      var loeschText = a.status === 'auftrag'
        ? 'Status Auftrag: wird nicht automatisch gelöscht.'
        : 'Wird ohne Auftrag am ' + datum(loeschDatum) + ' automatisch gelöscht.';

      d.innerHTML =
        '<button type="button" class="dc-btn dc-zurueck" data-a="zurueck">← Zur Liste</button>' +
        '<div class="dc-zeile1"><h3>' + esc(a.vorname + ' ' + a.nachname) + '</h3><span class="dc-badge s-' + esc(a.status) + '">' + esc(statusLabel(a.status)) + '</span></div>' +
        '<div class="dc-meta">' + esc(a.referenz) + ' · eingegangen ' + datum(a.created_at, true) + '</div>' +
        '<p class="dc-loeschung">' + esc(loeschText) + '</p>' +
        '<div class="dc-knoepfe">' +
          '<a class="dc-btn dc-btn--primaer" href="tel:' + esc(String(a.telefon).replace(/[^\d+]/g, '')) + '">Anrufen</a>' +
          '<a class="dc-btn" href="https://wa.me/' + esc(waNummer(a.telefon)) + '" target="_blank" rel="noopener">WhatsApp</a>' +
          '<a class="dc-btn" href="mailto:' + esc(a.email) + '?subject=' + encodeURIComponent('Ihr Drohnen-Check ' + a.referenz) + '">E-Mail</a>' +
          '<a class="dc-btn" href="' + esc(maps) + '" target="_blank" rel="noopener">Karte</a>' +
        '</div>' +

        '<h4>Kontakt</h4><dl>' +
          zeile('Telefon', a.telefon) + zeile('E-Mail', a.email) + zeile('Report per', a.kanal) +
        '</dl>' +

        '<h4>Gebäude</h4><dl>' +
          zeile('Adresse', adresse) + zeile('Gebäudetyp', a.gebaeudetyp) + zeile('Dachform', a.dachform) +
          zeile('Rolle', a.rolle + (a.rolle === 'Mieter' ? ' (Zustimmung der Eigentümerschaft einholen)' : '')) +
          zeile('Baujahr', a.baujahr) + zeile('Bemerkung', a.bemerkung) +
        '</dl>' +

        '<h4>Wunschtermine</h4><dl>' +
          zeile('Halbtage', (a.wunschtermine || []).map(terminLabel).map(esc).join('<br>') || '–', true) +
        '</dl>' +

        '<h4>Einwilligungen</h4><dl>' +
          zeile('Berechtigt', a.einwilligung_berechtigt ? 'ja' : 'nein') +
          zeile('Aufnahmen Dach', a.einwilligung_aufnahmen ? 'ja' : 'nein') +
          zeile('Kommunikation', a.einwilligung_kommunikation ? 'ja, anonymisiert' : 'nein') +
        '</dl>' +

        '<h4>Herkunft</h4><dl>' +
          zeile('Quelle', a.utm_source) + zeile('Medium', a.utm_medium) + zeile('Kampagne', a.utm_campaign) +
          zeile('Inhalt', a.utm_content) + zeile('Begriff', a.utm_term) +
          zeile('Landingpage', extra.landing) + zeile('Referrer', extra.referrer) +
        '</dl>' +

        '<h4>Bearbeitung</h4><div class="dc-verwaltung">' +
          '<div><label for="dc-status">Status</label><select id="dc-status" data-a="status">' +
            STATUS.map(function (s) { return '<option value="' + s.wert + '"' + (s.wert === a.status ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('') +
          '</select></div>' +
          '<div><label for="dc-termin">Bestätigter Termin</label><input type="datetime-local" id="dc-termin" data-a="termin" value="' + esc(lokalesDatetime(a.termin_bestaetigt)) + '" autocomplete="off"></div>' +
          '<div><label for="dc-notiz">Interne Notiz</label><textarea id="dc-notiz" data-a="notiz" autocomplete="off">' + esc(a.notiz_intern || '') + '</textarea></div>' +
          '<div><button type="button" class="dc-btn dc-btn--primaer" data-a="speichern">Speichern</button> <span class="dc-gespeichert" data-a="gespeichert" aria-live="polite"></span></div>' +
        '</div>';

      d.hidden = false;
      root.querySelector('.dc-layout').classList.add('detail-offen');
      if (opts.onDetail) opts.onDetail(ref);
    }

    function speichern() {
      var a = zustand.anfragen.filter(function (x) { return x.referenz === zustand.aktiv; })[0];
      if (!a) return;
      var termin = el('termin').value;
      var body = {
        referenz: a.referenz,
        status: el('status').value,
        notiz_intern: el('notiz').value.trim() || null,
        termin_bestaetigt: termin ? new Date(termin).toISOString() : null
      };
      var knopf = el('speichern');
      knopf.disabled = true;
      aufruf('/dachcheck-admin-update', { method: 'POST', body: JSON.stringify(body) }).then(function (r) {
        a.status = r.status; a.notiz_intern = r.notiz_intern; a.termin_bestaetigt = r.termin_bestaetigt;
        chips(); zeige(a.referenz);
        el('gespeichert').textContent = 'Gespeichert.';
      }).catch(function (e) {
        knopf.disabled = false;
        el('gespeichert').textContent = '';
        fehler('Speichern fehlgeschlagen: ' + e.message);
      });
    }

    function warteliste() {
      el('warteliste').innerHTML = zustand.warteliste.length
        ? zustand.warteliste.map(function (w) {
          return '<tr><td>' + datum(w.created_at) + '</td><td><a href="mailto:' + esc(w.email) + '">' + esc(w.email) + '</a></td><td>' + esc(w.plz || '–') + '</td><td>' + esc(w.ort || '–') + '</td></tr>';
        }).join('')
        : '<tr><td colspan="4" class="dc-leer">Noch keine Einträge.</td></tr>';
    }

    function csv() {
      var spalten = ['referenz', 'status', 'created_at', 'vorname', 'nachname', 'telefon', 'email', 'kanal', 'strasse', 'hausnummer', 'plz', 'ort',
        'gebaeudetyp', 'dachform', 'rolle', 'baujahr', 'bemerkung', 'wunschtermine', 'termin_bestaetigt',
        'einwilligung_kommunikation', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'notiz_intern'];
      var zelle = function (v) {
        if (Array.isArray(v)) v = v.map(terminLabel).join('; ');
        v = v == null ? '' : String(v);
        // Formel-Injection in Excel verhindern
        if (/^[=+\-@]/.test(v)) v = "'" + v;
        return '"' + v.replace(/"/g, '""') + '"';
      };
      var zeilen = [spalten.join(';')].concat(gefiltert().map(function (a) {
        return spalten.map(function (s) { return zelle(a[s]); }).join(';');
      }));
      var blob = new Blob(['﻿' + zeilen.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'drohnencheck-anfragen-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    }

    function klick(e) {
      var t = e.target.closest('button, a');
      if (!t || !root.contains(t)) return;
      if (t.dataset.ref) { zeige(t.dataset.ref); if (window.innerWidth < 900) root.scrollIntoView({ block: 'start' }); return; }
      if (t.dataset.filter) { zustand.filter = t.dataset.filter; chips(); liste(); return; }
      if (t.dataset.tab) {
        zustand.tab = t.dataset.tab;
        root.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b === t)); });
        root.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== zustand.tab; });
        return;
      }
      switch (t.dataset.a) {
        case 'laden': laden(); break;
        case 'csv': csv(); break;
        case 'speichern': speichern(); break;
        case 'zurueck':
          zustand.aktiv = null;
          el('detail').hidden = true;
          root.querySelector('.dc-layout').classList.remove('detail-offen');
          liste();
          if (opts.onDetail) opts.onDetail(null);
          break;
        case 'emails':
          var liste_ = zustand.warteliste.map(function (w) { return w.email; }).join(', ');
          if (navigator.clipboard) navigator.clipboard.writeText(liste_).then(function () { t.textContent = 'Kopiert'; });
          else window.prompt('E-Mail-Adressen', liste_);
          break;
      }
    }

    return laden();
  }

  window.DCAdmin = { mount: mount };

  // ════════════════════════════════════════════════════════════════════
  // Eigenständige Seite admin.html (Login + Übersicht)
  // ════════════════════════════════════════════════════════════════════
  var standalone = document.getElementById('dc-standalone');
  if (!standalone) return;

  // Gleicher Schlüssel wie im Admin-Panel: auf docs.jaeggivollmer.ch teilen sich beide den Login
  var KEY = 'jv_admin_pwd';
  var pw = {
    get: function () { try { return sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; } },
    set: function (v) { try { sessionStorage.setItem(KEY, v); } catch (e) { /* egal */ } },
    weg: function () { try { sessionStorage.removeItem(KEY); } catch (e) { /* egal */ } }
  };
  var login = document.getElementById('login');
  var app = document.getElementById('app');
  var abmelden = document.getElementById('abmelden');

  function zeigeLogin(fehlerText) {
    app.hidden = true; abmelden.hidden = true; login.hidden = false;
    var f = document.getElementById('login-fehler');
    f.textContent = fehlerText || '';
    f.parentNode.classList.toggle('fehler', !!fehlerText);
    document.getElementById('passwort').focus();
  }
  function zeigeApp() {
    login.hidden = true; app.hidden = false; abmelden.hidden = false;
    return mount(standalone, {
      getPwd: pw.get,
      onUnauthorized: function () { pw.weg(); zeigeLogin('Passwort falsch oder abgelaufen.'); },
      startReferenz: function () { return decodeURIComponent(location.hash.slice(1)); },
      onDetail: function (ref) {
        try { history.replaceState(null, '', ref ? '#' + ref : location.pathname); } catch (e) { /* egal */ }
      }
    });
  }

  document.getElementById('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var wert = document.getElementById('passwort').value;
    if (!wert) return;
    pw.set(wert);
    document.getElementById('passwort').value = '';
    zeigeApp();
  });
  abmelden.addEventListener('click', function () { pw.weg(); zeigeLogin(); });

  if (pw.get()) zeigeApp(); else zeigeLogin();
})();
