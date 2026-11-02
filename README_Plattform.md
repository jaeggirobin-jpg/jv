# JV-Plattform (docs.jaeggivollmer.ch)

Interne Startseite von Jäggi Vollmer: ein Login, Kacheln nach Kategorie (Planung, Badumbau, Marketing, Anfragen,
Verwaltung) nach dem Vorbild von Michis Übersicht. Michis fünf Claude-Tools laufen unverändert in der Plattform und
speichern neu in Supabase statt bei claude.ai. Dazu kommen ein Feedback-Knopf mit Bildausschnitt und eigene Logins für
Mitarbeiterinnen und Mitarbeiter.

## Aufbau

| Teil | Ort |
|---|---|
| Plattform (Übersicht, Projekte, Kunden, Katalog, Anfragen, Verwaltung) | `public/index.html`, `public/assets/plattform.js`, `plattform.css` |
| Anmeldung, Sitzung, Rechte | `netlify/functions/_lib/auth.js`, `sitzung.js`; Anmeldefenster in `public/tools/assets/jv-bridge.js` |
| Logins verwalten | `netlify/functions/zugaenge.js`, `public/assets/zugaenge.js`; Tabellen `mitarbeiter`, `anmelde_fehler` (`migration_017`) |
| Michis Tools | `public/tools/<tool>/index.html`; Speicher `tool-db.js`, `tool-asset.js`, `tool-blob.js`; Tabelle `tool_docs`, Bucket `tools` (`migration_015`) |
| Karte und Adressvorschläge (swisstopo) | `public/tools/assets/geo-admin.js`, `public/tools/terminplaner/plattform.js` |
| Kundenlink für Badvisualisierungen | `visualisierung-links.js`, `get-visualisierung.js`, `public/visualisierung.html`; Tabelle `visualisierung_links` |
| Feedback | `public/assets/feedback.js` (Knopf, Bildausschnitt), `feedback-board.js` (Board, Export), Function `feedback.js`; Tabelle `plattform_feedback`, Bucket `feedback` (`migration_016`) |
| Neue Tool-Version von Michi übernehmen | `werkzeuge/tools_einbinden.py` |

**Ein Projekt für alles:** Ein Projekt (Name, Adresse, Bauherrschaft, Projektleiter) gilt für Terminplan, Kundenzugang
(Inspiration, Swipe, Dokumente) und Badvisualisierungen. Bestehende Kunden werden im Projekt unter «Kundenzugang» →
«Bestehenden Kunden zuordnen» verknüpft.

Das Repo ist öffentlich. Kundendaten, Kundenfotos, 3D-Scans und Personendaten kommen nie ins Repo, sondern über
«Daten übernehmen» direkt in Supabase (private Buckets, Zugriff nur über die Functions).

## Einrichtung (einmalig, durch Robin)

1. **Supabase:** Dashboard → SQL Editor → New query → Inhalt der Datei einfügen → Run. In dieser Reihenfolge:
   `supabase/migration_015_plattform_tools.sql`, dann `migration_016_feedback.sql`, dann `migration_017_mitarbeiter.sql`.
   Die Migrationen legen nur Neues an und stören die heutige Seite nicht, sie können also vor dem Merge laufen.
   Kontrolle: Table Editor zeigt `tool_docs`, `visualisierung_links`, `plattform_feedback`, `mitarbeiter`,
   `anmelde_fehler`; Storage zeigt die Buckets `tools` und `feedback` (beide privat).
2. **Merge:** «merge» im Thread schreiben. Netlify deployt automatisch. Neue Environment Variables braucht es keine.
3. **Anmelden:** `https://docs.jaeggivollmer.ch` öffnen, **E-Mail leer lassen**, Hauptpasswort (`ADMIN_PASSWORD`)
   eingeben. Das Hauptpasswort gilt immer als Admin.
4. **Daten übernehmen:** Verwaltung → «Daten übernehmen» → `JV_Tools.zip` wählen → Auswahl prüfen →
   «Ausgewählte Daten übernehmen». Fenster offen lassen, bis «Fertig» erscheint. Erneut starten ist möglich.
   Danach unter «Projekte» die bestehenden Kunden den Projekten zuordnen.
5. **Logins anlegen:** Verwaltung → «Logins» → «Neues Login» (Name, E-Mail, Rolle, Bereiche). Das Startpasswort
   erscheint **genau einmal**: persönlich oder per SMS übergeben, nicht zusammen mit der E-Mail-Adresse per Mail.
   Beim ersten Login setzt die Person ein eigenes Passwort (mind. 10 Zeichen).
6. **Live testen** (in der Cloud-Sitzung waren geo.admin.ch und Supabase nur mit Attrappen prüfbar):
   - Terminplaner: Projekt öffnen, Karte der Adresse erscheint, Adressvorschläge beim Tippen, PDF mit Karte.
   - Badvisualisierung: im Projekt Kundenlink erstellen, in einem privaten Fenster öffnen, Link deaktivieren → gesperrt.
   - Gäste-WC: 3D-Ansicht lädt den Scan.
   - Feedback: Knopf «Feedback» → Bereich aufziehen → markieren → senden → erscheint im Feedback-Board.
   - Mit einem Mitarbeiter-Login anmelden: nur die freigegebenen Bereiche sind sichtbar.

## Logins und Rechte

- **Admin:** alles, auch Logins, Feedback-Board und «Daten übernehmen».
- **Mitarbeiter:** nur die gewählten Bereiche: Projekte (inkl. Tools), Kunden, Katalog, Anfragen (Drohnen-Check, KRV-Check).
  Die Oberfläche blendet den Rest aus, der Server prüft jede Anfrage trotzdem.
- **Hauptpasswort** bleibt als Notfallzugang. Die Admin-Seiten auf `dachcheck.` und `krv.` nutzen weiterhin nur das Hauptpasswort.
- Sitzung 12 Stunden, mit «angemeldet bleiben» 30 Tage. Sperren, neues Startpasswort oder andere Rechte melden die
  Person sofort überall ab.
- Schutz gegen Durchprobieren: 5 Fehlversuche pro Login → 15 Minuten gesperrt; 10 Fehlversuche pro Anschluss in 15 Minuten → Pause.
- Passwort vergessen: Admin → «Logins» → «Neues Startpasswort». Eigenes Passwort ändern: Benutzermenü oben rechts.

## Feedback

- Knopf «Feedback» oben rechts in der Plattform, am rechten Rand in den Tools, als kleiner Knopf in offenen Dialogen.
- Bereich aufziehen (oder ganze Seite), mit Stift, Pfeil, Rechteck oder Text markieren, Art wählen (Kommentar,
  Änderungsvorschlag, Fehler), beschreiben, senden. Ohne Internet wartet das Feedback im Browser und wird nachgesendet.
- **Board** (Verwaltung → «Feedback», nur Admins): Status Offen / In Arbeit / Erledigt, Häkchen «Umsetzen», Filter nach
  Seite, Bild gross ansehen. «Aufräumen» löscht Erledigtes, das älter als 3 Tage ist (inkl. Bild).
- **Export für Claude Code:** Punkte mit «Umsetzen» anhaken → «Markdown-Export» → Status wählen → kopieren oder
  herunterladen und in Claude Code einfügen. Die Bildausschnitte sind eingebettet, die betroffenen Dateien stehen pro
  Seite dabei. Danach bietet der Dialog an, die Punkte auf «In Arbeit» oder «Erledigt» zu setzen.
- Für Michis Tools nennt der Export die Datei in `public/tools/`. Änderungen dort gehen beim nächsten Einbinden einer
  neuen Tool-Version verloren, also besser Michi informieren oder das Skript anpassen.

## Neue Version eines Tools von Michi

Im Repo-Ordner (Windows, Eingabeaufforderung):

```
py werkzeuge\tools_einbinden.py JV_Tools.zip
```

Das Skript passt die Tools minimal an (Speicher, Karte, keine Personendaten) und bricht ab, wenn eine Stelle nicht
mehr passt oder noch Personendaten im Ergebnis stehen. Enthält die neue Version Daten, die noch nicht in der Plattform
sind, diese danach über «Daten übernehmen» einlesen.

## Datenschutz (revDSG)

- **Logins:** gespeichert werden Name, E-Mail, Rolle, Bereiche und die letzte Anmeldung. Passwörter nur als
  scrypt-Hash, Startpasswörter werden nie gespeichert. Es gibt kein Protokoll darüber, wer was bearbeitet
  (keine Verhaltensüberwachung im Sinne von Art. 26 ArGV 3; Bearbeitung im Arbeitsverhältnis nach Art. 328b OR).
- **Fehlversuche:** nur ein Hash der IP-Adresse, nach einem Tag gelöscht.
- **Feedback:** Bildausschnitte können Kundendaten zeigen (Namen, Adressen, Fotos). Sie liegen im privaten Bucket und
  sind nur für Admins sichtbar. Mitarbeitende informieren: nur den nötigen Ausschnitt wählen. Erledigtes regelmässig
  mit «Aufräumen» löschen.
- **Export an Claude Code:** Mit dem Export gehen Text und Bilder an Anthropic (USA). Bei Ausschnitten mit Kundendaten
  «Mit Bildausschnitten» abwählen oder bei diesem Punkt «Umsetzen» weglassen. Heruntergeladene Export-Dateien nach
  Gebrauch löschen.
