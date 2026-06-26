-- ============================================================================
-- inspiration_001_initial.sql
-- Additive Migration: Inspiration-Plattform für Jäggi Vollmer
-- Bestehende Tabelle doc_links bleibt UNVERÄNDERT.
-- Idempotent: kann mehrfach ausgeführt werden (IF NOT EXISTS / OR REPLACE).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. KUNDEN
-- ============================================================================
CREATE TABLE IF NOT EXISTS kunden (
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

CREATE INDEX IF NOT EXISTS idx_kunden_token ON kunden (access_token);
CREATE INDEX IF NOT EXISTS idx_kunden_status ON kunden (status);

-- ============================================================================
-- 2. INSPIRATION-PUNKTE (Master-Katalog)
-- ============================================================================
CREATE TABLE IF NOT EXISTS inspiration_punkte (
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

CREATE INDEX IF NOT EXISTS idx_punkte_kategorie
  ON inspiration_punkte (kategorie, reihenfolge) WHERE aktiv;

-- ============================================================================
-- 3. KUNDEN-INTERESSEN (Toggle + Kommentar)
-- ============================================================================
CREATE TABLE IF NOT EXISTS kunden_interessen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kunden_id uuid NOT NULL REFERENCES kunden(id) ON DELETE CASCADE,
  punkt_id uuid NOT NULL REFERENCES inspiration_punkte(id) ON DELETE CASCADE,
  interessiert boolean NOT NULL DEFAULT true,
  kommentar text,
  markiert_am timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kunden_id, punkt_id)
);

CREATE INDEX IF NOT EXISTS idx_interessen_kunde ON kunden_interessen (kunden_id);

-- ============================================================================
-- 4. AKTIVITÄTSLOG
-- ============================================================================
CREATE TABLE IF NOT EXISTS aktivitaet_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kunden_id uuid REFERENCES kunden(id) ON DELETE SET NULL,
  aktion text NOT NULL,
  details jsonb,
  ip_hash text,
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_log_kunde_zeit
  ON aktivitaet_log (kunden_id, timestamp DESC);

-- ============================================================================
-- 5. UPDATED-AT TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_kunden_updated'
  ) THEN
    CREATE TRIGGER trg_kunden_updated
      BEFORE UPDATE ON kunden
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_interessen_updated'
  ) THEN
    CREATE TRIGGER trg_interessen_updated
      BEFORE UPDATE ON kunden_interessen
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE kunden ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspiration_punkte ENABLE ROW LEVEL SECURITY;
ALTER TABLE kunden_interessen ENABLE ROW LEVEL SECURITY;
ALTER TABLE aktivitaet_log ENABLE ROW LEVEL SECURITY;

-- Admin (authenticated) hat volle Rechte
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_kunden') THEN
    CREATE POLICY admin_all_kunden ON kunden FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_punkte') THEN
    CREATE POLICY admin_all_punkte ON inspiration_punkte FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_interessen') THEN
    CREATE POLICY admin_all_interessen ON kunden_interessen FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_log') THEN
    CREATE POLICY admin_all_log ON aktivitaet_log FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Anon darf Katalog-Punkte lesen (nicht sensibel)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_punkte_select') THEN
    CREATE POLICY anon_punkte_select ON inspiration_punkte FOR SELECT
      TO anon USING (aktiv = true);
  END IF;
END $$;

-- ============================================================================
-- 7. RPC-FUNKTIONEN (SECURITY DEFINER, Token-basiert, anon-callable)
-- ============================================================================

-- 7a. Alle Daten für die Kunden-Inspirationsseite laden
-- Prüft hat_dokumente gegen die bestehende doc_links-Tabelle (gleicher Token).
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
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'kategorie', p.kategorie,
          'reihenfolge', p.reihenfolge,
          'titel', p.titel,
          'kurzbeschreibung', p.kurzbeschreibung,
          'vorteil', p.vorteil,
          'zu_bedenken', p.zu_bedenken,
          'bild_url', p.bild_url,
          'video_url', p.video_url
        ) ORDER BY p.kategorie, p.reihenfolge
      ), '[]'::jsonb)
        FROM inspiration_punkte p
       WHERE p.aktiv = true
    ),
    'interessen', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'punkt_id', ki.punkt_id,
        'interessiert', ki.interessiert,
        'kommentar', ki.kommentar
      )), '[]'::jsonb)
        FROM kunden_interessen ki
       WHERE ki.kunden_id = v_kunde.id
    ),
    -- Prüft ob Dokumente in der bestehenden doc_links-Tabelle existieren
    -- (gleicher Token wie kunden.access_token)
    'hat_dokumente', (
      SELECT EXISTS (
        SELECT 1 FROM doc_links d
         WHERE d.token = p_token AND d.is_active = true
      )
    )
  );

  -- Logging
  INSERT INTO aktivitaet_log (kunden_id, aktion)
  VALUES (v_kunde.id, 'seite_geoeffnet');

  RETURN v_result;
END;
$$;

-- 7b. Interesse setzen/aktualisieren (Toggle)
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

-- 7c. Kommentar separat aktualisieren (für Debounce-Updates)
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

-- ============================================================================
-- 8. GRANTS — anon darf die RPC-Funktionen aufrufen
-- ============================================================================
GRANT EXECUTE ON FUNCTION get_inspiration_data(text) TO anon;
GRANT EXECUTE ON FUNCTION upsert_interesse(text, uuid, boolean, text) TO anon;
GRANT EXECUTE ON FUNCTION update_kommentar(text, uuid, text) TO anon;

-- ============================================================================
-- 9. SEED-DATEN — 14 Inspiration-Punkte (4 Kategorien)
-- Bild-/Video-URLs sind zunächst NULL. Robin lädt Medien in den
-- Supabase Storage Bucket «inspiration-medien» hoch und aktualisiert
-- die URLs dann direkt im Table Editor (kein Code-Deployment nötig).
-- ============================================================================
INSERT INTO inspiration_punkte (kategorie, reihenfolge, titel, kurzbeschreibung, vorteil, zu_bedenken)
VALUES
  -- WC (4 Punkte)
  ('wc', 1,
   'Wand-WC mit Vorwandinstallation',
   'Schwebt frei an der Wand, der Spülkasten verschwindet in der Vorwand.',
   'Bodenpflege wird einfach, der Raum wirkt grösser.',
   'Die Vorwand braucht Tiefe — typisch 15 bis 20 cm.'),

  ('wc', 2,
   'Silent-Flush-Spülung',
   'Die Spülung läuft fast geräuschlos ab.',
   'Komfort vor allem nachts und in offenen Wohnkonzepten.',
   'In der Anschaffung leicht teurer.'),

  ('wc', 3,
   'Spülrandloses WC',
   'Keine versteckten Kanten unterhalb des Beckenrands.',
   'Reinigung deutlich einfacher, optisch klarer.',
   'Andere Spül-Charakteristik — wir zeigen Ihnen den Unterschied.'),

  ('wc', 4,
   'Dusch-WC',
   'Integrierte Reinigung mit warmem Wasser, optional mit Föhn.',
   'Mehr Hygiene, weniger Verbrauch von Feuchttüchern.',
   'Braucht einen Stromanschluss in der Nähe.'),

  -- Waschtisch (3 Punkte)
  ('waschtisch', 1,
   'Aufsatzbecken',
   'Die Schale steht auf einer Konsole oder einem Möbel.',
   'Skulpturaler Charakter, viele Materialien (Keramik, Naturstein, Mineralguss).',
   'Die Höhe muss zur Körpergrösse passen, sonst spritzt es.'),

  ('waschtisch', 2,
   'Unterbau-Waschtisch, integriert',
   'Becken und Platte aus einem Stück.',
   'Sehr aufgeräumt, einfach zu reinigen, keine Fugen.',
   'Reparaturen aufwändiger als bei austauschbaren Schalen.'),

  ('waschtisch', 3,
   'Doppelwaschtisch',
   'Zwei separate Becken in einem Möbel.',
   'Entspannte Morgenroutine zu zweit, kein Warten.',
   'Mindestens 140 cm Breite einplanen.'),

  -- Armaturen (4 Punkte)
  ('armaturen', 1,
   'Aufputz-Mischer',
   'Klassische sichtbare Montage am Becken oder an der Wand.',
   'Wartung und Austausch sind unkompliziert.',
   'Sichtbare Technik — Geschmackssache.'),

  ('armaturen', 2,
   'Unterputz-Mischer',
   'Die Technik verschwindet in der Wand, sichtbar bleibt nur das Bedienteil.',
   'Sehr aufgeräumte Optik, mehr Platz und einfacheres Putzen.',
   'Bei Reparaturen muss die Wand geöffnet werden — gute Markenware verhindert das fast immer.'),

  ('armaturen', 3,
   'Thermostat-Mischer',
   'Die Wassertemperatur bleibt konstant, auch wenn anderswo Wasser fliesst.',
   'Kein Kalt-Heiss-Schock unter der Dusche.',
   'Etwas grössere Bauform, bei der Auswahl zu beachten.'),

  ('armaturen', 4,
   'Berührungslose Armatur',
   'Sensor statt Griff.',
   'Hygienisch, ideal für Kinder und Gäste-WC.',
   'Stromversorgung (Batterie oder Trafo) muss eingeplant werden.'),

  -- Dusche (3 Punkte)
  ('dusche', 1,
   'Bodenebene Dusche (Walk-in)',
   'Kein Einstieg, fliessender Übergang vom Boden.',
   'Optisch grosszügig, barrierefrei, alltagstauglich.',
   'Boden braucht Gefälle und sehr saubere Abdichtung.'),

  ('dusche', 2,
   'Regenbrause am Deckenanschluss',
   'Grossflächiger Wasserfall von oben.',
   'Spa-Gefühl, sehr angenehm bei gutem Wasserdruck.',
   'Höhere Wassermenge, mit Handbrause als Alternative kombinierbar.'),

  ('dusche', 3,
   'Glas-Festelement statt Tür',
   'Reduzierter Spritzschutz statt klassischer Tür.',
   'Mehr Offenheit, einfacher zu reinigen.',
   'Etwas mehr Spritzwasser ausserhalb der Dusche.')

ON CONFLICT DO NOTHING;
