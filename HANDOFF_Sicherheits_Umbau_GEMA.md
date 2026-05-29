# HANDOFF: Sicherheits-Umbau GEMA

**Ziel:** Die sicherheitskritische Logik von GEMA aus dem Frontend in die Datenbank (Supabase) verlagern. Das Frontend bleibt sichtbar — das ist unvermeidbar und in Ordnung. Sicherheit wird **ausschliesslich serverseitig** durch Row Level Security (RLS) und Supabase Auth durchgesetzt.

**Wichtigster Grundsatz für dich (Claude Code):** Eine RLS-Policy gilt erst dann als fertig, wenn ich (oder ein Reviewer) aktiv getestet habe, dass ein nicht-berechtigter Benutzer NICHT auf fremde Daten zugreifen kann. Generiere keine Policy, ohne im selben Schritt einen konkreten Testfall mitzuliefern, der das beweist.

---

## Stack-Kontext

- Vanilla JS + Supabase + Netlify
- Auth bisher: selbstgebaute `gema_auth.js` mit Rollen + `FILE_MAP`-Routing
- Datenhaltung: teils Supabase (inkl. SECURITY DEFINER RPC), teils `localStorage` mit `_GemaDB`
- Build: `inject-env.js` schreibt Credentials nach `env-config.js`
- ~48 HTML-Module mit Kategorie-Präfixen (pm_, sb_, sa_, el_, hy_, br_, if_, ab_, sys_)

---

## Aktueller Stand (29.05.2026) — bereits passiert

Supabase Security Advisor hatte das Projekt `jaeggivollmer` als KRITISCH gemeldet (`rls_disabled_in_public`, `sensitive_columns_exposed`). RLS wurde daraufhin manuell auf allen Tabellen **aktiviert** → Errors stehen jetzt auf 0.

**ABER: das Loch ist noch nicht zu.** Verbleibend: 18 Warnings, davon mehrfach „RLS Policy Always True". Die vorhandenen Policies prüfen nichts — ihre `qual` ist überall `true` (= „lass jeden durch"). RLS ist also eingeschaltet, aber wirkungslos. Diese Tabellen sind weiterhin für jeden mit der Projekt-URL + anon-Key les- und schreibbar.

**Ist-Zustand der Policies (aus `pg_policies`):**

| Tabelle | Policy | cmd | qual | Bewertung |
|---|---|---|---|---|
| `kunden` | admin_all_kunden | ALL | `true` | **OFFEN — Personendaten, DSG** |
| `ansprechpersonen` | admin_all_ansprechpersonen | ALL | `true` | **OFFEN — Personendaten, DSG** |
| `kunden_interessen` | admin_all_interessen | ALL | `true` | **OFFEN — Personendaten, DSG** |
| `aktivitaet_log` | admin_all_log | ALL | `true` | **OFFEN — evtl. Personenbezug** |
| `inspiration_kategorien` | admin_all_kategorien | ALL | `true` | offen (Schreiben) |
| `inspiration_kategorien` | anon_kategorien_select | SELECT | `true` | Lesen für Katalog — vermutlich gewollt |
| `inspiration_punkte` | admin_all_punkte | ALL | `true` | offen (Schreiben) |
| `inspiration_punkte` | anon_punkte_select | SELECT | `(aktiv = true)` | **Vorbildmuster** — eingeschränkt, nicht `true` |
| `punkt_medien` | admin_all_medien | ALL | `true` | offen (Schreiben) |
| `punkt_medien` | anon_medien_select | SELECT | `true` | Lesen für Katalog — vermutlich gewollt |

**Kern-Erkenntnis:** Die `admin_all_*`-Policies heissen „admin", prüfen aber gar nicht auf Admin. Sie *können* es nicht, weil GEMA noch die eigene `gema_auth.js` nutzt und keine Supabase Auth. Ohne echten eingeloggten DB-Benutzer (`auth.uid()`) gibt es nichts, worauf eine Regel sich stützen könnte ausser `true`. → **Phase 2 (Supabase Auth) ist der eigentliche Blocker, nicht „später".** Solange die nicht steht, lassen sich `kunden` & Co. nicht echt absichern, sondern nur komplett sperren.

**Vorbild:** `anon_punkte_select` mit `(aktiv = true)` zeigt, wie es richtig aussieht — eine eingeschränkte Bedingung statt `true`. Am Ende sollen alle Policies so aussehen (Bedingung statt `true`).

---

## ZUERST ZU KLÄREN — offene Frage (blockiert die Policy-Wahl)

Für jede sensible Tabelle muss bekannt sein, **wie das Frontend darauf zugreift**, denn das entscheidet über die Strategie:

- **Nur über RPC-Funktionen** (`supabase.rpc('...')`) → die permissive `admin_all`-Policy kann **ersatzlos entfernt** werden. RLS ohne erlaubende Regel = Direktzugriff gesperrt, aber die SECURITY DEFINER RPCs funktionieren weiter (sie umgehen RLS). **Loch sofort zu, ganz ohne Auth-Umbau.**
- **Direkt** (`supabase.from('kunden')…`) → braucht eine echte Policy auf Basis von Supabase Auth (Phase 2). Bis dahin nur Notbremse (anon sperren) möglich.

**Prüfung (Claude Code als erster Schritt):** Durchsuche das gesamte Repo und erstelle eine Tabelle „Zugriffsweg pro Tabelle":

```
grep -rn "\.from('kunden'\|\.from(\"kunden\"" .        # direkter Zugriff?
grep -rn "\.rpc(" .                                     # welche RPCs gibt es?
```

Ergebnis pro Tabelle (`kunden`, `ansprechpersonen`, `kunden_interessen`, `aktivitaet_log`, `inspiration_*`, `punkt_medien`):
- Spalte 1: Tabelle
- Spalte 2: greift Frontend DIREKT zu (`.from`)? ja/nein + Fundstellen
- Spalte 3: über welche RPC(s)?
- Spalte 4: empfohlene Strategie (Policy entfernen / Auth-Policy nötig / Notbremse)

Diese Tabelle ist die Grundlage für Phase 3. **Erst danach Policies schreiben.**

---

## Phase 0 — AUDIT (zuerst, nichts ändern)

Erstelle einen Bericht `AUDIT_Sicherheit.md` mit folgenden Befunden, BEVOR du Code änderst:

1. **Schlüssel-Audit:** Durchsuche das gesamte Repo (inkl. `env-config.js`, `inject-env.js`, alle JS/HTML) nach Supabase-Schlüsseln.
   - Markiere jeden gefundenen Schlüssel als `anon/publishable` (öffentlich, ok) oder `service_role` (KRITISCH — darf nie im Frontend sein).
   - Suche auch nach anderen Geheimnissen: API-Keys Dritter, Passwörter, Tokens.
2. **Datenhaltungs-Audit:** Liste pro Modul auf, welche Daten in `localStorage` (`_GemaDB`) liegen und welche in Supabase. Markiere, welche localStorage-Daten echte Nutz-/Geschäftsdaten sind (müssen migriert werden) und welche nur UI-Zustand/Cache sind (dürfen bleiben).
3. **RLS-Audit:** RLS ist bereits auf allen Tabellen aktiv (Errors = 0). Fokus jetzt: alle Policies auflisten und jede mit `qual = true` markieren — das sind die wirkungslosen. Query: `select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='public';`
4. **Zugriffsweg-Audit (siehe Sektion „ZUERST ZU KLÄREN"):** pro sensibler Tabelle dokumentieren, ob das Frontend direkt (`.from`) oder nur über RPC zugreift. Das entscheidet die Strategie und ist die wichtigste offene Frage.
5. **Auth-Audit:** Dokumentiere, wo `gema_auth.js` Berechtigungsentscheidungen trifft, die NUR im Frontend stattfinden (umgehbar).
6. **RPC-Audit:** Prüfe alle SECURITY DEFINER Funktionen — diese laufen mit erhöhten Rechten und müssen intern selbst prüfen, ob der Aufrufer berechtigt ist. Besonders die Advisor-Warnung „Public Can Execute SECURITY DEFINER" (`get_inspiration_*`, `update_kommentar*`): bei Token-Link-Funktionen ist öffentlicher Aufruf evtl. gewollt — ABER nur, wenn die Funktion den Token intern selbst prüft. Sonst ist sie eine Hintertür um RLS herum.

**Stopp nach Phase 0.** Lege mir den Audit-Bericht vor. Erst nach meiner Freigabe weiter.

---

## Phase 1 — Geheimnisse bereinigen (höchste Priorität)

- Falls ein `service_role`-Key oder anderes Geheimnis im Frontend/Repo liegt: entfernen, in der Supabase-Konsole **rotieren** (alten ungültig machen), Git-History bereinigen (BFG/`git filter-repo`).
- Sicherstellen, dass `env-config.js` ausschliesslich den `anon/publishable`-Key enthält.
- `service_role`-Operationen (falls vorhanden) nur in Netlify Functions / Edge Functions verschieben, nie im Browser.

---

## Phase 2 — Auth auf Supabase Auth migrieren

- Selbstgebaute Login-Logik in `gema_auth.js` durch **Supabase Auth** ersetzen (E-Mail/Passwort als Basis).
- Optional OAuth-Provider (Google/Microsoft) als zusätzliche Anmeldeoption in Supabase Auth aktivieren.
- Rollen in einer Tabelle `profiles` (oder bestehender Struktur) am `auth.uid()` verankern, NICHT im Frontend-State als Quelle der Wahrheit.
- `FILE_MAP`-Routing darf als UX bleiben (Module ein-/ausblenden), ist aber kein Sicherheitsmechanismus mehr.
- Session-Handling über das Supabase JWT (automatisch im Client-SDK).

---

## Phase 3 — Tabellen absichern (`true` durch echte Regeln ersetzen)

Strategie pro Tabelle je nach Zugriffsweg-Audit:

**A) Tabelle wird nur über RPC angesprochen** → permissive Policy ersatzlos entfernen, fertig (kein Auth nötig):
```sql
DROP POLICY "admin_all_kunden" ON public.kunden;
-- RLS bleibt aktiv, ohne erlaubende Regel = anon-Direktzugriff gesperrt.
-- SECURITY DEFINER RPCs greifen weiter (umgehen RLS) — vorausgesetzt, sie prüfen intern selbst.
```

**B) Tabelle wird direkt vom Frontend angesprochen** → echte Policy auf Basis Supabase Auth (setzt Phase 2 voraus):
```sql
ALTER TABLE public.kunden ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_kunden" ON public.kunden;

CREATE POLICY "kunden_select_member" ON public.kunden
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );
CREATE POLICY "kunden_write_member" ON public.kunden
  FOR ALL USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  ) WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );
```

**C) Notbremse, bis Phase 2 steht** (wenn echte Personendaten drin sind und sofort geschützt werden müssen) — anon komplett aussperren, internes Tool kurz nicht nutzbar:
```sql
DROP POLICY IF EXISTS "admin_all_kunden" ON public.kunden;
-- keine Policy = niemand kommt per anon-Key durch. Lieber kurz kaputt als offen.
```

**Priorität:** `kunden`, `ansprechpersonen`, `kunden_interessen`, `aktivitaet_log` zuerst (Personendaten, DSG). Die `inspiration_*`- und `punkt_medien`-Lesepolicies (`anon_*_select`) können bleiben, falls der Katalog öffentlich/per Token lesbar sein soll — aber `admin_all_*` (Schreiben) auch dort einschränken.

**Für aus localStorage zu migrierende Daten** (separat vom obigen): Tabelle mit `org_id`/`owner_id` entwerfen, RLS + Policy nach Muster B, Migrationsskript bereitstellen.

3. **Pflicht-Testfall pro Policy mitliefern:** zeige eine Query mit reinem anon-Key auf die Tabelle und bestätige, dass 0 Zeilen / Fehler zurückkommen.
4. SECURITY DEFINER RPC-Funktionen: jede um eine interne Berechtigungs-/Token-Prüfung ergänzen (`IF ... THEN RAISE EXCEPTION`).

---

## Phase 4 — Frontend-Datenschicht umstellen

- Alle Lese-/Schreibzugriffe pro Modul von `localStorage`/`_GemaDB` auf authentifizierte Supabase-Calls umstellen.
- Frontend-Rollenprüfungen bleiben nur für Anzeige-Logik (Buttons ein-/ausblenden) — niemals als alleiniger Schutz.
- `_GemaDB` darf weiterhin für reinen UI-Zustand/Cache genutzt werden, nie für vertrauliche oder integritätskritische Daten.

---

## Phase 5 — Verifikation (nicht optional)

Bevor irgendein Modul als „fertig" gilt:

1. **Penetrations-Selbsttest pro Tabelle:** Mit dem reinen anon-Key (ohne Login) und mit einem fremden Benutzer-Login versuchen, Daten zu lesen/schreiben → muss scheitern.
2. **Direkter API-Zugriff:** REST-/SDK-Aufruf an der Frontend-UI vorbei → RLS muss greifen.
3. Checkliste pro Modul: RLS aktiv? Policies getestet? Keine Geheimnisse im Bundle? Auth erzwungen?

---

## Arbeitsweise

- Modul für Modul, nicht alles auf einmal. Beginne mit dem Modul mit den sensibelsten Daten.
- Nach jeder Phase: kurzer Statusbericht + offene Risiken.
- Bei Unsicherheit über eine Berechtigungsregel: nachfragen statt annehmen.
- In allen erstellten Dokumenten echte Umlaute (ä, ö, ü) verwenden.

---

## Hinweis zum Zeitrahmen

Der mechanische Teil (Policies, Umstellung der Aufrufe) ist schnell. Der Flaschenhals ist die Verifikation jeder einzelnen Policy. Liefere darum immer Code + Testnachweis zusammen, damit der Review nicht zum Engpass wird.
