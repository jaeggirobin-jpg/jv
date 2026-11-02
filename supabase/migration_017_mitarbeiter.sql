-- migration_017_mitarbeiter.sql — Eigene Logins für Mitarbeiterinnen und Mitarbeiter (intern)
--
-- Bisher gab es nur das eine Admin-Passwort (ADMIN_PASSWORD). Neu kann ein Admin in der Plattform
-- (#/zugaenge) Logins anlegen: E-Mail, Name, Rolle (admin / mitarbeiter) und Bereiche.
--   mitarbeiter      ein Login pro Person; Passwort nur als scrypt-Hash, nie im Klartext
--   anmelde_fehler   Fehlversuche pro (gehashter) IP-Adresse, Schutz gegen Durchprobieren, nach 1 Tag weg
-- Das Hauptpasswort ADMIN_PASSWORD bleibt als Zugang für Admins bestehen (Anmeldung ohne E-Mail).
--
-- Zugriff ausschliesslich über die Netlify Functions mit dem service_role-Key (/api/sitzung,
-- /api/zugaenge). Supabase Auth wird NICHT verwendet. RLS ist aktiv OHNE Policies.
-- Ausführen im Supabase SQL-Editor (einmalig, nach migration_016). Idempotent.

CREATE TABLE IF NOT EXISTS mitarbeiter (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  TEXT NOT NULL UNIQUE
                         CHECK (email = lower(email) AND char_length(email) <= 200 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  name                   TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  rolle                  TEXT NOT NULL DEFAULT 'mitarbeiter' CHECK (rolle IN ('admin', 'mitarbeiter')),
  -- Bereiche für die Rolle «mitarbeiter» (Admins dürfen alles)
  bereiche               TEXT[] NOT NULL DEFAULT ARRAY['projekte', 'kunden', 'katalog', 'anfragen']
                         CHECK (bereiche <@ ARRAY['projekte', 'kunden', 'katalog', 'anfragen']),
  passwort_hash          TEXT NOT NULL CHECK (passwort_hash LIKE 'scrypt$%'),
  muss_passwort_aendern  BOOLEAN NOT NULL DEFAULT true,     -- Startpasswort beim ersten Login ersetzen
  aktiv                  BOOLEAN NOT NULL DEFAULT true,
  -- Wird bei Sperren, neuem Passwort oder neuen Rechten erhöht: beendet alle Sitzungen der Person
  sitzung_version        INTEGER NOT NULL DEFAULT 1,
  fehlversuche           INTEGER NOT NULL DEFAULT 0,
  gesperrt_bis           TIMESTAMPTZ,
  letzte_anmeldung       TIMESTAMPTZ,
  erstellt               TIMESTAMPTZ NOT NULL DEFAULT now(),
  geaendert              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION mitarbeiter_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.geaendert := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS mitarbeiter_touch ON mitarbeiter;
CREATE TRIGGER mitarbeiter_touch BEFORE UPDATE ON mitarbeiter
  FOR EACH ROW EXECUTE FUNCTION mitarbeiter_touch();

CREATE TABLE IF NOT EXISTS anmelde_fehler (
  id        BIGSERIAL PRIMARY KEY,
  ip_hash   TEXT NOT NULL,
  erstellt  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS anmelde_fehler_ip_idx ON anmelde_fehler (ip_hash, erstellt);

-- ── RLS: an, aber ohne Policies → nur service_role ──────────────────────
ALTER TABLE mitarbeiter    ENABLE ROW LEVEL SECURITY;
ALTER TABLE anmelde_fehler ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mitarbeiter, anmelde_fehler FROM anon, authenticated;
REVOKE ALL ON SEQUENCE anmelde_fehler_id_seq FROM anon, authenticated;
REVOKE ALL ON FUNCTION mitarbeiter_touch() FROM PUBLIC, anon, authenticated;

-- ── Test ────────────────────────────────────────────────────────────────
-- Erwartung: alle Aufrufe als anon schlagen mit «permission denied» fehl.
--   SET ROLE anon;
--   SELECT * FROM mitarbeiter;                                          -- permission denied
--   SELECT * FROM anmelde_fehler;                                       -- permission denied
--   RESET ROLE;
-- Das erste Login legt ein Admin in der Plattform an: mit dem Hauptpasswort anmelden (E-Mail leer
-- lassen), dann «Logins» → «Neues Login».
