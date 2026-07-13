-- ============================================================================
-- inspiration_008_multi_dokumente.sql
-- Mehrere Dokumente pro Kunde ermöglichen.
--
-- Bisher: doc_links.token (UNIQUE) wurde mit dem Kunden-access_token belegt
-- → nur 1 Dokument pro Kunde möglich (Unique-Verletzung beim 2. Upload).
--
-- Neu: doc_links.token bleibt UNIQUE, ist aber pro Dokument zufällig.
-- Neue Spalte kunde_token verknüpft (nicht-unique) mehrere Dokumente
-- mit einem Kunden.
-- ============================================================================

ALTER TABLE doc_links ADD COLUMN IF NOT EXISTS kunde_token TEXT;

-- Bestehende Zeilen: kunde_token = token (waren bisher identisch),
-- damit alte Links unverändert weiter funktionieren.
UPDATE doc_links SET kunde_token = token WHERE kunde_token IS NULL;

CREATE INDEX IF NOT EXISTS idx_doc_links_kunde_token ON doc_links (kunde_token);
