// admin.js — Übersicht der KRV-Check-Anfragen
// Wird an zwei Orten verwendet:
//  1. admin.html auf krv.jaeggivollmer.ch (eigener Login, Link aus der Info-Mail)
//  2. Tab «KRV-Check» im bestehenden Admin-Panel (public/index.html)
// Beide nutzen dasselbe ADMIN_PASSWORD und die Functions krv-admin-*.
// Gestaltung: Klassen dc-* aus /dachcheck/assets/admin.css plus admin.css hier.
(function () {
  'use strict';

  var STATUS = [
    { wert: 'neu', label: 'Neu' },
    { wert: 'beurteilt', label: 'Beurteilt' },
    { wert: 'offerte', label: 'Offerte versendet' },
    { wert: 'auftrag', label: 'Auftrag' },
    { wert: 'abgeschlossen', label: 'Abgeschlossen' },
    { wert: 'abgesagt', label: 'Abgesagt' }
  ];
  var BEURTEILUNG = [
    { wert: 'vorhanden', label: 'KRV vorhanden' },
    { wert: 'fehlt', label: 'KRV fehlt' },
    { wert: 'unklar', label: 'Unklar' }
  ];
  var ROLLEN = { eigentuemer: 'Eigentümer/in', verwaltung: 'Verwaltung', mieter: 'Mieter/in' };
  var CFG = window.KRV_CONFIG || {};
  var LOESCHFRIST = CFG.loeschfristTage || 90;
  var VIDEO_MAX_SEKUNDEN = 60;
  var VIDEO_KANTE = 1280;
  var VIDEO_BITRATE = 2000000;
  // Ordner dieses Skripts (…/krv/assets/), funktioniert auf krv.jaeggivollmer.ch und im Admin-Panel
  var ASSETS = ((document.currentScript && document.currentScript.src) || '/krv/assets/admin.js').replace(/[^/]*$/, '');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function label(liste, w) {
    for (var i = 0; i < liste.length; i++) if (liste[i].wert === w) return liste[i].label;
    return w || '–';
  }
  function datum(iso, mitZeit) {
    if (!iso) return '–';
    var o = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (mitZeit) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return new Date(iso).toLocaleString('de-CH', o);
  }
  function adresseVon(a) {
    return [a.strasse, a.hausnummer].filter(Boolean).join(' ') + ', ' + a.plz + ' ' + a.ort;
  }
  // Schweizer Nummer ohne Ländervorwahl und führende 0, z. B. «793288180» aus «079 328 81 80» oder «+41 79 …»
  // (Kunden tippen die Nummer unterschiedlich ein). Ausländische Nummern: null.
  function telNational(tel) {
    var n = String(tel || '').replace(/[^\d+]/g, '');
    if (n.indexOf('+41') === 0) n = n.slice(3);
    else if (n.indexOf('0041') === 0) n = n.slice(4);
    else if (n.indexOf('+') === 0 || n.indexOf('00') === 0) return null;
    else if (n.length === 11 && n.indexOf('41') === 0) n = n.slice(2);
    if (n.indexOf('0') === 0) n = n.slice(1);
    return /^[1-9]\d{8}$/.test(n) ? n : null;
  }
  // Anzeige «079 328 81 80»; unbekanntes Format bleibt wie eingegeben
  function telAnzeige(tel) {
    var n = telNational(tel);
    return n ? '0' + n.slice(0, 2) + ' ' + n.slice(2, 5) + ' ' + n.slice(5, 7) + ' ' + n.slice(7) : String(tel || '').trim();
  }
  function telLink(tel) {
    var n = telNational(tel);
    return n ? '+41' + n : String(tel || '').replace(/[^\d+]/g, '');
  }
  function waNummer(tel) {
    var n = telNational(tel);
    if (n) return '41' + n;
    n = String(tel || '').replace(/[^\d+]/g, '');
    return n.indexOf('+') === 0 ? n.slice(1) : n.indexOf('00') === 0 ? n.slice(2) : n;
  }
  function mb(bytes) {
    return (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',') + ' MB';
  }

  // ════════════════════════════════════════════════════════════════════
  // Antwort an den Kunden als E-Mail-Entwurf (eigenes Mailprogramm, kein Versanddienst)
  // ════════════════════════════════════════════════════════════════════
  // Passender IWB-Flyer zur PLZ der Liegenschaft (config.js texte.iwb.flyer), als volle Adresse für die E-Mail
  function flyerUrl(plz) {
    var n = parseInt(plz, 10);
    var liste = (CFG.texte && CFG.texte.iwb && CFG.texte.iwb.flyer) || [];
    var f = liste.filter(function (x) {
      return (x.plz || []).some(function (e) {
        if (typeof e === 'number') return e === n;
        var t = String(e).split('-');
        return n >= parseInt(t[0], 10) && n <= parseInt(t[1] || t[0], 10);
      });
    })[0];
    return f ? 'https://krv.jaeggivollmer.ch/' + f.datei : '';
  }

  function antwortMail(a, beurteilung, text) {
    var anrede = 'Guten Tag ' + a.vorname + ' ' + a.nachname + '\n\n' +
      'Vielen Dank für Ihre Anfrage zum Gratis KRV-Check (' + a.referenz + ', ' + adresseVon(a) + ').\n\n';
    var zusatz = text ? text.trim() + '\n\n' : '';
    var vorbehalt = 'Bitte beachten Sie: Unsere Einschätzung beruht auf Ihren Fotos und ersetzt keine Kontrolle vor Ort.\n\n';
    var gruss = 'Freundliche Grüsse\nJäggi Vollmer\n' + (CFG.firma ? CFG.firma.telefon : '');
    var mieter = a.rolle === 'mieter'
      ? 'Den Einbau muss die Eigentümerschaft oder die Verwaltung in Auftrag geben. Leiten Sie diese E-Mail gerne weiter.\n\n'
      : '';
    var betreff, body;
    if (beurteilung === 'vorhanden') {
      betreff = 'Ihr KRV-Check ' + a.referenz + ': Rückflussverhinderer vorhanden';
      body = anrede +
        'Gute Nachricht: Auf Ihren Fotos ist nach dem Wasserzähler ein Rückflussverhinderer zu erkennen. Sie müssen nichts einbauen.\n\n' + zusatz +
        'Wir melden IWB per E-Mail, dass bei Ihnen bereits ein Rückflussverhinderer vorhanden ist. Sie müssen dafür nichts weiter tun.\n\n' +
        vorbehalt + gruss;
    } else if (beurteilung === 'fehlt') {
      betreff = 'Ihr KRV-Check ' + a.referenz + ': Rückflussverhinderer fehlt';
      body = anrede +
        'Auf Ihren Fotos sehen wir nach dem Wasserzähler keinen Rückflussverhinderer.\n\n' + zusatz +
        (a.offerte_gewuenscht === false
          ? 'Gemäss IWB muss die Eigentümerschaft einen Rückflussverhinderer auf eigene Kosten einbauen lassen. Wenn Sie dafür eine Offerte möchten, antworten Sie einfach auf diese E-Mail. Den Einbau melden wir anschliessend direkt an IWB.\n\n'
          : 'Gemäss IWB muss die Eigentümerschaft einen Rückflussverhinderer auf eigene Kosten einbauen lassen. Wie gewünscht erstellen wir Ihnen dafür eine Offerte. Den Einbau melden wir anschliessend direkt an IWB.\n\n' +
            '[Die Offerte finden Sie im Anhang. / Wir senden Ihnen die Offerte in den nächsten Tagen.]\n\n') +
        mieter + (flyerUrl(a.plz) ? 'Die Informationen von IWB dazu finden Sie im Flyer: ' + flyerUrl(a.plz) + '\n\n' : '') +
        vorbehalt + gruss;
    } else {
      betreff = 'Ihr KRV-Check ' + a.referenz + ': noch ein Foto, bitte';
      body = anrede +
        'Auf Ihren Fotos können wir leider nicht sicher erkennen, ob ein Rückflussverhinderer eingebaut ist.\n\n' + zusatz +
        'Können Sie uns noch ein Foto senden? Antworten Sie einfach auf diese E-Mail und hängen Sie das Foto an. Am besten von etwa einem Meter Abstand, mit dem Wasserzähler und allen Ventilen rechts und links davon. Alternativ kommen wir gerne kurz vorbei.\n\n' +
        gruss;
    }
    return 'mailto:' + a.email + '?subject=' + encodeURIComponent(betreff) + '&body=' + encodeURIComponent(body);
  }

  // ════════════════════════════════════════════════════════════════════
  // Übersicht in ein Element einhängen
  // ════════════════════════════════════════════════════════════════════
  function mount(root, opts) {
    opts = opts || {};
    var getPwd = opts.getPwd;
    var onUnauthorized = opts.onUnauthorized || function () {};
    var api = opts.api || '/api';

    var zustand = root._krv || { anfragen: [], filter: 'offen', suche: '', aktiv: null, tab: 'anfragen', fotos: {} };
    root._krv = zustand;

    if (!root._krvAufgebaut) {
      root._krvAufgebaut = true;
      root.classList.add('dc-admin', 'krv-admin');
      root.innerHTML =
        '<div class="dc-kopfzeile"><h2>KRV-Check</h2><div class="dc-aktionen">' +
          '<button type="button" class="dc-btn" data-a="laden">Aktualisieren</button>' +
          '<button type="button" class="dc-btn" data-a="csv">CSV exportieren</button></div></div>' +
        '<div class="dc-tabs" role="tablist">' +
          '<button type="button" role="tab" data-tab="anfragen" aria-selected="true">Anfragen <span data-anz="anfragen"></span></button>' +
          '<button type="button" role="tab" data-tab="video" aria-selected="false">Anleitungsvideo</button></div>' +
        '<section data-panel="anfragen">' +
          '<div class="dc-filter"><input type="search" data-a="suche" placeholder="Suchen: Name, Ort, Referenz, E-Mail …" autocomplete="off" aria-label="Anfragen durchsuchen">' +
          '<div class="dc-chips" data-a="chips" role="group" aria-label="Nach Status filtern"></div></div>' +
          '<div class="dc-layout"><ul class="dc-liste" data-a="liste"></ul><article class="dc-detail" data-a="detail" hidden></article></div>' +
        '</section>' +
        '<section data-panel="video" class="dc-hero" hidden>' +
          '<h3>Anleitungsvideo</h3>' +
          '<p class="dc-hinweis">Ein kurzes Handyvideo «so finde und fotografiere ich den Wasserzähler». Es erscheint auf der Landingpage über der gezeichneten Anleitung. ' +
            'Es wird beim Import auf ' + VIDEO_KANTE + ' px und höchstens ' + VIDEO_MAX_SEKUNDEN + ' Sekunden verkleinert, ohne Ton. Keine erkennbaren Personen oder Adressen. Am besten mit Chrome oder Edge.</p>' +
          '<div data-a="video-aktuell"><p class="dc-hinweis">Wird geladen …</p></div>' +
          '<label class="dc-btn dc-btn--primaer dc-upload">Video importieren<input type="file" accept="video/*" data-a="video-datei"></label>' +
          '<div class="dc-hero__zuschnitt" data-a="video-zuschnitt" hidden>' +
            '<video class="dc-hero__video" data-a="video-quelle" muted playsinline controls preload="metadata"></video>' +
            '<p class="dc-meta" data-a="video-info"></p>' +
            '<div class="dc-verwaltung dc-hero__felder">' +
              '<div><label for="krv-video-start">Start bei Sekunde</label><input type="number" id="krv-video-start" data-a="video-start" min="0" step="1" value="0" inputmode="numeric"></div>' +
              '<div><label for="krv-video-laenge">Länge in Sekunden (max. ' + VIDEO_MAX_SEKUNDEN + ')</label><input type="number" id="krv-video-laenge" data-a="video-laenge" min="1" max="' + VIDEO_MAX_SEKUNDEN + '" step="1" value="30" inputmode="numeric"></div>' +
            '</div>' +
            '<div class="dc-knoepfe"><button type="button" class="dc-btn" data-a="video-hier">Aktuelle Stelle als Start</button>' +
              '<button type="button" class="dc-btn dc-btn--primaer" data-a="video-los">Verkleinern und hochladen</button></div>' +
          '</div>' +
          '<p class="dc-gespeichert" data-a="video-status" aria-live="polite"></p>' +
        '</section>' +
        '<p class="dc-fehler" data-a="fehler" role="alert" hidden></p>';

      root.addEventListener('click', klick);
      // Rückantwortkarte: Einbaudatum nur bei «eingebaut»
      root.addEventListener('change', function (e) {
        var art = e.target.dataset.a;
        if (art === 'karte-art') el('karte-datum-feld').hidden = e.target.value !== 'eingebaut';
        if (art === 'beurteilung') vormerken({ beurteilung: e.target.value }, true);
      });
      // Textfelder automatisch speichern
      root.addEventListener('input', function (e) {
        var art = e.target.dataset.a;
        if (art === 'text') vormerken({ beurteilung_text: e.target.value });
        if (art === 'notiz') vormerken({ notiz_intern: e.target.value });
      });
      root.addEventListener('focusout', function (e) {
        if (['text', 'notiz'].indexOf(e.target.dataset.a) >= 0 && ausstehend) jetztSpeichern();
      });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && ausstehend) jetztSpeichern(); });
      window.addEventListener('beforeunload', function (e) {
        if (ausstehend || speichertGerade) { jetztSpeichern(); e.preventDefault(); e.returnValue = ''; }
      });
      root.querySelector('[data-a="video-datei"]').addEventListener('change', function (e) {
        var datei = e.target.files && e.target.files[0];
        e.target.value = '';
        if (datei) videoGewaehlt(datei);
      });
      root.querySelector('[data-a="suche"]').addEventListener('input', function (e) {
        zustand.suche = e.target.value.trim().toLowerCase();
        liste();
      });
    }

    function el(name) { return root.querySelector('[data-a="' + name + '"]'); }

    function aufruf(pfad, optionen) {
      optionen = optionen || {};
      // Passwort (eigene Seite admin.html) oder Sitzungs-Cookie der JV-Plattform (Header X-JV-Sitzung)
      var pw = getPwd ? getPwd() : '';
      var h = pw ? { Authorization: 'Bearer ' + pw } : { 'X-JV-Sitzung': '1' };
      if (optionen.body) h['Content-Type'] = 'application/json';
      return fetch(api + pfad, { method: optionen.method || 'GET', headers: h, body: optionen.body, credentials: 'same-origin' }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (res.status === 401) { onUnauthorized(); throw new Error('Nicht angemeldet'); }
          if (!res.ok) throw new Error(j.error || 'Fehler ' + res.status);
          return j;
        });
      });
    }
    function post(pfad, daten) {
      return aufruf(pfad, { method: 'POST', body: JSON.stringify(daten) });
    }

    function fehler(text) {
      var f = el('fehler');
      f.textContent = text || '';
      f.hidden = !text;
    }

    function laden() {
      fehler('');
      return aufruf('/krv-admin-liste').then(function (j) {
        zustand.anfragen = j.anfragen || [];
        chips();
        liste();
        var ref = opts.startReferenz && opts.startReferenz();
        if (ref && zustand.anfragen.some(function (a) { return a.referenz === ref; })) {
          zustand.filter = 'alle'; chips(); liste();
          zeige(ref);
        } else if (zustand.aktiv) {
          zeige(zustand.aktiv);
        }
      }).catch(function (e) { fehler('Die Anfragen konnten nicht geladen werden: ' + e.message); });
    }

    function istOffen(a) { return ['abgeschlossen', 'abgesagt'].indexOf(a.status) < 0; }

    function gefiltert() {
      return zustand.anfragen.filter(function (a) {
        if (zustand.filter === 'offen' && !istOffen(a)) return false;
        if (['offen', 'alle'].indexOf(zustand.filter) < 0 && a.status !== zustand.filter) return false;
        if (!zustand.suche) return true;
        var heu = [a.referenz, a.vorname, a.nachname, a.strasse, a.plz, a.ort, a.telefon || '', a.email].join(' ').toLowerCase();
        return heu.indexOf(zustand.suche) >= 0;
      });
    }

    function chips() {
      var zaehl = function (f) {
        return zustand.anfragen.filter(function (a) {
          if (f === 'alle') return true;
          if (f === 'offen') return istOffen(a);
          return a.status === f;
        }).length;
      };
      var filter = [{ wert: 'offen', label: 'Offen' }, { wert: 'alle', label: 'Alle' }].concat(STATUS);
      el('chips').innerHTML = filter.map(function (f) {
        return '<button type="button" data-filter="' + f.wert + '" aria-pressed="' + (zustand.filter === f.wert) + '">' + esc(f.label) + ' (' + zaehl(f.wert) + ')</button>';
      }).join('');
      root.querySelector('[data-anz="anfragen"]').textContent = '(' + zustand.anfragen.length + ')';
    }

    function fotoInfo(a) {
      if (a.keine_fotos) return 'ohne Fotos, anrufen';
      var n = (a.fotos || []).length;
      if (!a.fotos_abgeschlossen_at) return 'Upload nicht abgeschlossen';
      return n + (n === 1 ? ' Foto' : ' Fotos');
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
          '<span class="dc-badge s-' + esc(a.status) + '">' + esc(label(STATUS, a.status)) + '</span></span>' +
          '<span class="dc-meta">' + esc(adresseVon(a)) + '</span>' +
          '<span class="dc-meta">' + esc(a.referenz) + ' · ' + datum(a.created_at) + ' · ' + esc(fotoInfo(a)) +
          (a.beurteilung ? ' · <strong class="krv-b b-' + esc(a.beurteilung) + '">' + esc(label(BEURTEILUNG, a.beurteilung)) + '</strong>' : '') + '</span>' +
          '</button></li>';
      }).join('');
    }

    function zeile(k, v, roh) {
      return '<dt>' + esc(k) + '</dt><dd>' + (roh ? v : esc(v == null || v === '' ? '–' : v)) + '</dd>';
    }
    function zeileWenn(k, v) {
      return v == null || v === '' ? '' : zeile(k, v);
    }
    function aktuelleAnfrage() {
      return zustand.anfragen.filter(function (x) { return x.referenz === zustand.aktiv; })[0];
    }

    function zeige(ref) {
      if (ausstehend && ausstehend.referenz !== ref) jetztSpeichern();
      var a = zustand.anfragen.filter(function (x) { return x.referenz === ref; })[0];
      var d = el('detail');
      if (!a) { d.hidden = true; root.querySelector('.dc-layout').classList.remove('detail-offen'); return; }
      zustand.aktiv = ref;
      liste();

      var adresse = adresseVon(a);
      var maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(adresse + ', Schweiz');
      var extra = a.utm_extra || {};

      d.innerHTML =
        '<button type="button" class="dc-btn dc-zurueck" data-a="zurueck">← Zur Liste</button>' +
        '<div class="dc-zeile1"><h3>' + esc(a.vorname + ' ' + a.nachname) + '</h3><span class="dc-badge s-' + esc(a.status) + '">' + esc(label(STATUS, a.status)) + '</span></div>' +
        '<div class="dc-meta">' + esc(a.referenz) + ' · eingegangen ' + datum(a.created_at, true) +
          (a.rolle === 'mieter' ? ' · <span class="dc-badge mieter">Mieter/in</span>' : '') +
          (a.iwb_brief ? ' · <span class="dc-badge krv-iwb">IWB-Brief erhalten</span>' : '') +
          (a.offerte_gewuenscht === false ? ' · <span class="dc-badge krv-keine-offerte">Keine Offerte gewünscht</span>' : '') + '</div>' +
        '<p class="dc-loeschung">' + esc(loeschText(a)) + '</p>' +
        '<div class="dc-knoepfe">' +
          '<a class="dc-btn" href="tel:' + esc(telLink(a.telefon)) + '">Anrufen</a>' +
          '<a class="dc-btn" href="https://wa.me/' + esc(waNummer(a.telefon)) + '" target="_blank" rel="noopener">WhatsApp</a>' +
          '<a class="dc-btn" href="mailto:' + esc(a.email) + '?subject=' + encodeURIComponent('Ihr KRV-Check ' + a.referenz) + '">E-Mail</a>' +
          '<a class="dc-btn" href="' + esc(maps) + '" target="_blank" rel="noopener">Karte</a>' +
        '</div>' +

        '<h4>Fotos</h4><div class="krv-fotoliste" data-a="fotos">' +
          (a.keine_fotos ? '<p class="krv-anrufen">Keine Fotos: Kunde findet den Wasserzähler nicht oder kann kein Foto machen. Bitte anrufen.</p>' : '<p class="dc-hinweis">Fotos werden geladen …</p>') +
        '</div>' +

        '<h4>Beurteilung</h4><div class="dc-verwaltung">' +
          '<fieldset class="dc-ampelwahl"><legend>Ist ein Rückflussverhinderer eingebaut?</legend>' +
            BEURTEILUNG.map(function (x) {
              return '<label class="dc-ampel krv-wahl b-' + x.wert + '"><input type="radio" name="krv-beurteilung-' + esc(a.referenz) + '" data-a="beurteilung" value="' + x.wert + '"' + (a.beurteilung === x.wert ? ' checked' : '') + '><span>' + esc(x.label) + '</span></label>';
            }).join('') +
          '</fieldset>' +
          '<div><label for="krv-text">Begründung für den Kunden <span class="dc-optional">(kommt in die E-Mail)</span></label>' +
            '<textarea id="krv-text" data-a="text" autocomplete="off" placeholder="z. B. Nach dem Zähler ist ein Absperrventil mit integriertem Rückflussverhinderer (Prüfstutzen sichtbar) eingebaut.">' + esc(a.beurteilung_text || '') + '</textarea>' +
            '<div class="dc-textfeld__knoepfe">' +
              '<button type="button" class="dc-btn" data-a="ki-korrigieren">KI: korrigieren</button>' +
              '<button type="button" class="dc-btn" data-a="ki-umschreiben">KI: umschreiben</button>' +
              '<button type="button" class="dc-btn" data-a="ki-zurueck"' + (zustand.kiVorher && zustand.kiVorher.ref === a.referenz ? '' : ' hidden') + '>Rückgängig</button>' +
            '</div>' +
            '<p class="dc-gespeichert" data-a="ki-status" aria-live="polite"></p>' +
            '<p class="dc-hinweis dc-ki-hinweis">KI-Knöpfe: Nur der Text dieses Feldes geht zur Überarbeitung an Anthropic (USA), keine Fotos und keine Angaben aus der Anfrage. Bitte keine Namen, Adressen oder Telefonnummern hineinschreiben.</p></div>' +
          '<div><span class="krv-feldtitel" id="krv-status-titel">Status</span><div class="krv-status" role="group" aria-labelledby="krv-status-titel" data-a="status">' + statusKnoepfe(a.status) + '</div></div>' +
          '<div><label for="krv-notiz">Interne Notiz</label><textarea id="krv-notiz" data-a="notiz" autocomplete="off">' + esc(a.notiz_intern || '') + '</textarea></div>' +
          '<p class="dc-gespeichert krv-autosave" data-a="gespeichert" aria-live="polite">Änderungen werden automatisch gespeichert.</p>' +
        '</div>' +
        '<div class="dc-knoepfe" data-a="antwort">' + antwortKnopf(a) + '</div>' +

        '<h4>Meldung an IWB</h4><div class="dc-verwaltung krv-karte">' +
          '<p class="dc-hinweis">Die Meldung geht als E-Mail an die IWB-Installationskontrolle, eine Rückantwortkarte braucht es nicht.</p>' +
          '<fieldset class="dc-ampelwahl"><legend>Rückflussverhinderer</legend>' +
            '<label class="dc-ampel"><input type="radio" name="krv-karte-' + esc(a.referenz) + '" data-a="karte-art" value="vorhanden"' + (a.beurteilung !== 'fehlt' ? ' checked' : '') + '><span>ist bereits vorhanden</span></label>' +
            '<label class="dc-ampel"><input type="radio" name="krv-karte-' + esc(a.referenz) + '" data-a="karte-art" value="eingebaut"' + (a.beurteilung === 'fehlt' ? ' checked' : '') + '><span>ist eingebaut worden (durch uns)</span></label>' +
          '</fieldset>' +
          '<div class="krv-karte__felder">' +
            '<div><label for="krv-zaehler">Wasserzählernummer <span class="dc-optional">(falls bekannt)</span></label><input type="text" id="krv-zaehler" data-a="karte-zaehler" autocomplete="off"></div>' +
            '<div data-a="karte-datum-feld"' + (a.beurteilung === 'fehlt' ? '' : ' hidden') + '><label for="krv-einbau">Einbaudatum</label><input type="date" id="krv-einbau" data-a="karte-datum" autocomplete="off" value="' + new Date().toISOString().slice(0, 10) + '"></div>' +
          '</div>' +
          '<div class="dc-knoepfe"><button type="button" class="dc-btn dc-btn--primaer" data-a="karte-mail">Mail an IWB</button></div>' +
          '<p class="dc-hinweis">Öffnet einen fertigen Entwurf an ' + esc(CFG.iwbInstallationskontrolle || 'IWB') + ' im eigenen Mailprogramm.</p>' +
        '</div>' +

        '<h4>Kontakt und Liegenschaft</h4><dl>' +
          zeile('Adresse', adresse) + zeile('E-Mail', a.email) + zeile('Telefon', telAnzeige(a.telefon)) +
          zeile('Rolle', ROLLEN[a.rolle] || a.rolle) + zeile('IWB-Brief', a.iwb_brief ? 'ja, erhalten' : 'nein / nicht angegeben') +
          zeile('Offerte, falls KRV fehlt', a.offerte_gewuenscht === false ? 'nein, nur prüfen' : 'ja, gewünscht') +
          zeileWenn('Bemerkung', a.bemerkung) +
          zeileWenn('Beurteilt am', a.beurteilt_at ? datum(a.beurteilt_at, true) : '') +
        '</dl>' +

        '<h4>Herkunft</h4><dl>' +
          zeile('Quelle', a.utm_source) + zeile('Medium', a.utm_medium) + zeile('Kampagne', a.utm_campaign) +
          zeileWenn('Inhalt', a.utm_content) + zeileWenn('Begriff', a.utm_term) +
          zeileWenn('Landingpage', extra.landing) + zeileWenn('Referrer', extra.referrer) +
          zeile('Info-Mail', a.mail_intern_ok === true ? 'versendet' : a.mail_intern_ok === false ? 'fehlgeschlagen' : 'noch nicht') +
        '</dl>';

      d.hidden = false;
      root.querySelector('.dc-layout').classList.add('detail-offen');
      if (opts.onDetail) opts.onDetail(ref);
      if (!a.keine_fotos || (a.fotos || []).length) fotosLaden(a);
    }

    function karteAngaben() {
      return {
        art: (root.querySelector('[data-a="karte-art"]:checked') || {}).value || 'vorhanden',
        zaehler: el('karte-zaehler').value.trim(),
        einbau: el('karte-datum').value
      };
    }

    // Meldung an die IWB-Installationskontrolle als Mail-Entwurf (ersetzt die Rückantwortkarte, mit IWB abgesprochen)
    function iwbMail(a, k) {
      var liegenschaft = ((a.strasse || '') + ' ' + (a.hausnummer || '')).trim() + ', ' + ((a.plz || '') + ' ' + (a.ort || '')).trim();
      var eingebaut = k.art === 'eingebaut';
      var F = CFG.firma || {};
      var firma = F.name || 'Jäggi Vollmer GmbH';
      var zeilen = [
        'Liegenschaft: ' + liegenschaft,
        'Wasserzählernummer: ' + (k.zaehler || 'nicht bekannt'),
        'Rückflussverhinderer: ' + (eingebaut ? 'ist eingebaut worden' : 'ist bereits vorhanden')
      ];
      if (eingebaut) {
        zeilen.push('Installationsfirma: ' + firma);
        if (k.einbau) zeilen.push('Einbaudatum: ' + k.einbau.split('-').reverse().join('.'));
      }
      zeilen.push((ROLLEN[a.rolle] || 'Kontakt') + ': ' + ((a.vorname || '') + ' ' + (a.nachname || '')).trim());
      zeilen.push('Telefon: ' + telAnzeige(a.telefon));
      zeilen.push('Unsere Referenz: ' + a.referenz);
      var betreff = 'Rückflussverhinderer ' + (eingebaut ? 'eingebaut' : 'vorhanden') + ': ' + liegenschaft;
      var body = 'Guten Tag\n\n' +
        (eingebaut
          ? 'Wir melden Ihnen, dass wir in folgender Liegenschaft einen Rückflussverhinderer nach dem Wasserzähler eingebaut haben:\n\n'
          : 'Wir melden Ihnen, dass in folgender Liegenschaft nach dem Wasserzähler bereits ein Rückflussverhinderer vorhanden ist:\n\n') +
        zeilen.join('\n') + '\n\n' +
        (eingebaut ? '' : 'Unsere Beurteilung stützt sich auf Fotos der Installation, die uns die Kundschaft geschickt hat.\n\n') +
        'Bei Fragen erreichen Sie uns gerne unter ' + (F.telefon || '') + '.\n\n' +
        'Freundliche Grüsse\n' + firma + '\n' +
        [F.strasse, F.ort].filter(Boolean).join(', ') + '\n' + [F.telefon, F.email].filter(Boolean).join(' · ');
      return 'mailto:' + (CFG.iwbInstallationskontrolle || '') + '?subject=' + encodeURIComponent(betreff) + '&body=' + encodeURIComponent(body);
    }

    function antwortKnopf(a) {
      if (!a.beurteilung) return '<p class="dc-hinweis">Sobald eine Beurteilung gewählt ist, erscheint hier der passende E-Mail-Entwurf an den Kunden.</p>';
      return '<a class="dc-btn dc-btn--primaer" href="' + esc(antwortMail(a, a.beurteilung, a.beurteilung_text)) + '">Antwort per E-Mail (' + esc(label(BEURTEILUNG, a.beurteilung)) + ')</a>';
    }

    function fotosLaden(a) {
      var ref = a.referenz;
      var zeigen = function (fotos) {
        if (zustand.aktiv !== ref) return;
        var box = el('fotos');
        if (!box) return;
        box.innerHTML = fotos.length
          ? '<div class="dc-bilder" data-bildgruppe>' + fotos.map(function (f, i) {
            return '<div class="dc-bild"><a href="' + esc(f.url) + '" target="_blank" rel="noopener" data-gross><img src="' + esc(f.url) + '" alt="Foto ' + (i + 1) + '" loading="lazy"></a></div>';
          }).join('') + '</div><p class="dc-hinweis">Antippen zeigt das Foto gross. Links sind eine Stunde gültig.</p>'
          : '<p class="krv-anrufen">Keine Fotos angekommen' + (a.fotos_abgeschlossen_at ? '' : ' (Upload nicht abgeschlossen)') + '. Bitte anrufen oder per E-Mail nachfragen.</p>';
      };
      var cache = zustand.fotos[ref];
      if (cache && cache.bis > Date.now()) { zeigen(cache.fotos); return; }
      post('/krv-admin-anfrage', { action: 'fotos', referenz: ref }).then(function (r) {
        zustand.fotos[ref] = { fotos: r.fotos || [], bis: Date.now() + 50 * 60000 };
        zeigen(r.fotos || []);
      }).catch(function (e) {
        var box = el('fotos');
        if (box && zustand.aktiv === ref) box.innerHTML = '<p class="dc-fehler">Fotos konnten nicht geladen werden: ' + esc(e.message) + '</p>';
      });
    }

    // ── Automatisch speichern ────────────────────────────────────────
    // Status und Beurteilung sofort, Textfelder kurz nach dem Tippen und beim Verlassen des Feldes.
    // Gesendet werden nur die geänderten Felder; die Aufrufe laufen nacheinander.
    var ausstehend = null;   // { referenz, felder }
    var speicherUhr = null;
    var speicherKette = Promise.resolve();
    var speichertGerade = 0;

    function statusKnoepfe(aktuell) {
      return STATUS.map(function (x) {
        return '<button type="button" class="krv-status__knopf s-' + x.wert + '" data-status="' + x.wert + '" aria-pressed="' + (x.wert === aktuell) + '">' + esc(x.label) + '</button>';
      }).join('');
    }
    function speicherStatus(text, istFehler) {
      var s = el('gespeichert');
      if (!s) return;
      s.textContent = text;
      s.classList.toggle('dc-meldung-fehler', !!istFehler);
    }
    function vormerken(felder, sofort) {
      var a = aktuelleAnfrage();
      if (!a) return;
      if (ausstehend && ausstehend.referenz !== a.referenz) jetztSpeichern();
      ausstehend = ausstehend || { referenz: a.referenz, felder: {} };
      Object.keys(felder).forEach(function (k) { ausstehend.felder[k] = felder[k]; });
      speicherStatus('Wird gespeichert …');
      clearTimeout(speicherUhr);
      speicherUhr = setTimeout(jetztSpeichern, sofort ? 0 : 800);
    }
    function jetztSpeichern() {
      clearTimeout(speicherUhr);
      if (!ausstehend) return speicherKette;
      var auftrag = ausstehend;
      ausstehend = null;
      speichertGerade++;
      speicherKette = speicherKette.then(function () {
        return post('/krv-admin-anfrage', Object.assign({ action: 'speichern', referenz: auftrag.referenz }, auftrag.felder)).then(function (r) {
          var a = zustand.anfragen.filter(function (x) { return x.referenz === auftrag.referenz; })[0];
          if (a) Object.keys(r).forEach(function (k) { a[k] = r[k]; });
          chips(); liste();
          if (a && zustand.aktiv === a.referenz) {
            detailAktualisieren(a);
            if (!ausstehend) speicherStatus('Gespeichert um ' + new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) + '.');
          }
        }).catch(function (e) {
          // Felder behalten: Die nächste Änderung (oder ein Klick auf einen Status) versucht es erneut
          if (!ausstehend) ausstehend = auftrag;
          else if (ausstehend.referenz === auftrag.referenz) ausstehend.felder = Object.assign({}, auftrag.felder, ausstehend.felder);
          if (zustand.aktiv === auftrag.referenz) speicherStatus('Nicht gespeichert: ' + e.message + '. Wird bei der nächsten Änderung erneut versucht.', true);
          else fehler('Speichern fehlgeschlagen (' + auftrag.referenz + '): ' + e.message);
        }).then(function () { speichertGerade--; });
      });
      return speicherKette;
    }
    // Nach dem Speichern nur Anzeigen nachführen, Textfelder bleiben unberührt (sonst springt der Cursor)
    function detailAktualisieren(a) {
      var d = el('detail');
      var badge = d.querySelector('.dc-zeile1 .dc-badge');
      if (badge) { badge.className = 'dc-badge s-' + a.status; badge.textContent = label(STATUS, a.status); }
      d.querySelectorAll('[data-status]').forEach(function (k) { k.setAttribute('aria-pressed', String(k.dataset.status === a.status)); });
      var loesch = d.querySelector('.dc-loeschung');
      if (loesch) loesch.textContent = loeschText(a);
      el('antwort').innerHTML = antwortKnopf(a);
    }
    function loeschText(a) {
      return a.status === 'auftrag'
        ? 'Status Auftrag: wird nicht automatisch gelöscht.'
        : 'Wird ohne Auftrag am ' + datum(new Date(new Date(a.created_at).getTime() + LOESCHFRIST * 864e5)) + ' automatisch gelöscht (mit Fotos).';
    }

    // ── KI für die Begründung (gemeinsamer KI-Zugang auf dem Server, netlify/functions/_lib/ki.js) ──
    // zustand.kiVorher = { ref, text }: Text vor der letzten KI-Überarbeitung für «Rückgängig»
    function kiStatus(text, istFehler) {
      var s = el('ki-status');
      if (!s) return;
      s.textContent = text || '';
      s.classList.toggle('dc-meldung-fehler', !!istFehler);
    }
    function kiText(modus, knopf) {
      var a = aktuelleAnfrage();
      var ta = el('text');
      if (!a || !ta) return;
      var text = ta.value.trim();
      if (!text) { kiStatus('Bitte zuerst einen Text eingeben.', true); ta.focus(); return; }
      var gewaehlt = root.querySelector('[data-a="beurteilung"]:checked');
      var knoepfe = root.querySelectorAll('button[data-a^="ki-"]');
      var beschriftung = knopf.textContent;
      var ref = a.referenz;
      knoepfe.forEach(function (k) { k.disabled = true; });
      knopf.textContent = 'KI arbeitet …';
      kiStatus('');
      post('/krv-admin-anfrage', { action: 'ki', modus: modus, text: text, beurteilung: gewaehlt ? gewaehlt.value : '' }).then(function (r) {
        var aktuell = el('text');
        if (zustand.aktiv !== ref || !aktuell) return;
        zustand.kiVorher = { ref: ref, text: aktuell.value };
        aktuell.value = r.text;
        vormerken({ beurteilung_text: r.text }, true);
        el('ki-zurueck').hidden = false;
        kiStatus(r.gekuerzt ? 'Die KI-Antwort war zu lang und wurde abgeschnitten. Bitte prüfen.' : 'Text von der KI überarbeitet und gespeichert. Bitte prüfen.', !!r.gekuerzt);
      }).catch(function (e) {
        if (zustand.aktiv === ref) kiStatus('KI: ' + e.message, true);
      }).then(function () {
        knoepfe.forEach(function (k) { k.disabled = false; });
        knopf.textContent = beschriftung;
      });
    }
    function kiZurueck() {
      var v = zustand.kiVorher;
      var ta = el('text');
      if (!v || v.ref !== zustand.aktiv || !ta) return;
      ta.value = v.text;
      vormerken({ beurteilung_text: v.text }, true);
      zustand.kiVorher = null;
      el('ki-zurueck').hidden = true;
      kiStatus('Text von vor der KI wiederhergestellt.');
    }

    // ════════════════════════════════════════════════════════════════
    // Anleitungsvideo: importieren, im Browser verkleinern, hochladen
    // (Verkleinern übernimmt window.DCAdmin.videoVerkleinern aus /dachcheck/assets/admin.js)
    // ════════════════════════════════════════════════════════════════
    function videoAufruf(action, daten) {
      return post('/krv-admin-medien', Object.assign({ action: action }, daten || {}));
    }
    function videoStatus(text, istFehler) {
      var s = el('video-status');
      s.textContent = text || '';
      s.classList.toggle('dc-meldung-fehler', !!istFehler);
    }
    function videoLaden() {
      zustand.video = zustand.video || { geladen: false, aktuell: null, quelle: null, laeuft: false };
      videoAufruf('laden').then(function (r) {
        zustand.video.geladen = true;
        zustand.video.aktuell = r.video;
        videoZeigen();
      }).catch(function (e) { videoStatus('Video konnte nicht geladen werden: ' + e.message, true); });
    }
    function videoZeigen() {
      var h = zustand.video;
      var a = h.aktuell;
      el('video-aktuell').innerHTML = a
        ? '<video class="dc-hero__video" src="' + esc(a.video_url) + '"' + (a.poster_url ? ' poster="' + esc(a.poster_url) + '"' : '') + ' muted playsinline controls preload="metadata"></video>' +
          '<p class="dc-meta">Aktuell auf der Landingpage' + (a.breite ? ' · ' + a.breite + '×' + a.hoehe : '') + (a.dauer ? ' · ' + a.dauer + ' s' : '') +
            (a.groesse ? ' · ' + mb(a.groesse) : '') + ' · seit ' + datum(a.updated_at, true) + '</p>' +
          '<button type="button" class="dc-btn" data-a="video-entfernen">Video entfernen</button>'
        : '<p class="dc-hinweis">Zurzeit kein Video. Die Landingpage zeigt nur die gezeichnete Anleitung.</p>';
      var q = h.quelle;
      el('video-zuschnitt').hidden = !q;
      if (q) el('video-info').textContent = q.datei.name + ' · ' + mb(q.datei.size) + ' · ' + q.breite + '×' + q.hoehe + ' · ' + Math.round(q.dauer) + ' s';
      el('video-start').disabled = el('video-laenge').disabled = el('video-los').disabled = el('video-datei').disabled = h.laeuft;
    }
    function videoGewaehlt(datei) {
      var h = zustand.video;
      if (h.quelle) URL.revokeObjectURL(h.quelle.url);
      h.quelle = null;
      videoStatus('Video wird gelesen …');
      var url = URL.createObjectURL(datei);
      var v = el('video-quelle');
      v.onloadedmetadata = function () {
        if (!v.videoWidth) { v.onerror(); return; }
        h.quelle = { datei: datei, url: url, dauer: v.duration, breite: v.videoWidth, hoehe: v.videoHeight };
        el('video-start').value = 0;
        el('video-laenge').value = Math.min(VIDEO_MAX_SEKUNDEN, Math.max(1, Math.floor(v.duration)));
        videoStatus('');
        videoZeigen();
      };
      v.onerror = function () {
        URL.revokeObjectURL(url);
        h.quelle = null;
        videoZeigen();
        videoStatus('Dieses Video kann der Browser nicht lesen (oft H.265/HEVC vom iPhone). Bitte in Chrome oder Edge versuchen oder das Video als H.264 (MP4) exportieren.', true);
      };
      v.src = url;
    }
    function videoLos() {
      var h = zustand.video;
      var q = h.quelle;
      if (!q || h.laeuft) return;
      if (!window.DCAdmin || !window.DCAdmin.videoVerkleinern) { videoStatus('Videofunktion nicht geladen. Bitte Seite neu laden.', true); return; }
      var start = Math.max(0, Math.min(Number(el('video-start').value) || 0, q.dauer - 0.5));
      var laenge = Math.max(1, Math.min(Number(el('video-laenge').value) || VIDEO_MAX_SEKUNDEN, VIDEO_MAX_SEKUNDEN, q.dauer - start));
      h.laeuft = true;
      videoZeigen();
      var ergebnis;
      window.DCAdmin.videoVerkleinern(q.url, start, laenge, function (sek) {
        videoStatus('Video wird verkleinert: ' + Math.min(Math.round(sek), Math.round(laenge)) + ' von ' + Math.round(laenge) + ' Sekunden. Bitte dieses Fenster offen und sichtbar lassen.');
      }, { maxKante: VIDEO_KANTE, bitrate: VIDEO_BITRATE }).then(function (r) {
        ergebnis = r;
        videoStatus('Wird hochgeladen (' + mb(r.video.size) + ') …');
        return Promise.all([hochladen('video', r.video, r.typ), hochladen('poster', r.poster, 'image/jpeg')]);
      }).then(function (pfade) {
        return videoAufruf('setzen', { video: pfade[0], poster: pfade[1], dauer: laenge, breite: ergebnis.breite, hoehe: ergebnis.hoehe });
      }).then(function (r) {
        h.aktuell = r.video;
        URL.revokeObjectURL(q.url);
        h.quelle = null;
        el('video-quelle').removeAttribute('src');
        h.laeuft = false;
        videoZeigen();
        videoStatus('Fertig. Das Video ist jetzt auf der Landingpage (' + mb(ergebnis.video.size) + ').');
      }).catch(function (e) {
        h.laeuft = false;
        videoZeigen();
        videoStatus('Import fehlgeschlagen: ' + e.message, true);
      });
    }
    function hochladen(art, blob, typ) {
      return videoAufruf('upload-url', { art: art, typ: typ, groesse: blob.size }).then(function (u) {
        return fetch(u.upload_url, {
          method: 'PUT',
          headers: { 'content-type': typ, 'cache-control': 'max-age=31536000', 'x-upsert': 'false' },
          body: blob
        }).then(function (res) {
          if (!res.ok) throw new Error('Upload fehlgeschlagen (' + res.status + ')');
          return u.pfad;
        });
      });
    }
    function videoEntfernen() {
      if (!window.confirm('Anleitungsvideo von der Landingpage entfernen?')) return;
      videoAufruf('entfernen').then(function () {
        zustand.video.aktuell = null;
        videoZeigen();
        videoStatus('Video entfernt.');
      }).catch(function (e) { videoStatus('Entfernen fehlgeschlagen: ' + e.message, true); });
    }

    function csv() {
      var spalten = ['referenz', 'status', 'created_at', 'vorname', 'nachname', 'email', 'telefon', 'strasse', 'hausnummer', 'plz', 'ort',
        'rolle', 'iwb_brief', 'offerte_gewuenscht', 'keine_fotos', 'beurteilung', 'beurteilt_at', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'notiz_intern'];
      var zelle = function (v) {
        v = v == null ? '' : String(v);
        if (/^[=+\-@]/.test(v)) v = "'" + v;   // Formel-Injection in Excel verhindern
        return '"' + v.replace(/"/g, '""') + '"';
      };
      var zeilen = [spalten.join(';')].concat(gefiltert().map(function (a) {
        return spalten.map(function (s) { return zelle(a[s]); }).join(';');
      }));
      var blob = new Blob(['﻿' + zeilen.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'krvcheck-anfragen-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    }

    function klick(e) {
      var t = e.target.closest('button, a');
      if (!t || !root.contains(t)) return;
      if (t.dataset.status) {
        root.querySelectorAll('[data-status]').forEach(function (k) { k.setAttribute('aria-pressed', String(k === t)); });
        vormerken({ status: t.dataset.status }, true);
        return;
      }
      if (t.dataset.ref) { zeige(t.dataset.ref); if (window.innerWidth < 900) root.scrollIntoView({ block: 'start' }); return; }
      if (t.dataset.filter) { zustand.filter = t.dataset.filter; chips(); liste(); return; }
      if (t.dataset.tab) {
        zustand.tab = t.dataset.tab;
        root.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b === t)); });
        root.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== zustand.tab; });
        if (zustand.tab === 'video' && !(zustand.video && zustand.video.geladen)) videoLaden();
        return;
      }
      switch (t.dataset.a) {
        case 'laden': zustand.fotos = {}; jetztSpeichern().then(laden); break;
        case 'csv': csv(); break;
        case 'ki-korrigieren': kiText('korrigieren', t); break;
        case 'ki-umschreiben': kiText('umschreiben', t); break;
        case 'ki-zurueck': kiZurueck(); break;
        case 'karte-mail':
          var aktuell = aktuelleAnfrage();
          if (aktuell) window.location.href = iwbMail(aktuell, karteAngaben());
          break;
        case 'video-los': videoLos(); break;
        case 'video-entfernen': videoEntfernen(); break;
        case 'video-hier': el('video-start').value = Math.floor(el('video-quelle').currentTime || 0); break;
        case 'zurueck':
          jetztSpeichern();
          zustand.aktiv = null;
          el('detail').hidden = true;
          root.querySelector('.dc-layout').classList.remove('detail-offen');
          liste();
          if (opts.onDetail) opts.onDetail(null);
          break;
      }
    }

    return laden();
  }

  window.KRVAdmin = { mount: mount, _antwortMail: antwortMail };

  // ════════════════════════════════════════════════════════════════════
  // Eigenständige Seite admin.html (Login + Übersicht)
  // ════════════════════════════════════════════════════════════════════
  var standalone = document.getElementById('krv-standalone');
  if (!standalone) return;

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
