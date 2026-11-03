#!/usr/bin/env python3
"""app_symbole.py — App-Symbole der JV-Plattform (PWA) aus der JV-Bildmarke erzeugen.

Aufruf (im Repo-Ordner, braucht Pillow: pip install pillow):
    python werkzeuge/app_symbole.py            Symbole nach public/assets/app/ schreiben
    python werkzeuge/app_symbole.py --pruefen  nur prüfen, ob die Dateien zur Vorlage passen

Vorlage ist die JV-Bildmarke aller Seiten (public/dachcheck/assets/icon/favicon-512.png: «J» in Kupfer,
«V» in Grau auf weisser Kachel). Daraus entstehen:
  icon-512.png, icon-192.png, icon-96.png   Kachel mit runden Ecken (Computer, Verknüpfungen)
  icon-maskable-512.png, -192.png           weisses Quadrat bis zum Rand, Marke im sicheren Kreis
                                            (Android schneidet das Symbol rund oder als Squircle zu)
  apple-touch-icon.png                      180 px, deckend weiss (iOS füllt Transparenz schwarz)
Das Logo steht immer in Originalfarben auf Weiss (Robin, 21.10.2026), nie ganz weiss eingefärbt.
"""

import os
import sys

from PIL import Image, ImageChops

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VORLAGE = os.path.join(REPO, 'public', 'dachcheck', 'assets', 'icon', 'favicon-512.png')
ZIEL = os.path.join(REPO, 'public', 'assets', 'app')

WEISS = (255, 255, 255, 255)
SICHER = 0.38      # Marke liegt ganz im Kreis mit Radius 38 % (sichere Zone von Android: 40 %)
APPLE_BREITE = 0.79  # Breite der Marke im iOS-Symbol (wie das bisherige apple-touch-icon)


def vorlage():
    im = Image.open(VORLAGE).convert('RGBA')
    if im.size != (512, 512):
        raise SystemExit('Vorlage muss 512 × 512 px sein: ' + VORLAGE)
    return im


def marke(im):
    """Marke (Buchstaben) samt weissem Rand als deckendes Bild ausschneiden."""
    weiss = Image.new('RGBA', im.size, WEISS)
    flach = Image.alpha_composite(weiss, im).convert('RGB')
    unterschied = ImageChops.difference(flach, Image.new('RGB', im.size, (255, 255, 255)))
    maske = unterschied.convert('L').point(lambda v: 255 if v > 20 else 0)
    box = maske.getbbox()
    if not box:
        raise SystemExit('Keine Marke in der Vorlage gefunden')
    rand = 2
    box = (max(0, box[0] - rand), max(0, box[1] - rand), min(im.size[0], box[2] + rand), min(im.size[1], box[3] + rand))
    return flach.crop(box)


def auf_weiss(teil, groesse, breite):
    """Marke mit gegebener Breite mittig auf ein weisses Quadrat setzen (deckend, ohne Transparenz)."""
    b = max(1, round(breite))
    h = max(1, round(teil.size[1] * b / teil.size[0]))
    klein = teil.resize((b, h), Image.LANCZOS)
    bild = Image.new('RGB', (groesse, groesse), (255, 255, 255))
    bild.paste(klein, ((groesse - b) // 2, (groesse - h) // 2))
    return bild


def maskierbar(teil, groesse):
    w, h = teil.size
    # halbe Diagonale der Marke ≤ SICHER × Seitenlänge → ganze Marke im sicheren Kreis
    faktor = SICHER * groesse / (((w / 2) ** 2 + (h / 2) ** 2) ** 0.5)
    return auf_weiss(teil, groesse, w * faktor)


def symbole():
    im = vorlage()
    teil = marke(im)
    return {
        'icon-512.png': im,
        'icon-192.png': im.resize((192, 192), Image.LANCZOS),
        'icon-96.png': im.resize((96, 96), Image.LANCZOS),
        'icon-maskable-512.png': maskierbar(teil, 512),
        'icon-maskable-192.png': maskierbar(teil, 192),
        'apple-touch-icon.png': auf_weiss(teil, 180, 180 * APPLE_BREITE),
    }


def gleich(a, b):
    if a.size != b.size or a.mode != b.mode:
        return False
    return ImageChops.difference(a, b).getbbox() is None


def main():
    pruefen = '--pruefen' in sys.argv[1:]
    fehler = 0
    os.makedirs(ZIEL, exist_ok=True)
    for name, bild in symbole().items():
        pfad = os.path.join(ZIEL, name)
        if pruefen:
            if not os.path.exists(pfad):
                print('fehlt:', name)
                fehler += 1
                continue
            vorhanden = Image.open(pfad)
            vorhanden = vorhanden.convert(bild.mode)
            if not gleich(vorhanden, bild):
                print('veraltet:', name)
                fehler += 1
            continue
        bild.save(pfad, optimize=True)
        print(name, bild.size[0], 'px')
    if pruefen:
        print('App-Symbole aktuell' if not fehler else 'App-Symbole neu erzeugen: python werkzeuge/app_symbole.py')
        sys.exit(1 if fehler else 0)


if __name__ == '__main__':
    main()
