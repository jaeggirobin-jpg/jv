# AUDIT Sicherheit — Phase 0

**Repo:** `jv` (Inspiration + Docs für Jäggi Vollmer)
**Supabase-Projekt:** `jaeggivollmer` (`ywcnccpjhnnspbkcmpng`)
**Datum:** 29.05.2026
**Status:** Nur Audit — kein Code, kein SQL geändert.

---

## Wichtige Vorbemerkung: zwei Repos, eine Datenbank

Die Handoff `HANDOFF_Sicherheits_Umbau_GEMA.md` beschreibt das **GEMA-Projekt** (mit `gema_auth.js`, `_GemaDB`, `inject-env.js`, `env-config.js`, Modul-Präfixen `pm_`/`sb_`/…). **Keine** dieser Dateien existiert in diesem Repo:

| Erwartete GEMA-Datei | In diesem Repo? |
|---|---|
| `gema_auth.js` | nein |
| `inject-env.js` | nein |
| `env-config.js` | nein |
| `_GemaDB` (localStorage) | nein |

→ GEMA ist ein **separates Repo**, das sich aber dieselbe Supabase-Instanz und dieselben Tabellen (`kunden`, `ansprechpersonen`, `kunden_interessen`, `aktivitaet_log`, `inspiration_*`, `punkt_medien`) teilt. Dieser Audit deckt **nur das `jv`-Repo** ab. Für ein vollständiges Bild der DB-Sicherheit muss das GEMA-Repo separat auditiert werden — **dort** könnte es Direktzugriffe (`.from`) oder localStorage-Geschäftsdaten geben, die hier nicht sichtbar sind.

---

## 1. Zugriffsweg pro Tabelle (die Kernfrage)

Durchsucht wurden alle `*.html` / `*.js` im Repo (ohne `node_modules`, ohne `netlify/functions`) nach `.from('<tabelle>')` und `.rpc(...)`.

**Ergebnis: Das Frontend (`inspiration.html`, `swipe.html`, `index.html`) greift auf KEINE Tabelle direkt per `.from()` zu.** Der einzige `.from()`-Aufruf im Frontend ist `sb.storage.from('inspiration-medien')` — das ist **Storage**, keine Tabelle.

| Tabelle | Direkt (`.from`) im Frontend? | Über welche RPC? | Admin-Schreibweg | Empfohlene Strategie |
|---|---|---|---|---|
| `kunden` | **nein** | `get_inspiration_data` (liest Kundendaten) | Netlify Functions (service_role) | **A** — `admin_all_kunden` ersatzlos droppen |
| `ansprechpersonen` | **nein** | `get_inspiration_data` (liefert AP eingebettet) | Netlify Functions (service_role) | **A** — `admin_all_ansprechpersonen` droppen |
| `kunden_interessen` | **nein** | `get_inspiration_data` (lesen), `upsert_interesse` + `update_kommentar` (schreiben) | Netlify Functions (service_role) | **A** — `admin_all_interessen` droppen |
| `aktivitaet_log` | **nein** | wird von RPCs (SECURITY DEFINER) geschrieben | Netlify `get-kunde-interessen` (lesen) | **A** — `admin_all_log` droppen |
| `inspiration_kategorien` | **nein** | `get_inspiration_data` (liefert Kategorien eingebettet) | Netlify Functions | **A** für `admin_all_kategorien` (Schreiben). `anon_kategorien_select (true)` ist **redundant** (Frontend liest via RPC) → kann gedroppt werden |
| `inspiration_punkte` | **nein** | `get_inspiration_data` | Netlify Functions | **A** für `admin_all_punkte`. `anon_punkte_select (aktiv=true)` ist das Vorbildmuster — redundant fürs aktuelle Frontend, aber harmlos |
| `punkt_medien` | **nein** | `get_inspiration_data` (Medien eingebettet) | Netlify Functions | **A** für `admin_all_medien`. `anon_medien_select (true)` redundant fürs Frontend |

**Fazit:** Best-Case-Szenario der Handoff. Alle vier Personendaten-Tabellen werden ausschliesslich über SECURITY-DEFINER-RPCs (Kunde) bzw. service_role (Admin) angesprochen. Die `admin_all_*`-Policies (`qual = true`) können **ersatzlos entfernt** werden — RLS bleibt aktiv, anon-Direktzugriff ist dann gesperrt, RPCs und Netlify Functions laufen weiter. **Das Loch lässt sich sofort schliessen, ohne Supabase-Auth-Umbau (Phase 2).**

---

## 2. Schlüssel-Audit

| Fundort | Schlüssel | Typ | Bewertung |
|---|---|---|---|
| `inspiration.html:1235` | `SUPABASE_ANON_KEY` (role: `anon`, per JWT verifiziert) | anon / publishable | **OK** — öffentlich gedacht |
| `swipe.html:1011` | `SUPABASE_ANON_KEY` (role: `anon`) | anon / publishable | **OK** |
| `netlify/functions/*.js` (29 Dateien) | `process.env.SUPABASE_SERVICE_KEY` | service_role | **OK** — nur serverseitig, kommt aus Netlify-Env, nie im Browser-Bundle |
| `index.html` | — | — | nutzt **keinen** Supabase-Client (nur Netlify Functions) |

- **Kein `service_role`-Key im Frontend** oder im Git-Repo. ✓
- Die JWT-Rolle des Frontend-Keys wurde dekodiert und ist bestätigt `anon`. ✓
- `view.html` enthält keinen Supabase-Key (nutzt nur die `get-pdf` Netlify Function).
- **Weiteres Geheimnis:** `ADMIN_PASSWORD` wird in den Netlify Functions per `process.env` geprüft (Bearer-Header). Das Passwort selbst liegt **nicht** im Repo. Siehe Auth-Audit (Punkt 5).

> Hinweis: Der service_role-Key und das ADMIN_PASSWORD wurden früher in dieser Chat-Session im Klartext geteilt. Empfehlung für Phase 1: beide in der Supabase-/Netlify-Konsole **rotieren**, da sie als kompromittiert gelten müssen.

---

## 3. Datenhaltungs-Audit (localStorage / sessionStorage)

| Fundort | Speicher | Inhalt | Echte Daten oder UI-Cache? |
|---|---|---|---|
| `index.html:588-590,1744` | `sessionStorage` (`jv_admin_pwd`) | Admin-Passwort während der Session | **UI-Zustand** (Auth-Token), keine Geschäftsdaten |

- **Kein `_GemaDB`** in diesem Repo — das ist GEMA-spezifisch.
- **Keine Geschäfts-/Personendaten in localStorage.** Alle echten Daten liegen in Supabase.
- Einziger Punkt: Das Admin-Passwort steht im Klartext im `sessionStorage` und wird als `Authorization: Bearer` an die Functions geschickt. Für ein internes Tool akzeptabel, aber: ein geteiltes statisches Passwort ist schwächer als echte Auth. Siehe Empfehlung Punkt 5.

---

## 4. RLS-Audit (Policies mit `qual = true`)

Die `pg_policies`-Tabelle aus der Handoff ist die Quelle (ich habe in dieser Phase nichts an der DB abgefragt/geändert). Bewertung im Kontext des Zugriffsweg-Audits:

| Tabelle | Policy | cmd | qual | Wirksam? | Aktion (Phase 3) |
|---|---|---|---|---|---|
| `kunden` | admin_all_kunden | ALL | `true` | **nein** | droppen (Strategie A) |
| `ansprechpersonen` | admin_all_ansprechpersonen | ALL | `true` | **nein** | droppen (A) |
| `kunden_interessen` | admin_all_interessen | ALL | `true` | **nein** | droppen (A) |
| `aktivitaet_log` | admin_all_log | ALL | `true` | **nein** | droppen (A) |
| `inspiration_kategorien` | admin_all_kategorien | ALL | `true` | **nein** | droppen (A) |
| `inspiration_kategorien` | anon_kategorien_select | SELECT | `true` | lässt alle lesen | redundant → droppen oder belassen (nicht sensibel) |
| `inspiration_punkte` | admin_all_punkte | ALL | `true` | **nein** | droppen (A) |
| `inspiration_punkte` | anon_punkte_select | SELECT | `(aktiv = true)` | eingeschränkt ✓ | Vorbild — belassen |
| `punkt_medien` | admin_all_medien | ALL | `true` | **nein** | droppen (A) |
| `punkt_medien` | anon_medien_select | SELECT | `true` | lässt alle lesen | redundant → droppen oder belassen |

**Befund:** 8 Policies mit `qual = true` sind wirkungslos. Davon sind 5 `admin_all_*` (ALL) **gefährlich** (erlauben anon-Schreiben/-Lesen auf Personendaten + Katalog). Die 3 `anon_*_select`-Lesepolicies auf Katalogdaten sind nicht gefährlich (nicht sensibel) und für das aktuelle Frontend sogar redundant, da der Katalog über `get_inspiration_data` ausgeliefert wird.

---

## 5. Auth-Audit (Frontend-only Berechtigungen)

- **`gema_auth.js` existiert in diesem Repo nicht.** Die in der Handoff beschriebene umgehbare Frontend-Rollenlogik betrifft GEMA, nicht `jv`.
- **Kunden-Seite** (`inspiration.html`, `swipe.html`): kein Login. Zugang per 32-Hex-Token in der URL. Die Berechtigung wird **serverseitig** in jeder RPC geprüft (`access_token = p_token AND status = 'aktiv'`). ✓ Keine Frontend-only-Entscheidung.
- **Admin-Seite** (`index.html`): kein Supabase Auth. Stattdessen geteiltes Passwort → Bearer-Header → **serverseitige** Prüfung in jeder Netlify Function (`token === process.env.ADMIN_PASSWORD`). Die Berechtigung wird also serverseitig erzwungen, **nicht** nur im Frontend. ✓
  - Schwäche: ein einziges statisches, geteiltes Passwort (kein Benutzer-Konzept, keine Rotation, kein Audit-Trail wer was tat). Für die Zukunft erwägenswert: Admin auf Supabase Auth (Phase 2) umstellen. Für den aktuellen Schutz der Tabellen aber **nicht nötig**, da Strategie A ohne Auth auskommt.

---

## 6. RPC-Audit (SECURITY DEFINER)

Alle drei anon-aufrufbaren RPCs prüfen den Token **intern selbst** — sie sind keine Hintertür um RLS herum:

| Funktion | GRANT an anon? | Interne Prüfung | Bewertung |
|---|---|---|---|
| `get_inspiration_data(p_token)` | ja | `SELECT … WHERE access_token = p_token AND status = 'aktiv'`; `IF NOT FOUND THEN RAISE EXCEPTION` | ✓ sicher — liefert nur Daten des Token-Inhabers |
| `upsert_interesse(p_token, …)` | ja | gleiche Token-Prüfung, sonst `RAISE EXCEPTION` | ✓ sicher |
| `update_kommentar(p_token, …)` | ja | gleiche Token-Prüfung, sonst `RAISE EXCEPTION` | ✓ sicher |
| `set_updated_at()` | (Trigger) | — | unkritisch (Trigger-Funktion, kein anon-Aufruf) |

Beobachtungen:
- Der öffentliche Aufruf ist **gewollt und sicher**, weil jede Funktion den geheimen Token prüft. Das entspricht exakt dem von der Handoff geforderten Muster.
- `get_inspiration_data` liefert Personendaten (Vorname, Nachname, Projekt-Adresse, Termin) für einen gültigen Token zurück — das ist by design (der Kunde sieht seine eigenen Daten). Sicherheit hängt an der **Nicht-Erratbarkeit des Tokens** (16 Byte = 128 Bit Entropie, `gen_random` → ok).
- Es existieren **mehrere Versionen** von `get_inspiration_data` in den Migrationsdateien (002, 005, 007, 007b). Die zuletzt ausgeführte (007b) ist massgeblich und enthält die `status = 'aktiv'`-Prüfung. **Empfehlung:** vor Phase 3 in der DB verifizieren, welche Version aktiv ist (`SELECT prosrc FROM pg_proc WHERE proname = 'get_inspiration_data'`), damit keine alte Version ohne Status-Check aktiv ist.

---

## Gesamtbewertung & empfohlenes Vorgehen

**Gute Nachricht:** Im `jv`-Repo ist die Lage deutlich besser als von der Handoff befürchtet:
- Kein Direktzugriff vom Frontend auf Tabellen → **Strategie A für alle Tabellen anwendbar**.
- Kein service_role-Leak im Frontend.
- Keine Geschäftsdaten in localStorage.
- Alle anon-RPCs prüfen den Token serverseitig.

**Das eigentliche Loch** sind die 5 `admin_all_*`-Policies mit `qual = true`, die anon-Direktzugriff auf `kunden`, `ansprechpersonen`, `kunden_interessen`, `aktivitaet_log` und die Katalog-Schreibtabellen erlauben. Da nichts im Frontend diese Policies braucht, können sie **ersatzlos gedroppt** werden (Strategie A) — sofortige Schliessung ohne Auth-Umbau.

**Vorgeschlagene Reihenfolge für Phase 1/3 (nach deiner Freigabe):**
1. **Phase 1:** service_role-Key und ADMIN_PASSWORD rotieren (wurden im Chat geteilt).
2. **Phase 3 (Strategie A), Priorität Personendaten zuerst:**
   - `DROP POLICY admin_all_kunden ON kunden;`
   - `DROP POLICY admin_all_ansprechpersonen ON ansprechpersonen;`
   - `DROP POLICY admin_all_interessen ON kunden_interessen;`
   - `DROP POLICY admin_all_log ON aktivitaet_log;`
   - danach Katalog-Schreibpolicies: `admin_all_punkte`, `admin_all_kategorien`, `admin_all_medien`
   - jeweils **mit Penetrationstest** (anon-Key versucht `.from('kunden').select()` → muss 0 Zeilen / Fehler liefern) und **Funktionstest** (Kunden-Link + Admin-Panel funktionieren weiter).
3. **Offen / separat:** GEMA-Repo auditieren (teilt dieselben Tabellen — dort könnten Direktzugriffe sein, die Strategie A brechen würden). **Bevor** Policies gedroppt werden, muss sichergestellt sein, dass auch GEMA nicht direkt per anon-`.from` auf diese Tabellen zugreift.

---

## ⚠️ Blockierende Rückfrage vor Phase 3

**Greift das GEMA-Repo (oder irgendein anderer Client) direkt per anon-Key auf `kunden` / `ansprechpersonen` / `kunden_interessen` / `aktivitaet_log` zu?**

Wenn ja, würde das Droppen der `admin_all_*`-Policies GEMA brechen. Da beide Repos dieselbe DB teilen, kann ich das aus dem `jv`-Repo allein **nicht** abschliessend beantworten. Bitte entweder:
- (a) das GEMA-Repo ebenfalls per `grep -rn "\.from(" .` prüfen (lassen), oder
- (b) bestätigen, dass GEMA seine Daten auch nur über RPC/Functions bezieht.

**Erst nach dieser Klärung und deiner Freigabe gehe ich zu Phase 1/3 weiter.**
