# Gratis Drohnen-Rinnen-Check

Schlanke Landingpage mit einseitigem Anmeldeformular für den kostenlosen Drohnen-Check der Dachrinne, Ziel der Instagram- und Facebook-Werbung, mobile first. Der Kurzbericht für den Kunden wird direkt im Admin erstellt (Texte, Ampel, Fotos) und per persönlichem Link verschickt.

Läuft auf **derselben Netlify-Site** wie Katalog und Docs, aber unter einer eigenen Subdomain: `dachcheck.jaeggivollmer.ch` wird per Rewrite in `netlify.toml` auf den Ordner `public/dachcheck/` geleitet. Auf der Subdomain ist nur der Drohnen-Check erreichbar (Seite, Bericht, Übersicht und die `dachcheck-*`-Functions), Admin-Panel und Katalog nicht. Eigene Functions (`dachcheck-*`) und eigene Tabellen (`drohnencheck_*`).

```
public/dachcheck/                      → Landingpage (wird ausgeliefert)
│   ├── config.js                      → ALLE Texte, PLZ-Liste, Empfänger-Adresse
│   ├── index.html                     → Landingpage + Formular (eine Seite)
│   ├── bericht.html                   → Kundenansicht des Berichts (bericht.html?t=TOKEN)
│   ├── datenschutz.html               → Entwurf Datenschutz (juristisch prüfen)
│   ├── impressum.html
│   ├── admin.html                     → Übersicht der Anfragen (Passwort = ADMIN_PASSWORD)
│   └── assets/                        → app.js, admin.js, bericht.js, CSS, Logo (Original-SVG), Schriften (selbst gehostet)
netlify/functions/
│   ├── dachcheck-anfrage.js           → prüft, speichert, sendet Info-Mail
│   ├── dachcheck-warteliste.js        → E-Mail für Regionen ausserhalb des Gebiets
│   ├── dachcheck-loeschroutine.js     → läuft täglich, löscht nach 60 Tagen
│   ├── dachcheck-admin-liste.js       → Anfragen + Warteliste für die Übersicht (Admin)
│   ├── dachcheck-admin-update.js      → Status, Termin, Notiz ändern (Admin)
│   ├── dachcheck-bericht.js           → Bericht erstellen, Bilder hochladen, veröffentlichen (Admin)
│   ├── dachcheck-bericht-ansehen.js   → veröffentlichten Bericht für den Kunden ausliefern
│   ├── dachcheck-admin-medien.js      → Titelvideo importieren, ersetzen, entfernen (Admin)
│   ├── dachcheck-medien.js            → aktuelles Titelvideo für die Landingpage
│   └── _lib/dachcheck.js              → Supabase-, Storage- und Mail-Helfer (ohne npm-Abhängigkeiten)
supabase/migration_010_drohnencheck.sql → Tabellen, RLS, Funktionen
supabase/migration_011_drohnencheck_bericht.sql → Berichte, Storage-Bucket «drohnencheck», kurzes Formular
supabase/migration_012_drohnencheck_medien.sql → Titelvideo: Tabelle drohnencheck_einstellungen, öffentlicher Bucket «drohnencheck-medien»
netlify.toml                           → Subdomain-Rewrite und Zeitplan der Löschroutine
```

## Entscheide (Robin, 20.10.2026)

| Frage | Entscheid |
|---|---|
| Wo läuft die Seite? | Subdomain `dachcheck.jaeggivollmer.ch` auf der bestehenden Netlify-Site (keine zweite Site) |
| E-Mail | Nur eine **Info-Mail ohne Personendaten** an `info@jaeggivollmer.ch` (Referenz, Zeitpunkt, Link zur Anfrage in der Übersicht). **Keine** Bestätigungsmail an Kunden |
| Übersicht | Anfragen-Übersicht unter `dachcheck.jaeggivollmer.ch/admin.html` **und** als Tab «Drohnen-Check» im Admin-Panel, gleiches Passwort |
| Speicherung | Eigene Tabellen im bestehenden Supabase-Projekt, nur via service_role |
| Landingpage (20.10.2026) | Auf das Wesentliche reduziert. Keine Fotos nötig, optional ein Titelvideo (Drohnenflug). Kein «Bericht innert 24 Stunden» |
| Formular (20.10.2026) | Eine Seite: Vorname, Name, E-Mail, Telefon, Adresse, Einwilligung. Keine Wunschtermine: Der Projektleiter fliegt, wenn er in der Nähe ist, der Kunde muss nicht zu Hause sein |
| Bericht (20.10.2026) | Wird im Admin erstellt. Bilder im privaten Bucket, nicht als Base64 |

Weitere Annahmen (nicht explizit entschieden):

| Thema | Annahme |
|---|---|
| Versanddienst | Resend (Absender `dachcheck@jaeggivollmer.ch`). Da die Mail keine Personendaten enthält, ist der Anbieter datenschutzrechtlich unkritisch |
| Logo | Original-SVG unverändert unter `public/dachcheck/assets/logo-jaeggi-vollmer.svg` |
| Technik | Statisches HTML/CSS/JS ohne Build-Schritt (wie der Rest des Repos) |
| Bericht an Kunden | Der Link geht über das eigene Mailprogramm raus («Per E-Mail senden» öffnet einen fertigen Entwurf), damit keine Personendaten über Resend laufen |
| Bilder | Werden im Browser auf max. 2000 px verkleinert und als JPEG hochgeladen (entfernt auch GPS-Daten), max. 12 pro Bericht |
| Rate-Limit | 5 Anfragen pro Stunde und IP (Env `DC_RATE_LIMIT`) |
| Spamschutz | Honeypot + Rate-Limit, kein Captcha (Turnstile kann später ergänzt werden) |

## Lokal starten

```bash
npx netlify-cli dev          # http://localhost:8888/dachcheck/, Functions unter /api/*
```

Für lokale Tests eine Datei `.env` im Repo-Root mit den Variablen unten anlegen (nicht committen). Ohne `RESEND_API_KEY` wird die Anfrage gespeichert, aber keine Mail versendet (Hinweis im Log).

## Einrichten und deployen

1. **Datenbank:** `supabase/migration_010_drohnencheck.sql`, danach `migration_011_drohnencheck_bericht.sql` und `migration_012_drohnencheck_medien.sql` im Supabase SQL-Editor ausführen. Alle sind idempotent und fassen keine bestehenden Tabellen an. Migration 011 legt den privaten Storage-Bucket `drohnencheck` an (nur JPG/PNG/WebP, max. 10 MB), Migration 012 den öffentlichen Bucket `drohnencheck-medien` für das Titelvideo (nur MP4/WebM/JPG, max. 50 MB).
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

Alles steht in **`public/dachcheck/config.js`**: Texte aller Abschnitte, FAQ, PLZ-Liste, Empfänger- und Absender-Adresse, Meta Pixel ID. Nach dem Ändern committen und pushen, Netlify deployt automatisch.

- **Einzugsgebiet:** `einzugsgebiet.plz`, Bereiche als `'4000-4099'`, einzelne PLZ als Zahl. Wird im Browser und nochmals auf dem Server geprüft.
- **Meta Pixel:** `tracking.metaPixelId` setzen. Erst dann erscheint der Cookie-Hinweis, und das Pixel lädt nur nach «Einverstanden». Bei erfolgreicher Anfrage wird `Lead` gesendet.

## Wo landen die Anfragen?

- **Info-Mail intern** an `email.empfaengerIntern`: nur Referenz, Zeitpunkt und Link `…/admin.html#DC-…` direkt zur Anfrage, **keine Personendaten**. Der Kunde erhält keine Mail, nur die Danke-Seite mit Referenznummer.
- **Übersicht** (`admin.html` bzw. Tab «Drohnen-Check» im Admin-Panel): Liste mit Suche und Statusfilter, Detail mit allen Angaben, Knöpfe «Flug ankündigen» (fertiger E-Mail-Entwurf: wir kommen vorbei, Sie müssen nicht zu Hause sein), E-Mail, Anrufen, WhatsApp und Karte. Status, geplanter Flug und interne Notiz änderbar, Bericht, Warteliste, CSV-Export. Zeigt pro Anfrage, wann sie automatisch gelöscht wird.
- **Supabase-Tabelle `drohnencheck_anfragen`** mit Status `neu`. Status in der Übersicht nachführen: `neu → termin → geflogen → report → auftrag | abgeschlossen | abgesagt`. Die Spalte `mail_intern_ok` zeigt, ob die Info-Mail versendet wurde. Die UTM-Parameter stehen in den Spalten `utm_*`.
- **Warteliste** (PLZ ausserhalb): Tabelle `drohnencheck_warteliste`.
- **Referenznummer:** `DC-<Jahr>-<laufende Nr.>`, Zähler pro Jahr in `drohnencheck_zaehler`.

Auswertung nach Werbung, z. B. im SQL-Editor:

```sql
SELECT utm_source, utm_campaign, count(*) FROM drohnencheck_anfragen GROUP BY 1, 2 ORDER BY 3 DESC;
```

## Bericht erstellen

Im Detail einer Anfrage, Abschnitt **Bericht**:

1. Flugdatum, Ampel (Gut / Beobachten / Handlungsbedarf), Befund und optional Empfehlung erfassen.
2. **Bilder hinzufügen** (mehrere auf einmal, auch direkt vom Handy). Sie werden verkleinert und direkt in den privaten Bucket `drohnencheck` geladen (Pfad `{anfrage_id}/{zufall}.jpg`), in der Datenbank steht nur der Pfad. Beschriften, mit ↑ ↓ sortieren, «Entfernen» löscht das Bild auch im Bucket.
3. **Bericht speichern**, dann **Speichern und veröffentlichen**. Der Status springt auf «Bericht versendet».
4. **Per E-Mail senden** öffnet einen fertigen Entwurf mit dem Kundenlink im eigenen Mailprogramm. Alternativ «Link kopieren» (z. B. für WhatsApp).

Der Kunde sieht den Bericht unter `dachcheck.jaeggivollmer.ch/bericht.html?t=…` (Ampel, Befund, Empfehlung, Fotos, Kontakt) und kann ihn als PDF speichern. Die Bilder werden nur über signierte URLs mit einer Stunde Gültigkeit ausgeliefert. «Kundenlink sperren» macht den Link sofort ungültig.

## Löschung nach 60 Tagen

- **Automatisch:** Die Function `dachcheck-loeschroutine` läuft täglich (`schedule = "@daily"`) und ruft `drohnencheck_loeschen(60)` auf. Gelöscht werden alle Anfragen älter als 60 Tage, deren Status **nicht** `auftrag` ist, samt Bericht und den Bildern im Bucket. IP-Hashes werden nach 7 Tagen entfernt, Wartelisten-Einträge nach 24 Monaten.
- **Wichtig:** Wird aus einer Anfrage ein Auftrag, Status auf `auftrag` setzen, sonst wird sie gelöscht.
- **Weitere Drohnenaufnahmen** (alles, was nicht im Bericht ist, z. B. auf der Drohne oder dem Laptop) müssen manuell gelöscht werden: einmal pro Woche prüfen und alles löschen, was älter als 60 Tage ist und zu keiner Anfrage mit Status `auftrag` gehört.
- **Manuell** geht es auch im SQL-Editor: `SELECT drohnencheck_loeschen(60);`

## Platzhalter, die noch fehlen

| Wo | Was |
|---|---|
| `config.js` → `firma.uid` | UID-Nummer |
| `config.js` → `tracking.metaPixelId` | Meta Pixel ID (leer = kein Tracking) |
| `config.js` → `email.absenderAdresse` | Absender bestätigen, Domain bei Resend verifizieren |
| `config.js` → `einzugsgebiet.plz` | Startliste BS/BL prüfen (Grenzgemeinden zu SO/AG) |
| Admin → Tab «Landingpage» | optional: Titelvideo importieren (ohne Video bleibt ein ruhiger dunkler Hintergrund) |
| `impressum.html` | UID, vertretungsberechtigte Person |
| `datenschutz.html` | Link zur allgemeinen Datenschutzerklärung, Supabase-Region, Garantien pro Anbieter; Entwurf-Hinweis nach der juristischen Prüfung entfernen |
| Einwilligungstext Kommunikation | Steht im Briefing in Du-Form («Ihr dürft …»), der Rest der Seite siezt. Bei Bedarf in `config.js` anpassen |

## Titelvideo importieren

Im Admin (Admin-Panel → Drohnen-Check oder `dachcheck.jaeggivollmer.ch/admin.html`) im Tab **«Landingpage»** auf **«Video importieren»** klicken und das Originalvideo der Drohne wählen. Start und Länge wählen (max. 20 Sekunden), dann **«Verkleinern und hochladen»**.

- Das Video wird direkt im Browser verkleinert: 1280 px Breite, 30 Bilder pro Sekunde, ca. 2,5 Mbit/s, ohne Ton. Aus einer Drohnendatei von mehreren hundert MB werden so typischerweise 3 bis 6 MB. Das Original wird nie hochgeladen.
- Die Umwandlung läuft in Echtzeit (15 Sekunden Video dauern rund 15 Sekunden). Das Fenster dabei offen und sichtbar lassen.
- Am besten mit **Chrome oder Edge**: Sie erzeugen MP4 (H.264), das auf allen Handys läuft. Andere Browser erzeugen WebM; ältere iPhones zeigen dann nur das Standbild.
- Drohnenvideos in H.265/HEVC kann nicht jeder Browser lesen. Erscheint eine Fehlermeldung, das Video in der Drohnen-App als H.264 (MP4) exportieren.
- Ein neuer Import ersetzt das alte Video, «Video entfernen» löscht es. Das Standbild (erstes Bild) wird automatisch erzeugt.
- Bei «Bewegung reduzieren» oder im Datensparmodus zeigt die Landingpage nur das Standbild.
- Keine erkennbaren Personen, Hausnummern oder Autokennzeichen im Video: Der Bucket ist öffentlich.
