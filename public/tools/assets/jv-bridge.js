// jv-bridge.js — Verbindet Michis Tools mit der JV-Plattform
//
// Die Tools wurden als Claude-Artifacts gebaut und speichern über window.claude.use('db' | 'assets' |
// 'downloads' | 'permissions'). Dieses Skript stellt dieselbe Schnittstelle bereit, speichert aber in
// unserer Supabase-Datenbank (über die Netlify Functions tool-db, tool-asset, tool-blob). So bleiben die
// Tools selbst unverändert.
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
  function anfrage(pfad, optionen, wiederholt) {
    optionen = optionen || {};
    var h = { 'X-JV-Sitzung': '1' };
    if (optionen.body) h['Content-Type'] = 'application/json';
    return fetch(API + pfad, {
      method: optionen.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: h,
      body: optionen.body ? JSON.stringify(optionen.body) : undefined
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

  // ── permissions: in der Plattform immer erlaubt (Anmeldung regelt den Zugang) ──
  var permissions = {
    state: function () { return Promise.resolve('granted'); },
    request: function (namen) {
      var r = {};
      (namen || []).forEach(function (n) { r[n] = 'granted'; });
      return Promise.resolve(r);
    },
    manage: function () { return Promise.resolve(); }
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
    if (!TOOL) return Promise.reject(fehler('Kein Tool angegeben', 'unavailable'));
    // Erst anmelden, dann Daten: so lädt kein Tool mit leerem Speicher und überschreibt Gespeichertes
    if (name === 'db') return sitzungSicherstellen().then(function () { return speicherFuer(TOOL); });
    if (name === 'assets') return sitzungSicherstellen().then(function () { return dateienFuer(TOOL); });
    return Promise.reject(fehler('Nicht verfügbar: ' + name, 'unavailable'));
  }

  window.claude = Object.assign(window.claude || {}, { use: use });
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
    benutzer: function () { return benutzer; }
  };
})();
