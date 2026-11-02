-- migration_015_plattform_tools.sql — Speicher für Michis Tools und «ein Projekt für alles»
--
-- Die Tools (Bau-Terminplaner, Badvisualisierungen, Gäste-WC 3D, Story, Reel) liefen bisher als
-- Claude-Artifacts mit dem Speicher von claude.ai. In der Plattform speichern sie neu hier:
--   tool_docs             Dokumente der Tools (Projekte, Firmen, Einstellungen, Visualisierungen)
--   Bucket «tools»        Dateien der Tools (Fotos, Firmenlogos, Bilder der Visualisierungen, 3D-Scan)
--   kunden.projekt_id     Kundenzugang gehört zu einem Projekt (Projekt-ID aus dem Terminplaner)
--   visualisierung_links  Geschützter Kundenlink pro Badvisualisierung (wie doc_links für PDFs)
--
-- Zugriff ausschliesslich über die Netlify Functions mit dem service_role-Key.
-- RLS ist aktiv OHNE Policies: anon/authenticated haben dadurch keinerlei Zugriff.
-- Ausführen im Supabase SQL-Editor (einmalig). Idempotent.

-- ── Dokumente der Tools ────────────────────────────────────────────────
-- pfad wie im claude.ai-Speicher: «sammlung/dokument», z. B. «projects/m2dqpa28zr» oder «config/main».
-- Gelöschte Dokumente bleiben als «geloescht» stehen, damit offene Fenster das Löschen mitbekommen.
CREATE TABLE IF NOT EXISTS tool_docs (
  tool       TEXT NOT NULL CHECK (tool ~ '^[a-z0-9-]{2,40}$'),
  pfad       TEXT NOT NULL CHECK (pfad ~ '^[A-Za-z0-9_-]{1,80}/[A-Za-z0-9_-]{1,120}$'),
  sammlung   TEXT GENERATED ALWAYS AS (split_part(pfad, '/', 1)) STORED,
  daten      JSONB,
  geloescht  BOOLEAN NOT NULL DEFAULT false,
  geaendert  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tool, pfad)
);

CREATE INDEX IF NOT EXISTS tool_docs_sammlung_idx ON tool_docs (tool, sammlung, geaendert);

-- Änderungszeit immer von der Datenbank setzen (auch bei Upsert), die Fenster holen Änderungen «seit»
CREATE OR REPLACE FUNCTION tool_docs_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.geaendert := clock_timestamp();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tool_docs_touch ON tool_docs;
CREATE TRIGGER tool_docs_touch BEFORE INSERT OR UPDATE ON tool_docs
  FOR EACH ROW EXECUTE FUNCTION tool_docs_touch();

-- Einzelne Felder eines Dokuments ändern, ohne den Rest zu überschreiben
-- (z. B. Projekt-Zuordnung aus der Plattform, während der Terminplaner offen ist).
CREATE OR REPLACE FUNCTION tool_doc_patch(p_tool TEXT, p_pfad TEXT, p_daten JSONB)
RETURNS JSONB
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE tool_docs
     SET daten = COALESCE(daten, '{}'::jsonb) || p_daten
   WHERE tool = p_tool AND pfad = p_pfad AND NOT geloescht
  RETURNING jsonb_build_object('pfad', pfad, 'geaendert', geaendert, 'daten', daten);
$$;

-- ── Kunde ↔ Projekt ────────────────────────────────────────────────────
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS projekt_id TEXT
  CHECK (projekt_id IS NULL OR projekt_id ~ '^[A-Za-z0-9_-]{1,60}$');
CREATE INDEX IF NOT EXISTS kunden_projekt_idx ON kunden (projekt_id);

-- ── Kundenlinks für Badvisualisierungen ────────────────────────────────
-- Ein Link zeigt genau ein Objekt (tool_docs badvis/objekte/<objekt_id>), mit Wasserzeichen und
-- ohne Download. Deaktivierbar wie die PDF-Links. Gehört der Link einem Kunden, gilt zusätzlich
-- dessen Status (deaktivierter Kunde = Link gesperrt).
CREATE TABLE IF NOT EXISTS visualisierung_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token           TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  objekt_id       TEXT NOT NULL CHECK (objekt_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  kunde_name      TEXT NOT NULL,                       -- Name im Wasserzeichen
  kunde_id        UUID REFERENCES kunden(id) ON DELETE CASCADE,
  projekt_id      TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_viewed_at  TIMESTAMPTZ,
  view_count      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS visualisierung_links_objekt_idx ON visualisierung_links (objekt_id);
CREATE INDEX IF NOT EXISTS visualisierung_links_projekt_idx ON visualisierung_links (projekt_id);

-- ── RLS: an, aber ohne Policies → nur service_role ──────────────────────
ALTER TABLE tool_docs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE visualisierung_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tool_docs, visualisierung_links FROM anon, authenticated;

REVOKE ALL ON FUNCTION tool_doc_patch(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION tool_docs_touch()                 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tool_doc_patch(TEXT, TEXT, JSONB) TO service_role;

-- ── Storage ─────────────────────────────────────────────────────────────
-- «tools»: privat. Fotos und Logos aus dem Terminplaner, Bilder der Badvisualisierungen,
-- 3D-Scans des Gäste-WC-Tools (als JSON). Keine Storage-Policies: Upload nur über signierte
-- Upload-URLs der Functions, Anzeige nur über kurz gültige signierte URLs (/_blob/…).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tools', 'tools', false, 52428800,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/json'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Test ────────────────────────────────────────────────────────────────
-- Erwartung: alle Aufrufe als anon schlagen mit «permission denied» fehl.
--   SET ROLE anon;
--   SELECT * FROM tool_docs;                                            -- permission denied
--   SELECT * FROM visualisierung_links;                                 -- permission denied
--   SELECT tool_doc_patch('x', 'a/b', '{}'::jsonb);                     -- permission denied
--   RESET ROLE;
--   SELECT id, public, allowed_mime_types FROM storage.buckets WHERE id = 'tools';  -- public = false
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'kunden' AND column_name = 'projekt_id';
