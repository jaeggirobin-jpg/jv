// admin.js — Übersicht der Drohnen-Check-Anfragen
// Wird an zwei Orten verwendet:
//  1. admin.html auf dachcheck.jaeggivollmer.ch (eigener Login, Link aus der Info-Mail)
//  2. Tab «Drohnen-Check» im bestehenden Admin-Panel (public/index.html)
// Beide nutzen dasselbe ADMIN_PASSWORD und die Functions dachcheck-admin-*.
(function () {
  'use strict';

  var STATUS = [
    { wert: 'neu', label: 'Neu' },
    { wert: 'termin', label: 'Flug geplant' },
    { wert: 'geflogen', label: 'Geflogen' },
    { wert: 'report', label: 'Bericht versendet' },
    { wert: 'auftrag', label: 'Auftrag' },
    { wert: 'abgeschlossen', label: 'Abgeschlossen' },
    { wert: 'abgesagt', label: 'Abgesagt' }
  ];
  var CFG = window.DC_CONFIG || {};
  var LOESCHFRIST = CFG.loeschfristTage || 60;
  var BERICHT_URL = (CFG.links && CFG.links.bericht) || 'https://dachcheck.jaeggivollmer.ch/bericht.html';
  var AMPEL = ((CFG.texte && CFG.texte.report && CFG.texte.report.ampel) || []).map(function (a) { return { wert: a.stufe, label: a.wort }; });
  var MAX_KANTE = 2000;   // Bilder werden vor dem Upload auf diese Kantenlänge verkleinert (JPEG)
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
  function adresseVon(a) {
    return [a.strasse, a.hausnummer].filter(Boolean).join(' ') + ', ' + a.plz + ' ' + a.ort;
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
          '<div class="dc-filter"><input type="search" data-a="suche" placeholder="Suchen: Name, Ort, Referenz, E-Mail …" autocomplete="off" aria-label="Anfragen durchsuchen">' +
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
        var heu = [a.referenz, a.vorname, a.nachname, a.strasse, a.plz, a.ort, a.telefon || '', a.email].join(' ').toLowerCase();
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
          '<span class="dc-meta">' + esc(adresseVon(a)) + '</span>' +
          '<span class="dc-meta">' + esc(a.referenz) + ' · ' + datum(a.created_at) +
          (a.termin_bestaetigt ? ' · Flug ' + datum(a.termin_bestaetigt) : '') + '</span>' +
          '</button></li>';
      }).join('');
    }

    function zeile(k, v, roh) {
      return '<dt>' + esc(k) + '</dt><dd>' + (roh ? v : esc(v == null || v === '' ? '–' : v)) + '</dd>';
    }
    // Zeile nur, wenn ein Wert vorhanden ist (ältere Anfragen haben mehr Felder)
    function zeileWenn(k, v) {
      return v == null || v === '' ? '' : zeile(k, v);
    }

    function zeige(ref) {
      var a = zustand.anfragen.filter(function (x) { return x.referenz === ref; })[0];
      var d = el('detail');
      if (!a) { d.hidden = true; root.querySelector('.dc-layout').classList.remove('detail-offen'); return; }
      if (zustand.aktiv !== ref) zustand.bericht = null;
      zustand.aktiv = ref;
      liste();

      var adresse = adresseVon(a);
      var maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(adresse + ', Schweiz');
      var extra = a.utm_extra || {};
      var loeschDatum = new Date(new Date(a.created_at).getTime() + LOESCHFRIST * 864e5);
      var loeschText = a.status === 'auftrag'
        ? 'Status Auftrag: wird nicht automatisch gelöscht.'
        : 'Wird ohne Auftrag am ' + datum(loeschDatum) + ' automatisch gelöscht (mit Bericht und Bildern).';
      var gebaeude = zeileWenn('Gebäudetyp', a.gebaeudetyp) + zeileWenn('Dachform', a.dachform) + zeileWenn('Rolle', a.rolle) +
        zeileWenn('Baujahr', a.baujahr) + zeileWenn('Bemerkung', a.bemerkung);

      d.innerHTML =
        '<button type="button" class="dc-btn dc-zurueck" data-a="zurueck">← Zur Liste</button>' +
        '<div class="dc-zeile1"><h3>' + esc(a.vorname + ' ' + a.nachname) + '</h3><span class="dc-badge s-' + esc(a.status) + '">' + esc(statusLabel(a.status)) + '</span></div>' +
        '<div class="dc-meta">' + esc(a.referenz) + ' · eingegangen ' + datum(a.created_at, true) + '</div>' +
        '<p class="dc-loeschung">' + esc(loeschText) + '</p>' +
        '<div class="dc-knoepfe">' +
          '<a class="dc-btn dc-btn--primaer" href="' + esc(ankuendigungMail(a)) + '">Flug ankündigen</a>' +
          '<a class="dc-btn" href="mailto:' + esc(a.email) + '?subject=' + encodeURIComponent('Ihr Drohnen-Check ' + a.referenz) + '">E-Mail</a>' +
          (a.telefon ? '<a class="dc-btn" href="tel:' + esc(String(a.telefon).replace(/[^\d+]/g, '')) + '">Anrufen</a>' +
            '<a class="dc-btn" href="https://wa.me/' + esc(waNummer(a.telefon)) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') +
          '<a class="dc-btn" href="' + esc(maps) + '" target="_blank" rel="noopener">Karte</a>' +
        '</div>' +

        '<h4>Kontakt und Adresse</h4><dl>' +
          zeile('Adresse', adresse) + zeile('E-Mail', a.email) + zeileWenn('Telefon', a.telefon) + zeileWenn('Report per', a.kanal) +
        '</dl>' +

        (gebaeude ? '<h4>Gebäude</h4><dl>' + gebaeude + '</dl>' : '') +

        ((a.wunschtermine || []).length ? '<h4>Wunschtermine</h4><dl>' +
          zeile('Halbtage', a.wunschtermine.map(terminLabel).map(esc).join('<br>'), true) + '</dl>' : '') +

        '<h4>Bearbeitung</h4><div class="dc-verwaltung">' +
          '<div><label for="dc-status">Status</label><select id="dc-status" data-a="status">' +
            STATUS.map(function (s) { return '<option value="' + s.wert + '"' + (s.wert === a.status ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('') +
          '</select></div>' +
          '<div><label for="dc-termin">Geplanter Flug</label><input type="datetime-local" id="dc-termin" data-a="termin" value="' + esc(lokalesDatetime(a.termin_bestaetigt)) + '" autocomplete="off"></div>' +
          '<div><label for="dc-notiz">Interne Notiz</label><textarea id="dc-notiz" data-a="notiz" autocomplete="off">' + esc(a.notiz_intern || '') + '</textarea></div>' +
          '<div><button type="button" class="dc-btn dc-btn--primaer" data-a="speichern">Speichern</button> <span class="dc-gespeichert" data-a="gespeichert" aria-live="polite"></span></div>' +
        '</div>' +

        '<h4>Bericht</h4><div class="dc-bericht" data-a="bericht"><p class="dc-hinweis">Bericht wird geladen …</p></div>' +

        '<h4>Einwilligungen</h4><dl>' +
          zeile('Berechtigt + Aufnahmen', a.einwilligung_berechtigt && a.einwilligung_aufnahmen ? 'ja' : 'nein') +
          zeile('Kommunikation', a.einwilligung_kommunikation ? 'ja, anonymisiert' : 'nein') +
        '</dl>' +

        '<h4>Herkunft</h4><dl>' +
          zeile('Quelle', a.utm_source) + zeile('Medium', a.utm_medium) + zeile('Kampagne', a.utm_campaign) +
          zeileWenn('Inhalt', a.utm_content) + zeileWenn('Begriff', a.utm_term) +
          zeileWenn('Landingpage', extra.landing) + zeileWenn('Referrer', extra.referrer) +
        '</dl>';

      d.hidden = false;
      root.querySelector('.dc-layout').classList.add('detail-offen');
      if (opts.onDetail) opts.onDetail(ref);

      if (zustand.bericht && zustand.bericht.referenz === ref) berichtZeigen();
      else berichtLaden(ref);
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
      // Ungespeicherte Eingaben im Bericht über das Neuzeichnen retten
      if (zustand.bericht) berichtEingabenUebernehmen();
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

    // ════════════════════════════════════════════════════════════════
    // Bericht: erstellen, Bilder in den Bucket laden, veröffentlichen
    // ════════════════════════════════════════════════════════════════
    // zustand.bericht = { referenz, daten (vom Server oder null), eingaben, ungespeichert, meldung }

    function aktuelleAnfrage() {
      return zustand.anfragen.filter(function (x) { return x.referenz === zustand.aktiv; })[0];
    }

    function berichtAufruf(action, daten) {
      var body = Object.assign({ action: action, referenz: zustand.aktiv }, daten || {});
      return aufruf('/dachcheck-bericht', { method: 'POST', body: JSON.stringify(body) });
    }

    function berichtLaden(ref) {
      berichtAufruf('laden').then(function (r) {
        if (zustand.aktiv !== ref) return;
        zustand.bericht = { referenz: ref, daten: r.bericht, eingaben: null, ungespeichert: false, meldung: '', meldungFehler: false };
        berichtZeigen();
      }).catch(function (e) {
        var box = el('bericht');
        if (box) box.innerHTML = '<p class="dc-fehler">Bericht konnte nicht geladen werden: ' + esc(e.message) + '</p>';
      });
    }

    // Eingaben aus dem Formular lesen, damit sie ein Neuzeichnen überstehen
    function berichtEingabenUebernehmen() {
      var box = el('bericht');
      if (!box || !box.querySelector('[data-b="zusammenfassung"]')) return;
      var ampel = box.querySelector('input[name="dc-ampel"]:checked');
      var beschriftungen = {};
      box.querySelectorAll('[data-b="beschriftung"]').forEach(function (i) { beschriftungen[i.dataset.pfad] = i.value; });
      zustand.bericht.eingaben = {
        flugdatum: box.querySelector('[data-b="flugdatum"]').value,
        ampel: ampel ? ampel.value : '',
        zusammenfassung: box.querySelector('[data-b="zusammenfassung"]').value,
        empfehlung: box.querySelector('[data-b="empfehlung"]').value,
        beschriftungen: beschriftungen
      };
    }

    // Werte für die Anzeige: lokale Eingaben vor Serverstand
    function berichtWerte() {
      var b = zustand.bericht.daten || { bilder: [] };
      var e = zustand.bericht.eingaben || {};
      var a = aktuelleAnfrage() || {};
      var hat = function (k) { return Object.prototype.hasOwnProperty.call(e, k); };
      return {
        flugdatum: hat('flugdatum') ? e.flugdatum : (b.flugdatum || (a.termin_bestaetigt ? lokalesDatetime(a.termin_bestaetigt).slice(0, 10) : '')),
        ampel: hat('ampel') ? e.ampel : (b.ampel || ''),
        zusammenfassung: hat('zusammenfassung') ? e.zusammenfassung : (b.zusammenfassung || ''),
        empfehlung: hat('empfehlung') ? e.empfehlung : (b.empfehlung || ''),
        bilder: (b.bilder || []).map(function (x) {
          var cap = e.beschriftungen && Object.prototype.hasOwnProperty.call(e.beschriftungen, x.pfad) ? e.beschriftungen[x.pfad] : x.beschriftung;
          return { pfad: x.pfad, url: x.url, beschriftung: cap || '' };
        })
      };
    }

    function kundenLink() {
      var b = zustand.bericht && zustand.bericht.daten;
      return b ? BERICHT_URL + '?t=' + b.token : '';
    }

    function berichtZeigen() {
      var box = el('bericht');
      if (!box || !zustand.bericht) return;
      var a = aktuelleAnfrage();
      var b = zustand.bericht.daten;
      var w = berichtWerte();
      var veroeffentlicht = b && b.veroeffentlicht_at;

      var stand = !b
        ? 'Noch kein Bericht. Bilder hochladen und Texte erfassen, dann veröffentlichen.'
        : veroeffentlicht
          ? 'Veröffentlicht am ' + datum(b.veroeffentlicht_at, true) + '. Der Kunde kann den Bericht über den Link ansehen.'
          : 'Entwurf. Der Kundenlink ist noch gesperrt.';

      box.innerHTML =
        '<p class="dc-bericht__stand' + (veroeffentlicht ? ' ist-live' : '') + '">' + esc(stand) + '</p>' +
        '<div class="dc-verwaltung">' +
          '<div><label for="dc-flugdatum">Flugdatum</label><input type="date" id="dc-flugdatum" data-b="flugdatum" value="' + esc(w.flugdatum) + '" autocomplete="off"></div>' +
          '<fieldset class="dc-ampelwahl"><legend>Ampel</legend>' +
            AMPEL.map(function (x) {
              return '<label class="dc-ampel s-' + x.wert + '"><input type="radio" name="dc-ampel" value="' + x.wert + '"' + (w.ampel === x.wert ? ' checked' : '') + '><span>' + esc(x.label) + '</span></label>';
            }).join('') +
          '</fieldset>' +
          '<div><label for="dc-zusammenfassung">Befund</label><textarea id="dc-zusammenfassung" data-b="zusammenfassung" placeholder="Was wir gesehen haben, in zwei, drei Sätzen." autocomplete="off">' + esc(w.zusammenfassung) + '</textarea></div>' +
          '<div><label for="dc-empfehlung">Empfehlung <span class="dc-optional">(optional)</span></label><textarea id="dc-empfehlung" data-b="empfehlung" placeholder="Was wir empfehlen und bis wann." autocomplete="off">' + esc(w.empfehlung) + '</textarea></div>' +
        '</div>' +

        '<div class="dc-bilder">' +
          (w.bilder.length ? w.bilder.map(function (x, i) {
            return '<div class="dc-bild">' +
              (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener"><img src="' + esc(x.url) + '" alt="Bild ' + (i + 1) + '" loading="lazy"></a>' : '<div class="dc-bild__fehlt">Bild fehlt</div>') +
              '<input type="text" data-b="beschriftung" data-pfad="' + esc(x.pfad) + '" value="' + esc(x.beschriftung) + '" placeholder="Beschriftung, z. B. Rinne Nordseite" aria-label="Beschriftung Bild ' + (i + 1) + '" autocomplete="off">' +
              '<div class="dc-bild__knoepfe">' +
                '<button type="button" class="dc-btn" data-bild="hoch" data-pfad="' + esc(x.pfad) + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Nach vorne">↑</button>' +
                '<button type="button" class="dc-btn" data-bild="runter" data-pfad="' + esc(x.pfad) + '"' + (i === w.bilder.length - 1 ? ' disabled' : '') + ' aria-label="Nach hinten">↓</button>' +
                '<button type="button" class="dc-btn" data-bild="loeschen" data-pfad="' + esc(x.pfad) + '">Entfernen</button>' +
              '</div></div>';
          }).join('') : '<p class="dc-hinweis">Noch keine Bilder.</p>') +
        '</div>' +
        '<label class="dc-btn dc-upload">Bilder hinzufügen<input type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple data-b="dateien"></label>' +
        '<p class="dc-hinweis" data-b="upload-status" aria-live="polite"></p>' +

        '<div class="dc-knoepfe">' +
          '<button type="button" class="dc-btn dc-btn--primaer" data-a="bericht-speichern">Bericht speichern</button>' +
          (b ? '<button type="button" class="dc-btn" data-a="bericht-freigabe">' + (veroeffentlicht ? 'Kundenlink sperren' : 'Speichern und veröffentlichen') + '</button>' : '') +
        '</div>' +
        '<p class="dc-gespeichert' + (zustand.bericht.meldungFehler ? ' dc-meldung-fehler' : '') + '" data-b="meldung" aria-live="polite">' +
          esc(zustand.bericht.meldung || (zustand.bericht.ungespeichert ? 'Ungespeicherte Änderungen.' : '')) + '</p>' +

        (veroeffentlicht ?
          '<div class="dc-link"><label for="dc-kundenlink">Kundenlink</label><input type="text" id="dc-kundenlink" readonly value="' + esc(kundenLink()) + '">' +
          '<div class="dc-knoepfe">' +
            '<button type="button" class="dc-btn" data-a="link-kopieren">Link kopieren</button>' +
            '<a class="dc-btn dc-btn--primaer" href="' + esc(berichtMail(a)) + '">Per E-Mail senden</a>' +
            '<a class="dc-btn" href="' + esc(kundenLink()) + '" target="_blank" rel="noopener">Ansehen</a>' +
          '</div></div>' : '');

      zustand.bericht.meldung = '';
      zustand.bericht.meldungFehler = false;
      box.querySelector('[data-b="dateien"]').addEventListener('change', function (ev) {
        var dateien = Array.prototype.slice.call(ev.target.files || []);
        ev.target.value = '';
        if (dateien.length) bilderHochladen(dateien);
      });
      box.oninput = function () { zustand.bericht.ungespeichert = true; };
    }

    // Meldung direkt beim Bericht anzeigen (die allgemeine Fehlerzeile steht weit unten)
    function berichtMeldung(text, istFehler) {
      zustand.bericht.meldung = text;
      zustand.bericht.meldungFehler = !!istFehler;
      berichtZeigen();
    }

    function berichtSpeichern(danachVeroeffentlichen) {
      berichtEingabenUebernehmen();
      var w = berichtWerte();
      var knopf = el('bericht-speichern');
      if (knopf) knopf.disabled = true;
      return berichtAufruf('speichern', {
        flugdatum: w.flugdatum || null,
        ampel: w.ampel || null,
        zusammenfassung: w.zusammenfassung,
        empfehlung: w.empfehlung,
        bilder: w.bilder.map(function (x) { return { pfad: x.pfad, beschriftung: x.beschriftung }; })
      }).then(function (r) {
        zustand.bericht.daten = r.bericht;
        zustand.bericht.eingaben = null;
        zustand.bericht.ungespeichert = false;
        zustand.bericht.meldung = 'Bericht gespeichert.';
        if (danachVeroeffentlichen) return freigabe(true);
        berichtZeigen();
      }).catch(function (e) {
        berichtMeldung('Speichern fehlgeschlagen: ' + e.message, true);
      });
    }

    function freigabe(an) {
      return berichtAufruf('veroeffentlichen', { veroeffentlicht: an }).then(function (r) {
        zustand.bericht.daten = r.bericht;
        zustand.bericht.meldung = an ? 'Veröffentlicht. Jetzt den Link an den Kunden senden.' : 'Kundenlink gesperrt.';
        var a = aktuelleAnfrage();
        if (a && r.status && a.status !== r.status) { a.status = r.status; chips(); zeige(a.referenz); return; }
        berichtZeigen();
      }).catch(function (e) { berichtMeldung(e.message, true); });
    }

    // Bild im Browser verkleinern (spart Speicher und entfernt GPS-Daten aus EXIF)
    function verkleinern(datei) {
      var laden = window.createImageBitmap
        ? createImageBitmap(datei, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(datei); })
        : new Promise(function (ok, nein) {
          var img = new Image();
          img.onload = function () { ok(img); };
          img.onerror = nein;
          img.src = URL.createObjectURL(datei);
        });
      return laden.then(function (bild) {
        var b = bild.width, h = bild.height;
        var f = Math.min(1, MAX_KANTE / Math.max(b, h));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(b * f); canvas.height = Math.round(h * f);
        canvas.getContext('2d').drawImage(bild, 0, 0, canvas.width, canvas.height);
        if (bild.close) bild.close();
        return new Promise(function (ok, nein) {
          canvas.toBlob(function (blob) { blob ? ok(blob) : nein(new Error('Bild konnte nicht umgewandelt werden')); }, 'image/jpeg', 0.85);
        });
      }, function () {
        throw new Error('Format wird nicht unterstützt (bitte JPG oder PNG)');
      });
    }

    function bilderHochladen(dateien) {
      berichtEingabenUebernehmen();
      var status = function (t) { var s = el('bericht') && el('bericht').querySelector('[data-b="upload-status"]'); if (s) s.textContent = t; };
      var fehlerListe = [];
      var kette = Promise.resolve();
      dateien.forEach(function (datei, i) {
        kette = kette.then(function () {
          status('Bild ' + (i + 1) + ' von ' + dateien.length + ' wird hochgeladen …');
          return verkleinern(datei).then(function (blob) {
            return berichtAufruf('upload-url', { typ: 'image/jpeg', groesse: blob.size }).then(function (u) {
              return fetch(u.upload_url, {
                method: 'PUT',
                headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
                body: blob
              }).then(function (res) {
                if (!res.ok) throw new Error('Upload fehlgeschlagen (' + res.status + ')');
                return berichtAufruf('bild-hinzufuegen', { pfad: u.pfad });
              });
            });
          }).then(function (r) {
            zustand.bericht.daten = r.bericht;
          }).catch(function (e) {
            fehlerListe.push(datei.name + ': ' + e.message);
          });
        });
      });
      kette.then(function () {
        if (fehlerListe.length) berichtMeldung('Nicht hochgeladen: ' + fehlerListe.join('; '), true);
        else berichtZeigen();
      });
    }

    function bildAktion(art, pfad) {
      berichtEingabenUebernehmen();
      if (art === 'loeschen') {
        if (!window.confirm('Bild endgültig entfernen?')) return;
        berichtAufruf('bild-loeschen', { pfad: pfad }).then(function (r) {
          zustand.bericht.daten = r.bericht;
          berichtZeigen();
        }).catch(function (e) { berichtMeldung('Entfernen fehlgeschlagen: ' + e.message, true); });
        return;
      }
      // Reihenfolge lokal ändern, wird mit «Bericht speichern» übernommen
      var bilder = zustand.bericht.daten.bilder;
      var i = bilder.map(function (x) { return x.pfad; }).indexOf(pfad);
      var j = art === 'hoch' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= bilder.length) return;
      var tmp = bilder[i]; bilder[i] = bilder[j]; bilder[j] = tmp;
      zustand.bericht.ungespeichert = true;
      berichtZeigen();
    }

    // E-Mail-Entwürfe im eigenen Mailprogramm (keine Personendaten über den Versanddienst)
    function ankuendigungMail(a) {
      var tag = a.termin_bestaetigt
        ? new Date(a.termin_bestaetigt).toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' })
        : '[Tag]';
      var text = 'Guten Tag ' + a.vorname + ' ' + a.nachname + '\n\n' +
        'Vielen Dank für Ihre Anfrage zum Gratis Drohnen-Check (' + a.referenz + ').\n\n' +
        'Unser Projektleiter ist am ' + tag + ' in Ihrer Nähe und fliegt bei gutem Wetter kurz mit der Drohne über Ihr Dach (' + adresseVon(a) + '). ' +
        'Sie müssen dafür nicht zu Hause sein. Den Kurzbericht mit Ampel und Fotos erhalten Sie wenige Tage danach per E-Mail.\n\n' +
        'Freundliche Grüsse\nJäggi Vollmer';
      return 'mailto:' + a.email + '?subject=' + encodeURIComponent('Ihr Drohnen-Check ' + a.referenz + ': wir kommen vorbei') + '&body=' + encodeURIComponent(text);
    }
    function berichtMail(a) {
      var bis = a.status === 'auftrag' ? '' : '\n\nDer Bericht ist bis ' + datum(new Date(new Date(a.created_at).getTime() + LOESCHFRIST * 864e5)) + ' abrufbar.';
      var text = 'Guten Tag ' + a.vorname + ' ' + a.nachname + '\n\n' +
        'Ihr Kurzbericht zum Drohnen-Check ist bereit:\n' + kundenLink() + bis + '\n\n' +
        'Haben Sie Fragen oder wünschen Sie eine Offerte? Antworten Sie einfach auf diese E-Mail.\n\n' +
        'Freundliche Grüsse\nJäggi Vollmer';
      return 'mailto:' + a.email + '?subject=' + encodeURIComponent('Ihr Drohnen-Check ' + a.referenz + ': Kurzbericht') + '&body=' + encodeURIComponent(text);
    }

    function warteliste() {
      el('warteliste').innerHTML = zustand.warteliste.length
        ? zustand.warteliste.map(function (w) {
          return '<tr><td>' + datum(w.created_at) + '</td><td><a href="mailto:' + esc(w.email) + '">' + esc(w.email) + '</a></td><td>' + esc(w.plz || '–') + '</td><td>' + esc(w.ort || '–') + '</td></tr>';
        }).join('')
        : '<tr><td colspan="4" class="dc-leer">Noch keine Einträge.</td></tr>';
    }

    function csv() {
      var spalten = ['referenz', 'status', 'created_at', 'vorname', 'nachname', 'email', 'telefon', 'strasse', 'hausnummer', 'plz', 'ort',
        'termin_bestaetigt',
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
      if (t.dataset.bild) { bildAktion(t.dataset.bild, t.dataset.pfad); return; }
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
        case 'bericht-speichern': berichtSpeichern(false); break;
        case 'bericht-freigabe':
          if (zustand.bericht.daten && zustand.bericht.daten.veroeffentlicht_at) {
            if (window.confirm('Kundenlink sperren? Der Kunde sieht den Bericht dann nicht mehr.')) freigabe(false);
          } else {
            berichtSpeichern(true);
          }
          break;
        case 'link-kopieren':
          var link = kundenLink();
          if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { t.textContent = 'Kopiert'; });
          else window.prompt('Kundenlink', link);
          break;
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
