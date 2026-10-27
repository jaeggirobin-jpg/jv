# Sicherheit Drohnen-Check und KRV-Check

Stand: Prüfung vom 27.10.2026. Gilt für `public/dachcheck/`, `public/krv/` und die Functions `dachcheck-*`, `krv-*`.

## Datenspeicherung

- Tabellen `drohnencheck_*` und `krvcheck_*`: RLS aktiv, keine Policies, `REVOKE ALL` für `anon`/`authenticated`. Zugriff nur über die Functions mit dem Service-Key.
- RPCs (`*_anfrage_erfassen`, `*_loeschen`) sind nur für `service_role` ausführbar.
- Buckets `drohnencheck` und `krvcheck`: privat, nur Bilder, max. 10 MB. Upload nur über signierte Upload-URLs, Anzeige nur über signierte URLs (1 Stunde).
- Buckets `drohnencheck-medien` und `krvcheck-medien`: öffentlich, nur Werbevideos, Upload nur durch den Admin.
- Kundenfotos werden im Browser neu als JPEG gezeichnet, dadurch fallen EXIF- und GPS-Daten weg.
- Supabase-Region: Irland (EU).
- Löschroutinen: Drohnen-Check 60 Tage, KRV-Check 90 Tage ohne Auftrag, IP-Hash nach 7 Tagen.
- Info-Mails enthalten keine Personendaten, nur Referenz und Link.

## Missbrauch

- Honeypot-Feld, Prüfung aller Eingaben in den Functions.
- Rate-Limit pro IP (5 pro Stunde) und Gesamtlimit pro Stunde (Standard 30, `DC_LIMIT_GESAMT`, `KRV_LIMIT_GESAMT`), damit niemand mit vielen IP-Adressen Datenbank, Speicher und Postfach flutet.
- IP-Hash als HMAC mit geheimem Schlüssel (`DC_IP_SALT` oder aus dem Service-Key abgeleitet).

## Browser

- Content-Security-Policy als `<meta>` in jeder HTML-Seite der beiden Landingpages: Skripte nur vom eigenen Server (auf der Landingpage zusätzlich das Meta Pixel nach Zustimmung), Bilder/Videos/Uploads nur zu `*.supabase.co`, Adress-Vorschläge von `api3.geo.admin.ch` (swisstopo, `assets/adresse.js`, nur die getippte Adresse wird gesendet). Neue externe Dienste müssen dort ergänzt werden.
- Alle Kundendaten werden im Admin mit `esc()` ausgegeben. Das ist wichtig, weil das Admin-Passwort im `sessionStorage` liegt.
- Globale Header in `netlify.toml`: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`.

## Admin

- Ein gemeinsames Passwort (`ADMIN_PASSWORD`) für alle Admin-Seiten. Kein Schutz gegen Durchprobieren, deshalb muss es lang und zufällig sein (mindestens 20 Zeichen, Passwortmanager).
