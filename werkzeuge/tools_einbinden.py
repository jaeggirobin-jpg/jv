#!/usr/bin/env python3
"""tools_einbinden.py — Michis Claude-Tools in die JV-Plattform übernehmen (public/tools/).

Aufruf (im Repo-Ordner):
    python werkzeuge/tools_einbinden.py JV_Tools.zip

Die Tools werden NICHT umgebaut, nur minimal angepasst:
  * Speicher: jv-bridge.js stellt window.claude.use(...) bereit (Supabase statt claude.ai)
  * Keine Kunden- oder Personendaten im Repo (das Repo ist öffentlich!):
      - Terminplaner: Beispielprojekte, Firmen mit Kontaktpersonen und Projektleiter entfernt
        (kommen über «Daten übernehmen» in der Plattform in die Datenbank)
      - Badvisualisierungen: Objekte und Bilder entfernt (kommen aus der Datenbank)
      - Gäste-WC: eingebetteter 3D-Scan entfernt (liegt im privaten Bucket)
  * Terminplaner: feste Google-Karte entfernt, Karte der Projektadresse von geo.admin.ch,
    Adressvorschläge (plattform.js)

Neue Version eines Tools aus Claude? Datei(en) als ZIP oder einzeln angeben und das Skript erneut
ausführen. Bricht ab, wenn eine Stelle nicht mehr passt (dann Muster unten anpassen) oder wenn im
Ergebnis noch Personendaten stehen.
"""

import json
import os
import re
import sys
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIEL = os.path.join(REPO, 'public', 'tools')

# Firmendaten von Jäggi Vollmer (öffentlich, dürfen bleiben)
ERLAUBT = {
    'info@jaeggivollmer.ch', '0616920311', '+41616920311', '0799360311', '+41799360311',
}


class Fehler(Exception):
    pass


def ersetzen(text, alt, neu, name, anzahl=1):
    n = text.count(alt)
    if n != anzahl:
        raise Fehler(f'{name}: Stelle {anzahl}x erwartet, {n}x gefunden: {alt[:80]!r}')
    return text.replace(alt, neu)


def regex_ersetzen(text, muster, neu, name, anzahl=1, flags=0):
    neu_text, n = re.subn(muster, neu, text, flags=flags)
    if n != anzahl:
        raise Fehler(f'{name}: Muster {anzahl}x erwartet, {n}x gefunden: {muster[:80]!r}')
    return neu_text


def kopf(text, zusatz, name):
    """Zusätzliche Tags direkt nach dem ersten <head> einfügen."""
    m = re.search(r'<head[^>]*>', text)
    if not m:
        raise Fehler(f'{name}: <head> fehlt')
    return text[:m.end()] + zusatz + text[m.end():]


ROBOTS = '<meta name="robots" content="noindex, nofollow">'


def bridge(tool):
    return f'<script src="/tools/assets/jv-bridge.js" data-tool="{tool}"></script>'


# Feedback (wie in GEMA Beta): schwebender Knopf unten links, Ausschnitt markieren und senden.
# Name des Tools für das Feedback-Board
FEEDBACK_NAMEN = {
    'terminplaner': 'Bau-Terminplaner', 'badvisualisierungen': 'Badvisualisierungen', 'gaeste-wc': 'Gäste-WC Umbauvorschau',
    'story': 'Story Badumbau', 'reel': 'Reel-Generator',
}


def feedback_einbinden(text, ordner, name):
    i = text.rfind('</body>')
    if i < 0:
        raise Fehler(name + ': </body> fehlt')
    tag = (f'<script src="/assets/feedback.js" data-seite="tool-{ordner}" '
           f'data-name="{FEEDBACK_NAMEN[ordner]}" data-knopf="schwebend" defer></script>\n')
    return text[:i] + tag + text[i:]


# ── 1. Bau-Terminplaner ──────────────────────────────────────────────────
def terminplaner(t):
    n = 'Terminplaner'
    t = kopf(t, ROBOTS + bridge('terminplaner') + '<script src="/tools/assets/geo-admin.js"></script>', n)

    # Feste Google-Karte (Basel, Horburgstrasse) als Seitenhintergrund entfernen
    t = regex_ersetzen(t, r'/\* ===== Basel map as page background ===== \*/\n', '', n)
    t = regex_ersetzen(t, r'body::after\{content:"";position:fixed;inset:0;z-index:-2;background:url\("data:image/jpeg;base64,[A-Za-z0-9+/=]+"\)[^}]*\}\n', '', n)
    t = regex_ersetzen(t, r'\.jvpin\{[^}]*\}\n\.jvpin svg\{[^}]*\}\n\.jvpin \.lbl\{[^}]*\}\n\.jvpin \.lbl img\{[^}]*\}\.jvpin \.lbl small\{[^}]*\}\n', '', n)
    t = regex_ersetzen(t, r'\.mapattr\{[^}]*\}\n', '', n)
    t = regex_ersetzen(t, r'@media \(max-width:700px\)\{\.jvpin\{left:78%\}\.jvpin \.lbl img\{height:15px\}\}\n', '', n)
    t = ersetzen(t, 'body::after{opacity:.85}\n', '', n)
    t = regex_ersetzen(t, r'<div class="jvpin" aria-hidden="true">.*?</div></div><div class="mapattr">Kartendaten © Google</div>\n?', '', n, flags=re.S)
    t = ersetzen(t, 'document.addEventListener("DOMContentLoaded",()=>{const e=document.getElementById("jvpinlogo");if(e)e.src=LOGO;});', '', n)
    t = regex_ersetzen(t, r'const MAP_BG_L="data:image/jpeg;base64,[A-Za-z0-9+/=]+";\n', '', n)
    t = regex_ersetzen(t, r'const MAP_BG_P="data:image/jpeg;base64,[A-Za-z0-9+/=]+";\n', '', n)
    # PDF: ohne Karte der Projektadresse kein Hintergrund mehr (statt Google-Karte mit JV-Pin)
    t = regex_ersetzen(t, r"\n const mark=\(\)=>\{const x=pw\*\.85,y=ph\*\.85.*?doc\.addPage=\(\.\.\.a\)=>\{ap\(\.\.\.a\);paint\(\);return doc;\};\}",
                       "\n /* ohne Kartenausschnitt der Projektadresse: kein Hintergrund (JV-Plattform) */}", n, flags=re.S)
    # Karte von geo.admin.ch: mit CORS laden, damit sie fürs PDF zugeschnitten werden kann
    t = ersetzen(t, 'MAPC[key]={busy:1};const im=new Image();', "MAPC[key]={busy:1};const im=new Image();im.crossOrigin='anonymous';", n)
    t = ersetzen(t, "ch:'Karte \\u00a9 swisstopo'};", "ch:'Karte \\u00a9 swisstopo',av:'Grundkarte \\u00a9 Amtliche Vermessung der Kantone, geo.admin.ch'};", n)
    t = ersetzen(t, 'Für diese Adresse ist noch kein Kartenausschnitt hinterlegt – im Chat mit Claude anfordern',
                 'Für diese Adresse wurde noch keine Karte gefunden – Adresse mit Strasse, Hausnummer und PLZ eintragen (Vorschläge von geo.admin.ch)', n)

    # Keine Personendaten im öffentlichen Repo: kommen aus der Datenbank
    t = regex_ersetzen(t, r'const BASE_FIRMS=\[.*?\];\n', 'const BASE_FIRMS=[];\n', n)
    t = regex_ersetzen(t, r'const BASE_SENDER=\{.*?\};\n',
                       'const BASE_SENDER={"name": "", "company": "Jäggi Vollmer GmbH", "street": "Horburgstrasse 96", "city": "4057 Basel", '
                       '"phone": "061 692 03 11", "mobile": "", "email": "info@jaeggivollmer.ch", "web": "www.jaeggivollmer.ch", '
                       '"slogan": "Spenglerei | Sanitär | Planung"};\n', n)
    t = regex_ersetzen(t, r'const BASE_LEADERS=\[.*?\];\n', 'const BASE_LEADERS=[];\n', n)
    t = regex_ersetzen(t, r'const BASE_PROJECTS=\{.*?\};\n', 'const BASE_PROJECTS={};\n', n)

    # Hinweise für den Notfall (Speicher nicht erreichbar) auf die Plattform statt claude.ai
    t = ersetzen(t, 'Öffne das Tool am besten über die Claude-App oder claude.ai (angemeldet).',
                 'Öffne das Tool über die JV-Plattform (angemeldet) und lade die Seite neu.', n)
    t = ersetzen(t, "toast('In dieser Ansicht gibt es keinen Online-Speicher – bitte das Tool in der Claude-App oder auf claude.ai öffnen')",
                 "toast('In dieser Ansicht gibt es keinen Online-Speicher – bitte das Tool über die JV-Plattform öffnen')", n)
    t = ersetzen(t, "toast('Online-Speicher ist in dieser Ansicht nicht verfügbar – bitte in der Claude-App oder auf claude.ai öffnen')",
                 "toast('Online-Speicher ist nicht erreichbar – bitte die Seite neu laden')", n)

    # Ergänzungen der Plattform nach dem Skript des Tools (vor dem letzten </body>)
    i = t.rfind('</body>')
    if i < 0:
        raise Fehler(n + ': </body> fehlt')
    t = t[:i] + '<script src="/tools/terminplaner/plattform.js"></script>\n' + t[i:]
    return t


# ── 2. Badvisualisierungen ───────────────────────────────────────────────
def badvisualisierungen(t):
    n = 'Badvisualisierungen'
    t = kopf(t, ROBOTS + bridge('badvis') + '<script src="/tools/badvisualisierungen/daten.js"></script>', n)
    t = regex_ersetzen(t, r'const OBJ=\[.*?\];const TITLE=("[^"]*");const IMG=\{.*?\};const SRC=',
                       r'let OBJ=[];const TITLE=\1;let IMG={};const SRC=', n, flags=re.S)
    t = ersetzen(t, "window.addEventListener('hashchange',route);route();",
                 "window.addEventListener('hashchange',route);"
                 "JVBadvis.laden(function(d){OBJ=d.objekte;IMG=d.bilder;route();JVBadvis.hinweis(OBJ);});", n)
    return t


# ── 3. Gäste-WC Umbauvorschau ────────────────────────────────────────────
def gaeste_wc(t):
    n = 'Gäste-WC'
    t = kopf(t, ROBOTS + bridge('gaeste-wc'), n)
    # Eingebetteten 3D-Scan entfernen: liegt im privaten Bucket, Abruf über /tools/gaeste-wc/scan.json
    # Nur bis zum ersten </script>: der Scan endet mit «};», ein Muster bis «}</script>» frässe sonst die
    # Importmap (three.js) dahinter mit weg
    t = regex_ersetzen(t, r'<script>window\.__SCAN=.*?</script>\n?', '', n, flags=re.S)
    t = ersetzen(t, "const url=p.builtin?'scan.json':'/_blob/'+p.scan;", "const url=p.builtin?'/tools/gaeste-wc/scan.json':'/_blob/'+p.scan;", n)
    return t


# ── 4. Story Badumbau (keine Daten, keine Speicherfunktionen) ────────────
def story(t):
    return kopf(t, ROBOTS, 'Story')


# ── 5. Reel-Generator (nutzt nur «downloads») ────────────────────────────
def reel(t):
    return kopf(t, ROBOTS + bridge('reel'), 'Reel')


# (Datei, Ordner, Anpassung, erwartete Änderung der Anzahl <script>-Tags)
# Schutz: Fällt beim Anpassen ein Skript des Tools weg (z. B. die Importmap), bricht das Skript ab.
TOOLS = [
    ('1_Bau-Terminplaner_JV.html', 'terminplaner', terminplaner, +4),           # Bridge, geo-admin, plattform.js, Feedback
    ('2_JV_Badvisualisierungen.html', 'badvisualisierungen', badvisualisierungen, +3),   # Bridge, daten.js, Feedback
    ('3_Gaeste-WC_Umbauvorschau.html', 'gaeste-wc', gaeste_wc, +1),             # Bridge, Feedback, 3D-Scan entfernt
    ('4_JV_Story_Badumbau.html', 'story', story, +1),                           # Feedback
    ('5_JV_Reel-Generator.html', 'reel', reel, +2),                             # Bridge, Feedback
]


def verbotene_texte(dateien):
    """Personendaten aus den Daten der Tools sammeln, die im Ergebnis nicht vorkommen dürfen."""
    verboten = set()
    roh = dateien.get('1_Bau-Terminplaner_JV_Daten.json')
    if roh:
        d = json.loads(roh)
        for p in (d.get('projects') or {}).values():
            for k in ('client', 'phone'):
                if len(str(p.get(k) or '')) >= 5:
                    verboten.add(str(p[k]))
        for f in (d.get('firms') or {}).values():
            for k in ('contact', 'email', 'mobile'):
                if len(str(f.get(k) or '')) >= 5:
                    verboten.add(str(f[k]))
        cfg = d.get('cfg') or {}
        for l in cfg.get('leaders') or []:
            for k in ('email', 'mobile'):
                if len(str(l.get(k) or '')) >= 5:
                    verboten.add(str(l[k]))
    bad = dateien.get('2_JV_Badvisualisierungen.html')
    if bad:
        m = re.search(r'const OBJ=(\[.*?\]);const TITLE=', bad, re.S)
        if m:
            for o in json.loads(m.group(1)):
                if len(str(o.get('kunde') or '')) >= 5 and not str(o.get('kunde')).startswith('Objekt'):
                    verboten.add(str(o['kunde']))
    return {v for v in verboten if re.sub(r'\s', '', v) not in ERLAUBT and v not in ERLAUBT}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    dateien = {}
    for quelle in sys.argv[1:]:
        if quelle.lower().endswith('.zip'):
            with zipfile.ZipFile(quelle) as z:
                for name in z.namelist():
                    dateien[os.path.basename(name)] = z.read(name).decode('utf-8')
        else:
            with open(quelle, encoding='utf-8') as f:
                dateien[os.path.basename(quelle)] = f.read()

    verboten = verbotene_texte(dateien)
    fertig = 0
    for datei, ordner, fn, differenz in TOOLS:
        if datei not in dateien:
            continue
        ergebnis = fn(dateien[datei])
        ergebnis = feedback_einbinden(ergebnis, ordner, datei)
        vorher, nachher = dateien[datei].count('<script'), ergebnis.count('<script')
        if nachher - vorher != differenz:
            raise Fehler(f'{datei}: {vorher} Skripte vorher, {nachher} nachher (erwartet {differenz:+d}); '
                         'beim Anpassen ist ein Skript verloren gegangen oder dazugekommen')
        for v in verboten:
            if v in ergebnis:
                raise Fehler(f'{datei}: Personendaten im Ergebnis gefunden: {v!r}')
        for muster in (r'0\d{2} \d{3} \d{2} \d{2}', r'[\w.+-]+@[\w-]+\.[\w.]+'):
            for treffer in set(re.findall(muster, ergebnis)):
                if re.sub(r'\s', '', treffer) not in ERLAUBT and treffer not in ERLAUBT and not treffer.endswith(('.png', '.jpg', '.js')):
                    print(f'  Hinweis {datei}: {treffer!r} prüfen')
        ziel = os.path.join(ZIEL, ordner)
        os.makedirs(ziel, exist_ok=True)
        with open(os.path.join(ziel, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(ergebnis)
        print(f'{datei} → public/tools/{ordner}/index.html ({len(ergebnis) // 1024} KB)')
        fertig += 1
    if not fertig:
        raise Fehler('Keine bekannten Tool-Dateien gefunden')


if __name__ == '__main__':
    try:
        main()
    except Fehler as e:
        print('FEHLER:', e)
        sys.exit(2)
