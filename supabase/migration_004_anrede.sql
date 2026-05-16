-- ============================================================================
-- inspiration_004_anrede.sql
-- Erweitert anrede_typ um 'frau' und 'herr' statt nur 'person'.
-- ============================================================================

-- Reihenfolge wichtig: zuerst Constraint entfernen, dann Daten migrieren,
-- dann neuen Constraint setzen.
ALTER TABLE kunden DROP CONSTRAINT IF EXISTS kunden_anrede_typ_check;
UPDATE kunden SET anrede_typ = 'frau' WHERE anrede_typ = 'person';
ALTER TABLE kunden ADD CONSTRAINT kunden_anrede_typ_check
  CHECK (anrede_typ IN ('frau', 'herr', 'familie'));
