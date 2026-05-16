# HANDOFF: Inspiration-Erweiterung für docs.jaeggivollmer.ch-Repo

> **Read this first.** Dieses Dokument bringt Claude Code in den Stand, das bestehende docs.jaeggivollmer.ch-Repo um den Inspiration-Bereich zu erweitern. Vollständige fachliche Spezifikation: siehe `KONZEPT_Inspiration.md`.

---

## Kontext in 3 Sätzen

Es existiert bereits ein Netlify+Supabase-Setup für `docs.jaeggivollmer.ch`, das via Token-Link Kundendokumente (Bad-Visualisierungen) ausliefert (URL-Pattern: `view.html?t={32-hex-token}`). Dieses Repo wird **erweitert**, nicht ersetzt: zusätzlicher Inspiration-Bereich (One-Pager mit Apple-Style Scroll-Animationen, 4 Kategorien × 3–4 Items, Interesse-Toggle, Kommentare). Die neue Subdomain `inspiration.jaeggivollmer.ch` zeigt auf dieselbe Netlify-Site — beide Domains laufen parallel, ohne Redirects.

---

## Phase 0: Discovery (BEVOR Code geschrieben wird)

Claude Code soll **zuerst lesen, dann fragen, dann erst handeln**. Konkrete Reihenfolge:

### 0.1 Repo-Struktur erfassen
```bash
ls -la
cat README.md           # falls vorhanden
cat package.json        # falls vorhanden
find . -name "*.html" -not -path "*/node_modules/*"
find . -name "*.sql"
find . -name "*.js" -not -path "*/node_modules/*" | head -20
```

### 0.2 Frontend-Pattern verstehen
- `view.html` vollständig lesen
- Wie wird das Token aus der URL extrahiert?
- Welcher Supabase-Client (CDN-URL, Version)?
- Welche RPC-Funktionen oder direkten Table-Queries werden aufgerufen?
- Wie funktioniert das Watermarking?
- PDF.js-Konfiguration?

### 0.3 Supabase-Schema inspizieren
Möglichkeiten je nach Repo-Zustand:
- **a)** Migrations-Files vorhanden (`supabase/migrations/`, `db/`, `sql/`): alle lesen und mental konsolidieren
- **b)** Schema-Dump im Repo: lesen
- **c)** Nichts vorhanden: Robin fragen, ob er einen Supabase-Schema-Export liefern kann (Supabase Dashboard → Database → Schema → Export) **ODER** falls Service-Role-Key verfügbar: per `psql` oder Supabase API das Schema dumpen

Festzustellen:
- Name und Felder der Kunden-Tabelle (vermutlich `kunden`, `recipients` o.ä.)
- Existieren `access_token`, `status`, `nachname` schon? In welcher Form?
- Wie sieht die Dokumenten-Tabelle aus?
- Welche RLS-Policies sind aktiv?
- Existieren bereits SECURITY DEFINER Funktionen?

### 0.4 Bestandsaufnahme zusammenfassen
Bevor Code geschrieben wird, gibt Claude Code eine **kurze Zusammenfassung** an Robin aus:
- Datei-Übersicht des Repos
- Bestehende Schema-Struktur (Tabellen + relevante Felder)
- Vorgeschlagene additive Migration (welche Tabellen ALTER, welche neu)
- Frontend-Plan (neue `index.html`, oder `inspiration.html`, oder Tab-Switching?)
- Geschätzte Codeänderungen pro Datei

Robin bestätigt → erst dann Implementation.

---

## Phase 1: DNS & Netlify (manuell, durch Robin)

**Diese Schritte macht Robin, nicht Claude Code:**

### 1.1 Hostpoint DNS
1. Login Hostpoint → Domain `jaeggivollmer.ch` → DNS-Einstellungen
2. Neuen CNAME-Record anlegen:
   - **Name:** `inspiration`
   - **Wert:** identisch zum bestehenden `docs`-Record (vermutlich `<sitename>.netlify.app`)
   - TTL: Standard
3. Speichern. Propagation: 5–30 Min.

### 1.2 Netlify
1. Bestehende docs-Site → Site Settings → Domain Management
2. "Add custom domain" → `inspiration.jaeggivollmer.ch`
3. Netlify prüft DNS, provisioniert Let's Encrypt SSL (5–10 Min)
4. Optional: Primary Domain auf `inspiration.jaeggivollmer.ch` umstellen

**Resultat:** Beide Subdomains zeigen auf dieselbe Site. Bestehende Links unter `docs.jaeggivollmer.ch/view.html?t=...` funktionieren unverändert weiter.

---

## Phase 2: Supabase-Migration (additiv)

Basierend auf der Discovery aus Phase 0.3 erstellt Claude Code eine **additive Migration**. Grundregeln:

- Bestehende Tabellen nur via `ALTER TABLE ADD COLUMN` erweitern (idempotent: `IF NOT EXISTS`)
- Neue Tabellen nur, wenn noch nicht vorhanden
- Bestehende RLS-Policies nicht ersetzen — nur ergänzen
- Bestehende RPC-Funktionen nicht überschreiben — neue daneben anlegen

### 2.1 Voraussichtlich nötige Erweiterungen

Hinweis: Spaltennamen müssen ggf. an bestehende Konventionen angepasst werden (CamelCase vs. snake_case, Englisch vs. Deutsch). Claude Code soll dem bestehenden Stil folgen.

**Bestehende Kunden-Tabelle** (Name aus Discovery, hier `kunden` als Platzhalter):
```sql
ALTER TABLE kunden 
  ADD COLUMN IF NOT EXISTS anrede_typ text 
    CHECK (anrede_typ IN ('person', 'familie')),
  ADD COLUMN IF NOT EXISTS vorname text,
  ADD COLUMN IF NOT EXISTS termin_datum date,
  ADD COLUMN IF NOT EXISTS termin_uhrzeit time,
  ADD COLUMN IF NOT EXISTS projekt_adresse text,
  ADD COLUMN IF NOT EXISTS admin_notizen text;
```

**Neue Tabellen** (siehe vollständige Definitionen in `KONZEPT_Inspiration.md` Abschnitt 6):
- `inspiration_punkte` (Master-Katalog, 14 Seed-Items)
- `kunden_interessen` (Toggle-State + Kommentare)
- `aktivitaet_log` (Audit-Trail)

**Neue RPC-Funktionen:**
- `get_inspiration_data(p_token)` — gibt Kunde + Punkte + Interessen zurück
- `upsert_interesse(p_token, p_punkt_id, p_interessiert, p_kommentar)`
- `update_kommentar(p_token, p_punkt_id, p_kommentar)`

### 2.2 Seed-Daten
14 Inspiration-Punkte aus dem Claude-Design-Prompt extrahieren und als INSERT-Statements einfügen. Bilder/Videos werden in Phase 4 ergänzt (zunächst NULL → Frontend zeigt Platzhalter).

### 2.3 Storage-Bucket
Neuer öffentlicher Bucket `inspiration-medien` in Supabase Storage (Read-only für anon). Ordnerstruktur: `wc/`, `waschtisch/`, `armaturen/`, `dusche/`.

---

## Phase 3: Frontend-Erweiterung

### 3.1 Neue Datei: `index.html` (oder `inspiration.html`)

Quelle: Output aus Claude Design via `PROMPT_ClaudeDesign_Inspiration.md`. Robin liefert die generierte HTML-Datei. Claude Code:

1. Datei ins Repo legen
2. Hardcoded Customer-Object (z.B. `const kunde = { nachname: 'Müller', ... }`) ersetzen durch Supabase-Fetch via `get_inspiration_data(token)`
3. Hardcoded Inspiration-Punkte (im Array im JS) ersetzen durch die `data.punkte` aus der RPC-Response — Frontend rendert dynamisch
4. Toggle-Logik mit Optimistic UI + Supabase-Persistenz (Code-Pattern in `KONZEPT_Inspiration.md` Abschnitt 10.2)
5. Kommentar-Input mit Debounce (500ms)
6. Loading-State (Skeleton während Daten laden)
7. Error-State (Token ungültig → "Dieser Link ist nicht mehr aktiv. Bei Fragen: Robin Jäggi, +41 ...")
8. Bestehende `view.html` (Dokumente) per Link/Tab erreichbar machen, sobald `data.hat_dokumente === true`

### 3.2 Tab-Switching zwischen Inspiration & Dokumente

Zwei mögliche Patterns, Claude Code entscheidet basierend auf Repo-Stil:

**(a) Zwei separate HTML-Dateien** (`index.html` + `view.html`)
- Kunde startet auf `/?t=...` (Inspiration)
- Wenn `hat_dokumente`: Link/Button erscheint "Ihre Pläne ansehen →" → `/view.html?t=...`
- Auf `view.html` umgekehrt: Link zurück zur Inspiration

**(b) Single-Page mit Tabs**
- `index.html` enthält beide Bereiche als Tabs
- Tab "Dokumente" nur sichtbar wenn `hat_dokumente`
- Tab-Wechsel ohne Reload, Browser-History via `history.pushState`

Empfehlung: **(a)** ist einfacher und respektiert die bestehende `view.html`-Logik. Robin entscheidet im Review.

### 3.3 URL-Pattern beibehalten

Token bleibt als Query-Parameter `?t=...`. Keine Pfad-basierten URLs (`/k/{token}`), da das den bestehenden Routing-Stil bricht.

---

## Phase 4: Bilder & Videos

**Macht Robin:**
1. 14 Bilder kuratieren (Naturstein, Holz, warmes Licht — keine Hersteller-Showrooms)
2. Optional 3–4 kurze Videos (z.B. Silent-Flush, berührungslose Armatur) — generisch oder selbst aufgenommen
3. Videos komprimieren (`ffmpeg`-Befehl in KONZEPT Abschnitt 7)
4. Upload in Supabase Storage Bucket `inspiration-medien/{kategorie}/`

**Macht Claude Code:**
- UPDATE-Statements auf `inspiration_punkte` mit den Storage-URLs

---

## Phase 5: Admin-Erweiterung

Vermutlich existiert im Repo bereits ein Admin-Bereich (für Document-Upload, Kunden-Anlage). Erweiterungen:

### 5.1 Kunden-Anlage erweitern
Bestehendes Formular um neue Felder ergänzen: Anrede-Typ (Person/Familie), Vorname, Termin Datum + Uhrzeit, Projekt-Adresse.

### 5.2 Neue Admin-View: "Interessen"
Pro Kunde anzeigen:
- Liste der markierten Inspiration-Punkte mit Kommentaren
- Aktivitäts-Log (wann zuletzt geöffnet)
- PDF-Export für die Begehung

### 5.3 Katalog-Verwaltung (optional, später)
`/admin/katalog` — CRUD auf `inspiration_punkte`.

---

## Konkrete TODO-Liste für Claude Code

Sortiert nach Reihenfolge:

```
□ 1. Discovery: Repo-Struktur, view.html-Pattern, Supabase-Schema
□ 2. Discovery-Report an Robin, auf Bestätigung warten
□ 3. Migration-File schreiben (additiv, idempotent), in passendem Ordner ablegen
□ 4. Migration in Supabase ausführen (Robin gibt Service-Role-Key via .env, oder führt manuell aus)
□ 5. Seed-Daten für inspiration_punkte einspielen
□ 6. Storage-Bucket inspiration-medien anlegen
□ 7. Claude-Design HTML ins Repo legen (Robin liefert)
□ 8. HTML mit Supabase verbinden (RPC-Calls, dynamisches Rendering)
□ 9. Loading/Error/Deaktiviert-States
□ 10. Tab- oder Link-Switching zu view.html bei vorhandenen Dokumenten
□ 11. Mobile-Test auf Deploy-Preview
□ 12. Admin-Formular um neue Felder erweitern
□ 13. Admin-View "Interessen" implementieren
□ 14. PDF-Export der Kunden-Auswahl (für Begehung)
□ 15. Robin testet auf Deploy-Preview, mergen, manuell publishen
```

---

## Wichtige Hinweise & Stolpersteine

### Konsistenz mit bestehendem Code
- Coding-Stil des Repos einhalten (Einrückung, Semikolons, var/let/const, Sprache der Identifier)
- Supabase-Client-Version nicht ändern — bestehende Patterns weiterverwenden
- Falls bestehende RLS-Policies anders strukturiert sind als im KONZEPT empfohlen: bestehendem Pattern folgen, nicht erzwingen

### Token-Sicherheit
Bestehendes Token-Pattern (32 hex) ist sicher genug. Keine Änderung nötig.

### Anonymer Zugriff
Falls das bestehende Repo direkten Tabellen-Zugriff für anon erlaubt (statt SECURITY DEFINER): den Stil beibehalten **wenn die existierenden RLS-Policies sicher sind**. Andernfalls die SECURITY DEFINER Funktionen aus dem KONZEPT verwenden — die sind die saubere Variante.

### Deaktivierte Kunden
Status-Wert für Deaktivierung: prüfen, was im bestehenden Code verwendet wird (`active`/`inactive`, `aktiv`/`deaktiviert`, `enabled` boolean). Konsistent bleiben.

### Service Worker
Falls das Repo bereits einen Service Worker hat (für Offline-Caching): Achtung mit dem neuen Inspiration-HTML — eventuell Cache-Strategie anpassen, damit neue Versionen sofort beim Kunden ankommen.

### Bestehende Watermark-Logik
Bei den Visualisierungen wird per PDF.js + Watermark gerendert. Inspiration braucht keinen Watermark — Inhalte sind generisch, nicht kundenspezifisch geschützt. Aber: pro Kunde zeigt der Hero seinen Namen, das ist Personalisierung, kein Schutz.

### Performance
Inspiration-HTML wird einmalig geladen, dann viel JavaScript (Sticky Sections, IntersectionObserver). Auf älteren Android-Geräten testen. Bilder vorab komprimieren (max 200 KB/Bild via Squoosh oder ähnlich).

### Auto-play Videos
Nur stumm autoplay-fähig. `<video muted playsinline loop autoplay>`. Auf iOS Safari ist `playsinline` zwingend.

---

## Referenzen

- **Fachliche Spezifikation:** `KONZEPT_Inspiration.md`
- **Visueller Brief:** `PROMPT_ClaudeDesign_Inspiration.md`
- **Bestehendes Repo:** docs.jaeggivollmer.ch (lokal cloned by Claude Code)

---

## Open Loop für Robin

Nach Discovery (Phase 0) zurück an Robin mit:
1. Schema-Bestandsaufnahme (Tabellen + Spalten)
2. Welche Anpassungen sind nötig?
3. Stilfragen (Tab vs. zwei Seiten, deutscher/englischer Identifier, ...)
4. Erwartete Aufwandsschätzung in Schritten

Erst nach Robins OK: Migration und Code schreiben.
