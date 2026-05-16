# KONZEPT: Inspiration-Plattform jaeggivollmer.ch

**Stand:** Mai 2026  
**Owner:** Robin Jäggi  
**Status:** Konzept / Pre-Implementation

---

## 1. Vision

Personalisierter, web-basierter Inspirationskatalog für Bad-Umbau-Kunden. Jeder Kunde erhält einen individuellen Link, sieht beim Öffnen seinen Namen und den Begehungstermin, scrollt durch vier Kategorien (WC, Waschtisch, Armaturen, Dusche) mit je 3–4 kuratierten Optionen und markiert per Toggle, was ihn interessiert. Pro Punkt kann er einen Kommentar hinterlassen.

**Geschäftsziel:** Begehung qualitativ aufwerten, Kundenwünsche schon vor dem Termin abholen, Premium-Eindruck transportieren — bewusster Gegenpol zur klassischen Handwerker-Kommunikation.

**Strategischer Kontext:** Plattform ersetzt und erweitert `docs.jaeggivollmer.ch`. Bleibt JV-internes Tool (nicht als GEMA-Modul lizenzierbar geplant).

---

## 2. Verschmelzung mit docs.jaeggivollmer.ch

**Entscheidung:** Variante 1 — eine Plattform unter `inspiration.jaeggivollmer.ch` mit zwei Bereichen pro Kunde:

1. **Inspiration** (Katalog) — sichtbar ab Erstkontakt
2. **Dokumente** (Visualisierungen, Pläne, Angebot) — Bereich erscheint dynamisch, sobald Dokumente hochgeladen sind

Ein Link, eine Kundenreise. Vor der Begehung sieht der Kunde nur die Inspiration; nach der Begehung wachsen Visualisierungen und Pläne hinzu. Gleicher Look, gleicher Login-freier Zugang via Token.

**DNS-Migration:**
- `inspiration.jaeggivollmer.ch` wird neuer Primär-Host (Hostpoint CNAME → Netlify)
- `docs.jaeggivollmer.ch` bleibt vorerst aktiv und leitet via 301 auf den Inspiration-Bereich um, sobald migriert
- Alte Doc-Links: entweder migrieren oder als Legacy bis zum Ablauf weiterbetreiben

---

## 3. Architektur

```
┌────────────────────────────────────────────────────────────┐
│  Browser (Kunde Mobile/Desktop)                            │
│  inspiration.jaeggivollmer.ch/k/{access_token}             │
└────────────────────────┬───────────────────────────────────┘
                         │ HTTPS
              ┌──────────▼──────────┐
              │   Netlify (Static)  │
              │  HTML + CSS + JS    │
              │  (Claude Design     │
              │   Output, dann      │
              │   Supabase-aware)   │
              └──────────┬──────────┘
                         │
              ┌──────────▼────────────────────────────┐
              │   Supabase (EU-West, Frankfurt)       │
              │  ├─ Postgres (RLS + SECURITY DEFINER) │
              │  ├─ Storage (Videos, Bilder, PDFs)    │
              │  └─ Auth (nur für Admin/Robin)        │
              └───────────────────────────────────────┘
```

**Komponenten:**
- **Frontend:** Vanilla HTML/CSS/JS, gehostet auf Netlify (gleiches Konto wie GEMA und docs)
- **Backend:** Supabase, gleiche Region wie GEMA — Frankfurt für DSG-Konformität
- **Repo:** Neues GitHub-Repo `jv-inspiration` (privat oder public mit Branch-Protection)
- **Auto-Deploy:** GitHub → Netlify, Deploy Previews bei PR

---

## 4. URL-Struktur

| Pfad | Zweck | Auth |
|---|---|---|
| `/` | Optionale Marketing-Landing (oder 404, falls nicht gewollt) | — |
| `/k/{access_token}` | Kunden-Inspiration (One-Pager) | Token |
| `/k/{access_token}/dokumente` | Kunden-Dokumente (Visualisierungen) | Token |
| `/admin` | Login-Seite | — |
| `/admin/kunden` | Kunden-Liste + Verwaltung | Supabase Auth |
| `/admin/kunden/{id}` | Kunden-Detail (Interessen, Notizen, Dokumente) | Supabase Auth |
| `/admin/katalog` | Inspiration-Punkte verwalten (Master-Daten) | Supabase Auth |

**Access-Token-Format:** 32-stelliger Hex-String (kollisionssicher, nicht erratbar)

---

## 5. Datenmodell

### Übersicht

```
kunden ─┬─< kunden_interessen >── inspiration_punkte
        ├─< dokumente
        └─< aktivitaet_log
```

### Tabellen

**`kunden`** — pro Bad-Umbau-Kunde ein Datensatz
- `id` (uuid PK)
- `anrede_typ` ('person' | 'familie')
- `vorname`, `nachname`
- `email`, `telefon` (optional)
- `projekt_adresse`
- `termin_datum`, `termin_uhrzeit`
- `access_token` (unique, URL-Component)
- `status` ('aktiv' | 'deaktiviert' | 'archiviert')
- `admin_notizen` (interne Notizen für Robin)
- `created_at`, `updated_at`

**`inspiration_punkte`** — Master-Katalog (vorerst 14 Items für 4 Kategorien)
- `id` (uuid PK)
- `kategorie` ('wc' | 'waschtisch' | 'armaturen' | 'dusche')
- `reihenfolge` (int, für Sortierung)
- `titel`
- `kurzbeschreibung`
- `vorteil`
- `zu_bedenken`
- `bild_url` (Supabase Storage)
- `video_url` (optional, Supabase Storage)
- `aktiv` (boolean, für späteres Deaktivieren ohne Datenverlust)

**`kunden_interessen`** — Was der Kunde markiert hat
- `id` (uuid PK)
- `kunden_id` (FK → kunden)
- `punkt_id` (FK → inspiration_punkte)
- `interessiert` (boolean, default true)
- `kommentar` (text)
- `markiert_am`, `updated_at`
- UNIQUE (kunden_id, punkt_id)

**`dokumente`** — Migrierte docs-Funktionalität
- `id` (uuid PK)
- `kunden_id` (FK → kunden)
- `dateiname`
- `storage_path` (Supabase Storage Pfad)
- `typ` ('visualisierung' | 'plan' | 'angebot' | 'sonstiges')
- `watermark_text`
- `hochgeladen_am`
- `sichtbar` (boolean — Robin kann einzelne Dokumente verstecken)

**`aktivitaet_log`** — Audit-Trail (DSG-konform, IP nur gehasht)
- `id` (uuid PK)
- `kunden_id` (FK)
- `aktion` ('seite_geoeffnet' | 'punkt_markiert' | 'punkt_demarkiert' | 'kommentar_hinzu' | 'dokument_geoeffnet' | ...)
- `details` (jsonb)
- `ip_hash` (sha256 der IP, kein Klartext)
- `timestamp`

---

## 6. SQL Migration

```sql
-- ============================================================================
-- inspiration_001_initial.sql
-- Inspiration-Plattform Jäggi Vollmer
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- Kunden
-- ----------------------------------------------------------------------------
CREATE TABLE kunden (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anrede_typ text NOT NULL CHECK (anrede_typ IN ('person', 'familie')),
  vorname text,
  nachname text NOT NULL,
  email text,
  telefon text,
  projekt_adresse text,
  termin_datum date,
  termin_uhrzeit time,
  access_token text NOT NULL UNIQUE 
    DEFAULT replace(gen_random_uuid()::text, '-', ''),
  status text NOT NULL DEFAULT 'aktiv' 
    CHECK (status IN ('aktiv', 'deaktiviert', 'archiviert')),
  admin_notizen text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_kunden_token ON kunden (access_token);
CREATE INDEX idx_kunden_status ON kunden (status);

-- ----------------------------------------------------------------------------
-- Inspiration-Punkte (Master-Katalog)
-- ----------------------------------------------------------------------------
CREATE TABLE inspiration_punkte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kategorie text NOT NULL 
    CHECK (kategorie IN ('wc', 'waschtisch', 'armaturen', 'dusche')),
  reihenfolge int NOT NULL,
  titel text NOT NULL,
  kurzbeschreibung text,
  vorteil text,
  zu_bedenken text,
  bild_url text,
  video_url text,
  aktiv boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_punkte_kategorie 
  ON inspiration_punkte (kategorie, reihenfolge) WHERE aktiv;

-- ----------------------------------------------------------------------------
-- Kunden-Interessen
-- ----------------------------------------------------------------------------
CREATE TABLE kunden_interessen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kunden_id uuid NOT NULL REFERENCES kunden(id) ON DELETE CASCADE,
  punkt_id uuid NOT NULL REFERENCES inspiration_punkte(id) ON DELETE CASCADE,
  interessiert boolean NOT NULL DEFAULT true,
  kommentar text,
  markiert_am timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kunden_id, punkt_id)
);

CREATE INDEX idx_interessen_kunde ON kunden_interessen (kunden_id);

-- ----------------------------------------------------------------------------
-- Dokumente
-- ----------------------------------------------------------------------------
CREATE TABLE dokumente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kunden_id uuid NOT NULL REFERENCES kunden(id) ON DELETE CASCADE,
  dateiname text NOT NULL,
  storage_path text NOT NULL,
  typ text CHECK (typ IN ('visualisierung', 'plan', 'angebot', 'sonstiges')),
  watermark_text text,
  hochgeladen_am timestamptz NOT NULL DEFAULT now(),
  sichtbar boolean NOT NULL DEFAULT true
);

CREATE INDEX idx_dokumente_kunde ON dokumente (kunden_id) WHERE sichtbar;

-- ----------------------------------------------------------------------------
-- Aktivitätslog
-- ----------------------------------------------------------------------------
CREATE TABLE aktivitaet_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kunden_id uuid REFERENCES kunden(id) ON DELETE SET NULL,
  aktion text NOT NULL,
  details jsonb,
  ip_hash text,
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_log_kunde_zeit 
  ON aktivitaet_log (kunden_id, timestamp DESC);

-- ----------------------------------------------------------------------------
-- Updated-At-Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kunden_updated 
  BEFORE UPDATE ON kunden
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_interessen_updated 
  BEFORE UPDATE ON kunden_interessen
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS aktivieren
-- ----------------------------------------------------------------------------
ALTER TABLE kunden ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspiration_punkte ENABLE ROW LEVEL SECURITY;
ALTER TABLE kunden_interessen ENABLE ROW LEVEL SECURITY;
ALTER TABLE dokumente ENABLE ROW LEVEL SECURITY;
ALTER TABLE aktivitaet_log ENABLE ROW LEVEL SECURITY;

-- Admin (authenticated) hat volle Rechte auf alles
CREATE POLICY admin_all_kunden ON kunden FOR ALL TO authenticated 
  USING (true) WITH CHECK (true);
CREATE POLICY admin_all_punkte ON inspiration_punkte FOR ALL TO authenticated 
  USING (true) WITH CHECK (true);
CREATE POLICY admin_all_interessen ON kunden_interessen FOR ALL TO authenticated 
  USING (true) WITH CHECK (true);
CREATE POLICY admin_all_dokumente ON dokumente FOR ALL TO authenticated 
  USING (true) WITH CHECK (true);
CREATE POLICY admin_all_log ON aktivitaet_log FOR ALL TO authenticated 
  USING (true) WITH CHECK (true);

-- ANON darf inspiration_punkte lesen (Master-Katalog ist nicht sensibel)
CREATE POLICY anon_punkte_select ON inspiration_punkte FOR SELECT 
  TO anon USING (aktiv = true);

-- Alle anderen Tabellen: KEIN direkter anon-Zugriff
-- Stattdessen SECURITY DEFINER Funktionen (siehe unten)

-- ----------------------------------------------------------------------------
-- RPC Funktionen für Kunden-Frontend (Token-basiert)
-- ----------------------------------------------------------------------------

-- Kunde + alle seine Interessen + alle aktiven Punkte holen
CREATE OR REPLACE FUNCTION get_inspiration_data(p_token text)
RETURNS jsonb
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_kunde kunden%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_kunde 
    FROM kunden 
   WHERE access_token = p_token 
     AND status = 'aktiv';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or inactive token';
  END IF;

  v_result := jsonb_build_object(
    'kunde', jsonb_build_object(
      'id', v_kunde.id,
      'anrede_typ', v_kunde.anrede_typ,
      'vorname', v_kunde.vorname,
      'nachname', v_kunde.nachname,
      'projekt_adresse', v_kunde.projekt_adresse,
      'termin_datum', v_kunde.termin_datum,
      'termin_uhrzeit', v_kunde.termin_uhrzeit
    ),
    'punkte', (
      SELECT jsonb_agg(p.* ORDER BY p.kategorie, p.reihenfolge)
        FROM inspiration_punkte p
       WHERE p.aktiv = true
    ),
    'interessen', (
      SELECT jsonb_agg(jsonb_build_object(
        'punkt_id', ki.punkt_id,
        'interessiert', ki.interessiert,
        'kommentar', ki.kommentar
      ))
        FROM kunden_interessen ki
       WHERE ki.kunden_id = v_kunde.id
    ),
    'hat_dokumente', (
      SELECT COUNT(*) > 0 FROM dokumente d 
       WHERE d.kunden_id = v_kunde.id AND d.sichtbar
    )
  );

  -- Logging
  INSERT INTO aktivitaet_log (kunden_id, aktion)
  VALUES (v_kunde.id, 'seite_geoeffnet');

  RETURN v_result;
END;
$$;

-- Interesse setzen/aktualisieren
CREATE OR REPLACE FUNCTION upsert_interesse(
  p_token text,
  p_punkt_id uuid,
  p_interessiert boolean,
  p_kommentar text DEFAULT NULL
)
RETURNS void
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_kunde_id uuid;
BEGIN
  SELECT id INTO v_kunde_id 
    FROM kunden 
   WHERE access_token = p_token AND status = 'aktiv';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or inactive token';
  END IF;

  INSERT INTO kunden_interessen (kunden_id, punkt_id, interessiert, kommentar)
  VALUES (v_kunde_id, p_punkt_id, p_interessiert, p_kommentar)
  ON CONFLICT (kunden_id, punkt_id)
  DO UPDATE SET 
    interessiert = EXCLUDED.interessiert,
    kommentar = COALESCE(EXCLUDED.kommentar, kunden_interessen.kommentar),
    updated_at = now();

  INSERT INTO aktivitaet_log (kunden_id, aktion, details)
  VALUES (v_kunde_id,
    CASE WHEN p_interessiert THEN 'punkt_markiert' ELSE 'punkt_demarkiert' END,
    jsonb_build_object('punkt_id', p_punkt_id));
END;
$$;

-- Kommentar aktualisieren (separate Funktion für Debounce-Updates)
CREATE OR REPLACE FUNCTION update_kommentar(
  p_token text,
  p_punkt_id uuid,
  p_kommentar text
)
RETURNS void
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_kunde_id uuid;
BEGIN
  SELECT id INTO v_kunde_id 
    FROM kunden 
   WHERE access_token = p_token AND status = 'aktiv';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or inactive token';
  END IF;

  -- Wenn noch kein Interesse-Eintrag besteht, einen anlegen (auch ohne Markierung)
  INSERT INTO kunden_interessen (kunden_id, punkt_id, interessiert, kommentar)
  VALUES (v_kunde_id, p_punkt_id, false, p_kommentar)
  ON CONFLICT (kunden_id, punkt_id)
  DO UPDATE SET 
    kommentar = EXCLUDED.kommentar,
    updated_at = now();

  INSERT INTO aktivitaet_log (kunden_id, aktion, details)
  VALUES (v_kunde_id, 'kommentar_hinzu',
    jsonb_build_object('punkt_id', p_punkt_id));
END;
$$;

-- Dokumente eines Kunden holen
CREATE OR REPLACE FUNCTION get_dokumente(p_token text)
RETURNS jsonb
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_kunde_id uuid;
BEGIN
  SELECT id INTO v_kunde_id 
    FROM kunden 
   WHERE access_token = p_token AND status = 'aktiv';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or inactive token';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'dateiname', d.dateiname,
      'storage_path', d.storage_path,
      'typ', d.typ,
      'watermark_text', d.watermark_text,
      'hochgeladen_am', d.hochgeladen_am
    ) ORDER BY d.hochgeladen_am DESC), '[]'::jsonb)
      FROM dokumente d
     WHERE d.kunden_id = v_kunde_id AND d.sichtbar
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_inspiration_data(text) TO anon;
GRANT EXECUTE ON FUNCTION upsert_interesse(text, uuid, boolean, text) TO anon;
GRANT EXECUTE ON FUNCTION update_kommentar(text, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION get_dokumente(text) TO anon;
```

**Vorteil dieses Patterns:** Anon-Rolle hat keinen direkten Tabellen-Zugriff. Alle Operationen laufen über validierende RPC-Funktionen. Token-Diebstahl ist die einzige Angriffsfläche, und gestohlene Tokens können sofort über `status = 'deaktiviert'` invalidiert werden.

---

## 7. Storage-Struktur (Supabase Storage)

```
inspiration-medien/    (public, read-only)
  ├─ wc/
  │   ├─ wand-wc.jpg
  │   ├─ silent-flush.jpg
  │   ├─ silent-flush.mp4
  │   └─ ...
  ├─ waschtisch/
  ├─ armaturen/
  └─ dusche/

kunden-dokumente/       (private, signed URLs via RPC)
  └─ {kunden_id}/
      ├─ visualisierung_001.pdf
      ├─ plan_grundriss.pdf
      └─ ...
```

**Videos:** als `.mp4` (H.264, max 2 MB pro Clip — kurze Loops 5–10s reichen), Alternative `.webm` für moderne Browser. Auto-play funktioniert nur stumm — auf jedem Video `muted playsinline loop autoplay`.

**Kompressions-Empfehlung** mit `ffmpeg`:
```bash
ffmpeg -i input.mp4 -vcodec libx264 -crf 28 -preset slow \
       -vf "scale=1280:-2" -an output.mp4
```

---

## 8. Customer Flow

```
1. Robin schickt WhatsApp/E-Mail mit Link:
   "Frau Müller, wir freuen uns auf den Termin am 12. Juni. 
    Hier ein paar Inspirationen vorab: inspiration.jaeggivollmer.ch/k/abc123..."

2. Kunde tippt drauf (meistens Mobile)
   → Hero mit Begrüssung: "Frau Müller, wir freuen uns auf Ihr Bad."
   → Termin sichtbar
   
3. Kunde scrollt durch
   → 4 Kategorien, Apple-Style
   → Markiert per Tipp "Interessiert"
   → Optional: Kommentar zu einzelnen Punkten
   
4. Zusammenfassung am Ende: zeigt aktuelle Auswahl
5. Termin-Karte zur Erinnerung

6. Kunde kann später wiederkommen
   → State persistiert, alles noch markiert
   → Kann Markierungen anpassen

7. Am Begehungstermin öffnet Robin sein Admin-Dashboard
   → Sieht alle Markierungen + Kommentare
   → Kann offline (PDF-Export) oder online besprechen

8. Nach Begehung: Robin lädt Visualisierungen/Pläne hoch
   → Im Kunden-Link erscheint "Dokumente"-Tab
   → Kunde sieht und kann ansehen (PDF.js, kein Download)

9. Falls Auftrag nicht zustande kommt:
   → Robin setzt Kunde auf "deaktiviert"
   → Link wirft sofort 410 Gone / Redirect auf Hauptseite
```

---

## 9. Admin Flow (Robin)

**Tägliche Workflows:**

### Neuer Kunde anlegen
1. `/admin/kunden/neu`
2. Felder: Vorname, Nachname, Anrede-Typ, Email, Telefon, Adresse, Termin
3. Speichern → automatisch `access_token` generiert
4. **Share-Button:** WhatsApp-Vorlage oder E-Mail-Vorlage mit fertigem Link in die Zwischenablage

### Vor Begehung
1. Auf Kunde klicken → Detail-Ansicht
2. **Interessen-Liste:** Was hat Kunde markiert? Welche Kommentare?
3. **Aktivitäts-Log:** Wann hat Kunde die Seite zuletzt geöffnet? (signalisiert Engagement)
4. **PDF-Export** für die Begehung (offline-fähig auf dem iPad)

### Nach Begehung
1. Visualisierungen/Pläne als PDF hochladen
2. Dokument-Typ wählen (Visualisierung / Plan / Angebot)
3. Watermark-Text setzen (default: "Persönlich für Familie Müller — Jäggi Vollmer")

### Kunde deaktivieren
1. Status auf "deaktiviert" setzen → Link funktioniert nicht mehr (sofort, kein Cache)
2. Optional später: "archivieren" (verbirgt aus Standardliste, behält Daten für 3 Jahre)

### Katalog pflegen (selten)
1. `/admin/katalog`
2. Liste aller 14 Inspiration-Punkte
3. Bearbeiten, neu hinzufügen, deaktivieren
4. Reihenfolge per Drag&Drop

---

## 10. Embedding der Claude Design Seite — Workflow

Die Claude Design Ausgabe ist ein statisches HTML mit JS-State. Zwei Schritte, um sie produktiv zu machen:

### Schritt 1: Variablen-Replacement
Im Claude-Design-Output:
```javascript
const kunde = {
  anredeTyp: 'familie',
  nachname: 'Müller',
  termin: { datum: '2026-06-12', uhrzeit: '14:00', adresse: '...' }
};
```

**Wird ersetzt durch:**
```javascript
// 1. Token aus URL extrahieren
const token = window.location.pathname.split('/k/')[1]?.split('/')[0];
if (!token) location.href = '/';

// 2. Supabase Client initialisieren
const SUPABASE_URL = 'https://xxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 3. Daten laden via RPC
const { data, error } = await sb.rpc('get_inspiration_data', { p_token: token });
if (error) { /* zeige Fehlerseite */ }

const kunde = data.kunde;
const punkte = data.punkte;          // dynamische Inhalte
const initialInteressen = new Map(   // existierende Markierungen
  (data.interessen || []).map(i => [i.punkt_id, i])
);
const hatDokumente = data.hat_dokumente;
```

### Schritt 2: Toggle/Comment-Persistenz
**Statt** lokalem State-Update:
```javascript
toggleInteresse(punktId) {
  state[punktId] = !state[punktId];
  updateUI();
}
```

**Mit** Supabase-Persistenz + Optimistic UI:
```javascript
async function toggleInteresse(punktId) {
  // Optimistic UI Update zuerst
  const aktuell = interessen.get(punktId);
  const neu = !aktuell?.interessiert;
  interessen.set(punktId, { ...aktuell, punkt_id: punktId, interessiert: neu });
  updateUI();

  // Persistieren
  const { error } = await sb.rpc('upsert_interesse', {
    p_token: token,
    p_punkt_id: punktId,
    p_interessiert: neu
  });
  
  if (error) {
    // Rollback bei Fehler
    interessen.set(punktId, aktuell);
    updateUI();
    zeigeFehler('Konnte nicht gespeichert werden. Bitte erneut versuchen.');
  }
}

// Kommentar mit Debounce (500ms nach letzter Eingabe)
const kommentarDebounce = new Map();
function handleKommentarInput(punktId, text) {
  clearTimeout(kommentarDebounce.get(punktId));
  kommentarDebounce.set(punktId, setTimeout(async () => {
    await sb.rpc('update_kommentar', {
      p_token: token,
      p_punkt_id: punktId,
      p_kommentar: text
    });
  }, 500));
}
```

### Schritt 3: Bild-/Video-URLs aus Storage
Der Claude-Design-Output verwendet Unsplash-Platzhalter. Im Produktiv-Build kommen die URLs aus `inspiration_punkte.bild_url` / `video_url`, die auf Supabase Storage zeigen (`https://xxx.supabase.co/storage/v1/object/public/inspiration-medien/wc/silent-flush.jpg`).

---

## 11. Sicherheit & nDSG-Konformität

**Datenarten:**
- Kundendaten (Name, Telefon, Adresse, Termin) — niedrig sensitiv, Schweizer Privat-Adressen
- Interessen/Kommentare — kann persönliche Wünsche enthalten (z.B. "barrierefrei wegen Mobilität meiner Frau")
- Aktivitätslog — IP gehasht, nicht im Klartext gespeichert

**Schutzmassnahmen:**
- Hosting in der EU (Supabase Frankfurt) — DSG-konform
- Tokens sind 32 Zeichen Hex (~128 bit Entropie) — nicht erratbar
- HTTPS-only (Netlify-Default)
- Deaktivierte Kunden: Token wirft 401 sofort, kein Cache
- Anon-Rolle hat keinen direkten Tabellen-Zugriff (nur RPC-Funktionen)
- Auto-Löschung archivierter Kunden nach 3 Jahren (Cron-Job)
- Kein Tracking ausser dem internen aktivitaet_log
- Datenschutzerklärung im Footer verlinkt

**Was bewusst NICHT umgesetzt wird:**
- Keine Google Analytics, kein Facebook Pixel
- Kein Cookie-Banner nötig (keine Tracking-Cookies)
- Keine E-Mail-Tracking-Pixel beim Link-Versand

---

## 12. Roadmap (Phasen)

### Phase 1 — Visueller Prototyp (Diese Woche)
- [ ] Claude Design Prompt nutzen → HTML-Seite generieren lassen
- [ ] Robin reviewed: Tonalität, Farben, Schrift, Animationen
- [ ] Iterationen bis "ja, das ist es"
- [ ] **Output:** `inspiration_prototype.html` (statisch, fake-Daten)

### Phase 2 — Supabase Setup (1 Woche)
- [ ] Neues Supabase-Projekt anlegen (Frankfurt)
- [ ] Migration `inspiration_001_initial.sql` ausführen
- [ ] Inspiration-Punkte seeden (14 Items, 4 Kategorien)
- [ ] Bilder für 14 Items aufnehmen oder kuratieren (Holz, Naturstein, warm)
- [ ] Optional: 3–4 kurze Demo-Videos (z.B. Silent-Flush, berührungslose Armatur)
- [ ] Storage-Buckets anlegen, Bilder/Videos hochladen
- [ ] **Output:** Lebende Supabase-DB mit Master-Daten

### Phase 3 — Frontend-Integration (1 Woche)
- [ ] Prototyp-HTML in neues Repo `jv-inspiration`
- [ ] Variablen-Replacement (Schritt 1+2 oben)
- [ ] Supabase-JS einbinden, RPCs anbinden
- [ ] Loading-State, Error-State, Deaktiviert-State
- [ ] Mobile-Test auf echten Geräten (iOS Safari, Android Chrome)
- [ ] Netlify-Deploy + DNS auf inspiration.jaeggivollmer.ch
- [ ] **Output:** Funktionierende Kunden-Seite

### Phase 4 — Admin-Dashboard (1–2 Wochen)
- [ ] `/admin` Login-Seite (Supabase Auth, Magic Link)
- [ ] `/admin/kunden` Liste mit Filter (aktiv/deaktiviert)
- [ ] `/admin/kunden/neu` Anlegen + Token-Share-Buttons
- [ ] `/admin/kunden/{id}` Detail mit Interessen-View + Aktivitäts-Log
- [ ] `/admin/katalog` Punkte verwalten
- [ ] PDF-Export der Kunden-Auswahl für Begehung (offline-fähig)
- [ ] **Output:** Self-Service für Robin

### Phase 5 — Dokumente-Bereich (1 Woche)
- [ ] Upload-UI im Admin
- [ ] Kunden-Tab `/k/{token}/dokumente` mit PDF.js-Viewer + Watermark
- [ ] docs.jaeggivollmer.ch → 301 Redirect auf neue URL
- [ ] **Output:** Vollständige Plattform, docs-Migration abgeschlossen

### Phase 6 — Optimierungen (laufend)
- [ ] Eigene Videos statt Generika (sukzessive)
- [ ] A/B-Test verschiedene Headlines
- [ ] Auswertung: Welche Punkte werden am meisten markiert? Inhalte schärfen.
- [ ] Optional: WhatsApp-Bot, der den Link automatisch nach Erstkontakt schickt

---

## 13. Offene Fragen / Spätere Entscheidungen

- **Telefonnummer in Termin-Karte:** Robin's persönliche Nummer oder Firmennummer?
- **Datenschutz-Link:** Kurze eigene Seite oder Verweis auf Hauptwebsite?
- **Eigene Videos** vs. **gestaltete Animationen:** in Phase 6 zu entscheiden, je nach Aufwand
- **AI-Empfehlung:** Später könnte basierend auf Auswahl eine Empfehlung erscheinen ("Wenn Ihnen X und Y gefällt, schauen Sie sich auch Z an") — bewusst aus MVP rausgehalten
- **Mehrere Bäder:** Falls Kunde mehrere Bäder umbaut — separater Link pro Bad oder ein Link mit Bad-Auswahl? Vorerst: separater Link

---

## 14. Tech-Stack-Zusammenfassung

| Komponente | Wahl | Begründung |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS | Konsistent mit GEMA, kein Build-Step nötig |
| Hosting | Netlify | Gleiches Setup wie GEMA und docs |
| Backend | Supabase (Frankfurt) | DSG-konform, RLS + Storage + Auth in einem |
| DB-Zugriff | RPC via SECURITY DEFINER | Saubere Token-basierte Zugriffskontrolle |
| Auth | Supabase Auth (nur Admin) | Magic Link, keine Passwörter |
| Domain | inspiration.jaeggivollmer.ch | docs wird per 301 migriert |
| Repo | GitHub (privat) | Auto-Deploy via Netlify |
| Schriften | Fraunces + DM Sans | Google Fonts, hochwertig |
| Icons | Lucide via CDN | Konsistent mit GEMA |

---

**Nächster konkreter Schritt:** Claude Design Prompt einsetzen, ersten Visual-Prototyp generieren lassen, Robin reviewed.
