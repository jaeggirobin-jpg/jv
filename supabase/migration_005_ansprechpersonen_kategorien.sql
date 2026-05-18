-- ============================================================================
-- inspiration_005_ansprechpersonen_und_kategorien.sql
-- Neue Tabelle für Ansprechpersonen + Kategorie-Metadaten
-- ============================================================================

-- Ansprechpersonen (Projektleiter, Berater)
CREATE TABLE IF NOT EXISTS ansprechpersonen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  telefon text,
  foto_url text,
  aktiv boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Kunden: Ansprechperson zuweisen
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS ansprechperson_id uuid REFERENCES ansprechpersonen(id) ON DELETE SET NULL;

-- Kategorie-Metadaten (Titel, Intro-Text, Reihenfolge)
CREATE TABLE IF NOT EXISTS inspiration_kategorien (
  id text PRIMARY KEY,
  titel text NOT NULL,
  intro text,
  reihenfolge int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed: bestehende Kategorien mit den Original-Texten
INSERT INTO inspiration_kategorien (id, titel, intro, reihenfolge) VALUES
  ('wc', 'Toilette', 'Die Toilette ist das meistgenutzte Element im Bad. Was sie kann, hat sich in den letzten Jahren deutlich verändert.', 1),
  ('waschtisch', 'Waschtisch', 'Wahrscheinlich das prägendste Möbelstück im Bad — und das, was Sie morgens als Erstes berühren.', 2),
  ('armaturen', 'Armaturen', 'Hier entscheidet sich, wie das Bad sich anfühlt — jeden Tag, jedes Mal.', 3),
  ('dusche', 'Dusche', 'Vom funktionalen Element zum Rückzugsort — wenige Quadratmeter, grosse Wirkung.', 4)
ON CONFLICT (id) DO NOTHING;

-- RLS
ALTER TABLE ansprechpersonen ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspiration_kategorien ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_ansprechpersonen') THEN
    CREATE POLICY admin_all_ansprechpersonen ON ansprechpersonen FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_kategorien') THEN
    CREATE POLICY admin_all_kategorien ON inspiration_kategorien FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Anon darf Kategorien lesen (für die Inspirationsseite)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_kategorien_select') THEN
    CREATE POLICY anon_kategorien_select ON inspiration_kategorien FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- RPC aktualisieren: gibt Ansprechperson + Kategorien-Meta zurück
CREATE OR REPLACE FUNCTION get_inspiration_data(p_token text)
RETURNS jsonb
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_kunde kunden%ROWTYPE;
  v_ansprech ansprechpersonen%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_kunde
    FROM kunden
   WHERE access_token = p_token
     AND status = 'aktiv';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or inactive token';
  END IF;

  -- Ansprechperson laden falls zugewiesen
  IF v_kunde.ansprechperson_id IS NOT NULL THEN
    SELECT * INTO v_ansprech FROM ansprechpersonen WHERE id = v_kunde.ansprechperson_id AND aktiv;
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
    'ansprechperson', CASE WHEN v_ansprech.id IS NOT NULL THEN
      jsonb_build_object(
        'name', v_ansprech.name,
        'email', v_ansprech.email,
        'telefon', v_ansprech.telefon,
        'foto_url', v_ansprech.foto_url
      )
    ELSE NULL END,
    'kategorien', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object('id', ik.id, 'titel', ik.titel, 'intro', ik.intro)
        ORDER BY ik.reihenfolge
      ), '[]'::jsonb)
      FROM inspiration_kategorien ik
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
         AND (v_kunde.sichtbare_punkte IS NULL
              OR p.id = ANY(v_kunde.sichtbare_punkte))
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
    'hat_dokumente', (
      SELECT EXISTS (
        SELECT 1 FROM doc_links d
         WHERE d.token = p_token AND d.is_active = true
      )
    )
  );

  INSERT INTO aktivitaet_log (kunden_id, aktion)
  VALUES (v_kunde.id, 'seite_geoeffnet');

  RETURN v_result;
END;
$$;
