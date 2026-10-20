# Gratis Drohnen-Rinnen-Check

Landingpage mit mehrstufigem Anmeldeformular für den kostenlosen Drohnen-Check der Dachrinne. Ziel der Instagram- und Facebook-Werbung, mobile first.

Läuft auf **derselben Netlify-Site** wie Katalog und Docs, aber unter einer eigenen Subdomain: `dachcheck.jaeggivollmer.ch` wird per Rewrite in `netlify.toml` auf den Ordner `public/dachcheck/` geleitet. Auf der Subdomain ist nur der Drohnen-Check erreichbar (Seite plus zwei Functions), Admin und Katalog nicht. Eigene Functions (`dachcheck-*`) und eigene Tabellen (`drohnencheck_*`).

```
public/dachcheck/                      → Landingpage (wird ausgeliefert)
│   ├── config.js                      → ALLE Texte, Preise, PLZ-Liste, Empfänger-Adresse
│   ├── index.html                     → Landingpage + Formular
│   ├── datenschutz.html               → Entwurf Datenschutz (juristisch prüfen)
│   ├── impressum.html
│   ├── admin.html                     → Übersicht der Anfragen (Passwort = ADMIN_PASSWORD)
│   └── assets/                        → app.js, styles.css, Logo (Original-SVG), Schriften (selbst gehostet)
netlify/functions/
│   ├── dachcheck-anfrage.js           → prüft, speichert, sendet Info-Mail
│   ├── dachcheck-warteliste.js        → E-Mail für Regionen ausserhalb des Gebiets
│   ├── dachcheck-loeschroutine.js     → läuft täglich, löscht nach 60 Tagen
│   ├── dachcheck-admin-liste.js       → Anfragen + Warteliste für die Übersicht (Admin)
│   ├── dachcheck-admin-update.js      → Status, Termin, Notiz ändern (Admin)
│   └── _lib/dachcheck.js              → Supabase- und Mail-Helfer (ohne npm-Abhängigkeiten)
supabase/migration_010_drohnencheck.sql → Tabellen, RLS, Funktionen
netlify.toml                           → Subdomain-Rewrite und Zeitplan der Löschroutine
```

## Entscheide (Robin, 20.10.2026)

| Frage | Entscheid |
|---|---|
| Wo läuft die Seite? | Subdomain `dachcheck.jaeggivollmer.ch` auf der bestehenden Netlify-Site (keine zweite Site) |
| E-Mail | Nur eine **Info-Mail ohne Personendaten** an `info@jaeggivollmer.ch` (Referenz, Zeitpunkt, Link zur Anfrage in der Übersicht). **Keine** Bestätigungsmail an Kunden |
| Übersicht | Anfragen-Übersicht unter `dachcheck.jaeggivollmer.ch/admin.html` **und** als Tab «Drohnen-Check» im Admin-Panel, gleiches Passwort |
| Speicherung | Eigene Tabellen im bestehenden Supabase-Projekt, nur via service_role |

Weitere Annahmen (nicht explizit entschieden):

| Thema | Annahme |
|---|---|
| Versanddienst | Resend (Absender `dachcheck@jaeggivollmer.ch`). Da die Mail keine Personendaten enthält, ist der Anbieter datenschutzrechtlich unkritisch |
| Logo | Original-SVG unverändert unter `public/dachcheck/assets/logo-jaeggi-vollmer.svg` |
| Technik | Statisches HTML/CSS/JS ohne Build-Schritt (wie der Rest des Repos) |
| Wunschtermine | mindestens 2, höchstens 3 Halbtage, frühestens 2 Werktage im Voraus, 3 Wochen lang |
| Rate-Limit | 5 Anfragen pro Stunde und IP (Env `DC_RATE_LIMIT`) |
| Spamschutz | Honeypot + Rate-Limit, kein Captcha (Turnstile kann später ergänzt werden) |

## Lokal starten

```bash
npx netlify-cli dev          # http://localhost:8888/dachcheck/, Functions unter /api/*
```

Für lokale Tests eine Datei `.env` im Repo-Root mit den Variablen unten anlegen (nicht committen). Ohne `RESEND_API_KEY` wird die Anfrage gespeichert, aber keine Mail versendet (Hinweis im Log).

## Einrichten und deployen

1. **Datenbank:** `supabase/migration_010_drohnencheck.sql` im Supabase SQL-Editor ausführen. Das Skript ist idempotent und fasst keine bestehenden Tabellen an. Am Ende steht ein Test, der zeigt, dass der anon-Key keinen Zugriff hat.
2. **Resend:** Konto mit Region EU anlegen, Domain `jaeggivollmer.ch` verifizieren (DNS-Einträge bei Hostpoint), API-Key erstellen.
3. **Netlify (bestehende Site):** Unter *Domain management* die Domain `dachcheck.jaeggivollmer.ch` als **Domain alias** hinzufügen. Bei Hostpoint einen CNAME `dachcheck` → `<site>.netlify.app` setzen (gleiches Ziel wie `docs`). SSL kommt automatisch.
4. **Environment Variables** in der bestehenden Site ergänzen (`SUPABASE_URL` und `SUPABASE_SERVICE_KEY` sind schon gesetzt):

   | Variable | Inhalt |
   |---|---|
   | `RESEND_API_KEY` | API-Key von Resend |
   | `DC_IP_SALT` | beliebiger langer Zufallswert (für den IP-Hash) |
   | `DC_EMPFAENGER` | optional, überschreibt die interne Empfänger-Adresse |
   | `DC_ABSENDER` | optional, überschreibt die Absender-Adresse |
   | `DC_RATE_LIMIT` | optional, Anfragen pro Stunde und IP (Standard 5) |

5. **Werbelinks** mit UTM-Parametern, z. B.
   `https://dachcheck.jaeggivollmer.ch/?utm_source=instagram&utm_medium=paid&utm_campaign=rinnencheck-herbst`
   Direkt zum Formular: `…/#anfrage`.

## Konfiguration ändern

Alles steht in **`public/dachcheck/config.js`**: Texte aller Abschnitte, FAQ, Preise, PLZ-Liste, Termin-Regeln, Empfänger- und Absender-Adresse, Meta Pixel ID. Nach dem Ändern committen und pushen, Netlify deployt automatisch.

- **Preise:** `preise.dachkontrolle`, `preise.dachkontrolleAnrechnungAb`, `preise.wartungsabo`. `null` zeigt «Preis auf Anfrage».
- **Einzugsgebiet:** `einzugsgebiet.plz`, Bereiche als `'4000-4099'`, einzelne PLZ als Zahl. Wird im Browser und nochmals auf dem Server geprüft.
- **Meta Pixel:** `tracking.metaPixelId` setzen. Erst dann erscheint der Cookie-Hinweis, und das Pixel lädt nur nach «Einverstanden». Bei erfolgreicher Anfrage wird `Lead` gesendet.

## Wo landen die Anfragen?

- **Info-Mail intern** an `email.empfaengerIntern`: nur Referenz, Zeitpunkt und Link `…/admin.html#DC-…` direkt zur Anfrage, **keine Personendaten**. Der Kunde erhält keine Mail, nur die Danke-Seite mit Referenznummer.
- **Übersicht** (`admin.html` bzw. Tab «Drohnen-Check» im Admin-Panel): Liste mit Suche und Statusfilter, Detail mit allen Angaben, Knöpfe für Anrufen, WhatsApp, E-Mail und Karte, Status, bestätigter Termin und interne Notiz änderbar, Warteliste, CSV-Export. Zeigt pro Anfrage, wann sie automatisch gelöscht wird.
- **Supabase-Tabelle `drohnencheck_anfragen`** mit Status `neu`. Status in der Übersicht nachführen: `neu → termin → geflogen → report → auftrag | abgeschlossen | abgesagt`. Die Spalte `mail_intern_ok` zeigt, ob die Info-Mail versendet wurde. Die UTM-Parameter stehen in den Spalten `utm_*`.
- **Warteliste** (PLZ ausserhalb): Tabelle `drohnencheck_warteliste`.
- **Referenznummer:** `DC-<Jahr>-<laufende Nr.>`, Zähler pro Jahr in `drohnencheck_zaehler`.

Auswertung nach Werbung, z. B. im SQL-Editor:

```sql
SELECT utm_source, utm_campaign, count(*) FROM drohnencheck_anfragen GROUP BY 1, 2 ORDER BY 3 DESC;
```

## Löschung nach 60 Tagen

- **Automatisch:** Die Function `dachcheck-loeschroutine` läuft täglich (`schedule = "@daily"`) und ruft `drohnencheck_loeschen(60)` auf. Gelöscht werden alle Anfragen älter als 60 Tage, deren Status **nicht** `auftrag` ist. IP-Hashes werden nach 7 Tagen entfernt, Wartelisten-Einträge nach 24 Monaten.
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
| `datenschutz.html` | Link zur allgemeinen Datenschutzerklärung, Supabase-Region, Garantien pro Anbieter; Entwurf-Hinweis nach der juristischen Prüfung entfernen |
| Einwilligungstext Kommunikation | Steht im Briefing in Du-Form («Ihr dürft …»), der Rest der Seite siezt. Bei Bedarf in `config.js` anpassen |

## Bilder einsetzen

Echte Fotos nach `public/dachcheck/assets/img/` legen (JPG/WebP, max. ca. 1600 px breit) und den Pfad in `config.js` unter `bilder` eintragen, z. B. `hero: 'assets/img/hero.jpg'`. Der Platzhalter und seine Beschriftung verschwinden dann automatisch.
