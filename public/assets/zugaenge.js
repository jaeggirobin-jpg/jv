// zugaenge.js — Logins für Mitarbeiterinnen und Mitarbeiter (Plattform, Ansicht #/zugaenge, nur Admins)
//
// Anlegen mit Name, E-Mail, Rolle und Bereichen. Das Startpasswort zeigt die Plattform genau einmal an
// (gespeichert wird nur der Hash); beim ersten Login legt die Person ein eigenes Passwort fest.
// Sperren, neues Startpasswort, andere Rolle oder Bereiche melden die Person überall ab.
// Server: netlify/functions/zugaenge.js, Anmeldung: netlify/functions/sitzung.js.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var D = { logins: [], bereiche: {}, ich: null, geladen: false };
  var offen = { bearbeiten: null };
  var zugang = null;          // { name, email, passwort } nach Anlegen oder Zurücksetzen
  var entwurf = { name: '', email: '', rolle: 'mitarbeiter', bereiche: null };

  function api(daten) {
    return window.JVBridge.anfrage('/zugaenge', daten ? { method: 'POST', body: daten } : undefined);
  }

  function meldung(text, art) {
    var el = $('zgMeldung');
    if (el) el.innerHTML = text ? '<div class="msg ' + (art || 'info') + '">' + esc(text) + '</div>' : '';
  }

  function datumZeit(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ', ' +
      d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  }

  function kuerzel(name) {
    var t = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!t.length) return '?';
    return ((t[0][0] || '') + (t.length > 1 ? t[t.length - 1][0] : (t[0][1] || ''))).toUpperCase();
  }

  function bereicheHtml(gewaehlt, praefix) {
    return '<div class="zg-bereiche" role="group" aria-label="Bereiche">' + Object.keys(D.bereiche).map(function (b) {
      return '<label><input type="checkbox" name="' + praefix + '-bereich" value="' + esc(b) + '"' +
        (gewaehlt.indexOf(b) >= 0 ? ' checked' : '') + '> ' + esc(D.bereiche[b]) + '</label>';
    }).join('') + '</div>';
  }

  function formularHtml(art, l) {
    var p = art === 'neu' ? 'zgn' : 'zgb';
    var rolle = l.rolle || 'mitarbeiter';
    var bereiche = l.bereiche || Object.keys(D.bereiche);
    return '<form class="' + (art === 'neu' ? '' : 'zg-bearbeiten') + '" data-zform="' + art + '"' + (l.id ? ' data-id="' + esc(l.id) + '"' : '') + ' autocomplete="off" novalidate>' +
      '<div class="form-row"><div><label for="' + p + '-name">Name *</label><input type="text" id="' + p + '-name" value="' + esc(l.name || '') + '" maxlength="120" autocomplete="off" required></div>' +
      '<div><label for="' + p + '-email">E-Mail *</label><input type="email" id="' + p + '-email" value="' + esc(l.email || '') + '" maxlength="200" autocomplete="off" required></div></div>' +
      '<label for="' + p + '-rolle">Rolle</label><select id="' + p + '-rolle" data-zrolle>' +
        '<option value="mitarbeiter"' + (rolle === 'mitarbeiter' ? ' selected' : '') + '>Mitarbeiter: arbeitet in den gewählten Bereichen</option>' +
        '<option value="admin"' + (rolle === 'admin' ? ' selected' : '') + '>Admin: alles, auch Logins und Feedback-Board</option>' +
      '</select>' +
      '<div data-zbereiche' + (rolle === 'admin' ? ' hidden' : '') + '><label style="margin-bottom:2px">Bereiche</label>' + bereicheHtml(bereiche, p) + '</div>' +
      '<div class="jvp-knopfreihe" style="margin-top:14px"><button type="submit" class="jvp-knopf jvp-knopf--primaer">' +
        (art === 'neu' ? 'Login anlegen' : 'Speichern') + '</button>' +
        (art === 'neu' ? '' : '<button type="button" class="jvp-knopf" data-z="bearbeiten" data-id="' + esc(l.id) + '">Abbrechen</button>') +
      '</div></form>';
  }

  function zugangHtml() {
    if (!zugang) return '';
    return '<div class="zg-zugang" role="status">' +
      '<p><b>Zugangsdaten für ' + esc(zugang.name) + '</b>: nur jetzt sichtbar. Bitte persönlich oder per Nachricht weitergeben. Beim ersten Login wählt ' + esc(zugang.name.split(' ')[0]) + ' ein eigenes Passwort.</p>' +
      '<p class="muted">Adresse ' + esc(location.origin + '/') + ' · E-Mail ' + esc(zugang.email) + ' · Startpasswort:</p>' +
      '<code>' + esc(zugang.passwort) + '</code>' +
      '<div class="jvp-knopfreihe"><button type="button" class="jvp-knopf jvp-knopf--primaer" data-z="kopieren">Zugangsdaten kopieren</button>' +
      '<button type="button" class="jvp-knopf" data-z="zugang-zu">Ausblenden</button></div></div>';
  }

  function loginHtml(l) {
    var selbst = l.id === D.ich;
    var pillen = [];
    if (l.rolle === 'admin') pillen.push('<span class="pille pille--kupfer">Admin</span>');
    else pillen = pillen.concat((l.bereiche || []).map(function (b) { return '<span class="pille">' + esc(D.bereiche[b] || b) + '</span>'; }));
    if (l.rolle !== 'admin' && !(l.bereiche || []).length) pillen.push('<span class="pille pille--warn">Keine Bereiche</span>');
    if (!l.aktiv) pillen.push('<span class="pille pille--rot">Gesperrt</span>');
    if (l.aktiv && l.passwortAendern) pillen.push('<span class="pille pille--warn">Startpasswort noch nicht ersetzt</span>');
    if (l.gesperrtBis) pillen.push('<span class="pille pille--warn">Nach Fehlversuchen gesperrt bis ' + esc(new Date(l.gesperrtBis).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })) + '</span>');
    var html = '<li class="zg-login' + (l.aktiv ? '' : ' ist-gesperrt') + '"><span class="jvp-benutzer__kuerzel" aria-hidden="true">' + esc(kuerzel(l.name)) + '</span>' +
      '<div class="haupt"><b>' + esc(l.name) + (selbst ? ' (du)' : '') + '</b>' +
      '<span class="muted">' + esc(l.email) + ' · ' + esc(l.letzteAnmeldung ? 'zuletzt angemeldet ' + datumZeit(l.letzteAnmeldung) : 'noch nie angemeldet') + '</span>' +
      '<span class="pillen">' + pillen.join('') + '</span></div>' +
      '<div class="actions">' +
        '<button type="button" data-z="bearbeiten" data-id="' + esc(l.id) + '" aria-expanded="' + (offen.bearbeiten === l.id) + '">Bearbeiten</button>' +
        (selbst ? '' :
          '<button type="button" data-z="passwort" data-id="' + esc(l.id) + '">Neues Startpasswort</button>' +
          (l.gesperrtBis && l.aktiv ? '<button type="button" data-z="entsperren" data-id="' + esc(l.id) + '">Sperre aufheben</button>' : '') +
          '<button type="button" data-z="aktiv" data-id="' + esc(l.id) + '">' + (l.aktiv ? 'Sperren' : 'Entsperren') + '</button>' +
          '<button type="button" class="danger" data-z="loeschen" data-id="' + esc(l.id) + '">Löschen</button>') +
      '</div>';
    if (offen.bearbeiten === l.id) html += formularHtml('bearbeiten', l);
    return html + '</li>';
  }

  function zeichnen() {
    var ziel = $('zgInhalt');
    if (!ziel) return;
    var aktiv = document.activeElement && document.activeElement.id;
    var aktive = D.logins.filter(function (l) { return l.aktiv; }).length;
    ziel.innerHTML = zugangHtml() +
      '<div id="zgMeldung" aria-live="polite"></div>' +
      '<section class="card" aria-labelledby="zgNeuTitel"><h2 id="zgNeuTitel">Neues Login</h2>' +
        '<p class="muted">Das Startpasswort erzeugt die Plattform. Für persönliche Daten (Kunden) nur die Bereiche geben, die jemand wirklich braucht.</p>' +
        formularHtml('neu', entwurf) + '</section>' +
      '<section class="card" aria-labelledby="zgListeTitel"><h2 id="zgListeTitel">Logins <small class="muted">' +
        esc(D.logins.length ? aktive + ' aktiv' + (D.logins.length > aktive ? ', ' + (D.logins.length - aktive) + ' gesperrt' : '') : '') + '</small></h2>' +
        (D.logins.length
          ? '<ul class="jvp-liste">' + D.logins.map(loginHtml).join('') + '</ul>'
          : '<p class="jvp-leer">Noch keine persönlichen Logins. Bis dahin gilt nur das Hauptpasswort.</p>') +
      '</section>';
    if (aktiv && $(aktiv)) $(aktiv).focus();
  }

  function laden() {
    return api().then(function (r) {
      D.logins = r.logins || [];
      D.bereiche = r.bereiche || {};
      D.ich = r.ich || null;
      D.geladen = true;
    });
  }

  function zeigen() {
    zugang = null;            // Startpasswort nur direkt nach dem Anlegen zeigen, nicht beim nächsten Besuch
    if (!D.geladen) $('zgInhalt').innerHTML = '<p class="jvp-leer">Wird geladen …</p>';
    laden().then(zeichnen, function (e) {
      $('zgInhalt').innerHTML = '<div class="msg error">' + esc('Logins konnten nicht geladen werden: ' + e.message) + '</div>';
    });
  }

  function formDaten(form) {
    var p = form.getAttribute('data-zform') === 'neu' ? 'zgn' : 'zgb';
    var bereiche = [];
    Array.prototype.forEach.call(form.querySelectorAll('input[name="' + p + '-bereich"]:checked'), function (c) { bereiche.push(c.value); });
    return {
      name: $(p + '-name').value.trim(),
      email: $(p + '-email').value.trim(),
      rolle: $(p + '-rolle').value,
      bereiche: bereiche
    };
  }

  function login(id) {
    for (var i = 0; i < D.logins.length; i++) if (D.logins[i].id === id) return D.logins[i];
    return null;
  }

  function ersetzen(l) {
    for (var i = 0; i < D.logins.length; i++) if (D.logins[i].id === l.id) { D.logins[i] = l; return; }
    D.logins.push(l);
    D.logins.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'de'); });
  }

  // ── Bedienung ──
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t.closest || !t.closest('#zgInhalt')) return;
    if (t.hasAttribute('data-zrolle')) {
      var box = t.closest('form').querySelector('[data-zbereiche]');
      if (box) box.hidden = t.value === 'admin';
    }
    // Entwurf des neuen Logins merken (bleibt beim Neuzeichnen erhalten)
    var form = t.closest('form[data-zform="neu"]');
    if (form) entwurf = formDaten(form);
  });
  document.addEventListener('input', function (ev) {
    var form = ev.target.closest && ev.target.closest('#zgInhalt form[data-zform="neu"]');
    if (form) entwurf = formDaten(form);
  });

  document.addEventListener('submit', function (ev) {
    var form = ev.target.closest && ev.target.closest('#zgInhalt form[data-zform]');
    if (!form) return;
    ev.preventDefault();
    var art = form.getAttribute('data-zform');
    var d = formDaten(form);
    if (!d.name) { meldung('Bitte einen Namen angeben.', 'error'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) { meldung('Bitte eine gültige E-Mail-Adresse angeben.', 'error'); return; }
    if (d.rolle !== 'admin' && !d.bereiche.length && !confirm('Ohne Bereich sieht diese Person nur die Übersicht. Trotzdem speichern?')) return;
    var knopf = form.querySelector('button[type=submit]');
    knopf.disabled = true;
    var daten = art === 'neu'
      ? { aktion: 'anlegen', name: d.name, email: d.email, rolle: d.rolle, bereiche: d.bereiche }
      : { aktion: 'aendern', id: form.getAttribute('data-id'), name: d.name, email: d.email, rolle: d.rolle, bereiche: d.bereiche };
    api(daten).then(function (r) {
      ersetzen(r.login);
      if (art === 'neu') {
        zugang = { name: r.login.name, email: r.login.email, passwort: r.passwort };
        entwurf = { name: '', email: '', rolle: 'mitarbeiter', bereiche: null };
      } else {
        offen.bearbeiten = null;
      }
      zeichnen();
      if (art === 'neu') meldung('Login für ' + r.login.name + ' angelegt.', 'success');
      else meldung('Gespeichert.' + (r.abgemeldet ? ' ' + r.login.name + ' muss sich neu anmelden.' : ''), 'success');
      if (art === 'neu') window.scrollTo({ top: 0, behavior: 'smooth' });
    }, function (e) {
      knopf.disabled = false;
      meldung(e.message, 'error');
    });
  });

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest && ev.target.closest('#zgInhalt [data-z]');
    if (!el) return;
    var was = el.getAttribute('data-z');
    var id = el.getAttribute('data-id');
    var l = id ? login(id) : null;

    if (was === 'kopieren' && zugang) {
      var text = 'Login JV-Plattform\nAdresse: ' + location.origin + '/\nE-Mail: ' + zugang.email + '\nStartpasswort: ' + zugang.passwort +
        '\nBeim ersten Login ein eigenes Passwort wählen (mindestens 10 Zeichen).';
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
        meldung('Zugangsdaten kopiert.', 'success');
      }, function () {
        meldung('Kopieren nicht möglich. Bitte das Passwort von Hand übertragen.', 'error');
      });
      return;
    }
    if (was === 'zugang-zu') { zugang = null; zeichnen(); return; }
    if (was === 'bearbeiten') { offen.bearbeiten = offen.bearbeiten === id ? null : id; zeichnen(); return; }
    if (!l) return;

    var aufruf = null;
    if (was === 'passwort') {
      if (!confirm('Neues Startpasswort für ' + l.name + '? Das bisherige Passwort gilt danach nicht mehr, ' + l.name + ' wird überall abgemeldet.')) return;
      aufruf = api({ aktion: 'passwort', id: id }).then(function (r) {
        ersetzen(r.login);
        zugang = { name: r.login.name, email: r.login.email, passwort: r.passwort };
        zeichnen();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    } else if (was === 'aktiv') {
      aufruf = api({ aktion: 'aendern', id: id, aktiv: !l.aktiv }).then(function (r) {
        ersetzen(r.login);
        zeichnen();
        meldung(r.login.aktiv ? l.name + ' kann sich wieder anmelden.' : l.name + ' ist gesperrt und überall abgemeldet.', 'success');
      });
    } else if (was === 'entsperren') {
      aufruf = api({ aktion: 'aendern', id: id, entsperren: true }).then(function (r) {
        ersetzen(r.login);
        zeichnen();
        meldung('Sperre nach Fehlversuchen aufgehoben.', 'success');
      });
    } else if (was === 'loeschen') {
      if (!confirm('Login von ' + l.name + ' (' + l.email + ') endgültig löschen?\nTipp: «Sperren» behält das Login für später.')) return;
      aufruf = api({ aktion: 'loeschen', id: id }).then(function () {
        D.logins = D.logins.filter(function (x) { return x.id !== id; });
        zeichnen();
        meldung('Login gelöscht.', 'success');
      });
    }
    if (aufruf) {
      el.disabled = true;
      aufruf.catch(function (e) {
        el.disabled = false;
        meldung(e.message, 'error');
      });
    }
  });

  window.JVZugaenge = { zeigen: zeigen };
})();
