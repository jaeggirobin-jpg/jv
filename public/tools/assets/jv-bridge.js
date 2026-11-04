// jv-bridge.js — Verbindet Michis Tools mit der JV-Plattform
//
// Die Tools wurden als Claude-Artifacts gebaut und speichern über window.claude.use('db' | 'assets' |
// 'downloads' | 'permissions'). Dieses Skript stellt dieselbe Schnittstelle bereit, speichert aber in
// unserer Supabase-Datenbank (über die Netlify Functions tool-db, tool-asset, tool-blob). So bleiben die
// Tools selbst unverändert. Für künftige Versionen mit KI gibt es zusätzlich use('sample'): Die Anfrage
// geht über die Function ki an Claude, der Schlüssel bleibt auf dem Server.
//
// Einbinden VOR dem Skript des Tools:  <script src="/tools/assets/jv-bridge.js" data-tool="terminplaner"></script>
// Anmeldung: persönliches Login (E-Mail und Passwort) oder Hauptzugang, danach Sitzungs-Cookie der Plattform.
// Fehlt die Sitzung, erscheint ein Anmeldefenster, bevor das Tool Daten lädt.
(function () {
  'use strict';

  var script = document.currentScript;
  var TOOL = (script && script.dataset.tool) || '';
  var API = '/api';
  var INTERVALL_MS = 20000;          // so oft holen offene Fenster Änderungen anderer
  var RUHE_MS = 15 * 60 * 1000;      // ohne Bedienung: Abfragen pausieren
  var UEBERLAPPUNG_MS = 30000;       // Sicherheitsabstand für «seit»

  function kopie(x) {
    return x == null ? x : JSON.parse(JSON.stringify(x));
  }
  function fehler(meldung, code) {
    var e = new Error(meldung);
    if (code) e.code = code;
    return e;
  }

  // ── Projekt aus der Adresse übernehmen (Links aus der Plattform: ?projekt=<id>) ──
  try {
    var projekt = new URLSearchParams(location.search).get('projekt');
    if (projekt && /^[A-Za-z0-9_-]{1,60}$/.test(projekt)) {
      if (TOOL === 'terminplaner') {
        var ui = JSON.parse(localStorage.getItem('tp_ui') || '{}');
        ui.cur = projekt;
        ui.tab = 'plan';
        localStorage.setItem('tp_ui', JSON.stringify(ui));
      } else if (TOOL === 'gaeste-wc') {
        localStorage.setItem('active-project', JSON.stringify(projekt));
      }
    }
  } catch (e) { /* ohne localStorage öffnet das Tool einfach das letzte Projekt */ }

  // ── Anmeldung ─────────────────────────────────────────────────────────
  // Persönliches Login (E-Mail und Passwort) oder Hauptzugang (E-Mail leer lassen, Hauptpasswort).
  // Wer mit einem Startpasswort angemeldet ist (neues oder zurückgesetztes Login), legt zuerst ein
  // eigenes Passwort fest; vorher geben die Functions keine Daten heraus.
  var anmeldung = null;   // laufendes Anmeldefenster (Promise)
  var benutzer = null;    // { id, name, email, rolle, bereiche, hauptzugang, passwortAendern }
  var STIL =
    ':host{all:initial}' +
    '.bg{position:fixed;inset:0;z-index:2147483000;background:#f3f4f5;display:grid;place-items:center;padding:24px;' +
    'font-family:Arimo,Arial,Helvetica,sans-serif;color:#3f4c57;overflow:auto}' +
    'form{width:min(380px,100%);display:grid;gap:14px}' +
    'img{width:min(260px,80%);height:auto;display:block;margin:0 0 6px}' +
    'h1{font:800 26px/1.15 "Roboto Condensed","Arial Narrow",Arial,sans-serif;margin:0}' +
    'p{margin:0;color:#6c7882;font-size:14px;line-height:1.5}' +
    'p.klein{font-size:13px}' +
    'label{display:grid;gap:6px;font-size:13px;font-weight:600}' +
    'input[type=password],input[type=email]{font:inherit;font-size:16px;padding:11px 12px;border:1px solid #c3cad0;border-radius:6px;background:#fff;color:#3f4c57;' +
    'width:100%;max-width:100%;box-sizing:border-box}' +
    'input:focus{outline:2px solid #bd843a;outline-offset:1px;border-color:#bd843a}' +
    '.chk{display:flex;gap:8px;align-items:center;font-weight:400;font-size:14px}' +
    '.chk input{accent-color:#bd843a}' +
    'button{font:600 15px/1 Arimo,Arial,sans-serif;padding:13px 16px;border-radius:6px;border:1px solid #bd843a;background:#bd843a;color:#fff;cursor:pointer}' +
    'button:hover{background:#94621f;border-color:#94621f}' +
    'button.leise{background:none;color:#3f4c57;border-color:#c3cad0}' +
    'button.leise:hover{border-color:#bd843a;color:#94621f;background:none}' +
    'button:disabled{opacity:.6;cursor:wait}' +
    '.err{color:#b3332b;min-height:1.2em;font-size:14px}';

  function benutzerSetzen(b) {
    benutzer = b || null;
    try { window.dispatchEvent(new CustomEvent('jv-benutzer', { detail: benutzer })); } catch (e) { /* alte Browser */ }
  }

  function sitzungLaden() {
    return fetch(API + '/sitzung', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      if (!r.ok) { benutzerSetzen(null); return null; }
      return r.json().then(function (j) { benutzerSetzen(j.benutzer || null); return benutzer; });
    });
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // art: 'anmelden' | 'neu' (Startpasswort ersetzen) | 'aendern' (freiwillig, mit Abbrechen)
  // altesPasswort: bei 'neu' direkt nach der Anmeldung schon bekannt (Feld entfällt)
  function formular(art, altesPasswort) {
    return new Promise(function (fertig) {
      var host = document.createElement('div');
      host.setAttribute('data-jv-anmeldung', '');
      var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      var kopf = '<img src="/dachcheck/assets/logo-jaeggi-vollmer.svg" alt="Jäggi Vollmer">';
      var html;
      if (art === 'anmelden') {
        html = kopf + '<h1>Anmelden</h1><p>' + (TOOL === 'plattform'
          ? 'Interner Bereich von Jäggi Vollmer.'
          : 'Die Tools speichern in der JV-Plattform. Bitte anmelden.') + '</p>' +
          '<label>E-Mail<input type="email" name="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false"></label>' +
          '<label>Passwort<input type="password" name="pw" autocomplete="current-password" required></label>' +
          '<label class="chk"><input type="checkbox" name="bleiben"> Auf diesem Gerät 30 Tage angemeldet bleiben</label>' +
          '<div class="err" role="alert"></div><button type="submit">Anmelden</button>' +
          '<p class="klein">Hauptzugang: E-Mail leer lassen und das Hauptpasswort eingeben.</p>';
      } else {
        html = kopf + '<h1>' + (art === 'neu' ? 'Eigenes Passwort festlegen' : 'Passwort ändern') + '</h1>' +
          '<p>' + (art === 'neu'
            ? 'Hallo ' + escHtml(benutzer && benutzer.name) + '. Das Startpasswort gilt nur für die erste Anmeldung. Bitte jetzt ein eigenes Passwort wählen (mindestens 10 Zeichen).'
            : 'Mindestens 10 Zeichen. Andere Geräte werden danach abgemeldet.') + '</p>' +
          (altesPasswort ? '' : '<label>' + (art === 'neu' ? 'Startpasswort' : 'Bisheriges Passwort') +
            '<input type="password" name="alt" autocomplete="current-password" required></label>') +
          '<label>Neues Passwort<input type="password" name="neu" autocomplete="new-password" minlength="10" required></label>' +
          '<label>Neues Passwort wiederholen<input type="password" name="neu2" autocomplete="new-password" minlength="10" required></label>' +
          '<div class="err" role="alert"></div><button type="submit">Passwort speichern</button>' +
          (art === 'aendern' ? '<button type="button" class="leise" data-zu>Abbrechen</button>' : '<button type="button" class="leise" data-abmelden>Abmelden</button>');
      }
      root.innerHTML = '<style>' + STIL + '</style><div class="bg"><form novalidate>' + html + '</form></div>';
      document.documentElement.appendChild(host);
      var form = root.querySelector('form');
      var meldung = root.querySelector('.err');
      var knopf = root.querySelector('button[type=submit]');
      var erstes = root.querySelector('input');
      setTimeout(function () { erstes.focus(); }, 30);

      function zu(ergebnis) {
        host.remove();
        fertig(ergebnis);
      }
      function feld(name) { var f = root.querySelector('input[name=' + name + ']'); return f ? f.value : ''; }

      var abbrechen = root.querySelector('[data-zu]');
      if (abbrechen) abbrechen.addEventListener('click', function () { zu(false); });
      var abmelden = root.querySelector('[data-abmelden]');
      if (abmelden) abmelden.addEventListener('click', function () {
        fetch(API + '/sitzung', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-JV-Sitzung': '1' },
          body: JSON.stringify({ aktion: 'abmelden' })
        }).catch(function () { /* trotzdem neu laden */ }).then(function () { location.reload(); });
      });

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        meldung.textContent = '';
        var daten;
        if (art === 'anmelden') {
          if (!feld('pw')) { meldung.textContent = 'Bitte das Passwort eingeben.'; return; }
          daten = { email: feld('email').trim(), passwort: feld('pw'), bleiben: root.querySelector('input[name=bleiben]').checked };
        } else {
          var neu = feld('neu');
          if (neu.length < 10) { meldung.textContent = 'Das neue Passwort braucht mindestens 10 Zeichen.'; return; }
          if (neu !== feld('neu2')) { meldung.textContent = 'Die beiden neuen Passwörter stimmen nicht überein.'; return; }
          daten = { aktion: 'passwort', alt: altesPasswort || feld('alt'), neu: neu };
        }
        knopf.disabled = true;
        fetch(API + '/sitzung', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-JV-Sitzung': '1' },
          body: JSON.stringify(daten)
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (r.ok) {
              benutzerSetzen(j.benutzer || null);
              if (art === 'anmelden' && j.passwortAendern) {
                host.remove();
                formular('neu', daten.passwort).then(fertig);
                return;
              }
              zu(true);
              return;
            }
            if (art === 'anmelden' && r.status === 401) {
              meldung.textContent = daten.email ? 'E-Mail oder Passwort falsch.' : 'Passwort falsch. Mit persönlichem Login bitte auch die E-Mail eingeben.';
            } else {
              meldung.textContent = j.error || ('Nicht möglich (Fehler ' + r.status + ').');
            }
            knopf.disabled = false;
            var pw = root.querySelector('input[name=' + (art === 'anmelden' ? 'pw' : (altesPasswort ? 'neu' : 'alt')) + ']');
            if (pw) pw.select();
          });
        }).catch(function () {
          meldung.textContent = 'Keine Verbindung. Bitte erneut versuchen.';
          knopf.disabled = false;
        });
      });
    });
  }

  // Anmeldefenster (bei 401). Ist man schon angemeldet, fehlt nur das Recht für diesen Bereich.
  function anmeldenZeigen() {
    if (anmeldung) return anmeldung;
    anmeldung = sitzungLaden().then(function (b) {
      if (b && !b.passwortAendern) {
        throw fehler('Für diesen Bereich fehlt die Berechtigung. Bitte bei einem Admin melden.', 'not_granted');
      }
      return formular(b ? 'neu' : 'anmelden');
    }).then(function (x) {
      anmeldung = null;
      return x;
    }, function (e) {
      anmeldung = null;
      throw e;
    });
    return anmeldung;
  }

  var sitzungGeprueft = null;
  function sitzungSicherstellen() {
    if (!sitzungGeprueft) {
      sitzungGeprueft = sitzungLaden()
        .then(function (b) { if (!b || b.passwortAendern) return anmeldenZeigen(); })
        .catch(function () { /* offline: die Abfragen versuchen es später erneut */ })
        .then(function () { return benutzer; });
    }
    return sitzungGeprueft;
  }

  // Eigenes Passwort ändern (Plattform, Menü «Passwort ändern»)
  function passwortAendern() {
    if (!benutzer || benutzer.hauptzugang) return Promise.resolve(false);
    return formular('aendern');
  }

  // fetch mit Sitzung: bei 401 Anmeldefenster zeigen und einmal wiederholen
  // optionen.signal (AbortSignal) bricht die Anfrage ab
  function anfrage(pfad, optionen, wiederholt) {
    optionen = optionen || {};
    var h = { 'X-JV-Sitzung': '1' };
    if (optionen.body) h['Content-Type'] = 'application/json';
    return fetch(API + pfad, {
      method: optionen.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: h,
      body: optionen.body ? JSON.stringify(optionen.body) : undefined,
      signal: optionen.signal || undefined
    }).then(function (r) {
      if (r.status === 401 && !wiederholt) {
        return anmeldenZeigen().then(function () { return anfrage(pfad, optionen, true); });
      }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var code = j.code || (r.status === 413 ? 'quota_exceeded' : r.status === 401 ? 'not_granted' : 'http_' + r.status);
          throw fehler(j.error || ('Fehler ' + r.status), code);
        }
        return j;
      });
    });
  }

  // ── db: Firestore-ähnliche Schnittstelle wie im claude.ai-Speicher ─────
  function Speicher(tool) {
    this.tool = tool;
    this.sammlungen = {};      // name → { docs: { id: { daten, geaendert } }, geladen, hoerer: [] }
    this.seit = null;
    this.timer = null;
    this.laeuft = false;
    this.letzteBedienung = Date.now();
    this.letzteAbfrage = 0;
    var self = this;
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
      addEventListener(ev, function () {
        var warPause = Date.now() - self.letzteBedienung > RUHE_MS;
        self.letzteBedienung = Date.now();
        if (warPause) self.bald(0);
      }, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && Date.now() - self.letzteAbfrage > 5000) self.bald(0);
    });
  }

  Speicher.prototype.sammlung = function (name) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(name)) throw fehler('Ungültige Sammlung: ' + name, 'invalid_argument');
    if (!this.sammlungen[name]) {
      this.sammlungen[name] = { docs: {}, geladen: false, hoerer: [] };
      this.bald(0);
    }
    return this.sammlungen[name];
  };

  Speicher.prototype.bald = function (ms) {
    var self = this;
    clearTimeout(this.timer);
    this.timer = setTimeout(function () { self.abfragen(); }, ms);
  };

  Speicher.prototype.planen = function () {
    // Pause, solange das Fenster verborgen ist oder niemand bedient
    if (document.hidden || Date.now() - this.letzteBedienung > RUHE_MS) {
      clearTimeout(this.timer);
      return;
    }
    this.bald(INTERVALL_MS);
  };

  Speicher.prototype.abfragen = function () {
    var self = this;
    if (this.laeuft) return;
    var namen = Object.keys(this.sammlungen);
    if (!namen.length) return;
    var neue = namen.filter(function (n) { return !self.sammlungen[n].geladen; });
    // Neue Sammlungen brauchen eine vollständige Ladung, die übrigen nur Änderungen
    var abrufe = [];
    if (neue.length) abrufe.push({ namen: neue, seit: null });
    var alte = namen.filter(function (n) { return self.sammlungen[n].geladen; });
    if (alte.length && this.seit) abrufe.push({ namen: alte, seit: this.seit });
    if (!abrufe.length) return this.planen();

    this.laeuft = true;
    this.letzteAbfrage = Date.now();
    sitzungSicherstellen().then(function () {
      return Promise.all(abrufe.map(function (a) {
        return anfrage('/tool-db?tool=' + encodeURIComponent(self.tool) + '&sammlungen=' + a.namen.join(',') +
          (a.seit ? '&seit=' + encodeURIComponent(a.seit) : '')).then(function (r) { return { a: a, r: r }; });
      }));
    }).then(function (ergebnisse) {
      var jetzt = null;
      ergebnisse.forEach(function (e) {
        self.anwenden(e.a.namen, e.r.docs || [], !e.a.seit);
        if (e.r.jetzt && (!jetzt || e.r.jetzt < jetzt)) jetzt = e.r.jetzt;
      });
      if (jetzt) self.seit = new Date(Date.parse(jetzt) - UEBERLAPPUNG_MS).toISOString();
      self.laeuft = false;
      // Während der Abfrage dazugekommene Sammlungen sofort laden
      var offen = Object.keys(self.sammlungen).some(function (n) { return !self.sammlungen[n].geladen; });
      if (offen) self.bald(0); else self.planen();
    }).catch(function (err) {
      self.laeuft = false;
      // Erste Ladung fehlgeschlagen: Tool informieren (einmal), dann im Hintergrund weiter versuchen
      namen.forEach(function (n) {
        var s = self.sammlungen[n];
        if (!s.geladen && !s.fehlerGemeldet) {
          s.fehlerGemeldet = true;
          s.hoerer.forEach(function (h) { if (h.fehler) { try { h.fehler(err); } catch (e) { console.error(e); } } });
        }
      });
      clearTimeout(self.timer);
      self.timer = setTimeout(function () { self.abfragen(); }, 8000);
    });
  };

  Speicher.prototype.anwenden = function (namen, docs, vollstaendig) {
    var self = this;
    var aenderungen = {};
    namen.forEach(function (n) { aenderungen[n] = []; });
    if (vollstaendig) {
      // Vollständige Ladung: was fehlt, gilt als gelöscht
      var vorhanden = {};
      docs.forEach(function (d) { vorhanden[d.pfad] = true; });
      namen.forEach(function (n) {
        var s = self.sammlungen[n];
        Object.keys(s.docs).forEach(function (id) {
          if (!vorhanden[n + '/' + id]) { delete s.docs[id]; aenderungen[n].push({ type: 'removed', id: id, daten: null }); }
        });
      });
    }
    docs.forEach(function (d) {
      var teile = String(d.pfad).split('/');
      var n = teile[0], id = teile[1];
      var s = self.sammlungen[n];
      if (!s) return;
      var bekannt = s.docs[id];
      if (d.geloescht) {
        if (bekannt) { delete s.docs[id]; aenderungen[n].push({ type: 'removed', id: id, daten: null }); }
        return;
      }
      if (bekannt && bekannt.geaendert === d.geaendert) return;
      s.docs[id] = { daten: d.daten, geaendert: d.geaendert };
      aenderungen[n].push({ type: bekannt ? 'modified' : 'added', id: id, daten: d.daten });
    });
    namen.forEach(function (n) {
      var s = self.sammlungen[n];
      var erstes = !s.geladen;
      s.geladen = true;
      if (erstes || aenderungen[n].length) {
        s.hoerer.slice().forEach(function (h) {
          try { h.melden(aenderungen[n], erstes); } catch (e) { console.error('Fehler im Tool beim Verarbeiten der Daten', e); }
        });
      }
    });
  };

  function docSnap(id, eintrag, ref) {
    return {
      id: id,
      ref: ref,
      exists: !!eintrag,
      data: function () { return eintrag ? kopie(eintrag.daten) : undefined; }
    };
  }

  Speicher.prototype.collection = function (name) {
    var self = this;
    return {
      id: name,
      path: name,
      doc: function (id) {
        return self.doc(name + '/' + (id || neueDocId()));
      },
      onSnapshot: function (weiter, fehlerFn) {
        var s = self.sammlung(name);
        var hoerer = {
          fehler: fehlerFn,
          melden: function (aenderungen, erstes) {
            var alle = Object.keys(s.docs).map(function (id) { return docSnap(id, s.docs[id], self.doc(name + '/' + id)); });
            var liste = erstes
              ? alle.map(function (d) { return { type: 'added', doc: d }; })
              : aenderungen.map(function (a) {
                return { type: a.type, doc: docSnap(a.id, a.daten ? { daten: a.daten } : null, self.doc(name + '/' + a.id)) };
              });
            weiter({
              docs: alle, size: alle.length, empty: !alle.length,
              forEach: function (fn) { alle.forEach(fn); },
              docChanges: function () { return liste; }
            });
          }
        };
        s.hoerer.push(hoerer);
        if (s.geladen) setTimeout(function () { hoerer.melden([], true); }, 0);
        return function () { s.hoerer = s.hoerer.filter(function (h) { return h !== hoerer; }); };
      }
    };
  };

  Speicher.prototype.doc = function (pfad) {
    var self = this;
    var teile = String(pfad).split('/');
    if (teile.length !== 2 || !teile[0] || !teile[1]) throw fehler('Ungültiger Pfad: ' + pfad, 'invalid_argument');
    var name = teile[0], id = teile[1];
    var ref = {
      id: id,
      path: pfad,
      set: function (daten) {
        var s = self.sammlungen[name];
        // Schutz: nie schreiben, bevor die Sammlung geladen ist (sonst würden Standardwerte
        // eines Tools die gespeicherten Daten überschreiben)
        if (s && !s.geladen) return Promise.reject(fehler('Daten sind noch nicht geladen', 'not_loaded'));
        var kopiert = kopie(daten);
        return anfrage('/tool-db', { method: 'POST', body: { tool: self.tool, aktion: 'set', pfad: pfad, daten: kopiert } })
          .then(function (r) {
            if (s) s.docs[id] = { daten: kopiert, geaendert: r.geaendert };
          });
      },
      update: function (felder) {
        var s = self.sammlungen[name];
        if (s && !s.geladen) return Promise.reject(fehler('Daten sind noch nicht geladen', 'not_loaded'));
        return anfrage('/tool-db', { method: 'POST', body: { tool: self.tool, aktion: 'patch', pfad: pfad, daten: kopie(felder) } })
          .then(function (r) {
            if (s) s.docs[id] = { daten: r.daten, geaendert: r.geaendert };
          });
      },
      delete: function () {
        var s = self.sammlungen[name];
        if (s && !s.geladen) return Promise.reject(fehler('Daten sind noch nicht geladen', 'not_loaded'));
        return anfrage('/tool-db', { method: 'POST', body: { tool: self.tool, aktion: 'delete', pfad: pfad } })
          .then(function () { if (s) delete s.docs[id]; });
      },
      get: function () {
        return sitzungSicherstellen().then(function () {
          return anfrage('/tool-db?tool=' + encodeURIComponent(self.tool) + '&sammlungen=' + name);
        }).then(function (r) {
          var d = (r.docs || []).filter(function (x) { return x.pfad === pfad; })[0];
          return docSnap(id, d ? { daten: d.daten } : null, ref);
        });
      },
      onSnapshot: function (weiter, fehlerFn) {
        var s = self.sammlung(name);
        var hoerer = {
          fehler: fehlerFn,
          melden: function (aenderungen, erstes) {
            if (!erstes && !aenderungen.some(function (a) { return a.id === id; })) return;
            weiter(docSnap(id, s.docs[id], ref));
          }
        };
        s.hoerer.push(hoerer);
        if (s.geladen) setTimeout(function () { hoerer.melden([], true); }, 0);
        return function () { s.hoerer = s.hoerer.filter(function (h) { return h !== hoerer; }); };
      }
    };
    return ref;
  };

  function neueDocId() {
    var z = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var b = new Uint8Array(20);
    crypto.getRandomValues(b);
    var s = '';
    for (var i = 0; i < b.length; i++) s += z[b[i] % z.length];
    return s;
  }

  // ── assets: Dateien im privaten Bucket «tools» ────────────────────────
  function Dateien(tool) { this.tool = tool; }

  Dateien.prototype.upload = function (blob, optionen) {
    var typ = (optionen && optionen.type) || blob.type || 'application/octet-stream';
    var tool = this.tool;
    return sitzungSicherstellen().then(function () {
      return anfrage('/tool-asset', { method: 'POST', body: { aktion: 'vorbereiten', tool: tool, typ: typ, groesse: blob.size } });
    }).then(function (r) {
      return fetch(r.upload_url, {
        method: 'PUT',
        headers: { 'content-type': typ, 'cache-control': 'max-age=3600', 'x-upsert': 'false' },
        body: blob
      }).then(function (res) {
        if (!res.ok) throw fehler('Hochladen fehlgeschlagen (' + res.status + ')', res.status === 413 ? 'quota_exceeded' : 'upload_failed');
        return { id: r.id, url: r.url };
      });
    });
  };

  Dateien.prototype.delete = function (id) {
    return anfrage('/tool-asset', { method: 'POST', body: { aktion: 'loeschen', id: id } });
  };

  // Feste Datei (z. B. 3D-Scan des Gäste-WC-Tools) ersetzen
  Dateien.prototype.dateiErsetzen = function (name, blob, typ) {
    return anfrage('/tool-asset', { method: 'POST', body: { aktion: 'datei', name: name, typ: typ, groesse: blob.size } })
      .then(function (r) {
        return fetch(r.upload_url, { method: 'PUT', headers: { 'content-type': typ, 'x-upsert': 'false' }, body: blob });
      }).then(function (res) {
        if (!res.ok) throw fehler('Hochladen fehlgeschlagen (' + res.status + ')', 'upload_failed');
      });
  };

  // ── downloads: Datei im Browser speichern ─────────────────────────────
  var downloads = {
    save: function (auftrag) {
      return new Promise(function (fertig, abbruch) {
        try {
          var daten = auftrag && auftrag.data;
          var blob = daten instanceof Blob ? daten : new Blob([daten == null ? '' : daten]);
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = (auftrag && auftrag.filename) || 'download';
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
          fertig({ ok: true });
        } catch (e) {
          abbruch(fehler('Download nicht möglich', 'failed'));
        }
      });
    }
  };

  var gemeldet = {};
  function einmalMelden(schluessel, text) {
    if (gemeldet[schluessel]) return;
    gemeldet[schluessel] = true;
    try { console.warn('jv-bridge: ' + text); } catch (e) { /* ohne Konsole */ }
  }

  // ── sample: Claude für künftige Versionen der Tools ───────────────────
  // Dieselbe Schnittstelle wie use('sample') in claude.ai-Artefakten:
  //   sample(input, optionen)      → { text, truncated, modelTierApplied }
  //   sample.json(input, optionen) → der Wert aus der Antwort (JSON, tolerant gelesen)
  //   sample.limits()              → { maxPromptBytes, modelTiers }
  // Fehler sind einfache Objekte { code, message, text? } mit den Codes des Vertrags.
  // Abweichungen: keine Bilder (images_unavailable) und keine Werkzeuge (tools_unavailable). Die Antwort
  // kommt am Stück: onText wird einmal mit der ganzen Antwort aufgerufen, kurz bevor das Ergebnis kommt.
  // Gleiche Anfragen innerhalb von fünf Minuten liefert der Zwischenspeicher dieser Seite (cache: false
  // fragt immer neu). Vor der ersten Anfrage fragt ein Fenster einmal je Browser, ob die KI verwendet
  // werden darf. Wer ablehnt, bekommt bis zum Neuladen der Seite not_granted.
  var SAMPLE_MAX_BYTES = 262144;          // 256 KiB wie im Vertrag (die Function prüft dasselbe)
  var SAMPLE_STUFEN = ['default', 'complex', 'quick'];
  var SAMPLE_CODES = ['invalid_request', 'prompt_too_large', 'not_granted', 'session_expired', 'sampling_disabled',
    'rate_limited', 'refused', 'empty_completion', 'upstream_error'];
  var SAMPLE_OPTIONEN = ['onText', 'signal', 'tools', 'images', 'modelTier', 'model', 'effort', 'fast', 'cache'];
  var CACHE_MS = 300000, CACHE_MAX_MS = 86400000, CACHE_EINTRAEGE = 30, CACHE_MAX_ZEICHEN = 65536;
  var KI_GLEICHZEITIG = 2, KI_WARTEND = 8;  // wie im Vertrag: zwei laufen, einige warten, danach rate_limited
  var KI_OK = 'jv-ki-ok';
  var ABGEBROCHEN = {};
  var kiAbgelehnt = false;                // «Nicht jetzt» gilt bis zum Neuladen der Seite
  var kiFrage = null;                     // offenes Zustimmungsfenster (Promise<boolean>)
  var kiLaufend = 0;
  var kiWarteschlange = [];
  var sampleCache = [];                   // { schluessel, zeit, gcTime, ergebnis }, neueste zuletzt

  function sampleFehler(code, meldung, text) {
    var e = { code: code, message: meldung };
    if (typeof text === 'string' && text) e.text = text;
    return e;
  }

  function istObjekt(o) {
    if (!o || typeof o !== 'object') return false;
    var p = Object.getPrototypeOf(o);
    return p === Object.prototype || p === null;
  }

  function gesetzt(x) { return x !== undefined && x !== null; }

  var utf8 = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  function bytes(s) { return utf8 ? utf8.encode(s).length : s.length * 3; }

  // Eingabe prüfen und kopieren: Text oder [{ role: 'user'|'assistant', content }], beginnt und endet mit 'user'
  function eingabePruefen(input) {
    var liste = [];
    if (typeof input === 'string') {
      if (!input.trim()) return { fehler: sampleFehler('invalid_request', 'Die Anfrage ist leer.') };
      liste.push({ role: 'user', content: input });
    } else if (Array.isArray(input)) {
      if (!input.length) return { fehler: sampleFehler('invalid_request', 'Die Anfrage ist leer.') };
      for (var i = 0; i < input.length; i++) {
        var n = input[i];
        if (!n || typeof n !== 'object' || (n.role !== 'user' && n.role !== 'assistant')) {
          return { fehler: sampleFehler('invalid_request', 'Nachricht ' + (i + 1) + ': Die Rolle muss «user» oder «assistant» sein.') };
        }
        if (typeof n.content !== 'string' || !n.content.trim()) {
          return { fehler: sampleFehler('invalid_request', 'Nachricht ' + (i + 1) + ': Der Inhalt muss ein nicht leerer Text sein.') };
        }
        liste.push({ role: n.role, content: n.content });
      }
      if (liste[0].role !== 'user' || liste[liste.length - 1].role !== 'user') {
        return { fehler: sampleFehler('invalid_request', 'Die Nachrichten müssen mit der Rolle «user» beginnen und enden.') };
      }
    } else {
      var tipp = istObjekt(input) && typeof input.prompt === 'string' ? ' Statt { prompt } den Text direkt übergeben: sample(text, optionen).' : '';
      return { fehler: sampleFehler('invalid_request', 'Die Anfrage muss ein Text oder eine Liste von Nachrichten sein.' + tipp) };
    }
    var summe = 0;
    liste.forEach(function (m) { summe += bytes(m.content); });
    if (summe > SAMPLE_MAX_BYTES) return { fehler: sampleFehler('prompt_too_large', 'Die Anfrage ist zu lang (höchstens 256 KiB Text).') };
    return { nachrichten: liste };
  }

  function cacheEinstellung(c) {
    if (!gesetzt(c) || c === true) return { gcTime: CACHE_MS };
    if (c === false) return { aus: true };
    if (istObjekt(c)) {
      var g = c.gcTime === undefined ? CACHE_MS : c.gcTime;
      if (typeof g !== 'number' || !isFinite(g) || g <= 0) {
        return { fehler: sampleFehler('invalid_request', 'cache.gcTime muss eine Zahl grösser als 0 sein (Millisekunden).') };
      }
      if (c.refresh !== undefined && typeof c.refresh !== 'boolean') {
        return { fehler: sampleFehler('invalid_request', 'cache.refresh muss true oder false sein.') };
      }
      return { gcTime: Math.min(g, CACHE_MAX_MS), refresh: c.refresh === true };
    }
    return { fehler: sampleFehler('invalid_request', 'cache muss true, false oder { gcTime, refresh } sein.') };
  }

  // Optionen prüfen (einfaches Objekt, alles freiwillig). Ergebnis: { o, cache } oder { fehler }
  function optionenPruefen(o) {
    if (!gesetzt(o)) o = {};
    if (!istObjekt(o)) {
      var tipp = typeof AbortController !== 'undefined' && o instanceof AbortController ? ' Gemeint ist wohl { signal: controller.signal }.'
        : typeof o === 'function' ? ' Gemeint ist wohl { onText: funktion }.'
        : (typeof Blob !== 'undefined' && o instanceof Blob) || (typeof FileList !== 'undefined' && o instanceof FileList) ? ' Bilder gehören in { images } (hier nicht verfügbar).'
        : typeof o === 'string' ? ' Die Anfrage gehört ins erste Argument.' : '';
      return { fehler: sampleFehler('invalid_request', 'Die Optionen müssen ein einfaches Objekt sein.' + tipp) };
    }
    Object.keys(o).forEach(function (k) {
      if (SAMPLE_OPTIONEN.indexOf(k) < 0) einmalMelden('sample-option:' + k, 'sample: unbekannte Option «' + k + '» wird ignoriert.');
    });
    if (gesetzt(o.onText) && typeof o.onText !== 'function') return { fehler: sampleFehler('invalid_request', 'onText muss eine Funktion sein.') };
    if (gesetzt(o.signal) && !(typeof AbortSignal !== 'undefined' && o.signal instanceof AbortSignal)) {
      return { fehler: sampleFehler('invalid_request', 'signal muss ein AbortSignal sein (controller.signal, nicht der Controller).') };
    }
    if (gesetzt(o.modelTier) && SAMPLE_STUFEN.indexOf(o.modelTier) < 0) {
      return { fehler: sampleFehler('invalid_request', 'Unbekannte modelTier «' + String(o.modelTier) + '» (möglich: default, complex, quick).') };
    }
    if (gesetzt(o.tools)) {
      if (!Array.isArray(o.tools)) return { fehler: sampleFehler('invalid_request', 'tools muss eine Liste sein.') };
      if (o.tools.length) return { fehler: sampleFehler('tools_unavailable', 'Werkzeuge (tools) gibt es in der JV-Plattform nicht.') };
    }
    if (gesetzt(o.images) && (typeof o.images.length === 'number' ? o.images.length > 0 : true)) {
      return { fehler: sampleFehler('images_unavailable', 'Bilder gibt es für die KI in der JV-Plattform nicht.') };
    }
    var cache = cacheEinstellung(o.cache);
    if (cache.fehler) return { fehler: cache.fehler };
    if (gesetzt(o.fast) && o.fast !== 'auto' && o.fast !== false) einmalMelden('sample-fast', 'sample: fast muss «auto» oder false sein, der Wert wird ignoriert.');
    if (gesetzt(o.model) || gesetzt(o.effort)) einmalMelden('sample-modell', 'sample: model und effort werden ignoriert, das Modell bestimmt die JV-Plattform.');
    return { o: o, cache: cache };
  }

  function cacheLesen(schluessel, gcTime) {
    for (var i = sampleCache.length - 1; i >= 0; i--) {
      var c = sampleCache[i];
      if (c.schluessel !== schluessel) continue;
      if (Date.now() - c.zeit >= Math.min(c.gcTime, gcTime)) return null;
      return { text: c.ergebnis.text, truncated: c.ergebnis.truncated, modelTierApplied: c.ergebnis.modelTierApplied };
    }
    return null;
  }

  function cacheSchreiben(schluessel, ergebnis, gcTime) {
    if (schluessel.length > CACHE_MAX_ZEICHEN) return;   // lange Anfragen nicht im Speicher halten
    sampleCache = sampleCache.filter(function (c) { return c.schluessel !== schluessel; });
    sampleCache.push({ schluessel: schluessel, zeit: Date.now(), gcTime: gcTime, ergebnis: {
      text: ergebnis.text, truncated: ergebnis.truncated, modelTierApplied: ergebnis.modelTierApplied
    } });
    if (sampleCache.length > CACHE_EINTRAEGE) sampleCache.shift();
  }

  // Antwort als JSON lesen: ganze Antwort, sonst ein einzelner Markdown-Block, sonst von der ersten
  // { oder [ bis zur letzten } oder ]
  function jsonLesen(text) {
    function versuch(s) {
      try { return { ok: true, wert: JSON.parse(s) }; } catch (e) { return { ok: false }; }
    }
    var t = String(text).trim();
    var r = versuch(t);
    if (r.ok) return r;
    var bloecke = t.match(/```[^\n`]*\n?[\s\S]*?```/g);
    if (bloecke && bloecke.length === 1) {
      r = versuch(bloecke[0].replace(/^```[^\n`]*\n?/, '').replace(/```$/, '').trim());
      if (r.ok) return r;
    }
    var a = t.search(/[{[]/);
    var z = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    return a >= 0 && z > a ? versuch(t.slice(a, z + 1)) : { ok: false };
  }

  // Promise ablehnen, sobald das Signal auslöst (offene Fenster bleiben stehen)
  function mitAbbruch(p, signal) {
    if (!signal) return p;
    return new Promise(function (ok, nein) {
      function ab() { nein(ABGEBROCHEN); }
      if (signal.aborted) { ab(); return; }
      signal.addEventListener('abort', ab);
      p.then(function (x) { signal.removeEventListener('abort', ab); ok(x); },
        function (e) { signal.removeEventListener('abort', ab); nein(e); });
    });
  }

  // Platz für eine Anfrage: höchstens KI_GLEICHZEITIG laufen, KI_WARTEND warten, sonst rate_limited.
  // Ergebnis: Funktion zum Freigeben des Platzes.
  function kiPlatz(signal) {
    return new Promise(function (ok, nein) {
      function nehmen() {
        var frei = false;
        ok(function () {
          if (frei) return;
          frei = true;
          var naechster = kiWarteschlange.shift();
          if (naechster) naechster.nehmen(); else kiLaufend--;
        });
      }
      if (kiLaufend < KI_GLEICHZEITIG) { kiLaufend++; nehmen(); return; }
      if (kiWarteschlange.length >= KI_WARTEND) {
        nein(sampleFehler('rate_limited', 'Zu viele KI-Anfragen auf einmal. Bitte kurz warten und nochmals versuchen.'));
        return;
      }
      var eintrag = { nehmen: nehmen };
      kiWarteschlange.push(eintrag);
      if (signal) signal.addEventListener('abort', function () {
        var i = kiWarteschlange.indexOf(eintrag);
        if (i >= 0) { kiWarteschlange.splice(i, 1); nein(ABGEBROCHEN); }
      });
    });
  }

  function kiZustand() {
    try { if (localStorage.getItem(KI_OK) === '1') return 'granted'; } catch (e) { /* ohne localStorage: jedes Mal fragen */ }
    return kiAbgelehnt ? 'denied' : 'prompt';
  }

  // Einmal je Browser fragen, ob die KI verwendet werden darf. Ergebnis: true/false
  var KI_STIL =
    '.bg.ki{background:rgba(35,42,48,.55)}' +
    '.ki form{width:min(440px,100%);box-sizing:border-box;background:#fff;padding:24px;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.25)}' +
    '.ki .knoepfe{display:flex;gap:10px;flex-wrap:wrap}.ki .knoepfe button{flex:1 1 150px}';
  function kiZustimmung() {
    var z = kiZustand();
    if (z !== 'prompt') return Promise.resolve(z === 'granted');
    if (kiFrage) return kiFrage;
    kiFrage = new Promise(function (fertig) {
      var host = document.createElement('div');
      host.setAttribute('data-jv-ki', '');
      var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      root.innerHTML = '<style>' + STIL + KI_STIL + '</style>' +
        '<div class="bg ki" role="dialog" aria-modal="true" aria-labelledby="ki-titel"><form novalidate>' +
        '<h1 id="ki-titel">KI verwenden?</h1>' +
        '<p>Für diese Funktion schickt das Tool Angaben an Claude, die KI von Anthropic (USA). Es geht nur mit, ' +
        'was die Funktion dafür zusammenstellt, keine Anmeldedaten und keine weiteren Daten der Plattform.</p>' +
        '<p>Bitte die Funktion nicht für heikle Personendaten verwenden. Die Freigabe gilt für diesen Browser.</p>' +
        '<div class="knoepfe"><button type="submit">KI verwenden</button><button type="button" class="leise" data-nein>Nicht jetzt</button></div>' +
        '</form></div>';
      document.documentElement.appendChild(host);
      var ja = root.querySelector('button[type=submit]');
      setTimeout(function () { ja.focus(); }, 30);
      function antwort(erlaubt) {
        host.remove();
        kiFrage = null;
        if (erlaubt) {
          try { localStorage.setItem(KI_OK, '1'); } catch (e) { /* gilt dann nur für diese Seite */ }
          kiAbgelehnt = false;
        } else {
          kiAbgelehnt = true;
        }
        fertig(erlaubt);
      }
      root.querySelector('form').addEventListener('submit', function (ev) { ev.preventDefault(); antwort(true); });
      root.querySelector('[data-nein]').addEventListener('click', function () { antwort(false); });
      root.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') antwort(false); });
    });
    return kiFrage;
  }

  function textMelden(onText, text) {
    if (!onText) return;
    function melden(e) { try { console.error('jv-bridge: Fehler in onText', e); } catch (x) { /* ohne Konsole */ } }
    try {
      var r = onText({ text: text, delta: text });
      if (r && typeof r.then === 'function') r.then(null, melden);
    } catch (e) {
      melden(e);
    }
  }

  function alsSampleFehler(e) {
    if (e === ABGEBROCHEN || (e && e.name === 'AbortError')) return sampleFehler('cancelled', 'Abgebrochen.');
    if (istObjekt(e) && typeof e.code === 'string' && typeof e.message === 'string') return e;   // schon im Vertragsformat
    if (e instanceof TypeError) return sampleFehler('upstream_error', 'Keine Verbindung zur Plattform. Bitte später nochmals versuchen.');
    var code = e && e.code === 'quota_exceeded' ? 'prompt_too_large' : e && e.code;
    if (SAMPLE_CODES.indexOf(code) < 0) code = 'upstream_error';
    return sampleFehler(code, (e && e.message) || 'Die KI-Anfrage ist fehlgeschlagen.');
  }

  function sampleAufruf(verb, input, optionen) {
    var p = optionenPruefen(optionen);
    if (p.fehler) return Promise.reject(p.fehler);
    var e = eingabePruefen(input);   // die Eingabe wird jetzt gelesen; spätere Änderungen zählen nicht
    if (e.fehler) return Promise.reject(e.fehler);
    var o = p.o;
    var signal = o.signal || null;
    var stufe = o.modelTier || 'default';
    var onText = typeof o.onText === 'function' ? o.onText : null;
    var schluessel = verb + '|' + stufe + '|' + JSON.stringify(e.nachrichten);
    if (signal && signal.aborted) return Promise.reject(sampleFehler('cancelled', 'Abgebrochen.'));

    return Promise.resolve().then(function () {
      // Erst im nächsten Mikrotask: ein abort() im selben Ablauf schickt nichts ab
      if (signal && signal.aborted) throw ABGEBROCHEN;
      var gemerkt = !p.cache.aus && !p.cache.refresh ? cacheLesen(schluessel, p.cache.gcTime) : null;
      if (gemerkt) return gemerkt;
      return mitAbbruch(kiZustimmung(), signal).then(function (erlaubt) {
        if (!erlaubt) throw sampleFehler('not_granted', 'Die KI wurde nicht freigegeben. Nach dem Neuladen der Seite wird wieder gefragt.');
        return kiPlatz(signal);
      }).then(function (freigeben) {
        if (signal && signal.aborted) { freigeben(); throw ABGEBROCHEN; }
        var laeuft = anfrage('/ki', {
          method: 'POST',
          body: { action: 'sample', nachrichten: e.nachrichten, json: verb === 'json', stufe: stufe },
          signal: signal
        });
        laeuft.then(freigeben, freigeben);
        return mitAbbruch(laeuft, signal);
      }).then(function (r) {
        if (!r || typeof r.text !== 'string' || !r.text.trim()) throw sampleFehler('empty_completion', 'Die KI hat keinen Text geliefert.');
        return { text: r.text, truncated: r.gekuerzt === true, modelTierApplied: SAMPLE_STUFEN.indexOf(r.stufe) >= 0 ? r.stufe : stufe };
      });
    }).then(function (ergebnis) {
      if (signal && signal.aborted) throw ABGEBROCHEN;
      textMelden(onText, ergebnis.text);
      if (signal && signal.aborted) throw sampleFehler('cancelled', 'Abgebrochen.', ergebnis.text);
      var wert;
      if (verb === 'json') {
        if (ergebnis.truncated) throw sampleFehler('invalid_json', 'Die Antwort wurde abgeschnitten, bevor das JSON vollständig war.', ergebnis.text);
        var gelesen = jsonLesen(ergebnis.text);
        if (!gelesen.ok) throw sampleFehler('invalid_json', 'Die Antwort enthält keinen lesbaren JSON-Wert.', ergebnis.text);
        wert = gelesen.wert;
      }
      if (!p.cache.aus) cacheSchreiben(schluessel, ergebnis, p.cache.gcTime);
      return verb === 'json' ? wert : { text: ergebnis.text, truncated: ergebnis.truncated, modelTierApplied: ergebnis.modelTierApplied };
    }).catch(function (err) {
      throw alsSampleFehler(err);
    });
  }

  function sample(input, optionen) { return sampleAufruf('sample', input, optionen); }
  sample.json = function (input, optionen) { return sampleAufruf('json', input, optionen); };
  sample.limits = function () {
    return Promise.resolve({ maxPromptBytes: SAMPLE_MAX_BYTES, modelTiers: SAMPLE_STUFEN.slice() });
  };
  Object.freeze(sample);

  // Ältere Artefakte: window.claude.complete(prompt) → Text der Antwort
  function complete(prompt) {
    return sampleAufruf('sample', prompt, { cache: false }).then(function (r) { return r.text; });
  }

  // ── permissions: Anmeldung regelt den Zugang; nur die KI fragt einmal nach ──
  var IMMER_ERLAUBT = ['db', 'assets', 'downloads'];
  function erlaubnis(name) {
    if (name === 'sample') return kiZustand();
    return IMMER_ERLAUBT.indexOf(name) >= 0 ? 'granted' : 'unavailable';
  }
  var permissions = {
    state: function (name) {
      if (name === undefined) {
        var alle = {};
        IMMER_ERLAUBT.concat('sample').forEach(function (n) { alle[n] = erlaubnis(n); });
        return Promise.resolve(alle);
      }
      return Promise.resolve(erlaubnis(name));
    },
    request: function (namen) {
      var liste = Array.isArray(namen) ? namen.slice() : IMMER_ERLAUBT.concat('sample');
      var fragen = liste.indexOf('sample') >= 0 && kiZustand() === 'prompt' ? kiZustimmung() : Promise.resolve();
      return fragen.then(function () {
        var r = {};
        liste.forEach(function (n) { r[n] = erlaubnis(n); });
        return r;
      });
    },
    // «Nicht jetzt» zurücknehmen: die nächste KI-Anfrage fragt wieder
    manage: function () { kiAbgelehnt = false; return Promise.resolve(); }
  };

  var speicher = {};
  var dateien = {};
  function speicherFuer(tool) {
    if (!speicher[tool]) speicher[tool] = new Speicher(tool);
    return speicher[tool];
  }
  function dateienFuer(tool) {
    if (!dateien[tool]) dateien[tool] = new Dateien(tool);
    return dateien[tool];
  }

  function use(name) {
    if (name === 'downloads') return Promise.resolve(downloads);
    if (name === 'permissions') return Promise.resolve(permissions);
    if (name === 'sample') return Promise.resolve(sample);
    if (name === 'db' || name === 'assets') {
      if (!TOOL) return Promise.reject(fehler('Kein Tool angegeben', 'unavailable'));
      // Erst anmelden, dann Daten: so lädt kein Tool mit leerem Speicher und überschreibt Gespeichertes
      return sitzungSicherstellen().then(function () { return name === 'db' ? speicherFuer(TOOL) : dateienFuer(TOOL); });
    }
    // Wie in claude.ai: was es hier nicht gibt, ergibt null (das Tool blendet die Funktion aus)
    einmalMelden('use:' + name, 'use("' + name + '") gibt es in der JV-Plattform nicht, Ergebnis null.');
    return Promise.resolve(null);
  }

  window.claude = Object.assign(window.claude || {}, { use: use, complete: complete });
  // Für die Plattform (Datenübernahme, Projekte): direkter Zugriff auf Speicher und Dateien
  window.JVBridge = {
    tool: TOOL,
    db: speicherFuer,
    assets: dateienFuer,
    anfrage: anfrage,
    anmelden: anmeldenZeigen,
    sitzungSicherstellen: sitzungSicherstellen,
    sitzungLaden: sitzungLaden,
    passwortAendern: passwortAendern,
    kiZustimmung: kiZustimmung,          // Freigabe-Fenster der KI (einmal je Browser), z. B. für assets/ki-chat.js
    benutzer: function () { return benutzer; }
  };
})();
