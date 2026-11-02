// zugaenge.js — Logins für Mitarbeiterinnen und Mitarbeiter verwalten (nur Admins)
//
// GET  /api/zugaenge                                                → { logins, bereiche }
// POST /api/zugaenge { aktion: 'anlegen', email, name, rolle, bereiche }   → { login, passwort }
// POST /api/zugaenge { aktion: 'aendern', id, name?, email?, rolle?, bereiche?, aktiv? } → { login }
// POST /api/zugaenge { aktion: 'passwort', id }                     → { login, passwort }  (neues Startpasswort)
// POST /api/zugaenge { aktion: 'loeschen', id }                     → { ok }
//
// Das Startpasswort steht nur in dieser einen Antwort (gespeichert wird nur der scrypt-Hash). Beim ersten
// Login muss die Person ein eigenes Passwort setzen. Sperren, neues Passwort, andere Rolle oder Bereiche
// beenden alle laufenden Sitzungen der Person (sitzung_version + 1).

const a = require('./_lib/auth');
const { json, body, rest } = require('./_lib/tools');

const FELDER = 'id,email,name,rolle,bereiche,aktiv,muss_passwort_aendern,letzte_anmeldung,gesperrt_bis,erstellt,geaendert,sitzung_version';

function emailPruefen(email) {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!e || e.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return null;
  return e;
}

function nameText(name) {
  const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  return n && n.length <= 120 ? n : null;
}

function bereicheListe(liste) {
  if (!Array.isArray(liste)) return null;
  const aus = [];
  liste.forEach((b) => { if (a.BEREICHE[b] && aus.indexOf(b) < 0) aus.push(b); });
  return aus;
}

function ausgabe(m) {
  return {
    id: m.id, email: m.email, name: m.name, rolle: m.rolle, bereiche: m.bereiche || [], aktiv: m.aktiv,
    passwortAendern: m.muss_passwort_aendern, letzteAnmeldung: m.letzte_anmeldung,
    gesperrtBis: m.gesperrt_bis && new Date(m.gesperrt_bis).getTime() > Date.now() ? m.gesperrt_bis : null,
    erstellt: m.erstellt, geaendert: m.geaendert
  };
}

function doppelt(err) {
  return /\b409\b|23505|duplicate key/i.test(String(err && err.message));
}

async function lesen(id) {
  if (!a.UUID_RE.test(String(id || ''))) return null;
  const r = await rest('mitarbeiter?select=' + FELDER + '&id=eq.' + id);
  return (r && r[0]) || null;
}

exports.handler = async (event) => {
  const wer = await a.anmeldung(event);
  if (!wer) return json(401, { error: 'Nicht angemeldet', code: 'not_granted' });
  if (!a.darf(wer, a.VERWALTUNG)) return json(403, { error: 'Logins verwalten können nur Admins.' });

  try {
    if (event.httpMethod === 'GET') {
      const r = await rest('mitarbeiter?select=' + FELDER + '&order=name.asc');
      return json(200, { logins: (r || []).map(ausgabe), bereiche: a.BEREICHE, ich: wer.id });
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Methode nicht erlaubt' });
    const b = body(event);
    if (!b) return json(400, { error: 'Ungültiges JSON' });

    if (b.aktion === 'anlegen') {
      const email = emailPruefen(b.email);
      const name = nameText(b.name);
      if (!name) return json(400, { error: 'Bitte einen Namen angeben (höchstens 120 Zeichen).' });
      if (!email) return json(400, { error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
      const rolle = b.rolle === 'admin' ? 'admin' : 'mitarbeiter';
      const bereiche = bereicheListe(b.bereiche) || Object.keys(a.BEREICHE);
      const passwort = a.startpasswort();
      let neu;
      try {
        neu = await rest('mitarbeiter', {
          method: 'POST',
          body: { email, name, rolle, bereiche, passwort_hash: await a.passwortHash(passwort), muss_passwort_aendern: true }
        });
      } catch (err) {
        if (doppelt(err)) return json(409, { error: 'Für diese E-Mail-Adresse gibt es schon ein Login.' });
        throw err;
      }
      return json(200, { login: ausgabe(neu[0]), passwort });
    }

    const m = await lesen(b.id);
    if (!m) return json(404, { error: 'Login nicht gefunden' });
    const selbst = wer.id === m.id;

    if (b.aktion === 'aendern') {
      const felder = {};
      let abmelden = false;
      if (b.name !== undefined) {
        const name = nameText(b.name);
        if (!name) return json(400, { error: 'Bitte einen Namen angeben (höchstens 120 Zeichen).' });
        felder.name = name;
      }
      if (b.email !== undefined) {
        const email = emailPruefen(b.email);
        if (!email) return json(400, { error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
        if (email !== m.email) { felder.email = email; abmelden = true; }
      }
      if (b.rolle !== undefined) {
        const rolle = b.rolle === 'admin' ? 'admin' : 'mitarbeiter';
        if (selbst && rolle !== 'admin') return json(400, { error: 'Die eigene Admin-Rolle kann man sich nicht selbst wegnehmen.' });
        if (rolle !== m.rolle) { felder.rolle = rolle; abmelden = true; }
      }
      if (b.bereiche !== undefined) {
        const bereiche = bereicheListe(b.bereiche);
        if (!bereiche) return json(400, { error: 'Ungültige Bereiche' });
        if (bereiche.slice().sort().join() !== (m.bereiche || []).slice().sort().join()) { felder.bereiche = bereiche; abmelden = true; }
      }
      if (b.aktiv !== undefined) {
        const aktiv = b.aktiv === true;
        if (selbst && !aktiv) return json(400, { error: 'Das eigene Login kann man nicht selbst sperren.' });
        if (aktiv !== m.aktiv) {
          felder.aktiv = aktiv;
          if (!aktiv) abmelden = true;
          else { felder.fehlversuche = 0; felder.gesperrt_bis = null; }
        }
      }
      if (b.entsperren === true) { felder.fehlversuche = 0; felder.gesperrt_bis = null; }
      if (!Object.keys(felder).length) return json(200, { login: ausgabe(m) });
      if (abmelden) felder.sitzung_version = Number(m.sitzung_version) + 1;
      let r;
      try {
        r = await rest('mitarbeiter?id=eq.' + m.id + '&select=' + FELDER, { method: 'PATCH', body: felder });
      } catch (err) {
        if (doppelt(err)) return json(409, { error: 'Für diese E-Mail-Adresse gibt es schon ein Login.' });
        throw err;
      }
      return json(200, { login: ausgabe(r[0]), abgemeldet: abmelden });
    }

    if (b.aktion === 'passwort') {
      if (selbst) return json(400, { error: 'Das eigene Passwort bitte über «Passwort ändern» setzen.' });
      const passwort = a.startpasswort();
      const r = await rest('mitarbeiter?id=eq.' + m.id + '&select=' + FELDER, {
        method: 'PATCH',
        body: {
          passwort_hash: await a.passwortHash(passwort), muss_passwort_aendern: true,
          sitzung_version: Number(m.sitzung_version) + 1, fehlversuche: 0, gesperrt_bis: null
        }
      });
      return json(200, { login: ausgabe(r[0]), passwort });
    }

    if (b.aktion === 'loeschen') {
      if (selbst) return json(400, { error: 'Das eigene Login kann man nicht selbst löschen.' });
      await rest('mitarbeiter?id=eq.' + m.id, { method: 'DELETE', prefer: 'return=minimal' });
      return json(200, { ok: true });
    }

    return json(400, { error: 'Unbekannte Aktion' });
  } catch (err) {
    console.error('zugaenge', err);
    if (/mitarbeiter/.test(String(err.message)) && /\b404\b|42P01|does not exist|schema cache/i.test(String(err.message))) {
      return json(500, { error: 'Die Tabelle «mitarbeiter» fehlt noch. Bitte migration_017_mitarbeiter.sql in Supabase ausführen.' });
    }
    return json(500, { error: 'Logins konnten nicht gespeichert werden' });
  }
};
