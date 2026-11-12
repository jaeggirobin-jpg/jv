# JV-Plattform (docs.jaeggivollmer.ch)

Interne Startseite von Jäggi Vollmer: ein Login, Kacheln nach Kategorie (Planung, Badumbau, Marketing, Anfragen,
Verwaltung) nach dem Vorbild von Michis Übersicht. Michis fünf Claude-Tools laufen unverändert in der Plattform und
speichern neu in Supabase statt bei claude.ai. Dazu kommen ein Feedback-Knopf mit Bildausschnitt, eigene Logins für
Mitarbeiterinnen und Mitarbeiter und ein gemeinsamer KI-Zugang (Claude) für alle KI-Funktionen.

## Aufbau

| Teil | Ort |
|---|---|
| Plattform (Übersicht, Projekte, Kunden, Katalog, Anfragen, Verwaltung) | `public/index.html`, `public/assets/plattform.js`, `plattform.css` |
| Anmeldung, Sitzung, Rechte | `netlify/functions/_lib/auth.js`, `sitzung.js`; Anmeldefenster in `public/tools/assets/jv-bridge.js` |
| Logins verwalten | `netlify/functions/zugaenge.js`, `public/assets/zugaenge.js`; Tabellen `mitarbeiter`, `anmelde_fehler` (`migration_017`) |
| Michis Tools | `public/tools/<tool>/index.html`; Speicher `tool-db.js`, `tool-asset.js`, `tool-blob.js`; Tabelle `tool_docs`, Bucket `tools` (`migration_015`) |
| Karte und Adressvorschläge (swisstopo) | `public/tools/assets/geo-admin.js`, `public/tools/terminplaner/plattform.js` |
| «Zurück» vor dem Logo bzw. Lasche am Rand (alles öffnet im selben Tab) | `public/assets/zurueck.js`, Merker in `public/assets/plattform.js` |
| Badvisualisierungen erstellen und bearbeiten | `public/assets/badvis-editor.js`; Knöpfe und Aufbereitung im Tool `public/tools/badvisualisierungen/daten.js` |
| Kundenlink für Badvisualisierungen | `visualisierung-links.js`, `get-visualisierung.js`, `public/visualisierung.html`; Tabelle `visualisierung_links` |
| Feedback | `public/assets/feedback.js` (Knopf, Bildausschnitt), `feedback-board.js` (Board, Export), Function `feedback.js`; Tabelle `plattform_feedback`, Bucket `feedback` (`migration_016`) |
| KI (Claude) | `netlify/functions/_lib/ki.js` (gemeinsamer Zugang), `ki.js` (Katalog, Tools, Chat), `_lib/werkzeug-chat.js`; KI für die Tools in `jv-bridge.js`, Chat in Reel/Story `assets/ki-chat.js` |
| Neue Tool-Version von Michi übernehmen | `werkzeuge/tools_einbinden.py` |
| App (PWA): installierbar, Offline-Hinweis | `public/manifest.webmanifest`, `public/sw.js`, `public/offline.html`, `public/assets/app.js`; Symbole `public/assets/app/` aus `werkzeuge/app_symbole.py` |

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
   Für die KI muss `ANTHROPIC_API_KEY` gesetzt sein (für den Drohnen-Check wohl schon der Fall, siehe «KI»).
3. **Anmelden:** `https://docs.jaeggivollmer.ch` öffnen, **E-Mail leer lassen**, Hauptpasswort (`ADMIN_PASSWORD`)
   eingeben. Das Hauptpasswort gilt immer als Admin.
4. **Daten übernehmen:** Verwaltung → «Daten übernehmen» → `JV_Tools.zip` wählen → Auswahl prüfen →
   «Ausgewählte Daten übernehmen». Fenster offen lassen, bis «Fertig» erscheint. Erneut starten ist möglich.
   Danach unter «Projekte» die bestehenden Kunden den Projekten zuordnen.
5. **Logins anlegen:** Verwaltung → «Logins» → «Neues Login» (Name, E-Mail, Rolle, Bereiche). Das Startpasswort
   erscheint **genau einmal**: persönlich oder per SMS übergeben, nicht zusammen mit der E-Mail-Adresse per Mail.
   Beim ersten Login setzt die Person ein eigenes Passwort (mind. 10 Zeichen).
6. **Live testen** (in der Cloud-Sitzung waren geo.admin.ch und Supabase nur mit Attrappen prüfbar):
   - Terminplaner: Knopf «Projekte» → Suchfeld (Name, Adresse, Bauherrschaft), Adressvorschläge beim Tippen,
     PDF «Terminplan» mit schwarz-weisser Karte und farbigem Kreis um die Adresse.
   - Aus der Plattform ein Tool öffnen: öffnet im selben Tab, «Zurück» oben links vor dem Logo (bzw. die Lasche am linken Rand) führt zurück, das Logo zur Übersicht.
   - Badvisualisierung: im Projekt Kundenlink erstellen, in einem privaten Fenster öffnen, Link deaktivieren → gesperrt.
   - Gäste-WC: 3D-Ansicht lädt den Scan.
   - Feedback: Knopf «Feedback» → Bereich aufziehen → markieren → senden → erscheint im Feedback-Board.
   - Mit einem Mitarbeiter-Login anmelden: nur die freigegebenen Bereiche sind sichtbar.
   - KI: im Katalog bei einem neuen Punkt eine Kurzbeschreibung tippen → «KI: korrigieren»; in einer KRV-Anfrage die
     Begründung → «KI: umschreiben». «Rückgängig» holt jeweils den alten Text zurück.

## Navigation

- Tools, Kundenseiten und Berichtsvorschauen öffnen im selben Tab. Oben links vor dem Logo (Badvisualisierungen,
  Terminplaner, Reel) bzw. als Lasche am linken Rand erscheint «Zurück»: es führt dorthin zurück, wo man in der Plattform war (Übersicht, Projekt, Kunden, Anfrage). Direkt aufgerufen führt es
  zur Übersicht, ein Klick aufs Logo ebenso. Kunden sehen «Zurück» nicht (nur wenn die Seite aus der Plattform geöffnet wurde).
- Externe Ziele bleiben in einem neuen Tab: WhatsApp, Karte, E-Mail, Telefon, Webseiten von Firmen und der IWB.

## Als App installieren (PWA)

Die Plattform lässt sich wie eine App auf den Home-Bildschirm, ins Dock oder in die Taskleiste legen. Sie öffnet dann
in einem eigenen Fenster ohne Adressleiste, mit dem JV-Symbol.

- **iPhone, iPad (Safari):** Teilen-Knopf (Quadrat mit Pfeil, in neueren Versionen unter «…») → «Zum Home-Bildschirm»
  → «Hinzufügen». Den Weg zeigt auch das Benutzermenü oben rechts.
- **Android, Chrome oder Edge am PC:** Benutzermenü oben rechts → «Als App installieren». Fehlt der Knopf, bietet der
  Browser es gerade nicht an (schon installiert, privates Fenster); dann über das Menü des Browsers («App installieren»
  bzw. «Zum Startbildschirm hinzufügen»).
- **Mac mit Safari:** Menü «Ablage» → «Zum Dock hinzufügen».
- Auf iPhone und iPad hat die App eine eigene Anmeldung (getrennt von Safari): beim ersten Öffnen einmal anmelden,
  am besten mit «Angemeldet bleiben».
- Langes Drücken bzw. Rechtsklick auf das Symbol (Android, PC) bietet die Kurzbefehle «Projekte» und «Bau-Terminplaner».
- **Ohne Verbindung** zeigt die App «Keine Verbindung» statt einer Fehlerseite des Browsers. Sie lädt von selbst neu,
  sobald der Server wieder antwortet (fragt alle paar Sekunden nach, später seltener); «Erneut versuchen» lädt sofort.
- **Auf dem Gerät gespeichert wird nur dieser Hinweis.** Projekte, Kundendaten, Bilder und PDFs kommen immer frisch vom
  Server, ohne Verbindung ist nichts davon sichtbar. Kundenlinks, Drohnen-Check und KRV-Check gehören nicht zur App.
- **Neue Version:** erscheint in der App wie im Browser beim nächsten Öffnen.

## Terminplaner: Karte und Projektsuche

- Die Karte der Projektadresse erscheint nur im PDF (Terminplan, Auswertung, Checklisten, Kontaktliste), nicht mehr am
  Bildschirm. Sie ist schwarz-weiss, nur der Kreis um die Adresse ist farbig. Im Terminplan liegt der Punkt mittig
  zwischen dem Ende der Tabelle und der Legende; ist eine Seite voll, bekommt nur die Seite mit Platz die Karte.
- Das erste PDF nach einem Projektwechsel wartet höchstens 6 Sekunden auf die Karte (geo.admin.ch). Kommt sie nicht,
  entsteht das PDF ohne Karte.
- Knopf «Projekte»: der Cursor steht im Suchfeld. Gesucht wird in Name, Adresse, Bauherrschaft, Projektleiter und
  Status, kleine Tippfehler werden erkannt. ↑ ↓ wählen, Enter öffnet, Escape leert bzw. schliesst. Die Auswahlliste
  im Kopf gibt es nicht mehr.

## Badvisualisierungen erstellen

- **Neu:** im Projekt unter «Badvisualisierungen» auf «＋ Neue Visualisierung» oder im Tool oben rechts. Datum und
  Hinweis sind vorbefüllt, aus dem Projekt auch der Kunde. Nötig sind Raum, Titel, ein Vorher-Foto und je Farbvariante ein Nachher-Foto; das
  Mockup der Teile ist freiwillig. Ab zwei Farbvarianten braucht jede einen Namen und eine wird «zuerst gezeigt».
- **Fotos:** JPG oder PNG, hineinziehen oder wählen. Vorher- und Nachher-Fotos brauchen dieselbe Sicht und dasselbe
  Seitenverhältnis (quer 4:3 oder hoch 3:4), sonst erscheint ein Hinweis. Lässt sich ein iPhone-Foto (HEIC) nicht
  lesen: Einstellungen › Kamera › Formate › «Maximale Kompatibilität».
- **Ausführung:** je Zeile Bauteil und Beschreibung, auf Wunsch mit Farbmuster. Leere Zeilen fallen weg.
- **Bearbeiten:** im Projekt bei der Visualisierung oder im Tool oben rechts «Bearbeiten». Wer mit ungespeicherten
  Änderungen weggeht, wird gefragt.
- **Kundenlink:** nur für Visualisierungen mit Projekt. Ohne Projekt gespeichert, später das Projekt wählen.
- **Löschen:** im Editor unten «Löschen». Der Kundenlink und die Fotos gehen mit, das lässt sich nicht rückgängig machen.

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

## KI (Claude)

- Alle KI-Funktionen laufen über einen gemeinsamen Zugang auf dem Server (offizielles Anthropic-SDK). Der Schlüssel
  bleibt in Netlify, der Browser sieht ihn nie.
- **Wo:** Drohnen-Check (Bericht, wie bisher), KRV-Check (Begründung für den Kunden, in der Plattform und auf
  `krv.`), Katalog (Kurzbeschreibung, Vorteil, Zu bedenken, Einleitung einer Kategorie): «KI: korrigieren» korrigiert nur
  Rechtschreibung, Grammatik und Zeichensetzung, «KI: umschreiben» formuliert neu, «Rückgängig» holt den alten Text zurück.
- **Michis Tools:** Baut Michi in eine neue Version KI ein (`window.claude.use('sample')` wie bei claude.ai), läuft sie
  nach dem Einbinden ohne Umbau. Beim ersten Mal fragt der Browser einmal «KI verwenden?». Nur für Logins mit dem
  Bereich «Projekte».
- **Chat mit Claude in Reel-Generator und Story** (Robin, 4.11.2026): Knopf «Claude» unten rechts. Man stellt Fragen
  («Welcher Spruch passt zu einem Gäste-WC?») oder verlangt Änderungen («Mach das Rätsel lustiger», «Verschieb Foto 4
  nach vorne», «Akzentfarbe auf JV-Kupfer»); Claude ändert direkt, jede Antwort mit Änderungen hat «Rückgängig».
  Reel: Startseite, Rätsel-/Split-Text, Spruch, eigener Spruch, Zusatz, Etappen-Texte, Reihenfolge der Fotos (Fotos
  hinzufügen/entfernen und die Schlussseite bleiben von Hand). Story: Titel, Text, Knopf, Telefon, Fusszeile,
  Akzentfarbe; die Änderungen merkt sich der Browser, «Original» stellt alles zurück. Mit geht nur der Stand (Texte,
  Einstellungen, Reihenfolge), nie Fotos. Bereich «Projekte».
  **Freie Gestaltung** (Robin, 4.11.2026): Reel: Logo (Lage, Grösse, mit/ohne Karte, Datei ohne weissen Hintergrund,
  Deckkraft, Zeitfenster), Grundfarben und zusätzliche Ebenen (Text, Rechteck, Kreis, Linie, Logo, je mit Zeitfenster
  und Ein-/Ausblenden), Knopf «Gestaltung zurück». Story: CSS je Element (Logo, Logokarte, Titel, Knopf …), Logo ohne
  Hintergrund, zusätzliche Textfelder. Der Server lässt nur bekannte Felder und CSS ohne Bilder von aussen zu
  (`netlify/functions/_lib/gestaltung.js`). Die Gestaltung merkt sich der Browser.
- **Netlify:** `ANTHROPIC_API_KEY` (Site configuration → Environment variables). Optional `JV_KI_MODELL` für ein
  anderes Claude-Modell (das frühere `DC_KI_MODELL` gilt weiter). Vorgabe ist ein schnelles Modell, weil Netlify jede
  Function nach 10 Sekunden abbricht. Ohne Schlüssel läuft alles andere normal, nur die KI-Knöpfe melden es.
- **Grenzen:** Eine Antwort muss nach rund 8.5 Sekunden fertig sein, sonst kommt eine Teilantwort (Tools) bzw. eine
  Meldung. Ist Claude ausgelastet, steht das in der Meldung; einfach später nochmals versuchen.

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
- **Fotos der Badvisualisierungen:** werden vor dem Hochladen im Browser neu gezeichnet (höchstens 2000 px). Dabei
  fallen Kameradaten und GPS-Standort weg. Sie liegen im privaten Bucket `tools`; ersetzte Fotos und die Fotos einer
  gelöschten Visualisierung werden gelöscht, ihr Kundenlink ebenfalls.
- **Feedback:** Bildausschnitte können Kundendaten zeigen (Namen, Adressen, Fotos). Sie liegen im privaten Bucket und
  sind nur für Admins sichtbar. Mitarbeitende informieren: nur den nötigen Ausschnitt wählen. Erledigtes regelmässig
  mit «Aufräumen» löschen.
- **KI-Knöpfe:** Es geht nur der Text des Feldes an Anthropic (USA), beim Katalog dazu der Titel, beim KRV-Check die
  Beurteilung (vorhanden/fehlt/unklar), beim Drohnen-Check die Ampel; keine Fotos, keine Angaben aus der Anfrage. Auf dem Server wird kein Text
  gespeichert oder protokolliert. Mitarbeitende informieren: keine Namen, Adressen oder Telefonnummern in diese Felder
  schreiben (steht auch unter den Knöpfen). Die Bedingungen von Anthropic für die API (Commercial Terms mit Data
  Processing Addendum) einmal prüfen, sie regeln die Auftragsbearbeitung (Art. 9 revDSG).
- **KI in Michis Tools:** Was mitgeht, bestimmt das Tool. Schickt eine künftige Version Projektdaten mit
  Personenbezug (Bauherrschaft, Adresse), ist das eine Bekanntgabe ins Ausland (Art. 16 revDSG): vorher mit Michi
  klären, ob das nötig ist. Das Freigabe-Fenster weist darauf hin.
- **Export an Claude Code:** Mit dem Export gehen Text und Bilder an Anthropic (USA). Bei Ausschnitten mit Kundendaten
  «Mit Bildausschnitten» abwählen oder bei diesem Punkt «Umsetzen» weglassen. Heruntergeladene Export-Dateien nach
  Gebrauch löschen.
