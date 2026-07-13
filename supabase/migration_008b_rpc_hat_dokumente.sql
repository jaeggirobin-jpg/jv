-- Kopiere den gesamten Inhalt in den Supabase SQL Editor und fuehre ihn aus.
-- Aktualisiert get_inspiration_data: hat_dokumente prueft jetzt kunde_token
-- statt token (mehrere Dokumente pro Kunde moeglich).

CREATE OR REPLACE FUNCTION get_inspiration_data(p_token text)
RETURNS jsonb
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_kunde kunden%ROWTYPE;
  v_ansprech ansprechpersonen%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_kunde FROM kunden WHERE access_token = p_token AND status = 'aktiv';
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or inactive token'; END IF;

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
          'video_url', p.video_url,
          'medien', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'id', m.id,
                'name', m.name,
                'bild_url', m.bild_url,
                'video_url', m.video_url
              ) ORDER BY m.reihenfolge
            ), '[]'::jsonb)
            FROM punkt_medien m WHERE m.punkt_id = p.id
          )
        ) ORDER BY p.kategorie, p.reihenfolge
      ), '[]'::jsonb)
      FROM inspiration_punkte p
      WHERE p.aktiv = true
        AND (v_kunde.sichtbare_punkte IS NULL OR p.id = ANY(v_kunde.sichtbare_punkte))
    ),
    'interessen', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'punkt_id', ki.punkt_id,
          'medium_id', ki.medium_id,
          'interessiert', ki.interessiert,
          'kommentar', ki.kommentar
        )
      ), '[]'::jsonb)
      FROM kunden_interessen ki WHERE ki.kunden_id = v_kunde.id
    ),
    'hat_dokumente', (
      SELECT EXISTS (
        SELECT 1 FROM doc_links d
        WHERE d.kunde_token = p_token AND d.is_active = true
      )
    )
  );

  INSERT INTO aktivitaet_log (kunden_id, aktion) VALUES (v_kunde.id, 'seite_geoeffnet');
  RETURN v_result;
END;
$$;
