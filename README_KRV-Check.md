# Gratis KRV-Check (krv.jaeggivollmer.ch)

Hauseigentümer im IWB-Gebiet (Basel, Riehen, Bettingen, Binningen) laden Fotos der Armatur beim Wasserzähler hoch.
Wir beurteilen im Admin, ob ein Rückflussverhinderer (KRV) eingebaut ist, und offerieren sonst den Einbau.
Gleiches Muster wie der Drohnen-Check (`README_Drohnen-Check.md`): dieselbe Netlify-Site, Subdomain per Host-Rewrite.

## Grundlage

IWB-Unterlagen (Flyer «Rückflussverhinderung in Trinkwasserinstallationen», Brief an Hauseigentümer vom 1.10.2021):
§ 28 der Ausführungsbestimmungen von IWB betreffend die Abgabe von Trinkwasser (SG 772.800). Die Grund- bzw.
Hauseigentümerschaft muss auf eigene Kosten nach der Messeinrichtung einen kontrollierbaren Rückflussverhinderer
installieren. Angeschriebene Liegenschaften sollen bis 1.1.2027 nachrüsten. Texte auf der Seite nur so formulieren.

## Aufbau

| Teil | Ort |
|---|---|
| Landingpage, Formular, Anleitung | `public/krv/index.html`, `assets/app.js`, `assets/szene.js` (gezeichnete Skizze, nur Ersatz, falls das Video nicht lädt), `assets/krv.css` |
| Erklärvideo auf der Seite | `assets/anleitung.mp4`/`.webm` + `anleitung.jpg` (läuft stumm und in Schleife, sobald sichtbar; Quelle `web.html` im Projektordner krv-check/video-quelle/) |
| Texte, PLZ, Löschfrist, Pixel | `public/krv/config.js` |
| Anfragen-Übersicht | `public/krv/admin.html` und Tab «KRV-Check» im Admin-Panel (`public/index.html`), Code `public/krv/assets/admin.js` |
| Functions | `netlify/functions/krv-*.js`, Hilfen `_lib/krvcheck.js` (nutzt `_lib/dachcheck.js`) |
| Datenbank | `supabase/migration_013_krvcheck.sql`: Tabellen `krvcheck_*`, Buckets `krvcheck` (privat, Fotos), `krvcheck-medien` (öffentlich, Anleitungsvideo) |

Schriften, Grundgestaltung, Logo und die Video-Verkleinerung kommen aus `public/dachcheck/assets/` (auf der Subdomain
über eine eigene Weiterleitung erreichbar).

### Ablauf einer Anfrage

1. Kunde wählt 1 bis 5 Fotos. Der Browser verkleinert sie (1800 px, JPEG, ohne Standortdaten).
2. `krv-anfrage` prüft die Angaben (PLZ im IWB-Gebiet), speichert die Anfrage (`KRV-2026-0001`) und gibt signierte Upload-URLs plus einen Upload-Token zurück (gültig 2 Stunden, gespeichert wird nur der Hash).
3. Der Browser lädt die Fotos direkt in den privaten Bucket, dann schliesst `krv-fotos` ab und sendet die Info-Mail an info@ (ohne Personendaten, nur Referenz und Link).
4. Option «Ich finde den Wasserzähler nicht, bitte anrufen»: Anfrage ohne Fotos, Info-Mail sofort.
5. Bricht der Upload ab, holt die tägliche `krv-loeschroutine` die Info-Mail nach. Im Admin sind auch nicht abgeschlossene Uploads sichtbar.
6. Im Admin: Fotos ansehen, Beurteilung «vorhanden / fehlt / unklar» mit Begründung speichern, dann «Antwort per E-Mail» öffnet einen fertigen Entwurf im eigenen Mailprogramm. Bei «vorhanden» gibt es bewusst keine Bestätigung an IWB, der Kunde nutzt die Rückantwortkarte selbst.
7. Löschung ohne Auftrag nach 90 Tagen (Anfrage und Fotos), ausser Status «Auftrag».

## Einrichtung (einmalig, durch Robin)

1. **PR mergen.** Netlify deployt automatisch.
2. **Supabase:** Dashboard → SQL Editor → New query → Inhalt von `supabase/migration_013_krvcheck.sql` einfügen → Run.
   Kontrolle: Table Editor zeigt `krvcheck_anfragen`, Storage zeigt die Buckets `krvcheck` (privat) und `krvcheck-medien` (öffentlich).
3. **Netlify:** Site «JV Docs» → Domain management → Production domains → Add domain alias → `krv.jaeggivollmer.ch`.
4. **Hostpoint DNS:** Domain jaeggivollmer.ch → DNS-Editor → neuer Eintrag Typ `CNAME`, Name `krv`, Ziel `[netlify-site].netlify.app` (gleicher Wert wie beim Eintrag `dachcheck`). Das SSL-Zertifikat erstellt Netlify danach automatisch (bis ca. 1 Stunde).
5. **Environment Variables:** keine neuen nötig. Die Info-Mail nutzt den bestehenden Absender `DC_ABSENDER`. Optional: `KRV_ABSENDER`, `KRV_EMPFAENGER`, `KRV_RATE_LIMIT` (Standard 5 Anfragen pro Stunde und IP), `KRV_LIMIT_GESAMT` (Standard 30 Anfragen pro Stunde über alle Absender).
6. **Test:** `https://krv.jaeggivollmer.ch` auf dem Handy öffnen, Foto hochladen, absenden. Info-Mail an info@ kommt, Link führt zu `krv.jaeggivollmer.ch/admin.html#KRV-…`, Fotos sind sichtbar. Die Testanfrage danach auf «Abgesagt» setzen.

## Offen

- Bestätigen, dass Jäggi Vollmer die Installationsbewilligung von IWB hat (E-Mail-Entwurf «fehlt» sagt, dass wir den Einbau an IWB melden).
- Datenschutzerklärung prüfen lassen, Entwurfs-Hinweis entfernen; UID im Impressum.
- Meta Pixel-ID in `config.js` → `tracking.metaPixelId`.
- Optional: echtes Anleitungsvideo im Admin unter «Anleitungsvideo» importieren. Es ersetzt dann das mitgelieferte gezeichnete Video.
