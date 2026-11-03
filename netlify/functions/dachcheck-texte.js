// dachcheck-texte.js — Textvorlagen und KI-Textkorrektur für den Bericht (POST, Admin)
//
//   'vorlagen'          → Vorschläge (fest im Code) und eigene Vorlagen (drohnencheck_einstellungen)
//   'vorlage-speichern' → eigene Vorlage anlegen { feld, titel, text }
//   'vorlage-loeschen'  → eigene Vorlage löschen oder Vorschlag ausblenden { id }
//   'ki'                → Text korrigieren oder umschreiben { modus, feld, text, ampel }
//
// Die KI-Funktion schickt nur den Text des Feldes an Anthropic (USA), keine Namen, Adressen
// oder Bilder. Im Admin steht der Hinweis, keine Personendaten in den Text zu schreiben.
const crypto = require('crypto');
const { antwort, rest } = require('./_lib/dachcheck');
const { anmeldung } = require('./_lib/auth');
const ki = require('./_lib/ki');

const SCHLUESSEL = 'textbausteine';
const FELDER = ['zusammenfassung', 'empfehlung'];
const MAX_TEXT = 3000;
const MAX_TITEL = 60;
const MAX_EIGENE = 200;

// Klassische Texte als Startpunkt (Befund = zusammenfassung)
const VORSCHLAEGE = [
  { id: 'v-b-frei', feld: 'zusammenfassung', titel: 'Alles frei', text: 'Die Rinnen und Abläufe sind frei von Laub und Schmutz. Wir haben keine Schäden gesehen, das Regenwasser kann ungehindert abfliessen.' },
  { id: 'v-b-leicht', feld: 'zusammenfassung', titel: 'Leichte Verschmutzung', text: 'In den Rinnen liegt etwas Laub und Schmutz. Die Abläufe sind noch offen, das Wasser kann zurzeit abfliessen.' },
  { id: 'v-b-laub', feld: 'zusammenfassung', titel: 'Viel Laub in der Rinne', text: 'In einem Teil der Rinnen hat sich viel Laub angesammelt. Bei starkem Regen kann das Wasser über den Rinnenrand laufen.' },
  { id: 'v-b-verstopft', feld: 'zusammenfassung', titel: 'Ablauf verstopft', text: 'Mindestens ein Ablauf ist verstopft. Das Regenwasser staut sich in der Rinne und kann über den Rand laufen oder an der Fassade herunterlaufen.' },
  { id: 'v-b-bewuchs', feld: 'zusammenfassung', titel: 'Bewuchs (Moos, Pflanzen)', text: 'In der Rinne wachsen Moos und kleine Pflanzen. Sie halten Schmutz und Wasser zurück und können den Ablauf mit der Zeit verstopfen.' },
  { id: 'v-b-gefaelle', feld: 'zusammenfassung', titel: 'Wasser steht in der Rinne', text: 'In der Rinne steht Wasser. Das deutet auf ein ungenügendes Gefälle oder eine abgesenkte Rinne hin.' },
  { id: 'v-b-schaden', feld: 'zusammenfassung', titel: 'Rinne beschädigt', text: 'An der Rinne haben wir eine Beschädigung gesehen (Delle, Riss oder undichte Verbindung). Dort kann Wasser austreten und die Fassade oder das Dach durchnässen.' },
  { id: 'v-b-halter', feld: 'zusammenfassung', titel: 'Rinnenhalter locker', text: 'Einzelne Rinnenhalter scheinen locker oder verbogen. Die Rinne hängt an dieser Stelle durch.' },
  { id: 'v-b-korrosion', feld: 'zusammenfassung', titel: 'Korrosion', text: 'An der Rinne sind Rost- oder Korrosionsspuren sichtbar. Noch ist sie dicht, das Material ist aber gealtert.' },
  { id: 'v-b-teilweise', feld: 'zusammenfassung', titel: 'Nicht alles einsehbar', text: 'Ein Teil der Rinnen war wegen Bäumen oder Dachaufbauten aus der Luft nicht einsehbar. Unsere Einschätzung bezieht sich auf die sichtbaren Bereiche.' },

  { id: 'v-e-nichts', feld: 'empfehlung', titel: 'Nichts zu tun', text: 'Zurzeit ist nichts zu tun. Wir empfehlen, die Rinnen in etwa zwei Jahren wieder kontrollieren zu lassen.' },
  { id: 'v-e-beobachten', feld: 'empfehlung', titel: 'In 6 bis 12 Monaten wieder schauen', text: 'Eine Reinigung ist noch nicht nötig. Wir empfehlen, die Rinnen in 6 bis 12 Monaten wieder anzuschauen, am besten nach dem Laubfall.' },
  { id: 'v-e-reinigen', feld: 'empfehlung', titel: 'Reinigung empfohlen', text: 'Wir empfehlen, die Rinnen und Abläufe reinigen zu lassen, am besten vor dem nächsten Winter. Gerne machen wir Ihnen dafür eine Offerte.' },
  { id: 'v-e-dringend', feld: 'empfehlung', titel: 'Bald reinigen', text: 'Wir empfehlen, die Rinnen und Abläufe möglichst bald reinigen zu lassen, damit kein Wasser an die Fassade oder ins Gebäude gelangt. Gerne machen wir Ihnen dafür eine Offerte.' },
  { id: 'v-e-laubschutz', feld: 'empfehlung', titel: 'Laubschutz prüfen', text: 'Wegen der Bäume in der Nähe lohnt sich ein Laubschutz auf der Rinne. So bleibt sie länger frei und muss seltener gereinigt werden.' },
  { id: 'v-e-reparatur', feld: 'empfehlung', titel: 'Reparatur durch Spengler', text: 'Wir empfehlen, die beschädigte Stelle von unserem Spengler vor Ort anschauen und reparieren zu lassen. Gerne vereinbaren wir mit Ihnen einen Termin.' },
  { id: 'v-e-ersatz', feld: 'empfehlung', titel: 'Ersatz der Rinne', text: 'Die Rinne ist am Ende ihrer Lebensdauer. Mittelfristig empfehlen wir einen Ersatz. Gerne beraten wir Sie vor Ort und erstellen eine Offerte.' },
  { id: 'v-e-vorort', feld: 'empfehlung', titel: 'Kontrolle vor Ort', text: 'Aus der Luft lässt sich nicht alles beurteilen. Wir empfehlen eine kurze Kontrolle vor Ort durch unseren Spengler.' }
];

async function gespeichert() {
  const r = await rest('drohnencheck_einstellungen?schluessel=eq.' + SCHLUESSEL + '&select=wert');
  const w = (r && r[0] && r[0].wert) || {};
  return { eigene: Array.isArray(w.eigene) ? w.eigene : [], ausgeblendet: Array.isArray(w.ausgeblendet) ? w.ausgeblendet : [] };
}

async function speichern(wert) {
  await rest('drohnencheck_einstellungen?on_conflict=schluessel', {
    method: 'POST',
    body: { schluessel: SCHLUESSEL, wert },
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

function liste(w) {
  const vorschlaege = VORSCHLAEGE.filter((v) => w.ausgeblendet.indexOf(v.id) < 0).map((v) => ({ ...v, eigene: false }));
  return vorschlaege.concat(w.eigene.map((v) => ({ ...v, eigene: true })));
}

// ── KI ────────────────────────────────────────────────────────────────
// Die Anfrage an Claude macht der gemeinsame KI-Zugang (_lib/ki.js, offizielles SDK von Anthropic).
const AMPEL_TEXT = { gut: 'Gut (nichts zu tun)', beobachten: 'Beobachten', handlung: 'Handlungsbedarf' };

async function kiText(modus, feld, text, ampel) {
  const wofuer = feld === 'empfehlung' ? 'die Empfehlung' : 'den Befund';
  try {
    const r = await ki.textUeberarbeiten({
      modus,
      text,
      kontext: 'Du überarbeitest ' + wofuer + ' in einem kurzen Kundenbericht einer Spenglerei in Basel. ' +
        'Der Projektleiter hat die Dachrinnen und Abläufe eines Hauses mit einer Drohne optisch kontrolliert.' +
        (AMPEL_TEXT[ampel] ? ' Die Ampel im Bericht steht auf «' + AMPEL_TEXT[ampel] + '».' : ''),
      umschreiben: 'Formuliere den Text klar, freundlich und fachlich korrekt um, in zwei bis vier kurzen Sätzen. ' +
        'Schreib verständlich für Hausbesitzer ohne Fachwissen. Füge keine Fakten, Masse, Preise oder Fristen hinzu, die nicht im Text stehen.'
    });
    return { status: 200, body: r };
  } catch (e) {
    if (e instanceof ki.KiFehler) return { status: e.status, body: { error: e.message, code: e.code } };
    throw e;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return antwort(405, { error: 'Methode nicht erlaubt' });
  if (!(await anmeldung(event, 'anfragen'))) return antwort(401, { error: 'Nicht autorisiert' });

  let b;
  try {
    b = JSON.parse(event.body || '{}');
  } catch (e) {
    return antwort(400, { error: 'Ungültige Anfrage' });
  }

  try {
    switch (b.action) {
      case 'vorlagen':
        return antwort(200, { vorlagen: liste(await gespeichert()) });

      case 'vorlage-speichern': {
        const feld = String(b.feld || '');
        const text = String(b.text || '').trim();
        const titel = String(b.titel || '').trim().slice(0, MAX_TITEL);
        if (FELDER.indexOf(feld) < 0) return antwort(400, { error: 'Ungültiges Feld' });
        if (!text) return antwort(400, { error: 'Der Text ist leer' });
        if (text.length > MAX_TEXT) return antwort(400, { error: 'Der Text ist zu lang (max. ' + MAX_TEXT + ' Zeichen)' });
        const w = await gespeichert();
        if (w.eigene.length >= MAX_EIGENE) return antwort(400, { error: 'Zu viele Vorlagen. Bitte zuerst alte löschen.' });
        w.eigene.push({ id: 'e-' + crypto.randomBytes(6).toString('hex'), feld, titel: titel || text.slice(0, 40), text });
        await speichern(w);
        return antwort(200, { vorlagen: liste(w) });
      }

      case 'vorlage-loeschen': {
        const id = String(b.id || '');
        const w = await gespeichert();
        if (VORSCHLAEGE.some((v) => v.id === id)) {
          if (w.ausgeblendet.indexOf(id) < 0) w.ausgeblendet.push(id);
        } else {
          const vorher = w.eigene.length;
          w.eigene = w.eigene.filter((v) => v.id !== id);
          if (w.eigene.length === vorher) return antwort(404, { error: 'Vorlage nicht gefunden' });
        }
        await speichern(w);
        return antwort(200, { vorlagen: liste(w) });
      }

      case 'vorschlaege-zuruecksetzen': {
        const w = await gespeichert();
        w.ausgeblendet = [];
        await speichern(w);
        return antwort(200, { vorlagen: liste(w) });
      }

      case 'ki': {
        const modus = b.modus === 'korrigieren' ? 'korrigieren' : b.modus === 'umschreiben' ? 'umschreiben' : '';
        const feld = String(b.feld || '');
        const text = String(b.text || '').trim();
        if (!modus) return antwort(400, { error: 'Ungültiger Modus' });
        if (FELDER.indexOf(feld) < 0) return antwort(400, { error: 'Ungültiges Feld' });
        if (!text) return antwort(400, { error: 'Bitte zuerst einen Text eingeben' });
        if (text.length > MAX_TEXT) return antwort(400, { error: 'Der Text ist zu lang (max. ' + MAX_TEXT + ' Zeichen)' });
        const r = await kiText(modus, feld, text, String(b.ampel || ''));
        return antwort(r.status, r.body);
      }

      default:
        return antwort(400, { error: 'Unbekannte Aktion' });
    }
  } catch (err) {
    console.error(err);
    return antwort(500, { error: 'Texte konnten nicht verarbeitet werden' });
  }
};
