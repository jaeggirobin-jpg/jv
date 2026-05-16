-- ============================================================================
-- inspiration_004_anrede.sql
-- Erweitert anrede_typ um 'frau' und 'herr' statt nur 'person'.
-- ============================================================================

ALTER TABLE kunden DROP CONSTRAINT IF EXISTS kunden_anrede_typ_check;
ALTER TABLE kunden ADD CONSTRAINT kunden_anrede_typ_check
  CHECK (anrede_typ IN ('frau', 'herr', 'familie'));

-- Bestehende 'person'-Einträge auf 'frau' setzen (oder manuell korrigieren)
UPDATE kunden SET anrede_typ = 'frau' WHERE anrede_typ = 'person';
