// sitzung.js — Anmeldung für die Plattform und die Tools (Sitzungs-Cookie)
//
// GET  /api/sitzung                               → 200 { angemeldet: true, benutzer } oder 401
// POST /api/sitzung { email, passwort, bleiben }  → setzt das Cookie (HttpOnly, Secure, SameSite=Strict)
//      Ohne E-Mail: Hauptzugang mit ADMIN_PASSWORD. Mit E-Mail: Mitarbeiter-Login (Tabelle mitarbeiter).
//      Antwort { ok, benutzer, passwortAendern } – bei passwortAendern muss zuerst ein eigenes Passwort her.
// POST /api/sitzung { aktion: 'passwort', alt, neu }   → eigenes Passwort ändern (Header X-JV-Sitzung nötig)
// POST /api/sitzung { aktion: 'abmelden' }             → löscht das Cookie
//
// Schutz gegen Durchprobieren: pro Login 5 Fehlversuche, dann 15 Minuten gesperrt; pro IP-Adresse
// (gehasht) höchstens 10 Fehlversuche in 15 Minuten (Tabelle anmelde_fehler, nach 1 Tag gelöscht).
// Die Antwort verrät nie, ob es eine E-Mail-Adresse gibt.

const a = require('./_lib/auth');
const { json, body, rest } = require('./_lib/tools');
const { ipHash } = require('./_lib/dachcheck');

const MAX_LOGIN = 5;              // Fehlversuche pro Login, dann Sperre
const SPERRE_MIN = 15;
const MAX_IP = 10;                // Fehlversuche pro IP in SPERRE_MIN Minuten
const MIN_LAENGE = 10;            // eigenes Passwort

function warten(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function oeffentlich(b) {
  return { id: b.id, name: b.name, email: b.email, rolle: b.rolle, bereiche: b.bereiche, hauptzugang: !!b.hauptzugang, passwortAendern: !!b.passwortAendern };
}

// Fehlt die Tabelle (migration_017 noch nicht ausgeführt), bleibt die Anmeldung möglich (nur ohne Zählung)
async function ipGesperrt(ip) {
  if (!ip) return false;
  const seit = new Date(Date.now() - SPERRE_MIN * 60e3).toISOString();
  try {
    const r = await rest('anmelde_fehler?select=id&ip_hash=eq.' + ip + '&erstellt=gt.' + encodeURIComponent(seit) + '&limit=' + MAX_IP);
    return (r || []).length >= MAX_IP;
  } catch (e) {
    console.error('sitzung: Fehlversuche nicht lesbar', e.message);
    return false;
  }
}

async function fehlerMerken(ip) {
  try {
    await rest('anmelde_fehler', { method: 'POST', body: { ip_hash: ip || 'unbekannt' }, prefer: 'return=minimal' });
    // Alte Einträge aufräumen (älter als 1 Tag)
    await rest('anmelde_fehler?erstellt=lt.' + encodeURIComponent(new Date(Date.now() - 864e5).toISOString()), { method: 'DELETE', prefer: 'return=minimal' });
  } catch (e) {
    console.error('sitzung: Fehlversuch nicht gespeichert', e.message);
  }
}

function passwortRegel(neu) {
  if (typeof neu !== 'string' || neu.length < MIN_LAENGE) return 'Das neue Passwort braucht mindestens ' + MIN_LAENGE + ' Zeichen.';
  if (neu.length > 200) return 'Das neue Passwort ist zu lang (höchstens 200 Zeichen).';
  if (/^(.)\1+$/.test(neu)) return 'Das neue Passwort ist zu einfach.';
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    const wer = await a.sitzungsBenutzer(event, { auchPasswortAendern: true });
    return wer ? json(200, { angemeldet: true, benutzer: oeffentlich(wer) }) : json(401, { error: 'Nicht angemeldet' });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Methode nicht erlaubt' });

  const b = body(event);
  if (!b) return json(400, { error: 'Ungültiges JSON' });

  if (b.aktion === 'abmelden') {
    return json(200, { ok: true }, { 'Set-Cookie': a.sitzungsCookieLoeschen() });
  }

  if (!process.env.ADMIN_PASSWORD) return json(500, { error: 'ADMIN_PASSWORD ist nicht gesetzt' });

  try {
    // ── Eigenes Passwort ändern ──
    if (b.aktion === 'passwort') {
      if (!a.sitzungsHeader(event)) return json(401, { error: 'Nicht angemeldet' });
      const wer = await a.sitzungsBenutzer(event, { auchPasswortAendern: true });
      if (!wer) return json(401, { error: 'Nicht angemeldet' });
      if (wer.hauptzugang) return json(400, { error: 'Das Hauptpasswort wird in Netlify geändert (Variable ADMIN_PASSWORD).' });
      const regel = passwortRegel(b.neu);
      if (regel) return json(400, { error: regel });
      // Auch hier zählen Fehlversuche (sonst liesse sich mit einer offenen Sitzung das Passwort durchprobieren)
      const ipP = ipHash(event);
      if (await ipGesperrt(ipP)) {
        return json(429, { error: 'Zu viele Fehlversuche. Bitte in ' + SPERRE_MIN + ' Minuten erneut versuchen.' });
      }
      const zeilen = await rest('mitarbeiter?select=id,passwort_hash,sitzung_version&id=eq.' + wer.id);
      const m = zeilen && zeilen[0];
      if (!m || !(await a.passwortPruefen(b.alt, m.passwort_hash))) {
        await fehlerMerken(ipP);
        await warten(400);
        return json(400, { error: 'Das bisherige Passwort stimmt nicht.' });
      }
      if (b.neu === b.alt) return json(400, { error: 'Bitte ein anderes Passwort als bisher wählen.' });
      const version = Number(m.sitzung_version) + 1;
      await rest('mitarbeiter?id=eq.' + wer.id, {
        method: 'PATCH',
        body: { passwort_hash: await a.passwortHash(b.neu), muss_passwort_aendern: false, sitzung_version: version },
        prefer: 'return=minimal'
      });
      // Andere Geräte sind damit abgemeldet, dieses bleibt angemeldet
      const s = a.sitzungErstellen(wer.id, version, wer.sitzung && wer.sitzung.lang);
      wer.passwortAendern = false;
      return json(200, { ok: true, benutzer: oeffentlich(wer) }, { 'Set-Cookie': s.cookie });
    }

    // ── Anmelden ──
    const ip = ipHash(event);
    if (await ipGesperrt(ip)) {
      return json(429, { error: 'Zu viele Fehlversuche. Bitte in ' + SPERRE_MIN + ' Minuten erneut versuchen.' });
    }
    const passwort = typeof b.passwort === 'string' ? b.passwort : '';
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const bleiben = b.bleiben === true;

    if (!email) {
      if (!a.passwortOk(passwort)) {
        await fehlerMerken(ip);
        await warten(400);
        return json(401, { error: 'Passwort falsch' });
      }
      const s = a.sitzungErstellen('admin', 0, bleiben);
      return json(200, { ok: true, bis: s.ablauf, benutzer: oeffentlich(a.hauptzugang()) }, { 'Set-Cookie': s.cookie });
    }

    if (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      await a.passwortPruefen(passwort, '');      // gleiche Antwortzeit
      await fehlerMerken(ip);
      return json(401, { error: 'E-Mail oder Passwort falsch' });
    }
    const zeilen = await rest('mitarbeiter?select=id,email,name,rolle,bereiche,aktiv,sitzung_version,muss_passwort_aendern,passwort_hash,fehlversuche,gesperrt_bis&email=eq.' + encodeURIComponent(email));
    const m = zeilen && zeilen[0];
    if (m && m.gesperrt_bis && new Date(m.gesperrt_bis).getTime() > Date.now()) {
      return json(429, { error: 'Zu viele Fehlversuche für dieses Login. Bitte in ' + SPERRE_MIN + ' Minuten erneut versuchen.' });
    }
    const ok = await a.passwortPruefen(passwort, m ? m.passwort_hash : '');
    if (!m || !ok || m.aktiv !== true) {
      await fehlerMerken(ip);
      if (m && !ok) {
        const n = Number(m.fehlversuche || 0) + 1;
        await rest('mitarbeiter?id=eq.' + m.id, {
          method: 'PATCH',
          body: n >= MAX_LOGIN
            ? { fehlversuche: 0, gesperrt_bis: new Date(Date.now() + SPERRE_MIN * 60e3).toISOString() }
            : { fehlversuche: n },
          prefer: 'return=minimal'
        });
      }
      await warten(300);
      // Gesperrtes Login: erst nach richtigem Passwort sagen (verrät sonst, dass es die Adresse gibt)
      if (m && ok && m.aktiv !== true) return json(403, { error: 'Dieses Login ist gesperrt. Bitte bei Jäggi Vollmer melden.' });
      return json(401, { error: 'E-Mail oder Passwort falsch' });
    }
    await rest('mitarbeiter?id=eq.' + m.id, {
      method: 'PATCH',
      body: { fehlversuche: 0, gesperrt_bis: null, letzte_anmeldung: new Date().toISOString() },
      prefer: 'return=minimal'
    });
    const s = a.sitzungErstellen(m.id, Number(m.sitzung_version), bleiben);
    const wer = a.benutzerAus(m);
    return json(200, { ok: true, bis: s.ablauf, benutzer: oeffentlich(wer), passwortAendern: wer.passwortAendern }, { 'Set-Cookie': s.cookie });
  } catch (err) {
    console.error('sitzung', err);
    return json(500, { error: 'Anmeldung zurzeit nicht möglich' });
  }
};
