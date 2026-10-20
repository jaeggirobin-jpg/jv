-- 001_drohnencheck.sql — Tabellen und Funktionen für den Gratis Drohnen-Rinnen-Check
--
-- Eigenständig: berührt keine bestehenden Tabellen (kunden, inspiration_* usw.).
-- Zugriff ausschliesslich über die Netlify Functions mit dem service_role-Key.
-- RLS ist aktiv OHNE Policies: anon/authenticated haben dadurch keinerlei Zugriff.
--
-- Ausführen im Supabase SQL-Editor (einmalig). Idempotent.

-- ── Anfragen ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drohnencheck_anfragen (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referenz                    TEXT UNIQUE NOT NULL,               -- DC-2026-0001
  status                      TEXT NOT NULL DEFAULT 'neu'
                              CHECK (status IN ('neu', 'termin', 'geflogen', 'report', 'auftrag', 'abgeschlossen', 'abgesagt')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Adresse
  strasse                     TEXT NOT NULL,
  hausnummer                  TEXT NOT NULL,
  plz                         TEXT NOT NULL,
  ort                         TEXT NOT NULL,

  -- Gebäude
  gebaeudetyp                 TEXT NOT NULL,
  dachform                    TEXT NOT NULL,
  rolle                       TEXT NOT NULL,
  baujahr                     INTEGER,
  bemerkung                   TEXT,

  -- Kontakt
  vorname                     TEXT NOT NULL,
  nachname                    TEXT NOT NULL,
  telefon                     TEXT NOT NULL,
  email                       TEXT NOT NULL,
  kanal                       TEXT NOT NULL,                       -- E-Mail | WhatsApp

  -- Termin
  wunschtermine               TEXT[] NOT NULL DEFAULT '{}',        -- ['2026-10-26_vm', ...]
  termin_bestaetigt           TIMESTAMPTZ,

  -- Einwilligungen (Zeitpunkt = created_at)
  einwilligung_berechtigt     BOOLEAN NOT NULL,
  einwilligung_aufnahmen      BOOLEAN NOT NULL,
  einwilligung_kommunikation  BOOLEAN NOT NULL DEFAULT false,

  -- Messbarkeit
  utm_source                  TEXT,
  utm_medium                  TEXT,
  utm_campaign                TEXT,
  utm_content                 TEXT,
  utm_term                    TEXT,
  utm_extra                   JSONB,                               -- fbclid, landing, referrer

  -- Technik
  ip_hash                     TEXT,                                -- gesalzener SHA-256, nur für Rate-Limit
  mail_kunde_ok               BOOLEAN,
  mail_intern_ok              BOOLEAN,
  notiz_intern                TEXT,

  CONSTRAINT drohnencheck_pflicht_einwilligungen CHECK (einwilligung_berechtigt AND einwilligung_aufnahmen)
);

CREATE INDEX IF NOT EXISTS drohnencheck_anfragen_created_idx ON drohnencheck_anfragen (created_at);
CREATE INDEX IF NOT EXISTS drohnencheck_anfragen_ip_idx ON drohnencheck_anfragen (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS drohnencheck_anfragen_status_idx ON drohnencheck_anfragen (status);

-- updated_at automatisch nachführen
CREATE OR REPLACE FUNCTION drohnencheck_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS drohnencheck_anfragen_touch ON drohnencheck_anfragen;
CREATE TRIGGER drohnencheck_anfragen_touch BEFORE UPDATE ON drohnencheck_anfragen
  FOR EACH ROW EXECUTE FUNCTION drohnencheck_touch();

-- ── Warteliste (PLZ ausserhalb des Einzugsgebiets) ───────────────────────
CREATE TABLE IF NOT EXISTS drohnencheck_warteliste (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  email       TEXT NOT NULL,
  plz         TEXT,
  ort         TEXT,
  utm         JSONB,
  ip_hash     TEXT
);
CREATE INDEX IF NOT EXISTS drohnencheck_warteliste_ip_idx ON drohnencheck_warteliste (ip_hash, created_at);

-- ── Referenz-Zähler pro Jahr ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drohnencheck_zaehler (
  jahr    INTEGER PRIMARY KEY,
  letzte  INTEGER NOT NULL DEFAULT 0
);

-- ── RLS: an, aber ohne Policies → nur service_role ──────────────────────
ALTER TABLE drohnencheck_anfragen   ENABLE ROW LEVEL SECURITY;
ALTER TABLE drohnencheck_warteliste ENABLE ROW LEVEL SECURITY;
ALTER TABLE drohnencheck_zaehler    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON drohnencheck_anfragen, drohnencheck_warteliste, drohnencheck_zaehler FROM anon, authenticated;

-- ── Anfrage erfassen: Rate-Limit + Referenznummer + Insert in einer Transaktion ──
-- p_daten: JSON mit allen Spalten (bereits in der Function validiert).
-- Rückgabe: { referenz } oder { error: 'rate_limit' }
CREATE OR REPLACE FUNCTION drohnencheck_anfrage_erfassen(p_daten JSONB, p_max_pro_stunde INTEGER DEFAULT 5)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jahr     INTEGER := EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/Zurich'))::INTEGER;
  v_nr       INTEGER;
  v_referenz TEXT;
  v_ip       TEXT := p_daten->>'ip_hash';
BEGIN
  IF v_ip IS NOT NULL AND (
    SELECT count(*) FROM drohnencheck_anfragen
    WHERE ip_hash = v_ip AND created_at > now() - interval '1 hour'
  ) >= p_max_pro_stunde THEN
    RETURN jsonb_build_object('error', 'rate_limit');
  END IF;

  INSERT INTO drohnencheck_zaehler (jahr, letzte) VALUES (v_jahr, 1)
  ON CONFLICT (jahr) DO UPDATE SET letzte = drohnencheck_zaehler.letzte + 1
  RETURNING letzte INTO v_nr;

  v_referenz := 'DC-' || v_jahr || '-' || lpad(v_nr::TEXT, 4, '0');

  INSERT INTO drohnencheck_anfragen (
    referenz, strasse, hausnummer, plz, ort,
    gebaeudetyp, dachform, rolle, baujahr, bemerkung,
    vorname, nachname, telefon, email, kanal, wunschtermine,
    einwilligung_berechtigt, einwilligung_aufnahmen, einwilligung_kommunikation,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_extra, ip_hash
  ) VALUES (
    v_referenz, p_daten->>'strasse', p_daten->>'hausnummer', p_daten->>'plz', p_daten->>'ort',
    p_daten->>'gebaeudetyp', p_daten->>'dachform', p_daten->>'rolle',
    NULLIF(p_daten->>'baujahr', '')::INTEGER, p_daten->>'bemerkung',
    p_daten->>'vorname', p_daten->>'nachname', p_daten->>'telefon', p_daten->>'email', p_daten->>'kanal',
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_daten->'wunschtermine')), '{}'),
    (p_daten->>'einwilligung_berechtigt')::BOOLEAN,
    (p_daten->>'einwilligung_aufnahmen')::BOOLEAN,
    COALESCE((p_daten->>'einwilligung_kommunikation')::BOOLEAN, false),
    p_daten->>'utm_source', p_daten->>'utm_medium', p_daten->>'utm_campaign',
    p_daten->>'utm_content', p_daten->>'utm_term', p_daten->'utm_extra', v_ip
  );

  RETURN jsonb_build_object('referenz', v_referenz);
END $$;

-- Warteliste-Eintrag mit Rate-Limit
CREATE OR REPLACE FUNCTION drohnencheck_warteliste_erfassen(p_daten JSONB, p_max_pro_stunde INTEGER DEFAULT 5)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip TEXT := p_daten->>'ip_hash';
BEGIN
  IF v_ip IS NOT NULL AND (
    SELECT count(*) FROM drohnencheck_warteliste
    WHERE ip_hash = v_ip AND created_at > now() - interval '1 hour'
  ) >= p_max_pro_stunde THEN
    RETURN jsonb_build_object('error', 'rate_limit');
  END IF;

  INSERT INTO drohnencheck_warteliste (email, plz, ort, utm, ip_hash)
  VALUES (p_daten->>'email', p_daten->>'plz', p_daten->>'ort', p_daten->'utm', v_ip);

  RETURN jsonb_build_object('ok', true);
END $$;

-- Löschroutine: Anfragen ohne Auftrag nach X Tagen entfernen.
-- Status 'auftrag' bleibt (dann gelten die Aufbewahrungsfristen des Auftrags).
-- Zusätzlich wird der ip_hash aller Anfragen nach 7 Tagen entfernt (wird nur fürs Rate-Limit gebraucht).
CREATE OR REPLACE FUNCTION drohnencheck_loeschen(p_tage INTEGER DEFAULT 60)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_geloescht INTEGER;
BEGIN
  DELETE FROM drohnencheck_anfragen
  WHERE status <> 'auftrag'
    AND created_at < now() - make_interval(days => p_tage);
  GET DIAGNOSTICS v_geloescht = ROW_COUNT;

  -- Warteliste: nach 24 Monaten ohne Benachrichtigung entfernen
  DELETE FROM drohnencheck_warteliste
  WHERE created_at < now() - interval '24 months';

  UPDATE drohnencheck_anfragen SET ip_hash = NULL
  WHERE ip_hash IS NOT NULL AND created_at < now() - interval '7 days';
  UPDATE drohnencheck_warteliste SET ip_hash = NULL
  WHERE ip_hash IS NOT NULL AND created_at < now() - interval '7 days';

  RETURN jsonb_build_object('geloescht', v_geloescht);
END $$;

-- Funktionen nur für service_role ausführbar
REVOKE ALL ON FUNCTION drohnencheck_anfrage_erfassen(JSONB, INTEGER)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION drohnencheck_warteliste_erfassen(JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION drohnencheck_loeschen(INTEGER)                  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION drohnencheck_anfrage_erfassen(JSONB, INTEGER)   TO service_role;
GRANT EXECUTE ON FUNCTION drohnencheck_warteliste_erfassen(JSONB, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION drohnencheck_loeschen(INTEGER)                  TO service_role;

-- ── Test (als anon im SQL-Editor bzw. per REST mit anon-Key) ─────────────
-- Erwartung: alle drei Aufrufe schlagen mit «permission denied» fehl.
--   SET ROLE anon;
--   SELECT * FROM drohnencheck_anfragen;                       -- permission denied
--   SELECT drohnencheck_anfrage_erfassen('{}'::jsonb);         -- permission denied
--   SELECT drohnencheck_loeschen(0);                           -- permission denied
--   RESET ROLE;
