-- migration_012_drohnencheck_medien.sql — Titelvideo der Drohnen-Check-Landingpage
--
-- Das Video wird im Admin importiert (Tab «Landingpage»), im Browser verkleinert
-- und in den ÖFFENTLICHEN Bucket «drohnencheck-medien» geladen (Pfad hero/{zufall}.mp4|webm,
-- Standbild hero/{zufall}.jpg). Welche Dateien aktuell sind, steht in drohnencheck_einstellungen.
-- Der Bucket enthält nur Werbematerial der Landingpage, keine Kundendaten (die Berichte
-- bleiben im privaten Bucket «drohnencheck»).
--
-- Voraussetzung: migration_010 und 011. Ausführen im Supabase SQL-Editor. Idempotent.

CREATE TABLE IF NOT EXISTS drohnencheck_einstellungen (
  schluessel  TEXT PRIMARY KEY,
  wert        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS drohnencheck_einstellungen_touch ON drohnencheck_einstellungen;
CREATE TRIGGER drohnencheck_einstellungen_touch BEFORE UPDATE ON drohnencheck_einstellungen
  FOR EACH ROW EXECUTE FUNCTION drohnencheck_touch();

ALTER TABLE drohnencheck_einstellungen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON drohnencheck_einstellungen FROM anon, authenticated;

-- Öffentlich lesbar (Landingpage), schreiben nur über signierte Upload-URLs der Functions.
-- Max. 50 MB pro Datei; das verkleinerte Video hat typischerweise 3 bis 8 MB.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('drohnencheck-medien', 'drohnencheck-medien', true, 52428800, ARRAY['video/mp4', 'video/webm', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE SET public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
