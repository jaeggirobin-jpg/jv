-- ============================================================================
-- inspiration_003_freie_kategorien.sql
-- Entfernt die CHECK-Einschränkung auf kategorie, damit beliebige
-- Kategorien (z.B. 'boden', 'spiegel', 'beleuchtung') erstellt werden können.
-- ============================================================================

ALTER TABLE inspiration_punkte DROP CONSTRAINT IF EXISTS inspiration_punkte_kategorie_check;
