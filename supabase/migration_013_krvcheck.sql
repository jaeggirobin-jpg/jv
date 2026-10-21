-- migration_013_krvcheck.sql — Tabellen und Funktionen für den Gratis KRV-Check (krv.jaeggivollmer.ch)
--
-- Kunden laden Fotos der Wasserzähler-Armatur hoch, wir beurteilen im Admin, ob bereits ein
-- Rückflussverhinderer (KRV) eingebaut ist, und erstellen sonst eine Offerte.
--
-- Eigenständig: berührt keine bestehenden Tabellen (kunden, drohnencheck_* usw.).
-- Zugriff ausschliesslich über die Netlify Functions mit dem service_role-Key.
-- RLS ist aktiv OHNE Policies: anon/authenticated haben dadurch keinerlei Zugriff.
--
-- Voraussetzung: keine (nutzt pgcrypto/gen_random_uuid wie die übrigen Migrationen).
-- Ausführen im Supabase SQL-Editor (einmalig). Idempotent.

-- ── Anfragen ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS krvcheck_anfragen (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referenz                    TEXT UNIQUE NOT NULL,               -- KRV-2026-0001
  status                      TEXT NOT NULL DEFAULT 'neu'
                              CHECK (status IN ('neu', 'beurteilt', 'offerte', 'auftrag', 'abgeschlossen', 'abgesagt')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Adresse der Liegenschaft
  strasse                     TEXT NOT NULL,
  hausnummer                  TEXT NOT NULL,
  plz                         TEXT NOT NULL,
  ort                         TEXT NOT NULL,

  -- Kontakt
  vorname                     TEXT NOT NULL,
  nachname                    TEXT NOT NULL,
  telefon                     TEXT NOT NULL,
  email                       TEXT NOT NULL,
  rolle                       TEXT NOT NULL CHECK (rolle IN ('eigentuemer', 'verwaltung', 'mieter')),
  iwb_brief                   BOOLEAN NOT NULL DEFAULT false,     -- Brief von IWB erhalten
  bemerkung                   TEXT,

  -- Fotos im privaten Bucket «krvcheck», Pfad {id}/{zufall}.jpg
  fotos                       JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ pfad }]
  keine_fotos                 BOOLEAN NOT NULL DEFAULT false,     -- «Ich finde die Armatur nicht, bitte anrufen»
  upload_token_hash           TEXT,                               -- SHA-256 des Upload-Tokens (nur für den Abschluss)
  upload_bis                  TIMESTAMPTZ,                        -- Fotos können bis dann abgeschlossen werden
  fotos_abgeschlossen_at      TIMESTAMPTZ,

  -- Beurteilung (im Admin)
  beurteilung                 TEXT CHECK (beurteilung IN ('vorhanden', 'fehlt', 'unklar')),
  beurteilung_text            TEXT,                               -- Begründung für den Kunden
  beurteilt_at                TIMESTAMPTZ,

  -- Einwilligung (Zeitpunkt = created_at)
  einwilligung                BOOLEAN NOT NULL,

  -- Messbarkeit
  utm_source                  TEXT,
  utm_medium                  TEXT,
  utm_campaign                TEXT,
  utm_content                 TEXT,
  utm_term                    TEXT,
  utm_extra                   JSONB,                               -- fbclid, landing, referrer

  -- Technik
  ip_hash                     TEXT,                                -- gesalzener SHA-256, nur für Rate-Limit
  mail_intern_ok              BOOLEAN,
  notiz_intern                TEXT,

  CONSTRAINT krvcheck_pflicht_einwilligung CHECK (einwilligung)
);

CREATE INDEX IF NOT EXISTS krvcheck_anfragen_created_idx ON krvcheck_anfragen (created_at);
CREATE INDEX IF NOT EXISTS krvcheck_anfragen_ip_idx ON krvcheck_anfragen (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS krvcheck_anfragen_status_idx ON krvcheck_anfragen (status);

CREATE OR REPLACE FUNCTION krvcheck_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS krvcheck_anfragen_touch ON krvcheck_anfragen;
CREATE TRIGGER krvcheck_anfragen_touch BEFORE UPDATE ON krvcheck_anfragen
  FOR EACH ROW EXECUTE FUNCTION krvcheck_touch();

-- ── Referenz-Zähler pro Jahr ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS krvcheck_zaehler (
  jahr    INTEGER PRIMARY KEY,
  letzte  INTEGER NOT NULL DEFAULT 0
);

-- ── Einstellungen (Anleitungsvideo der Landingpage) ─────────────────────
CREATE TABLE IF NOT EXISTS krvcheck_einstellungen (
  schluessel  TEXT PRIMARY KEY,
  wert        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS krvcheck_einstellungen_touch ON krvcheck_einstellungen;
CREATE TRIGGER krvcheck_einstellungen_touch BEFORE UPDATE ON krvcheck_einstellungen
  FOR EACH ROW EXECUTE FUNCTION krvcheck_touch();

-- ── RLS: an, aber ohne Policies → nur service_role ──────────────────────
ALTER TABLE krvcheck_anfragen      ENABLE ROW LEVEL SECURITY;
ALTER TABLE krvcheck_zaehler       ENABLE ROW LEVEL SECURITY;
ALTER TABLE krvcheck_einstellungen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON krvcheck_anfragen, krvcheck_zaehler, krvcheck_einstellungen FROM anon, authenticated;

-- ── Storage ─────────────────────────────────────────────────────────────
-- «krvcheck»: privat, Fotos der Kunden (max. 10 MB, nur Bilder). Keine Storage-Policies:
-- Upload nur über signierte Upload-URLs der Functions, Anzeige nur über kurz gültige signierte URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('krvcheck', 'krvcheck', false, 10485760, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- «krvcheck-medien»: öffentlich, nur das Anleitungsvideo der Landingpage (kein Kundenmaterial).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('krvcheck-medien', 'krvcheck-medien', true, 52428800, ARRAY['video/mp4', 'video/webm', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE SET public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Anfrage erfassen: Rate-Limit + Referenznummer + Insert in einer Transaktion ──
-- p_daten: JSON mit allen Spalten (bereits in der Function validiert).
-- Rückgabe: { id, referenz } oder { error: 'rate_limit' }
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
    vorname, nachname, telefon, email, rolle, iwb_brief, bemerkung,
    keine_fotos, upload_token_hash, upload_bis, einwilligung,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_extra, ip_hash
  ) VALUES (
    v_referenz, p_daten->>'strasse', p_daten->>'hausnummer', p_daten->>'plz', p_daten->>'ort',
    p_daten->>'vorname', p_daten->>'nachname', p_daten->>'telefon', p_daten->>'email',
    p_daten->>'rolle', COALESCE((p_daten->>'iwb_brief')::BOOLEAN, false), p_daten->>'bemerkung',
    COALESCE((p_daten->>'keine_fotos')::BOOLEAN, false),
    p_daten->>'upload_token_hash', (p_daten->>'upload_bis')::TIMESTAMPTZ,
    (p_daten->>'einwilligung')::BOOLEAN,
    p_daten->>'utm_source', p_daten->>'utm_medium', p_daten->>'utm_campaign',
    p_daten->>'utm_content', p_daten->>'utm_term', p_daten->'utm_extra', v_ip
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'referenz', v_referenz);
END $$;

-- Löschroutine: Anfragen ohne Auftrag nach X Tagen entfernen (gibt die IDs zurück,
-- damit die Function die Fotos im Bucket löschen kann). ip_hash nach 7 Tagen entfernen.
CREATE OR REPLACE FUNCTION krvcheck_loeschen(p_tage INTEGER DEFAULT 90)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  WITH weg AS (
    DELETE FROM krvcheck_anfragen
    WHERE status <> 'auftrag'
      AND created_at < now() - make_interval(days => p_tage)
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_ids FROM weg;

  UPDATE krvcheck_anfragen SET ip_hash = NULL
  WHERE ip_hash IS NOT NULL AND created_at < now() - interval '7 days';

  -- Upload-Token wird nach Ablauf nicht mehr gebraucht
  UPDATE krvcheck_anfragen SET upload_token_hash = NULL
  WHERE upload_token_hash IS NOT NULL AND upload_bis < now();

  RETURN jsonb_build_object('geloescht', cardinality(v_ids), 'ids', to_jsonb(v_ids));
END $$;

-- Funktionen nur für service_role ausführbar
REVOKE ALL ON FUNCTION krvcheck_anfrage_erfassen(JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION krvcheck_loeschen(INTEGER)                FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION krvcheck_anfrage_erfassen(JSONB, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION krvcheck_loeschen(INTEGER)                TO service_role;

-- ── Test ────────────────────────────────────────────────────────────────
-- Erwartung: alle Aufrufe als anon schlagen mit «permission denied» fehl.
--   SET ROLE anon;
--   SELECT * FROM krvcheck_anfragen;                          -- permission denied
--   SELECT krvcheck_anfrage_erfassen('{}'::jsonb);            -- permission denied
--   SELECT krvcheck_loeschen(0);                              -- permission denied
--   RESET ROLE;
--   SELECT id, public, allowed_mime_types FROM storage.buckets WHERE id LIKE 'krvcheck%';
--   -- krvcheck: public = false, krvcheck-medien: public = true
