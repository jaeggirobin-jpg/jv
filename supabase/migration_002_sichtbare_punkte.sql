-- ============================================================================
-- inspiration_002_sichtbare_punkte.sql
-- Erweitert kunden um eine Spalte, die steuert welche Punkte der Kunde sieht.
-- NULL = alle Punkte sichtbar (Standardverhalten, abwärtskompatibel).
-- ============================================================================

ALTER TABLE kunden ADD COLUMN IF NOT EXISTS sichtbare_punkte uuid[];

-- RPC aktualisieren: filtert Punkte nach sichtbare_punkte wenn gesetzt
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
         -- Wenn sichtbare_punkte gesetzt, nur diese zeigen
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
