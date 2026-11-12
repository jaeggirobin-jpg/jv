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
  * Terminplaner: feste Google-Karte entfernt; die Karte der Projektadresse (geo.admin.ch) erscheint
    nur noch im PDF, schwarz-weiss mit farbigem Kreis um die Adresse; Adressvorschläge und
    Projektsuche statt Auswahlliste (plattform.js)

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


# Zurück zur Plattform (Robin, 2.11.2026: Tools öffnen im selben Tab). Robin, 12.11.2026: Knopf «Zurück»
# oben links direkt vor dem Logo, Klick aufs Logo = Übersicht der Plattform. Selektor des Logos je Tool;
# Tools ohne Logo im Kopf (Gäste-WC, Story) behalten die Lasche am linken Rand.
ZURUECK_LOGO = {
    'badvisualisierungen': '.top > img',
    'terminplaner': '.top .brand',
    'reel': 'header > .logo',
}


def zurueck_einbinden(text, ordner, name):
    i = text.rfind('</body>')
    if i < 0:
        raise Fehler(name + ': </body> fehlt')
    logo = ZURUECK_LOGO.get(ordner)
    attr = f' data-logo="{logo}"' if logo else ''
    return text[:i] + f'<script src="/assets/zurueck.js"{attr} defer></script>\n' + text[i:]


# Chat mit Claude (Robin, 4.11.2026): Knopf «Claude» unten rechts, Fragen und Änderungen am Inhalt
def ki_chat_einbinden(text, werkzeug, name):
    i = text.rfind('</body>')
    if i < 0:
        raise Fehler(name + ': </body> fehlt')
    return text[:i] + f'<script src="/assets/ki-chat.js" data-werkzeug="{werkzeug}" defer></script>\n' + text[i:]


# ── 1. Bau-Terminplaner ──────────────────────────────────────────────────
def kontaktliste_hintergrund(t):
    n = 'Terminplaner'
    # PDF Kontaktliste (Unternehmer & Handwerker): Kopf, Tabellenkopf und Zeilen mit halbtransparentem
    # Hintergrund wie im Terminplan, damit die Schrift über der Karte lesbar bleibt (Robin, 11.11.2026)
    t = ersetzen(t, "pdfBg(doc,true,p);const PW=297,M=12;\n try{doc.addImage(LOGO,'PNG',M,M,40,10.45);}catch(e){}",
                 "pdfBg(doc,true,p);const PW=297,M=12;const halb=(a,f)=>{doc.setGState(new doc.GState({opacity:a}));f();doc.setGState(new doc.GState({opacity:1}));};\n"
                 " doc.setFillColor(255,255,255);halb(.88,()=>doc.roundedRect(M,M-3.5,PW-2*M,20,3,3,'F'));doc.setFillColor(175,118,49);doc.roundedRect(M,M-3.5,2.2,20,1.1,1.1,'F');\n"
                 " try{doc.addImage(LOGO,'PNG',M+5,M,40,10.45);}catch(e){}", n)
    t = ersetzen(t, "doc.text('Kontaktliste '+(p.name||''),M+48,M+6);", "doc.text('Kontaktliste '+(p.name||''),M+53,M+6);", n)
    t = ersetzen(t, ".filter(Boolean).join('   ·   '),M+48,M+11.5);\n const C=[['Firma / Rolle',58]",
                 ".filter(Boolean).join('   ·   '),M+53,M+11.5);\n const C=[['Firma / Rolle',58]", n)
    t = ersetzen(t, " let y=M+20;\n const head=()=>{doc.setFillColor(...RGB.ph);doc.rect(M,y,PW-2*M,7,'F');",
                 " let y=M+20,top=y,zi=0;const rahmen=()=>{doc.setDrawColor(...RGB.line);doc.setLineWidth(.3);doc.roundedRect(M,top,PW-2*M,y-top,2,2,'S');doc.setLineWidth(.2);};\n"
                 " const head=()=>{top=y;zi=0;doc.setFillColor(...RGB.ph);halb(.95,()=>{doc.roundedRect(M,y,PW-2*M,7,2,2,'F');doc.rect(M,y+2,PW-2*M,5,'F');});", n)
    t = ersetzen(t, "  if(y+h>210-M){doc.addPage();y=M;head();}\n  let x=M+1.5;cells.forEach",
                 "  if(y+h>210-M){rahmen();doc.addPage();y=M;head();}\n"
                 "  doc.setFillColor(...(zi++%2?[246,247,248]:[255,255,255]));halb(.86,()=>doc.rect(M,y,PW-2*M,h,'F'));\n"
                 "  let x=M+1.5;cells.forEach", n)
    t = ersetzen(t, "  y+=h;doc.setDrawColor(...RGB.line);doc.line(M,y,PW-M,y);\n }\n return doc;",
                 "  y+=h;doc.setDrawColor(...RGB.line);doc.line(M,y,PW-M,y);\n }\n rahmen();\n return doc;", n)
    return t


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
    # PDF Terminplan: Ende der Tabelle je Seite und Lage der Legende merken, plattform.js setzt den
    # Punkt der Karte in die Mitte dazwischen (Robin, 2.11.2026)
    t = ersetzen(t, 'const frame=y1=>{doc.setDrawColor(...C.line);',
                 'const frame=y1=>{(doc.jvUnten=doc.jvUnten||{})[doc.internal.getCurrentPageInfo().pageNumber]=y1;doc.setDrawColor(...C.line);', n)
    t = ersetzen(t, 'const fy=PH-M-6;doc.setFillColor(...C.soft);',
                 'const fy=PH-M-6;doc.jvLegende={x:M,y:fy-1.5,w:W};doc.setFillColor(...C.soft);', n)

    t = kontaktliste_hintergrund(t)

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

    # Projekte: Suche statt Auswahlliste im Kopf (Robin, 2.11.2026); die Suche baut plattform.js
    t = regex_ersetzen(t, r'<select class="inp" id="projsel" data-chg="pickProject"[^\n]*?</select>\n ', '', n)
    t = ersetzen(t, '<button class="btn" data-act="projects" title="Projekte verwalten">',
                 '<button class="btn" data-act="projects" title="Projekt suchen und öffnen" aria-haspopup="dialog">', n)

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
    # Bridge für Anmeldung und KI-Freigabe des Chats
    return ki_chat_einbinden(kopf(t, ROBOTS + bridge('story'), 'Story'), 'story', 'Story')


# ── 5. Reel-Generator (nutzt nur «downloads») ────────────────────────────
# Freie Gestaltung des Reels über den Claude-Chat (Robin, 4.11.2026: «freie Anpassungen via Chat»).
# Das Tool zeichnet alles in einer geschlossenen Funktion; diese Stellen machen Farben und Logo einstellbar
# und zeichnen zusätzliche Ebenen (Text, Formen, Logo). Ohne Gestaltung sieht das Reel aus wie bei Michi.
# Gesteuert wird über window.JVReelGestaltung.setzen({ farben, logo, ebenen }) aus public/assets/ki-chat.js.
REEL_GESTALTUNG = r"""
// ── JV: freie Gestaltung über den Claude-Chat (eingefügt von werkzeuge/tools_einbinden.py) ──
const JVG_STD = { gold: GOLD, weiss: WHITE, dunkel: DARK };
let JVG = { farben: {}, logo: {}, ebenen: [] };
let jvgFrei = null, jvgFreiLaedt = false;   // Logo ohne weissen Hintergrund (/logo.png), erst bei Bedarf geladen
function jvgLogo(o) {
  if (!o.freigestellt) return logoImg;
  if (!jvgFrei && !jvgFreiLaedt) { jvgFreiLaedt = true; loadImg('/logo.png').then((i) => { jvgFrei = i; try { refresh(false); } catch (e) {} }).catch(() => {}); }
  return jvgFrei || logoImg;
}
function jvgZeit(o, t) { return t == null || (t >= (o.von || 0) && (o.bis == null || t < o.bis)); }
function jvgBlende(o, t) {
  if (t == null) return 1; let a = 1;
  if (o.einblenden > 0) a = Math.min(a, clamp((t - (o.von || 0)) / o.einblenden));
  if (o.ausblenden > 0 && o.bis != null) a = Math.min(a, clamp((o.bis - t) / o.ausblenden));
  return a;
}
function jvgEbenen(c, t) {
  for (const e of JVG.ebenen) {
    if (!jvgZeit(e, t)) continue;
    const a = (e.deckkraft != null ? e.deckkraft : 1) * jvgBlende(e, t); if (a <= 0) continue;
    c.save(); c.globalAlpha = a;
    const x = e.x != null ? e.x : W / 2, y = e.y != null ? e.y : H / 2;
    if (e.drehung) { c.translate(x, y); c.rotate(e.drehung * Math.PI / 180); c.translate(-x, -y); }
    const zeichnen = (fn) => (e.schatten ? shadowed(c, fn, 18, 0.6) : fn());
    if (e.typ === 'text') {
      const schreib = e.schrift === 'schreib', gr = e.groesse || 80;
      c.font = `${schreib ? 400 : (e.gewicht || 700)} ${gr}px ${schreib ? SCRIPT : COND}`;
      c.fillStyle = e.farbe || WHITE; c.textAlign = { links: 'left', rechts: 'right' }[e.ausrichtung] || 'center'; c.textBaseline = 'middle';
      const z = String(e.text || '').split('\n'), zh = gr * 1.15, y0 = y - (z.length - 1) * zh / 2;
      zeichnen(() => z.forEach((l, i) => c.fillText(l, x, y0 + i * zh)));
    } else if (e.typ === 'rechteck') {
      const b = e.b || 400, h = e.h || 200; c.fillStyle = e.farbe || WHITE;
      zeichnen(() => { rr(c, x - b / 2, y - h / 2, b, h, Math.min(e.radius || 0, b / 2, h / 2)); c.fill(); });
    } else if (e.typ === 'kreis') {
      c.fillStyle = e.farbe || GOLD; zeichnen(() => { c.beginPath(); c.arc(x, y, e.r || 100, 0, Math.PI * 2); c.fill(); });
    } else if (e.typ === 'linie') {
      c.strokeStyle = e.farbe || GOLD; c.lineWidth = e.dicke || 10; c.lineCap = 'round';
      zeichnen(() => { c.beginPath(); c.moveTo(x, y); c.lineTo(e.x2 != null ? e.x2 : x + 300, e.y2 != null ? e.y2 : y); c.stroke(); });
    } else if (e.typ === 'logo' && logoImg) {
      const bild = jvgLogo(e), lw = e.breite || 400, lh = bild.naturalHeight * lw / bild.naturalWidth;
      zeichnen(() => c.drawImage(bild, x - lw / 2, y - lh / 2, lw, lh));
    }
    c.restore();
  }
}
window.JVReelGestaltung = {
  setzen(g) {
    g = g && typeof g === 'object' ? g : {};
    JVG = { farben: g.farben || {}, logo: g.logo || {}, ebenen: Array.isArray(g.ebenen) ? g.ebenen : [] };
    GOLD = JVG.farben.gold || JVG_STD.gold; WHITE = JVG.farben.weiss || JVG_STD.weiss; DARK = JVG.farben.dunkel || JVG_STD.dunkel;
    try { refresh(false); } catch (e) { /* Tool startet noch */ }
  },
  stand() { return JSON.parse(JSON.stringify(JVG)); },
  standard() { return Object.assign({}, JVG_STD); },
  masse: { breite: W, hoehe: H },
};
"""

REEL_LOGO = r"""function logoCard(c, t) {
  const L = JVG.logo;
  if (!logoImg || L.sichtbar === false || !jvgZeit(L, t)) return;
  const bild = jvgLogo(L), lw = L.breite || 600, f = lw / 600, lh = bild.naturalHeight * lw / bild.naturalWidth;
  const karte = L.karte !== false, px = karte ? 35 * f : 0, py = karte ? 28 * f : 0, cw = lw + 2 * px, ch = lh + 2 * py;
  const x = L.x != null ? L.x - cw / 2 : (W - cw) / 2, y = L.y != null ? L.y - ch / 2 : 120;
  c.save(); c.globalAlpha = (L.deckkraft != null ? L.deckkraft : 1) * jvgBlende(L, t);
  if (karte) shadowed(c, () => { c.fillStyle = L.kartenfarbe || WHITE; rr(c, x, y, cw, ch, L.radius != null ? L.radius : 26 * f); c.fill(); }, L.schatten === false ? 0 : 30, L.schatten === false ? 0 : 0.35);
  if (!karte && L.schatten) shadowed(c, () => c.drawImage(bild, x, y, lw, lh), 24, 0.5);
  else c.drawImage(bild, x + px, y + py, lw, lh);
  c.restore();
}
"""


def reel_gestaltung(t):
    t = regex_ersetzen(t, r"const GOLD = ('[^']*'), WHITE = ('[^']*'), DARK = ('[^']*');",
                       lambda m: f'let GOLD = {m.group(1)}, WHITE = {m.group(2)}, DARK = {m.group(3)};', 'Reel Farben')
    t = regex_ersetzen(t, r"function logoCard\(c\) \{\n.*?\n\}\n", lambda m: REEL_LOGO, 'Reel Logo', flags=re.S)
    t = ersetzen(t, '  logoCard(ctx);\n}\nfunction buildEndBg', '  logoCard(ctx, t);\n  jvgEbenen(ctx, t);\n}\nfunction buildEndBg', 'Reel Ebenen')
    # Gestaltung direkt nach der Zeile mit dem Logo-Bild (dort sind clamp, rr, shadowed und das Canvas bekannt)
    return ersetzen(t, "let logoImg = null, photos = [], endBg = null, isExample = true;\n",
                    "let logoImg = null, photos = [], endBg = null, isExample = true;\n" + REEL_GESTALTUNG.lstrip('\n'), 'Reel Gestaltung')


def reel(t):
    return ki_chat_einbinden(kopf(reel_gestaltung(t), ROBOTS + bridge('reel'), 'Reel'), 'reel', 'Reel')


# (Datei, Ordner, Anpassung, erwartete Änderung der Anzahl <script>-Tags)
# Schutz: Fällt beim Anpassen ein Skript des Tools weg (z. B. die Importmap), bricht das Skript ab.
TOOLS = [
    ('1_Bau-Terminplaner_JV.html', 'terminplaner', terminplaner, +5),           # Bridge, geo-admin, plattform.js, Feedback, Zurück
    ('2_JV_Badvisualisierungen.html', 'badvisualisierungen', badvisualisierungen, +4),   # Bridge, daten.js, Feedback, Zurück
    ('3_Gaeste-WC_Umbauvorschau.html', 'gaeste-wc', gaeste_wc, +2),             # Bridge, Feedback, Zurück, 3D-Scan entfernt
    ('4_JV_Story_Badumbau.html', 'story', story, +4),                           # Bridge, Claude-Chat, Feedback, Zurück
    ('5_JV_Reel-Generator.html', 'reel', reel, +4),                             # Bridge, Claude-Chat, Feedback, Zurück
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
        ergebnis = zurueck_einbinden(ergebnis, ordner, datei)
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
