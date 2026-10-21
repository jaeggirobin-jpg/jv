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
  function waNummer(tel) {
    var n = String(tel || '').replace(/[^\d+]/g, '');
    if (n.indexOf('+') === 0) n = n.slice(1);
    else if (n.indexOf('00') === 0) n = n.slice(2);
    else if (n.indexOf('0') === 0) n = '41' + n.slice(1);
    return n;
  }
  function mb(bytes) {
    return (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',') + ' MB';
  }

  // ════════════════════════════════════════════════════════════════════
  // Antwort an den Kunden als E-Mail-Entwurf (eigenes Mailprogramm, kein Versanddienst)
  // ════════════════════════════════════════════════════════════════════
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
        'Falls Sie von IWB angeschrieben wurden: Melden Sie IWB mit der beigelegten Rückantwortkarte, dass bereits ein Rückflussverhinderer vorhanden ist.\n\n' +
        vorbehalt + gruss;
    } else if (beurteilung === 'fehlt') {
      betreff = 'Ihr KRV-Check ' + a.referenz + ': Rückflussverhinderer fehlt';
      body = anrede +
        'Auf Ihren Fotos sehen wir nach dem Wasserzähler keinen Rückflussverhinderer.\n\n' + zusatz +
        'Gemäss IWB muss die Eigentümerschaft einen Rückflussverhinderer auf eigene Kosten einbauen lassen. Gerne erstellen wir Ihnen dafür eine Offerte. Den Einbau melden wir anschliessend direkt an IWB.\n\n' +
        '[Die Offerte finden Sie im Anhang. / Wir senden Ihnen die Offerte in den nächsten Tagen.]\n\n' +
        mieter + vorbehalt + gruss;
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
      var a = zustand.anfragen.filter(function (x) { return x.referenz === ref; })[0];
      var d = el('detail');
      if (!a) { d.hidden = true; root.querySelector('.dc-layout').classList.remove('detail-offen'); return; }
      zustand.aktiv = ref;
      liste();

      var adresse = adresseVon(a);
      var maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(adresse + ', Schweiz');
      var extra = a.utm_extra || {};
      var loeschText = a.status === 'auftrag'
        ? 'Status Auftrag: wird nicht automatisch gelöscht.'
        : 'Wird ohne Auftrag am ' + datum(new Date(new Date(a.created_at).getTime() + LOESCHFRIST * 864e5)) + ' automatisch gelöscht (mit Fotos).';

      d.innerHTML =
        '<button type="button" class="dc-btn dc-zurueck" data-a="zurueck">← Zur Liste</button>' +
        '<div class="dc-zeile1"><h3>' + esc(a.vorname + ' ' + a.nachname) + '</h3><span class="dc-badge s-' + esc(a.status) + '">' + esc(label(STATUS, a.status)) + '</span></div>' +
        '<div class="dc-meta">' + esc(a.referenz) + ' · eingegangen ' + datum(a.created_at, true) +
          (a.rolle === 'mieter' ? ' · <span class="dc-badge mieter">Mieter/in</span>' : '') +
          (a.iwb_brief ? ' · <span class="dc-badge krv-iwb">IWB-Brief erhalten</span>' : '') + '</div>' +
        '<p class="dc-loeschung">' + esc(loeschText) + '</p>' +
        '<div class="dc-knoepfe">' +
          '<a class="dc-btn" href="tel:' + esc(String(a.telefon).replace(/[^\d+]/g, '')) + '">Anrufen</a>' +
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
            '<textarea id="krv-text" data-a="text" autocomplete="off" placeholder="z. B. Nach dem Zähler ist ein Absperrventil mit integriertem Rückflussverhinderer (Prüfstutzen sichtbar) eingebaut.">' + esc(a.beurteilung_text || '') + '</textarea></div>' +
          '<div><label for="krv-status">Status</label><select id="krv-status" data-a="status">' +
            STATUS.map(function (s) { return '<option value="' + s.wert + '"' + (s.wert === a.status ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('') +
          '</select></div>' +
          '<div><label for="krv-notiz">Interne Notiz</label><textarea id="krv-notiz" data-a="notiz" autocomplete="off">' + esc(a.notiz_intern || '') + '</textarea></div>' +
          '<div><button type="button" class="dc-btn dc-btn--primaer" data-a="speichern">Speichern</button> <span class="dc-gespeichert" data-a="gespeichert" aria-live="polite"></span></div>' +
        '</div>' +
        '<div class="dc-knoepfe" data-a="antwort">' + antwortKnopf(a) + '</div>' +

        '<h4>Kontakt und Liegenschaft</h4><dl>' +
          zeile('Adresse', adresse) + zeile('E-Mail', a.email) + zeile('Telefon', a.telefon) +
          zeile('Rolle', ROLLEN[a.rolle] || a.rolle) + zeile('IWB-Brief', a.iwb_brief ? 'ja, erhalten' : 'nein / nicht angegeben') +
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

    function antwortKnopf(a) {
      if (!a.beurteilung) return '<p class="dc-hinweis">Nach dem Speichern der Beurteilung erscheint hier der passende E-Mail-Entwurf an den Kunden.</p>';
      return '<a class="dc-btn dc-btn--primaer" href="' + esc(antwortMail(a, a.beurteilung, a.beurteilung_text)) + '">Antwort per E-Mail (' + esc(label(BEURTEILUNG, a.beurteilung)) + ')</a>';
    }

    function fotosLaden(a) {
      var ref = a.referenz;
      var zeigen = function (fotos) {
        if (zustand.aktiv !== ref) return;
        var box = el('fotos');
        if (!box) return;
        box.innerHTML = fotos.length
          ? '<div class="dc-bilder">' + fotos.map(function (f, i) {
            return '<div class="dc-bild"><a href="' + esc(f.url) + '" target="_blank" rel="noopener"><img src="' + esc(f.url) + '" alt="Foto ' + (i + 1) + '" loading="lazy"></a></div>';
          }).join('') + '</div><p class="dc-hinweis">Antippen öffnet das Foto in voller Grösse. Links sind eine Stunde gültig.</p>'
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

    function speichern() {
      var a = aktuelleAnfrage();
      if (!a) return;
      var gewaehlt = root.querySelector('[data-a="beurteilung"]:checked');
      var body = {
        action: 'speichern',
        referenz: a.referenz,
        status: el('status').value,
        beurteilung: gewaehlt ? gewaehlt.value : null,
        beurteilung_text: el('text').value,
        notiz_intern: el('notiz').value
      };
      var knopf = el('speichern');
      knopf.disabled = true;
      post('/krv-admin-anfrage', body).then(function (r) {
        Object.keys(r).forEach(function (k) { a[k] = r[k]; });
        chips(); zeige(a.referenz);
        el('gespeichert').textContent = 'Gespeichert.';
      }).catch(function (e) {
        knopf.disabled = false;
        fehler('Speichern fehlgeschlagen: ' + e.message);
      });
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
        'rolle', 'iwb_brief', 'keine_fotos', 'beurteilung', 'beurteilt_at', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'notiz_intern'];
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
        case 'laden': zustand.fotos = {}; laden(); break;
        case 'csv': csv(); break;
        case 'speichern': speichern(); break;
        case 'video-los': videoLos(); break;
        case 'video-entfernen': videoEntfernen(); break;
        case 'video-hier': el('video-start').value = Math.floor(el('video-quelle').currentTime || 0); break;
        case 'zurueck':
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
