-- migration_016_feedback.sql — Feedback aus der Plattform und den Tools (nach der Vorlage aus GEMA Beta)
--
-- Mit dem Knopf «Feedback» wählt man auf jeder Admin-Seite einen Bildausschnitt, markiert ihn
-- (Stift, Pfeil, Rechteck, Text) und beschreibt, was auffällt. Die Punkte landen hier:
--   plattform_feedback   ein Eintrag pro Feedback (Text, Seite, Status, Freigabe «umsetzen»)
--   Bucket «feedback»    der Bildausschnitt als JPEG (privat)
-- Im Board der Plattform (#/feedback) werden die Punkte bearbeitet und als Markdown für
-- Claude Code exportiert.
--
-- Zugriff ausschliesslich über die Netlify Function /api/feedback mit dem service_role-Key.
-- RLS ist aktiv OHNE Policies: anon/authenticated haben dadurch keinerlei Zugriff.
-- Ausführen im Supabase SQL-Editor (einmalig, nach migration_015). Idempotent.

CREATE TABLE IF NOT EXISTS plattform_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ID aus dem Browser: ein nachgesendeter Eintrag (Warteschlange) wird nie doppelt gespeichert
  client_id   TEXT UNIQUE NOT NULL CHECK (client_id ~ '^fb_[A-Za-z0-9_-]{4,60}$'),
  seite       TEXT NOT NULL CHECK (seite ~ '^[a-z0-9-]{2,60}$'),   -- z. B. «tool-terminplaner», «plattform-projekt»
  seite_name  TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',                           -- Pfad und Anker der Seite (ohne Domain)
  typ         TEXT NOT NULL DEFAULT 'kommentar' CHECK (typ IN ('kommentar', 'aenderung', 'fehler')),
  text        TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 20000),
  autor       TEXT NOT NULL DEFAULT '',
  bild_pfad   TEXT CHECK (bild_pfad IS NULL OR bild_pfad ~ '^[0-9]{4}-[0-9]{2}/[a-f0-9-]{36}\.jpg$'),
  bild_weg    BOOLEAN NOT NULL DEFAULT false,                     -- Bild war zu gross bzw. ging verloren
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,                 -- Bildschirm, Browser, «Feedback zur Funktion»
  status      TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'bearbeitung', 'erledigt')),
  umsetzen    BOOLEAN NOT NULL DEFAULT true,                      -- kommt in den Markdown-Export
  erstellt    TIMESTAMPTZ NOT NULL DEFAULT now(),
  geaendert   TIMESTAMPTZ NOT NULL DEFAULT now(),
  erledigt_am TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS plattform_feedback_status_idx ON plattform_feedback (status, erstellt DESC);

-- Änderungszeit von der Datenbank setzen, «erledigt am» beim Statuswechsel festhalten
CREATE OR REPLACE FUNCTION plattform_feedback_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.geaendert := now();
  IF NEW.status = 'erledigt' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'erledigt') THEN
    NEW.erledigt_am := now();
  ELSIF NEW.status <> 'erledigt' THEN
    NEW.erledigt_am := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS plattform_feedback_touch ON plattform_feedback;
CREATE TRIGGER plattform_feedback_touch BEFORE INSERT OR UPDATE ON plattform_feedback
  FOR EACH ROW EXECUTE FUNCTION plattform_feedback_touch();

-- ── RLS: an, aber ohne Policies → nur service_role ──────────────────────
ALTER TABLE plattform_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plattform_feedback FROM anon, authenticated;
REVOKE ALL ON FUNCTION plattform_feedback_touch() FROM PUBLIC, anon, authenticated;

-- ── Storage ─────────────────────────────────────────────────────────────
-- «feedback»: privat, nur JPEG bis 8 MB. Keine Storage-Policies: Hochladen nur durch die Function,
-- Anzeige im Board nur über kurz gültige signierte URLs (/api/feedback?bild=…).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('feedback', 'feedback', false, 8388608, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Test ────────────────────────────────────────────────────────────────
-- Erwartung: alle Aufrufe als anon schlagen mit «permission denied» fehl.
--   SET ROLE anon;
--   SELECT * FROM plattform_feedback;                                   -- permission denied
--   RESET ROLE;
--   SELECT id, public, allowed_mime_types FROM storage.buckets WHERE id = 'feedback';  -- public = false
