-- ============================================================================
-- migration_009_rls_haertung.sql
-- Sicherheits-Härtung gemäss Prüfbericht vom 20.10.2026 (Befunde K1, K2).
--
-- Hintergrund:
-- Die admin_all_*-Policies (FOR ALL TO authenticated USING (true)) gaben
-- jedem eingeloggten Supabase-Benutzer vollen Lese- und Schreibzugriff auf
-- alle Kundendaten. Da der anon-Key öffentlich ist, kann sich bei aktiver
-- Selbstregistrierung jeder ein Konto anlegen. Die Anwendung nutzt
-- Supabase Auth nirgends:
--   - Kundenseiten greifen nur über SECURITY-DEFINER-RPCs zu (umgehen RLS)
--   - Admin-Panel greift nur über Netlify Functions mit service_role zu
--     (service_role umgeht RLS)
-- → Die Policies werden ersatzlos entfernt. RLS bleibt aktiv; ohne
--   erlaubende Policy ist jeder Direktzugriff mit anon/authenticated gesperrt.
--
-- VORHER PRÜFEN: Greift das GEMA-Repo (gleiche Datenbank) mit einem
-- eingeloggten Supabase-Benutzer direkt per .from() auf diese Tabellen zu?
-- Wenn ja, bricht GEMA nach dieser Migration.
--
-- Idempotent: kann mehrfach ausgeführt werden.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Permissive admin_all_*-Policies entfernen (K1)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS admin_all_kunden           ON kunden;
DROP POLICY IF EXISTS admin_all_ansprechpersonen ON ansprechpersonen;
DROP POLICY IF EXISTS admin_all_interessen       ON kunden_interessen;
DROP POLICY IF EXISTS admin_all_log              ON aktivitaet_log;
DROP POLICY IF EXISTS admin_all_punkte           ON inspiration_punkte;
DROP POLICY IF EXISTS admin_all_kategorien       ON inspiration_kategorien;
DROP POLICY IF EXISTS admin_all_medien           ON punkt_medien;

-- Die anon-Lesepolicies auf den Katalog (anon_punkte_select,
-- anon_kategorien_select, anon_medien_select) bleiben bestehen: Katalogdaten
-- sind nicht personenbezogen.

-- ----------------------------------------------------------------------------
-- 2. RLS auf allen Tabellen sicherstellen (K2)
-- ----------------------------------------------------------------------------
-- doc_links wird nur von Netlify Functions (service_role) gelesen und
-- geschrieben. Ohne Policy ist die Tabelle für anon/authenticated gesperrt.
ALTER TABLE doc_links              ENABLE ROW LEVEL SECURITY;
ALTER TABLE kunden                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE ansprechpersonen       ENABLE ROW LEVEL SECURITY;
ALTER TABLE kunden_interessen      ENABLE ROW LEVEL SECURITY;
ALTER TABLE aktivitaet_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspiration_punkte     ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspiration_kategorien ENABLE ROW LEVEL SECURITY;
ALTER TABLE punkt_medien           ENABLE ROW LEVEL SECURITY;

-- Allfällige Policies auf doc_links entfernen, die in der Konsole angelegt
-- wurden und nicht im Repo stehen.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'doc_links'
  LOOP
    EXECUTE format('DROP POLICY %I ON doc_links', r.policyname);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Alte RPC-Überladungen entfernen
-- ----------------------------------------------------------------------------
-- migration.sql legte upsert_interesse/update_kommentar ohne p_medium_id an,
-- migration_007 die neuen Signaturen mit Default-Parameter. Bestehen beide,
-- sind Aufrufe ohne p_medium_id mehrdeutig. Die neuen Signaturen bleiben.
DROP FUNCTION IF EXISTS upsert_interesse(text, uuid, boolean, text);
DROP FUNCTION IF EXISTS update_kommentar(text, uuid, text);

-- ----------------------------------------------------------------------------
-- 4. Bucket «pdfs»: privat, nur PDF, max. 25 MB
-- ----------------------------------------------------------------------------
-- Uploads laufen neu direkt aus dem Admin-Panel über signierte Upload-URLs
-- (create-link.js). Der Bucket erzwingt Typ und Grösse zusätzlich selbst.
UPDATE storage.buckets
   SET public = false,
       allowed_mime_types = ARRAY['application/pdf'],
       file_size_limit = 26214400
 WHERE id = 'pdfs';

COMMIT;

-- ============================================================================
-- TESTS (nach der Ausführung)
-- ============================================================================
-- a) Keine permissive Policy mehr auf Personendaten:
--    select tablename, policyname, roles, cmd, qual
--      from pg_policies where schemaname = 'public' order by tablename;
--    → erwartet nur noch anon_punkte_select, anon_kategorien_select,
--      anon_medien_select
--
-- b) RLS überall aktiv:
--    select relname, relrowsecurity from pg_class
--     where relnamespace = 'public'::regnamespace and relkind = 'r';
--    → relrowsecurity = true bei allen Tabellen
--
-- c) Penetrationstest mit dem öffentlichen anon-Key (Terminal):
--    curl "https://ywcnccpjhnnspbkcmpng.supabase.co/rest/v1/kunden?select=*" \
--      -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--    → erwartet: []   (dasselbe für doc_links, ansprechpersonen,
--      kunden_interessen, aktivitaet_log)
--
-- d) Funktionstest: Kunden-Link (inspiration.html, swipe.html, view.html)
--    öffnen, Punkt markieren, Kommentar schreiben; im Admin-Panel Kunden
--    und Dokumente laden. Alles muss weiter funktionieren.
