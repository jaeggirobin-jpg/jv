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
├── index.html              → Admin-Panel (passwortgeschützt)
├── view.html               → Kunden-Viewer (Token-basiert)
├── netlify.toml            → Routing + Function-Config
└── netlify/functions/
    ├── get-pdf.js          → Sichere PDF-Auslieferung (signierte URL)
    ├── create-link.js      → Link erstellen (Admin)
    ├── toggle-link.js      → Link aktivieren/deaktivieren (Admin)
    ├── delete-link.js      → Link löschen inkl. Datei (Admin)
    └── list-links.js       → Alle Links auflisten (Admin)
```

### Datenfluss

```
Admin lädt PDF hoch
→ create-link.js speichert Datei in Supabase Storage
→ generiert einmaligen Token (UUID-basiert)
→ speichert Eintrag in doc_links Tabelle
→ gibt shareable URL zurück: docs.jaeggivollmer.ch/view.html?t=TOKEN

Kunde öffnet Link
→ view.html liest Token aus URL
→ ruft get-pdf.js auf mit Token
→ get-pdf.js prüft is_active in Supabase
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

### Storage

- Bucket-Name: `pdfs`
- Bucket-Typ: **privat** (kein öffentlicher Zugriff)
- Dateipfad-Konvention: `{token}/{original-filename}.pdf`

### Row Level Security (RLS)

RLS auf `doc_links` deaktiviert — Zugriff ausschliesslich via `service_role` Key in Netlify Functions. Kein direkter Client-Zugriff auf Supabase.

---

## Netlify Functions

Alle Functions verwenden den `service_role` Key (aus Environment Variable), niemals den `anon` Key. Der `anon` Key wird nur im Frontend für nichts verwendet — alle Supabase-Calls laufen serverseitig.

### Environment Variables (in Netlify setzen)

```
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   ← service_role, geheim
ADMIN_PASSWORD=...             ← selbst gewählt, mind. 16 Zeichen
```

### Authentifizierung Admin-Panel

Kein JWT, kein OAuth. Einfaches Passwort-Vergleich:
- Frontend sendet Passwort im `Authorization: Bearer PASSWORT` Header
- Jede Function prüft `process.env.ADMIN_PASSWORD` gegen den Header
- Bei Misserfolg: 401

---

## Frontend-Verhalten

### Admin-Panel (`index.html`)

- Passwort-Eingabe beim ersten Aufruf, gespeichert in `sessionStorage`
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
  - Text: `«Vertraulich – [Kundenname]»` + aktuelles Datum
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

```toml
[build]
  functions = "netlify/functions"
  publish = "."

[[headers]]
  for = "/view.html"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Cache-Control = "no-store"

[[headers]]
  for = "/*.pdf"
  [headers.values]
    X-Robots-Tag = "noindex"
```

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
- [ ] **Mehrbenutzer-Admin** — verschiedene Mitarbeiter mit eigenem Login
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

---

## Sicherheits-Prinzipien

1. **Kein direkter Storage-Zugriff** — alle PDFs nur via signierte URLs mit kurzer TTL (60s)
2. **Service Key bleibt serverseitig** — niemals im Frontend-Code
3. **Token ist nicht erratbar** — 16 Bytes = 32 Hex-Zeichen Entropie
4. **Zugang wird bei jedem Request geprüft** — nicht gecacht
5. **Kein PDF im Browser-Cache** — `Cache-Control: no-store` Header

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
