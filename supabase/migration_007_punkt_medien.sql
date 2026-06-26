-- ============================================================================
-- inspiration_007_punkt_medien.sql
-- Mehrere Bilder/Videos pro Inspiration-Punkt (Slides/Varianten)
-- ============================================================================

-- Slides pro Punkt (z.B. verschiedene Farben eines Waschtischs)
CREATE TABLE IF NOT EXISTS punkt_medien (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  punkt_id uuid NOT NULL REFERENCES inspiration_punkte(id) ON DELETE CASCADE,
  name text,
  bild_url text,
  video_url text,
  reihenfolge int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medien_punkt ON punkt_medien (punkt_id, reihenfolge);

-- RLS
ALTER TABLE punkt_medien ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_medien') THEN
    CREATE POLICY admin_all_medien ON punkt_medien FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_medien_select') THEN
    CREATE POLICY anon_medien_select ON punkt_medien FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- Kunden-Interessen: optionale Referenz auf ein spezifisches Medium
ALTER TABLE kunden_interessen ADD COLUMN IF NOT EXISTS medium_id uuid REFERENCES punkt_medien(id) ON DELETE CASCADE;

-- Alten UNIQUE-Constraint entfernen und neuen setzen
ALTER TABLE kunden_interessen DROP CONSTRAINT IF EXISTS kunden_interessen_kunden_id_punkt_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_interessen_unique
  ON kunden_interessen (kunden_id, punkt_id, COALESCE(medium_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- RPC aktualisieren: gibt Medien pro Punkt zurück
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
   WHERE access_token = p_token AND status = 'aktiv';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or inactive token';
  END IF;

  IF v_kunde.ansprechperson_id IS NOT NULL THEN
    SELECT * INTO v_ansprech FROM ansprechpersonen WHERE id = v_kunde.ansprechperson_id AND aktiv;
  END IF;

  v_result := jsonb_build_object(
    'kunde', jsonb_build_object(
      'id', v_kunde.id, 'anrede_typ', v_kunde.anrede_typ,
      'vorname', v_kunde.vorname, 'nachname', v_kunde.nachname,
      'projekt_adresse', v_kunde.projekt_adresse,
      'termin_datum', v_kunde.termin_datum, 'termin_uhrzeit', v_kunde.termin_uhrzeit
    ),
    'ansprechperson', CASE WHEN v_ansprech.id IS NOT NULL THEN
      jsonb_build_object('name', v_ansprech.name, 'email', v_ansprech.email,
        'telefon', v_ansprech.telefon, 'foto_url', v_ansprech.foto_url)
    ELSE NULL END,
    'kategorien', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object('id', ik.id, 'titel', ik.titel, 'intro', ik.intro)
        ORDER BY ik.reihenfolge), '[]'::jsonb)
      FROM inspiration_kategorien ik
    ),
    'punkte', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', p.id, 'kategorie', p.kategorie, 'reihenfolge', p.reihenfolge,
          'titel', p.titel, 'kurzbeschreibung', p.kurzbeschreibung,
          'vorteil', p.vorteil, 'zu_bedenken', p.zu_bedenken,
          'bild_url', p.bild_url, 'video_url', p.video_url,
          'medien', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object('id', m.id, 'name', m.name,
                'bild_url', m.bild_url, 'video_url', m.video_url)
              ORDER BY m.reihenfolge), '[]'::jsonb)
            FROM punkt_medien m WHERE m.punkt_id = p.id
          )
        ) ORDER BY p.kategorie, p.reihenfolge
      ), '[]'::jsonb)
        FROM inspiration_punkte p
       WHERE p.aktiv = true
         AND (v_kunde.sichtbare_punkte IS NULL OR p.id = ANY(v_kunde.sichtbare_punkte))
    ),
    'interessen', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'punkt_id', ki.punkt_id, 'medium_id', ki.medium_id,
        'interessiert', ki.interessiert, 'kommentar', ki.kommentar
      )), '[]'::jsonb)
        FROM kunden_interessen ki WHERE ki.kunden_id = v_kunde.id
    ),
    'hat_dokumente', (
      SELECT EXISTS (SELECT 1 FROM doc_links d WHERE d.token = p_token AND d.is_active = true)
    )
  );

  INSERT INTO aktivitaet_log (kunden_id, aktion) VALUES (v_kunde.id, 'seite_geoeffnet');
  RETURN v_result;
END;
$$;

-- upsert_interesse erweitert um optionalen medium_id Parameter
CREATE OR REPLACE FUNCTION upsert_interesse(
  p_token text,
  p_punkt_id uuid,
  p_interessiert boolean,
  p_kommentar text DEFAULT NULL,
  p_medium_id uuid DEFAULT NULL
)
RETURNS void
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_kunde_id uuid;
BEGIN
  SELECT id INTO v_kunde_id
    FROM kunden WHERE access_token = p_token AND status = 'aktiv';
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or inactive token'; END IF;

  INSERT INTO kunden_interessen (kunden_id, punkt_id, medium_id, interessiert, kommentar)
  VALUES (v_kunde_id, p_punkt_id, p_medium_id, p_interessiert, p_kommentar)
  ON CONFLICT (kunden_id, punkt_id, COALESCE(medium_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET
    interessiert = EXCLUDED.interessiert,
    kommentar = COALESCE(EXCLUDED.kommentar, kunden_interessen.kommentar),
    updated_at = now();

  INSERT INTO aktivitaet_log (kunden_id, aktion, details)
  VALUES (v_kunde_id,
    CASE WHEN p_interessiert THEN 'punkt_markiert' ELSE 'punkt_demarkiert' END,
    jsonb_build_object('punkt_id', p_punkt_id, 'medium_id', p_medium_id));
END;
$$;

-- update_kommentar erweitert um optionalen medium_id
CREATE OR REPLACE FUNCTION update_kommentar(
  p_token text,
  p_punkt_id uuid,
  p_kommentar text,
  p_medium_id uuid DEFAULT NULL
)
RETURNS void
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_kunde_id uuid;
BEGIN
  SELECT id INTO v_kunde_id
    FROM kunden WHERE access_token = p_token AND status = 'aktiv';
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or inactive token'; END IF;

  INSERT INTO kunden_interessen (kunden_id, punkt_id, medium_id, interessiert, kommentar)
  VALUES (v_kunde_id, p_punkt_id, p_medium_id, false, p_kommentar)
  ON CONFLICT (kunden_id, punkt_id, COALESCE(medium_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET kommentar = EXCLUDED.kommentar, updated_at = now();

  INSERT INTO aktivitaet_log (kunden_id, aktion, details)
  VALUES (v_kunde_id, 'kommentar_hinzu',
    jsonb_build_object('punkt_id', p_punkt_id, 'medium_id', p_medium_id));
END;
$$;

-- Grants für die erweiterten Signaturen
GRANT EXECUTE ON FUNCTION upsert_interesse(text, uuid, boolean, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION update_kommentar(text, uuid, text, uuid) TO anon;
