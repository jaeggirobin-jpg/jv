# JV Docs – Sicherer Dokumenten-Viewer
## `docs.jaeggivollmer.ch`

---

## Projektzweck

Internes Tool für Jäggi Vollmer GmbH (Basel) zur sicheren Weitergabe von Badezimmer-Visualisierungen und Offertunterlagen an Kunden. Dokumente werden über einen einmaligen Link zugänglich gemacht, können vom Kunden **nicht heruntergeladen** werden, und der Zugang kann jederzeit durch den Admin deaktiviert werden.

**Kernproblem:** Kunden leiten Visualisierungen an Konkurrenten weiter. Die Lösung schafft hohe Hürden für Weitergabe ohne absolute DRM-Garantie.

---

## Stack

| Schicht | Technologie |
|---|---|
| Hosting / Edge Functions | Netlify |
| Datenbank | Supabase (PostgreSQL) |
| PDF-Storage | Supabase Storage (Bucket: `pdfs`, privat) |
| PDF-Rendering | PDF.js (Canvas-basiert, kein nativer Browser-Viewer) |
| Frontend | Vanilla JS, kein Framework |
| Auth (Admin) | Einfaches Passwort via Netlify Environment Variable |

---

## Architektur-Übersicht

```
docs.jaeggivollmer.ch/
├── public/                 → EINZIGER ausgelieferter Ordner (publish = "public")
│   ├── index.html          → JV-Plattform (intern): Übersicht, Projekte, Kunden, Katalog, Anfragen, Verwaltung
│   ├── view.html           → Kunden-Viewer für PDFs (Token-basiert)
│   ├── visualisierung.html → Kunden-Viewer für Badvisualisierungen (Token, Canvas, Wasserzeichen)
│   ├── inspiration.html    → Kunden-Inspirationsseite (Token, Supabase-RPCs)
│   ├── swipe.html          → Inspiration als Swipe-Karten (Token, Supabase-RPCs)
│   ├── tools/              → Michis Tools (Terminplaner, Badvisualisierungen, Gäste-WC 3D, Story, Reel)
│   │   └── assets/jv-bridge.js → Speicher der Tools (statt claude.ai) + Anmeldefenster der Plattform
│   ├── assets/plattform.js|css → Plattform (Router, Projekte, Rechte im Menü, Daten übernehmen)
│   ├── assets/feedback.js  → Feedback-Knopf mit Bildausschnitt (Plattform und Tools)
│   ├── assets/feedback-board.js, zugaenge.js → Verwaltung: Feedback-Board, Logins
│   ├── assets/vendor/      → html2canvas-pro (MIT, für die Feedback-Bilder)
│   └── assets/, logo.png
├── netlify.toml            → Routing, Function-Config, Sicherheits-Header
├── supabase/               → SQL-Migrationen (manuell im SQL-Editor ausführen)
├── werkzeuge/tools_einbinden.py → neue Version eines Tools von Michi übernehmen (entfernt Personendaten)
└── netlify/functions/
    ├── _lib/auth.js        → Anmeldung: Hauptpasswort, Mitarbeiter-Logins, Sitzungs-Cookie, Bereiche
    ├── sitzung.js          → Anmelden, Abmelden, eigenes Passwort ändern
    ├── zugaenge.js         → Logins verwalten (nur Admins)
    ├── feedback.js         → Feedback speichern (alle), Board und Export (nur Admins)
    ├── tool-db.js, tool-asset.js, tool-blob.js → Speicher und Dateien der Tools
    ├── visualisierung-links.js, get-visualisierung.js → Kundenlinks für Badvisualisierungen
    ├── get-pdf.js          → Sichere PDF-Auslieferung (signierte URL, prüft Kundenstatus)
    ├── create-link.js      → PDF-Upload in 2 Schritten (prepare/finalize, Admin)
    ├── ...                 → weitere Admin-Functions für Kunden, Katalog, Medien, Anfragen
```

Dateien ausserhalb von `public/` (Doku, Migrationen, Function-Quellcode) werden nie ausgeliefert. Neue öffentliche Dateien gehören nach `public/`.

### Datenfluss

```
Admin lädt PDF hoch
→ create-link.js (action 'prepare') erzeugt Dokument-Token + signierte Upload-URL
→ Browser lädt das PDF direkt in den privaten Bucket (kein 6-MB-Limit der Functions)
→ create-link.js (action 'finalize') prüft Datei (PDF, max. 25 MB)
→ speichert Eintrag in doc_links Tabelle
→ gibt shareable URL zurück: docs.jaeggivollmer.ch/view.html?t=TOKEN

Kunde öffnet Link
→ view.html liest Token aus URL
→ ruft get-pdf.js auf mit Token
→ get-pdf.js prüft is_active in Supabase und, falls der Token einem Kunden gehört, kunden.status = 'aktiv'
→ falls aktiv: generiert signierte Supabase-URL (60 Sekunden gültig)
→ PDF.js rendert PDF als Canvas (seitenweise)
→ Wasserzeichen wird via Canvas-API überlagert
→ Kein Download, kein Rechtsklick, kein direkter PDF-URL

Admin deaktiviert Link
→ toggle-link.js setzt is_active = false
→ nächster Aufruf des Kunden: Zugang verweigert
```

---

## Supabase Schema

```sql
CREATE TABLE doc_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  customer_name TEXT NOT NULL,
  note TEXT,
  file_path TEXT NOT NULL,          -- Pfad im Supabase Storage Bucket
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_viewed_at TIMESTAMPTZ,
  view_count INTEGER DEFAULT 0
);
```

Weitere Tabellen der Plattform (alle mit RLS ohne Policies, nur über Functions):
- `tool_docs` (migration_015): Dokumente der Tools, Pfad wie im claude.ai-Speicher (`projects/<id>`, `config/main`)
- `visualisierung_links` (migration_015): Kundenlinks für Badvisualisierungen, `kunden.projekt_id` = «ein Projekt für alles»
- `plattform_feedback` (migration_016): Feedback mit Status, «umsetzen», Bildpfad
- `mitarbeiter`, `anmelde_fehler` (migration_017): Logins (scrypt-Hash) und Fehlversuche pro gehashter IP

### Storage

- Bucket-Name: `pdfs`
- Bucket-Typ: **privat** (kein öffentlicher Zugriff)
- Dateipfad-Konvention: `{token}/{original-filename}.pdf`
- Weitere private Buckets: `tools` (Dateien der Tools, Anzeige über `/_blob/<id>` → signierte URL), `feedback` (Bildausschnitte, JPEG)

### Row Level Security (RLS)

RLS ist auf **allen** Tabellen aktiv (inkl. `doc_links`, siehe `migration_009_rls_haertung.sql`). Es gibt bewusst **keine** Policies für `anon`/`authenticated` auf Personendaten:
- Admin-Zugriff läuft ausschliesslich über Netlify Functions mit `service_role` (umgeht RLS)
- Kundenseiten greifen nur über SECURITY-DEFINER-RPCs zu, die den Token selbst prüfen (`get_inspiration_data`, `upsert_interesse`, `update_kommentar`)
- Einzige anon-Policies: Lesezugriff auf Katalogdaten (`anon_punkte_select`, `anon_kategorien_select`, `anon_medien_select`)
- **Nie** eine Policy mit `USING (true)` für `authenticated` anlegen: Mit dem öffentlichen anon-Key kann sich sonst jeder ein Konto anlegen und alles lesen.
- Supabase Auth wird nicht genutzt, Selbstregistrierung muss in Supabase ausgeschaltet bleiben.

---

## Netlify Functions

Alle Functions verwenden den `service_role` Key (aus Environment Variable), niemals den `anon` Key. Der `anon` Key steht öffentlich in `inspiration.html`/`swipe.html` und darf dort nur die Token-RPCs aufrufen; alle Admin-Calls laufen serverseitig.

### Environment Variables (in Netlify setzen)

```
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   ← service_role, geheim
ADMIN_PASSWORD=...             ← selbst gewählt, mind. 16 Zeichen
```

### Authentifizierung (Plattform und Admin-Functions)

Kein Supabase Auth, kein OAuth. Zwei Arten von Zugängen (`netlify/functions/_lib/auth.js`):
- **Hauptzugang** `ADMIN_PASSWORD`: gilt immer als Admin. In der Plattform anmelden mit leerer E-Mail; die Admin-Seiten auf den Subdomains (dachcheck., krv.) senden es weiterhin als `Authorization: Bearer PASSWORT`.
- **Mitarbeiter-Logins** (Tabelle `mitarbeiter`, Verwaltung «Logins»): E-Mail + eigenes Passwort (scrypt N=65536). Startpasswort wird einmal angezeigt und muss beim ersten Login ersetzt werden. Rolle `admin` (alles) oder `mitarbeiter` mit Bereichen `projekte`, `kunden`, `katalog`, `anfragen`. Logins und Feedback-Board (`verwaltung`) nur für Admins.
- Nach der Anmeldung (`/api/sitzung`) trägt der Browser das signierte Cookie `__Host-jv_sitzung` (HttpOnly, Secure, SameSite=Strict, 12 h oder 30 Tage). Jede Anfrage prüft Signatur, Ablauf und bei Logins in der Datenbank `aktiv` und `sitzung_version` (Sperren, neues Passwort, andere Rechte → sofort abgemeldet).
- `fetch()`-Aufrufe brauchen zusätzlich den Header `X-JV-Sitzung: 1` (CSRF-Schutz). Nur Bilder/Dateien ohne eigenen Header (`/_blob/…`, Feedback-Bilder) nutzen `anmeldungDatei`.
- Fehlversuche: 5 pro Login → 15 Minuten gesperrt; 10 pro IP (gehasht) in 15 Minuten → 429.
- In jeder Admin-Function: `if (!(await anmeldung(event, 'bereich'))) return 401`. **Immer mit `await`** (die Funktion ist asynchron; ohne `await` wäre das Promise immer «wahr»). Neue Functions brauchen einen passenden Bereich.
- Bei Misserfolg: 401 (nicht angemeldet oder Bereich fehlt), 403 für Verwaltung ohne Admin-Rolle.

---

## Frontend-Verhalten

### Plattform (`index.html`)

Einrichtung, Rechte, Feedback und Datenschutz für Robin: `README_Plattform.md`.

- Anmeldefenster aus `jv-bridge.js` (E-Mail + Passwort, «angemeldet bleiben»), Benutzermenü oben rechts mit «Passwort ändern» und «Abmelden»
- Navigation und Kacheln zeigen nur die Bereiche des Logins (`data-bereich`, `data-nur-admin`); der Server prüft trotzdem jede Anfrage
- Feedback: Knopf «Feedback» (oben rechts, in den Tools am rechten Rand, in offenen Dialogen als kleiner Knopf) → Bereich aufziehen, markieren, beschreiben. Wartet offline im Browser und wird nachgesendet. Board unter Verwaltung «Feedback»: Status, «Umsetzen», Markdown-Export für Claude Code mit eingebetteten Bildern
- Michis Tools in `public/tools/` nicht von Hand umbauen: neue Versionen mit `werkzeuge/tools_einbinden.py` übernehmen (sonst gehen Änderungen beim nächsten Einbinden verloren)
- PDF-Upload via `<input type="file">` → Base64 → an `create-link.js`
- Tabelle aller Links mit:
  - Kundenname, Notiz, Erstelldatum
  - Letzter Aufruf, Anzahl Aufrufe
  - Status (Aktiv / Inaktiv) mit Toggle-Button
  - Copy-Link-Button
  - Löschen-Button (inkl. Bestätigung)
- Kein CSS-Framework, eigene schlichte Styles (Farben: `#BF853B`, `#4B575D`, `#929A9D`)

### Kunden-Viewer (`view.html`)

- Token wird aus `?t=TOKEN` URL-Parameter gelesen
- PDF.js lädt PDF über temporäre signierte URL
- Rendering: jede Seite als `<canvas>` Element
- Wasserzeichen (Canvas-API, nach dem Rendern überlagert):
  - Logo plus Text `«Vertraulich – [Kundenname]»` + aktuelles Datum (Name kommt von `get-pdf.js` als `watermark`)
  - Diagonal, halbtransparent, auf jeder Seite
- Schutzmassnahmen:
  - `contextmenu` Event deaktiviert
  - `keydown` für `Ctrl+S`, `Ctrl+P` deaktiviert
  - Kein `<a href>` Link zur PDF-Datei irgendwo im DOM
  - `user-select: none` auf gesamtem Body
- Fehlerzustände:
  - Link nicht gefunden → klare Meldung
  - Link deaktiviert → «Dieser Link wurde deaktiviert. Bitte kontaktieren Sie Jäggi Vollmer.»
  - Netzwerkfehler → Retry-Button

---

## netlify.toml

Siehe `netlify.toml` im Repo: `publish = "public"`, globale Sicherheits-Header (`X-Frame-Options`, `nosniff`, `Referrer-Policy: no-referrer`, CSP mit `frame-ancestors 'none'`), `Cache-Control: no-store` für HTML.

---

## Geplante Erweiterungen (Backlog)

Diese Features sind **noch nicht gebaut**, aber die Architektur soll sie ermöglichen:

### Kurzfristig
- [ ] **Ablaufdatum pro Link** — `expires_at TIMESTAMPTZ` in `doc_links`, automatische Deaktivierung
- [ ] **Passwortschutz pro Link** — optionales Passwort für einzelne Dokumente (z.B. für sensiblere Offerten)
- [ ] **E-Mail-Notifikation** — Admin erhält E-Mail wenn Kunde Link öffnet (via Netlify + Resend.com)

### Mittelfristig
- [ ] **Mehrere Dokumente pro Link** — ein Token → mehrere PDFs (z.B. Visualisierung + Offertübersicht)
- [ ] **Aufruf-Protokoll** — Tabelle `view_log` mit Timestamp, IP (gehasht), User-Agent pro Aufruf
- [ ] **Vorschaubild** — automatische PNG-Vorschau der ersten PDF-Seite im Admin-Panel
- [ ] **Drag & Drop Upload** — im Admin-Panel

### Langfristig
- [x] **Mehrbenutzer-Admin** — Mitarbeiter-Logins mit Rollen und Bereichen (migration_017, Verwaltung «Logins»)
- [ ] **Kategorien** — Links nach Projekt/Kunde gruppieren
- [ ] **Statistik-Dashboard** — Öffnungsrate, aktivste Links
- [ ] **WhatsApp/E-Mail-Versand** — direktes Versenden des Links aus dem Admin-Panel

---

## Coding-Konventionen

- **Vanilla JS** — kein React, kein Vue, kein Framework
- **Keine Build-Tools** — kein Webpack, kein Vite. Alles direkt deploybar.
- **Netlify Functions** — Node.js, CommonJS (`require`), nicht ESM
- **Fehlerbehandlung** — jede Function gibt strukturierte JSON-Fehler zurück: `{ error: "Beschreibung" }`
- **Kommentare** — auf Deutsch, da internes Tool
- **Dateinamen** — Kleinschreibung, Bindestriche (kebab-case)
- **Input-Validierung** — immer serverseitig in den Functions prüfen

### Bekannte Mobile-Probleme (wiederkehrend)

- **Input-Felder `date` und `time` auf Mobile (iOS/Android):** Diese ragen auf schmalen Screens über den Container hinaus wenn `max-width: 100%` und `box-sizing: border-box` fehlen. IMMER `max-width: 100%; box-sizing: border-box;` auf alle Input-Typen setzen inkl. `date`, `time`, `number`.
- **`font-size` unter 16px auf iOS:** Inputs mit `font-size` kleiner als 16px verursachen einen automatischen Zoom auf iOS Safari. Auf Mobile immer mindestens `font-size: 16px` für Inputs setzen.
- **Autofill/Autocomplete:** Browser füllt Kunden-Formularfelder mit dem Admin-Passwort. Lösung: `autocomplete="off"` oder `autocomplete="new-password"` auf allen Kunden-Feldern.

---

## Sicherheits-Prinzipien

1. **Kein direkter Storage-Zugriff** — alle PDFs nur via signierte URLs mit kurzer TTL (60s)
2. **Service Key bleibt serverseitig** — niemals im Frontend-Code
3. **Token ist nicht erratbar** — 16 Bytes = 32 Hex-Zeichen Entropie
4. **Zugang wird bei jedem Request geprüft** — nicht gecacht
5. **Kein PDF im Browser-Cache** — `Cache-Control: no-store` Header
6. **Passwörter nur als scrypt-Hash** — Startpasswörter erscheinen genau einmal, nie im Klartext gespeichert oder geloggt
7. **Rechte serverseitig** — Bereiche werden in jeder Function geprüft, die Oberfläche blendet nur aus

---

## Bekannte Limitierungen (bewusst akzeptiert)

- **Foto des Bildschirms** ist nicht verhinderbar — das ist das «analoge Loch»
- **Browser-DevTools** können Canvas-Inhalt theoretisch extrahieren — für diesen Use-Case akzeptabel
- **Screen-Recording** ist nicht verhinderbar
- Das Ziel ist **hohe praktische Hürde**, nicht absolute DRM-Sicherheit

---

## Deployment

1. GitHub Repo → mit Netlify verbinden (Auto-Deploy bei Push)
2. Oder: manuelles Drag & Drop im Netlify Dashboard
3. Custom Domain: `docs.jaeggivollmer.ch`
   - DNS CNAME-Eintrag bei Hostpoint: `docs` → `[netlify-site].netlify.app`
   - SSL: automatisch via Netlify Let's Encrypt

---

## Kontakt / Betreiber

Jäggi Vollmer GmbH  
Horburgstrasse 96, 4057 Basel  
info@jaeggivollmer.ch  
Tel. 061 692 03 11
