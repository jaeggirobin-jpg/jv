-- migration_011_drohnencheck_bericht.sql — Kurzes Formular und Bericht im Admin
--
-- 1. Das Anmeldeformular fragt nur noch Name, E-Mail, Telefon und Adresse ab.
--    Gebäudeangaben, Kanal und Wunschtermine werden optional.
-- 2. Neue Tabelle drohnencheck_berichte: ein Bericht pro Anfrage, im Admin erstellt.
--    Bilder liegen im privaten Storage-Bucket «drohnencheck» (nicht als Base64 in der DB),
--    Pfad: {anfrage_id}/{zufall}.jpg
-- 3. Löschroutine gibt die IDs der gelöschten Anfragen zurück, damit die Function
--    die zugehörigen Bilder im Bucket entfernen kann.
--
-- Voraussetzung: migration_010_drohnencheck.sql. Ausführen im Supabase SQL-Editor. Idempotent.

-- ── 1. Formularfelder optional ──────────────────────────────────────────
ALTER TABLE drohnencheck_anfragen ALTER COLUMN gebaeudetyp DROP NOT NULL;
ALTER TABLE drohnencheck_anfragen ALTER COLUMN dachform    DROP NOT NULL;
ALTER TABLE drohnencheck_anfragen ALTER COLUMN rolle       DROP NOT NULL;
ALTER TABLE drohnencheck_anfragen ALTER COLUMN kanal       DROP NOT NULL;

-- ── 2. Berichte ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drohnencheck_berichte (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anfrage_id         UUID NOT NULL UNIQUE REFERENCES drohnencheck_anfragen(id) ON DELETE CASCADE,
  token              TEXT NOT NULL UNIQUE CHECK (token ~ '^[a-f0-9]{32}$'),   -- Kundenlink bericht.html?t=…
  flugdatum          DATE,
  ampel              TEXT CHECK (ampel IN ('gut', 'beobachten', 'handlung')),
  zusammenfassung    TEXT,
  empfehlung         TEXT,
  bilder             JSONB NOT NULL DEFAULT '[]'::jsonb,                   -- [{ pfad, beschriftung }]
  veroeffentlicht_at TIMESTAMPTZ,                                          -- NULL = Entwurf, Link gesperrt
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS drohnencheck_berichte_touch ON drohnencheck_berichte;
CREATE TRIGGER drohnencheck_berichte_touch BEFORE UPDATE ON drohnencheck_berichte
  FOR EACH ROW EXECUTE FUNCTION drohnencheck_touch();

ALTER TABLE drohnencheck_berichte ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON drohnencheck_berichte FROM anon, authenticated;

-- ── Storage-Bucket (privat, nur Bilder, max. 10 MB pro Datei) ────────────
-- Keine Storage-Policies: Upload nur über signierte Upload-URLs der Functions,
-- Anzeige nur über signierte URLs mit kurzer Gültigkeit.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('drohnencheck', 'drohnencheck', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 3. Löschroutine mit Rückgabe der gelöschten IDs ──────────────────────
-- Berichte verschwinden per ON DELETE CASCADE, die Bilder entfernt die Function
-- dachcheck-loeschroutine anhand der zurückgegebenen IDs aus dem Bucket.
CREATE OR REPLACE FUNCTION drohnencheck_loeschen(p_tage INTEGER DEFAULT 60)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  WITH weg AS (
    DELETE FROM drohnencheck_anfragen
    WHERE status <> 'auftrag'
      AND created_at < now() - make_interval(days => p_tage)
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_ids FROM weg;

  -- Warteliste: nach 24 Monaten ohne Benachrichtigung entfernen
  DELETE FROM drohnencheck_warteliste
  WHERE created_at < now() - interval '24 months';

  UPDATE drohnencheck_anfragen SET ip_hash = NULL
  WHERE ip_hash IS NOT NULL AND created_at < now() - interval '7 days';
  UPDATE drohnencheck_warteliste SET ip_hash = NULL
  WHERE ip_hash IS NOT NULL AND created_at < now() - interval '7 days';

  RETURN jsonb_build_object('geloescht', cardinality(v_ids), 'ids', to_jsonb(v_ids));
END $$;

REVOKE ALL ON FUNCTION drohnencheck_loeschen(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION drohnencheck_loeschen(INTEGER) TO service_role;

-- ── Test ────────────────────────────────────────────────────────────────
--   SET ROLE anon;
--   SELECT * FROM drohnencheck_berichte;                       -- permission denied
--   RESET ROLE;
--   SELECT id, public, allowed_mime_types FROM storage.buckets WHERE id = 'drohnencheck';  -- public = false
