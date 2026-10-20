# Gratis Drohnen-Rinnen-Check

Landingpage mit mehrstufigem Anmeldeformular für den kostenlosen Drohnen-Check der Dachrinne. Ziel der Instagram- und Facebook-Werbung, mobile first.

Läuft **komplett getrennt** vom Katalog, Kundenportal und Dokumenten-Viewer im Root dieses Repos: eigener Ordner, eigene Netlify-Site, eigene `netlify.toml`, eigene Functions und eigene Tabellen (`drohnencheck_*`). Keine gemeinsamen Dateien.

```
drohnen-check/
├── netlify.toml                 → Konfiguration der eigenen Netlify-Site
├── public/                      → wird ausgeliefert
│   ├── config.js                → ALLE Texte, Preise, PLZ-Liste, Empfänger-Adresse
│   ├── index.html               → Landingpage + Formular
│   ├── datenschutz.html         → Entwurf Datenschutz (juristisch prüfen)
│   ├── impressum.html
│   └── assets/                  → app.js, styles.css, Logo (Original-SVG), Schriften (selbst gehostet)
├── netlify/
│   ├── functions/
│   │   ├── anfrage.js           → prüft, speichert, versendet beide Mails
│   │   ├── warteliste.js        → E-Mail für Regionen ausserhalb des Gebiets
│   │   └── loeschroutine.js     → läuft täglich, löscht nach 60 Tagen
│   └── lib/gemeinsam.js         → Supabase- und Mail-Helfer (ohne npm-Abhängigkeiten)
└── supabase/001_drohnencheck.sql → Tabellen, RLS, Funktionen
```

## Getroffene Annahmen

Robin hat die Fragen aus dem Briefing noch nicht beantwortet. Bis dahin gelten diese Standardwahlen:

| Frage | Annahme |
|---|---|
| Wo läuft die Seite? | Eigene Subdomain `dachcheck.jaeggivollmer.ch` als separate Netlify-Site (Base directory `drohnen-check`) |
| E-Mail-Versand | Resend mit EU-Region, Absender `dachcheck@jaeggivollmer.ch` |
| Empfänger interne Mail | `info@jaeggivollmer.ch` |
| Speicherung | Eigene Tabellen im bestehenden Supabase-Projekt (EU), nur via service_role |
| Logo | Original-SVG unverändert unter `public/assets/logo-jaeggi-vollmer.svg` |
| Technik | Statisches HTML/CSS/JS ohne Build-Schritt (wie der Rest des Repos) |
| Wunschtermine | mindestens 2, höchstens 3 Halbtage, frühestens 2 Werktage im Voraus, 3 Wochen lang |
| Rate-Limit | 5 Anfragen pro Stunde und IP (Env `DC_RATE_LIMIT`) |
| Spamschutz | Honeypot + Rate-Limit, kein Captcha (Turnstile kann später ergänzt werden) |

## Lokal starten

```bash
cd drohnen-check
npx netlify-cli dev          # http://localhost:8888, Functions unter /api/*
```

Für lokale Tests eine Datei `drohnen-check/.env` mit den Variablen unten anlegen (nicht committen). Ohne `RESEND_API_KEY` wird die Anfrage gespeichert, aber keine Mail versendet (Hinweis im Log).

## Einrichten und deployen

1. **Datenbank:** `supabase/001_drohnencheck.sql` im Supabase SQL-Editor ausführen. Das Skript ist idempotent und fasst keine bestehenden Tabellen an. Am Ende steht ein Test, der zeigt, dass der anon-Key keinen Zugriff hat.
2. **Resend:** Konto mit Region EU anlegen, Domain `jaeggivollmer.ch` verifizieren (DNS-Einträge bei Hostpoint), API-Key erstellen.
3. **Netlify:** Neue Site aus diesem Repo anlegen, **Base directory = `drohnen-check`**. Publish und Functions kommen aus `drohnen-check/netlify.toml`.
4. **Environment Variables** in der neuen Site setzen:

   | Variable | Inhalt |
   |---|---|
   | `SUPABASE_URL` | `https://<projekt>.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | service_role-Key (geheim) |
   | `RESEND_API_KEY` | API-Key von Resend |
   | `DC_IP_SALT` | beliebiger langer Zufallswert (für den IP-Hash) |
   | `DC_EMPFAENGER` | optional, überschreibt die interne Empfänger-Adresse |
   | `DC_ABSENDER` | optional, überschreibt die Absender-Adresse |
   | `DC_RATE_LIMIT` | optional, Anfragen pro Stunde und IP (Standard 5) |

5. **Domain:** In Netlify die Domain `dachcheck.jaeggivollmer.ch` hinzufügen, bei Hostpoint einen CNAME `dachcheck` → `<site>.netlify.app` setzen. SSL kommt automatisch.
6. **Werbelinks** mit UTM-Parametern, z. B.
   `https://dachcheck.jaeggivollmer.ch/?utm_source=instagram&utm_medium=paid&utm_campaign=rinnencheck-herbst`
   Direkt zum Formular: `…/#anfrage`.

## Konfiguration ändern

Alles steht in **`public/config.js`**: Texte aller Abschnitte, FAQ, Preise, PLZ-Liste, Termin-Regeln, Empfänger- und Absender-Adresse, Meta Pixel ID. Nach dem Ändern committen und pushen, Netlify deployt automatisch.

- **Preise:** `preise.dachkontrolle`, `preise.dachkontrolleAnrechnungAb`, `preise.wartungsabo`. `null` zeigt «Preis auf Anfrage».
- **Einzugsgebiet:** `einzugsgebiet.plz`, Bereiche als `'4000-4099'`, einzelne PLZ als Zahl. Wird im Browser und nochmals auf dem Server geprüft.
- **Meta Pixel:** `tracking.metaPixelId` setzen. Erst dann erscheint der Cookie-Hinweis, und das Pixel lädt nur nach «Einverstanden». Bei erfolgreicher Anfrage wird `Lead` gesendet.

## Wo landen die Anfragen?

- **E-Mail an den Kunden** mit Referenznummer, Zusammenfassung, nächsten Schritten.
- **E-Mail intern** an `email.empfaengerIntern`: alle Angaben, Referenz im Betreff, Link zu Google Maps, UTM-Parameter.
- **Supabase-Tabelle `drohnencheck_anfragen`** mit Status `neu`. Status im Table Editor nachführen: `neu → termin → geflogen → report → auftrag | abgeschlossen | abgesagt`. Die Spalten `mail_kunde_ok` und `mail_intern_ok` zeigen, ob der Versand geklappt hat.
- **Warteliste** (PLZ ausserhalb): Tabelle `drohnencheck_warteliste`.
- **Referenznummer:** `DC-<Jahr>-<laufende Nr.>`, Zähler pro Jahr in `drohnencheck_zaehler`.

Auswertung nach Werbung, z. B. im SQL-Editor:

```sql
SELECT utm_source, utm_campaign, count(*) FROM drohnencheck_anfragen GROUP BY 1, 2 ORDER BY 3 DESC;
```

## Löschung nach 60 Tagen

- **Automatisch:** Die Function `loeschroutine` läuft täglich (`schedule = "@daily"`) und ruft `drohnencheck_loeschen(60)` auf. Gelöscht werden alle Anfragen älter als 60 Tage, deren Status **nicht** `auftrag` ist. IP-Hashes werden nach 7 Tagen entfernt, Wartelisten-Einträge nach 24 Monaten.
- **Wichtig:** Wird aus einer Anfrage ein Auftrag, Status auf `auftrag` setzen, sonst wird sie gelöscht.
- **Drohnenaufnahmen** liegen nicht in dieser Datenbank. Sie müssen manuell gelöscht werden: einmal pro Woche den Ordner der Aufnahmen prüfen und alles löschen, was älter als 60 Tage ist und zu keiner Anfrage mit Status `auftrag` gehört.
- **Manuell** geht es auch im SQL-Editor: `SELECT drohnencheck_loeschen(60);`

## Platzhalter, die noch fehlen

| Wo | Was |
|---|---|
| `config.js` → `preise` | Preis Dachkontrolle, Anrechnungsgrenze, Preis Wartungsabo |
| `config.js` → `firma.uid` | UID-Nummer |
| `config.js` → `tracking.metaPixelId` | Meta Pixel ID (leer = kein Tracking) |
| `config.js` → `email.absenderAdresse` | Absender bestätigen, Domain bei Resend verifizieren |
| `config.js` → `einzugsgebiet.plz` | Startliste BS/BL prüfen (Grenzgemeinden zu SO/AG) |
| `config.js` → `bilder.hero` | Drohnenaufnahme eines Daches |
| `config.js` → `bilder.report` | Bild des Muster-PDFs (zurzeit nachgebaute Vorschau) |
| `config.js` → `bilder.team` | Teamfoto |
| `impressum.html` | UID, vertretungsberechtigte Person |
| `datenschutz.html` | Link zur allgemeinen Datenschutzerklärung, Supabase-Region, Angaben Resend, Garantien pro Anbieter; Entwurf-Hinweis nach der juristischen Prüfung entfernen |
| Einwilligungstext Kommunikation | Steht im Briefing in Du-Form («Ihr dürft …»), der Rest der Seite siezt. Bei Bedarf in `config.js` anpassen |

## Bilder einsetzen

Echte Fotos nach `public/assets/img/` legen (JPG/WebP, max. ca. 1600 px breit) und den Pfad in `config.js` unter `bilder` eintragen, z. B. `hero: 'assets/img/hero.jpg'`. Der Platzhalter und seine Beschriftung verschwinden dann automatisch.
