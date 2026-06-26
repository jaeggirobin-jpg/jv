-- ============================================================================
-- inspiration_006_katalog_komplett.sql
-- Ersetzt die bisherigen 4 Kategorien und 14 Punkte durch den vollständigen
-- Katalog mit 11 Kategorien und 37 Punkten.
-- ============================================================================

-- Alte Kategorien-Metadaten löschen und neue einfügen
DELETE FROM inspiration_kategorien;

INSERT INTO inspiration_kategorien (id, titel, intro, reihenfolge) VALUES
  ('dusche',             'Dusche',                           'Vom funktionalen Element zum Rückzugsort.', 1),
  ('duscharmatur',       'Duscharmatur',                     'Hier entscheidet sich, wie das Duschen sich anfühlt.', 2),
  ('badewanne',          'Badewanne',                        'Manche Kunden duschen nur, andere brauchen die Wanne.', 3),
  ('badarmatur',         'Badarmatur',                       'Wie das Wasser in die Wanne kommt — gerade bei freistehenden Wannen ein Designthema.', 4),
  ('accessoires',        'Accessoires Dusche und Badewanne', 'Die kleinen Dinge, die im Alltag zählen — Shampoo, Seife, Schwamm wollen einen Platz.', 5),
  ('waschtisch',         'Waschtisch',                       'Wahrscheinlich das prägendste Möbelstück im Bad.', 6),
  ('waschtischarmatur',  'Waschtischarmatur',                'Wie das Wasser zum Waschtisch kommt — drei sehr unterschiedliche Konzepte.', 7),
  ('spiegel',            'Spiegel',                          'Mehr als nur eine Spiegelfläche — heute meist auch Stauraum oder Lichtquelle.', 8),
  ('moebel',             'Möbel',                            'Stauraum macht den Unterschied zwischen «Designbad» und «Designbad, in dem man auch lebt».', 9),
  ('wc',                 'WC',                               'Die Toilette ist das meistgenutzte Element im Bad. Was sie kann, hat sich deutlich verändert.', 10),
  ('betaetigungsplatte', 'Betätigungsplatte für WC',         'Das kleine Detail, das man jeden Tag sieht und drückt — oft unterschätzt.', 11);

-- Alte Punkte löschen (CASCADE löscht kunden_interessen-Referenzen)
DELETE FROM inspiration_punkte;

-- Alle 37 Punkte einfügen
INSERT INTO inspiration_punkte (kategorie, reihenfolge, titel, kurzbeschreibung, vorteil, zu_bedenken) VALUES

  -- 1. Dusche (4 Punkte)
  ('dusche', 1,
   'Bodenebene Dusche (Walk-in)',
   'Kein Einstieg, der Boden geht fliessend in die Dusche über.',
   'Optisch grosszügig, barrierefrei, alltagstauglich.',
   'Der Boden braucht ein präzises Gefälle und eine sehr sorgfältige Abdichtung.'),

  ('dusche', 2,
   'Extraflache Duschwanne',
   'Eine niedrige Wanne (2–3 cm), die fast bodengleich wirkt.',
   'Einfacher Einbau ohne komplexe Bodenabdichtung, ideal bei Sanierungen mit wenig Aufbauhöhe.',
   'Sichtbarer Rand bleibt, leichte Stolperkante.'),

  ('dusche', 3,
   'Glas-Festelement',
   'Statt einer Tür ein fixiertes Glaspaneel als Spritzschutz.',
   'Offene, klare Optik, sehr einfach zu reinigen, keine Mechanik.',
   'Etwas mehr Spritzwasser ausserhalb der Dusche — Aufstellung will geplant sein.'),

  ('dusche', 4,
   'Glasschiebe- oder Pendeltüre',
   'Klassische geschlossene Lösung mit Tür oder Schiebetür.',
   'Kein Spritzwasser, mehr Wärme beim Duschen, klassische Optik.',
   'Mechanik und Dichtungen halten nicht ewig, regelmässige Pflege nötig.'),

  -- 2. Duscharmatur (3 Punkte)
  ('duscharmatur', 1,
   'Aufputz-Mischer',
   'Der Mischer ist sichtbar an der Wand montiert, mit kombinierter Kopf- und Handbrause.',
   'Einfache Montage, unkomplizierte Wartung und schneller Austausch.',
   'Sichtbare Technik — Geschmackssache.'),

  ('duscharmatur', 2,
   'Unterputz-Mischer',
   'Die Technik verschwindet in der Wand, sichtbar bleibt nur das Bedienteil.',
   'Sehr aufgeräumte Optik, mehr Bewegungsfreiheit, einfacheres Putzen.',
   'Bei Reparaturen muss die Wand geöffnet werden — gute Markenware mit Service-Box minimiert dieses Risiko.'),

  ('duscharmatur', 3,
   'Thermostatmischer',
   'Die Wassertemperatur bleibt konstant, auch wenn anderswo Wasser fliesst.',
   'Kein Kalt-Warm-Schock, sicher für Kinder und ältere Menschen.',
   'Höhere Anschaffung, etwas grössere Bauform.'),

  -- 3. Badewanne (4 Punkte)
  ('badewanne', 1,
   'Eingebaute Wanne',
   'Wanne in eine gemauerte oder verkleidete Vorwand integriert.',
   'Bewährte Lösung, platzsparend, in vielen Grössen verfügbar.',
   'Die Optik hängt stark vom Verkleidungsmaterial ab (Fliese, Holz, Stein).'),

  ('badewanne', 2,
   'Freistehende Wanne',
   'Wanne mittig oder seitlich im Raum, ringsum sichtbar.',
   'Skulpturaler Mittelpunkt, sehr hochwertige Anmutung.',
   'Braucht Platz und einen präzise geplanten Wasseranschluss.'),

  ('badewanne', 3,
   'Hydromassage-Wanne (Whirlpool)',
   'Wanne mit Düsen für Wassermassage, oft kombinierbar mit Beleuchtung und Aromatherapie.',
   'Wellness im eigenen Bad, gezielte Entspannung.',
   'Höhere Anschaffung und Betriebskosten, regelmässige Wartung der Düsen.'),

  ('badewanne', 4,
   'Duo-Wanne',
   'Wanne breiter und länger gestaltet, Armaturen mittig oder am Kopfende.',
   'Bequem zu zweit, sehr grosszügige Anmutung.',
   'Hoher Platzbedarf und höherer Wasserverbrauch.'),

  -- 4. Badarmatur (3 Punkte)
  ('badarmatur', 1,
   'Wannenrandarmatur',
   'Hahn und Auslauf werden direkt auf den Wannenrand montiert.',
   'Kompakte Lösung, kein separater Wandanschluss nötig.',
   'Die Bohrungen in der Wanne sind fix — spätere Änderungen kaum möglich.'),

  ('badarmatur', 2,
   'Freistehende Standarmatur',
   'Schlanke Säule, vom Boden hochgeführt, neben der freistehenden Wanne.',
   'Skulpturaler Auftritt, perfekte Ergänzung zur freistehenden Wanne.',
   'Bodenanschluss muss präzise vorbereitet werden, später nicht mehr verschiebbar.'),

  ('badarmatur', 3,
   'Wandarmatur mit Schwallauslauf',
   'Auslauf und Bedienteil sind in der Wand verbaut, das Wasser fällt als breiter Strahl in die Wanne.',
   'Schöne Wasseroptik beim Einlassen, aufgeräumter Wannenrand.',
   'Bauseitige Vorbereitung in der Wand erforderlich, früh planen.'),

  -- 5. Accessoires (3 Punkte)
  ('accessoires', 1,
   'Wandnische (gefliest)',
   'Eine im Mauerwerk vorgesehene Aussparung, mit der Wand zusammen gefliest.',
   'Sehr aufgeräumt, kein zusätzliches Element im Raum, Grösse und Lage frei wählbar.',
   'Muss in der Rohbauphase festgelegt werden — spätere Änderungen praktisch unmöglich.'),

  ('accessoires', 2,
   'Aufgesetzte Ablage (Glas, Stein, Edelstahl)',
   'Wird nach Fertigstellung auf die Wand montiert.',
   'Auch nachträglich möglich, freie Materialwahl, einfacher Austausch.',
   'Sichtbares Element auf der Wand, Reinigung der Unterkante.'),

  ('accessoires', 3,
   'Drahtkorb oder hängender Halter',
   'An die Brausestange eingehängt oder eingehakt, ohne Bohren.',
   'Flexibel, umstellbar, kein Eingriff in die Bausubstanz.',
   'Optisch weniger reduziert, mehr Kalkpflege nötig.'),

  -- 6. Waschtisch (4 Punkte)
  ('waschtisch', 1,
   'Aufsatzbecken',
   'Das Becken steht als eigenes Objekt auf einer Konsole oder einem Möbel.',
   'Skulpturaler Charakter, viele Materialien (Keramik, Naturstein, Mineralguss).',
   'Gesamthöhe (Möbel plus Becken) muss zur Körpergrösse passen — sonst spritzt es.'),

  ('waschtisch', 2,
   'Einbau- oder Unterbauwaschtisch',
   'Becken und Platte aus einem Stück oder bündig ineinander integriert.',
   'Sehr aufgeräumt, fugenlos, einfach zu reinigen.',
   'Reparaturen aufwändiger als bei austauschbarem Aufsatzbecken.'),

  ('waschtisch', 3,
   'Doppelwaschtisch',
   'Zwei separate Becken in einem Möbel oder zwei einzelne Waschtische nebeneinander.',
   'Entspannte Morgenroutine zu zweit.',
   'Mindestens 140–160 cm Breite, sonst zu eng.'),

  ('waschtisch', 4,
   'Wandhängender Waschtisch',
   'Becken oder Waschtischmöbel schwebt frei an der Wand, ohne Bodenkontakt.',
   'Bodenreinigung einfach, der Raum wirkt grosszügiger.',
   'Wand muss tragfähig sein — bei Leichtbauwänden ist eine Verstärkung nötig.'),

  -- 7. Waschtischarmatur (3 Punkte)
  ('waschtischarmatur', 1,
   'Standarmatur am Beckenrand',
   'Klassische sichtbare Armatur, direkt am Becken oder auf der Platte montiert.',
   'Einfache Montage, problemloser Austausch, grosse Modellauswahl.',
   'Beim Putzen rund um die Armatur etwas Aufwand.'),

  ('waschtischarmatur', 2,
   'Wandarmatur',
   'Bedienteil und Auslauf kommen aus der Wand, der Beckenrand bleibt frei.',
   'Sehr aufgeräumter Beckenbereich, ideal für Aufsatzbecken aus Naturstein.',
   'Bauseitige Vorbereitung in der Wand, schwerer nachzurüsten.'),

  ('waschtischarmatur', 3,
   'Berührungslose Armatur (Sensor)',
   'Sensor statt Griff, das Wasser läuft bei Annäherung.',
   'Hygienisch, ideal für Gäste-WC oder Kinderbad, spart Wasser.',
   'Stromversorgung (Batterie oder Trafo) muss eingeplant werden.'),

  -- 8. Spiegel (3 Punkte)
  ('spiegel', 1,
   'Einfacher Spiegel',
   'Reine Spiegelfläche, mit oder ohne Rahmen.',
   'Klar, schlicht, materialbetont — der Rahmen kann eine starke Designaussage sein.',
   'Die Beleuchtung muss separat über Wandlampen oder Deckenlicht geplant werden.'),

  ('spiegel', 2,
   'Lichtspiegel',
   'Spiegel mit integrierter LED-Beleuchtung (am Rand, hinterleuchtet oder als Frontlicht).',
   'Schattenfreies Gesicht beim Schminken oder Rasieren, oft dimmbar und in der Lichtfarbe einstellbar.',
   'Stromanschluss hinter dem Spiegel nötig, Lichtfarbe (warm/neutral) bewusst wählen.'),

  ('spiegel', 3,
   'Spiegelschrank',
   'Spiegel mit Stauraum dahinter, oft mit Steckdosen im Inneren.',
   'Verbindet Spiegel und Aufbewahrung, hält den Waschtisch frei von Pflegeprodukten.',
   'Tiefer als ein einfacher Spiegel (10–15 cm), kann kleinere Räume optisch verengen.'),

  -- 9. Möbel (3 Punkte)
  ('moebel', 1,
   'Unterbau-Waschtischmöbel',
   'Möbel direkt unter dem Waschtisch, mit Schubladen oder Türen.',
   'Wertvoller Stauraum am meistgenutzten Punkt im Bad.',
   'Gute Beschläge (Vollauszug, Soft-Close) kosten etwas mehr, machen aber im Alltag den Unterschied.'),

  ('moebel', 2,
   'Hochschrank',
   'Schmaler Schrank von Boden bis Decke oder Brusthöhe.',
   'Maximaler Stauraum auf minimaler Grundfläche — Platz für Handtücher, Vorräte, Wäschekorb.',
   'Position früh festlegen — Lichtwirkung und Türrichtung beeinflussen die ganze Raumwirkung.'),

  ('moebel', 3,
   'Hänge- oder Beistellmöbel',
   'Kleinere Einzelmöbel an der Wand, als Konsole oder Regal.',
   'Gezielte Ergänzung dort, wo Aufbewahrung fehlt — auch nachträglich möglich.',
   'Können das Bad schnell voller wirken lassen — bewusst dosieren.'),

  -- 10. WC (4 Punkte)
  ('wc', 1,
   'Wand-WC mit Vorwandinstallation',
   'WC schwebt an der Wand, der Spülkasten verschwindet in der Vorwand.',
   'Bodenpflege wird einfach, der Raum wirkt grösser und ruhiger.',
   'Die Vorwand braucht 15–20 cm Tiefe.'),

  ('wc', 2,
   'Spülrandloses WC',
   'Keine versteckten Kanten unterhalb des Beckenrands.',
   'Reinigung deutlich einfacher, optisch klarer.',
   'Andere Spülcharakteristik — am Modell zeigen wir Ihnen den Unterschied.'),

  ('wc', 3,
   'Silent-Flush-Spülung',
   'Die Spülung läuft fast geräuschlos ab.',
   'Komfort vor allem nachts und in offenen Wohnkonzepten.',
   'In der Anschaffung leicht teurer.'),

  ('wc', 4,
   'Dusch-WC',
   'Integrierte Wasser-Reinigung, optional mit Föhn, Sitzheizung und Geruchsabsaugung.',
   'Mehr Hygiene, weniger Verbrauch von Feuchttüchern, hoher Komfortgewinn.',
   'Stromanschluss in der Nähe nötig, die Modelle unterscheiden sich deutlich in Funktion und Qualität.'),

  -- 11. Betätigungsplatte (3 Punkte)
  ('betaetigungsplatte', 1,
   'Kunststoff (Standard)',
   'Klassische Platte in Weiss oder verchromtem Kunststoff.',
   'Sehr günstig, robust, in vielen Varianten verfügbar.',
   'Wirkt im hochwertigen Bad schnell wie ein Sparposten.'),

  ('betaetigungsplatte', 2,
   'Glas oder Metall',
   'Platte aus gehärtetem Glas, Edelstahl, Messing oder Schwarzmatt.',
   'Hochwertige Anmutung, sehr langlebig, viele Designoptionen passend zu Armaturen und Beschlägen.',
   'Im Materialpreis spürbar — aber sichtbar bei jeder Nutzung.'),

  ('betaetigungsplatte', 3,
   'Flächenbündig mit Fliese',
   'Die Platte wird mit derselben Fliese belegt wie die Wand — beinahe unsichtbar.',
   'Sehr aufgeräumte Optik, die Wand bleibt durchgehend, sehr ruhiges Gesamtbild.',
   'Aufwändigere Vorbereitung, die Fliesenwahl muss früh feststehen, Mass präzise auf die Fliese abgestimmt.');
