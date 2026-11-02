-- migration_014_krvcheck_offerte.sql
-- KRV-Check: Kunde wählt im Formular, ob er eine Offerte wünscht, falls noch kein
-- Rückflussverhinderer eingebaut ist (Standard: Ja).
-- Im Supabase SQL-Editor ausführen. Mehrfach ausführbar.

ALTER TABLE krvcheck_anfragen
  ADD COLUMN IF NOT EXISTS offerte_gewuenscht BOOLEAN NOT NULL DEFAULT true;   -- Offerte, falls KRV fehlt

-- Erfassungs-Funktion mit der neuen Spalte ersetzen (sonst unverändert gegenüber migration_013)
CREATE OR REPLACE FUNCTION krvcheck_anfrage_erfassen(p_daten JSONB, p_max_pro_stunde INTEGER DEFAULT 5)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jahr     INTEGER := EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/Zurich'))::INTEGER;
  v_nr       INTEGER;
  v_referenz TEXT;
  v_id       UUID;
  v_ip       TEXT := p_daten->>'ip_hash';
BEGIN
  IF v_ip IS NOT NULL AND (
    SELECT count(*) FROM krvcheck_anfragen
    WHERE ip_hash = v_ip AND created_at > now() - interval '1 hour'
  ) >= p_max_pro_stunde THEN
    RETURN jsonb_build_object('error', 'rate_limit');
  END IF;

  INSERT INTO krvcheck_zaehler (jahr, letzte) VALUES (v_jahr, 1)
  ON CONFLICT (jahr) DO UPDATE SET letzte = krvcheck_zaehler.letzte + 1
  RETURNING letzte INTO v_nr;

  v_referenz := 'KRV-' || v_jahr || '-' || lpad(v_nr::TEXT, 4, '0');

  INSERT INTO krvcheck_anfragen (
    referenz, strasse, hausnummer, plz, ort,
    vorname, nachname, telefon, email, rolle, iwb_brief, offerte_gewuenscht, bemerkung,
    keine_fotos, upload_token_hash, upload_bis, einwilligung,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_extra, ip_hash
  ) VALUES (
    v_referenz, p_daten->>'strasse', p_daten->>'hausnummer', p_daten->>'plz', p_daten->>'ort',
    p_daten->>'vorname', p_daten->>'nachname', p_daten->>'telefon', p_daten->>'email',
    p_daten->>'rolle', COALESCE((p_daten->>'iwb_brief')::BOOLEAN, false),
    COALESCE((p_daten->>'offerte_gewuenscht')::BOOLEAN, true), p_daten->>'bemerkung',
    COALESCE((p_daten->>'keine_fotos')::BOOLEAN, false),
    p_daten->>'upload_token_hash', (p_daten->>'upload_bis')::TIMESTAMPTZ,
    (p_daten->>'einwilligung')::BOOLEAN,
    p_daten->>'utm_source', p_daten->>'utm_medium', p_daten->>'utm_campaign',
    p_daten->>'utm_content', p_daten->>'utm_term', p_daten->'utm_extra', v_ip
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'referenz', v_referenz);
END $$;

-- Rechte wie bisher: nur service_role
REVOKE ALL ON FUNCTION krvcheck_anfrage_erfassen(JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION krvcheck_anfrage_erfassen(JSONB, INTEGER) TO service_role;

-- ── Test ────────────────────────────────────────────────────────────────
--   SELECT column_name, column_default FROM information_schema.columns
--   WHERE table_name = 'krvcheck_anfragen' AND column_name = 'offerte_gewuenscht';   -- 1 Zeile, Default true
