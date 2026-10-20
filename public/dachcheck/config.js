// config.js — Zentrale Konfiguration «Gratis Drohnen-Rinnen-Check»
//
// Alle Texte, Preise, die PLZ-Liste und die Empfänger-Adresse stehen hier.
// Die Datei wird vom Browser (window.DC_CONFIG) UND von der Netlify Function
// (require) gelesen. Deshalb: nur reines JS-Objekt, keine Funktionen, keine Geheimnisse.
// API-Keys gehören in die Netlify Environment Variables, nicht hierher.
//
// Platzhalter sind mit «[___]» bzw. null markiert und in README.md aufgelistet.

(function (root) {
  var config = {

    // ── Firma ──────────────────────────────────────────────────────────────
    firma: {
      name: 'Jäggi Vollmer GmbH',
      strasse: 'Horburgstrasse 96',
      ort: '4057 Basel',
      telefon: '061 692 03 11',
      telefonLink: '+41616920311',
      email: 'info@jaeggivollmer.ch',
      website: 'https://www.jaeggivollmer.ch',
      uid: 'CHE-[___]',                 // Platzhalter: UID-Nummer
      whatsapp: null                    // optional, z. B. '+41790000000'
    },

    // ── Preise (null = «Preis auf Anfrage») ────────────────────────────────
    preise: {
      dachkontrolle: null,              // CHF, z. B. 290
      dachkontrolleAnrechnungAb: null,  // CHF Auftragswert, ab dem angerechnet wird
      wartungsabo: null                 // CHF pro Jahr
    },

    // ── Einzugsgebiet ──────────────────────────────────────────────────────
    // Startwert: Postleitzahlen Basel-Stadt und Basel-Landschaft.
    // Bereiche als «von-bis», einzelne PLZ als Zahl. Bitte bei Bedarf ergänzen.
    einzugsgebiet: {
      bezeichnung: 'Basel-Stadt und Basel-Landschaft',
      plz: [
        // Basel-Stadt
        '4000-4099', 4125, 4126,
        // Basel-Landschaft, Bezirk Arlesheim
        4101, 4102, 4103, 4104, 4105, 4106, 4107, 4123, 4124, 4127, 4132,
        4142, 4144, 4147, 4148, 4153,
        // Bezirk Laufen
        2814, 4117, 4202, 4203, 4222, 4223, 4224, 4225, 4242, 4243, 4244,
        4246, 4253, 4254,
        // Bezirk Liestal
        4133, 4302, 4304, 4402, 4410, 4411, 4414, 4415, 4416, 4417, 4419,
        4422, 4423,
        // Bezirke Sissach und Waldenburg
        4207, 4418, 4424, 4425, 4426, 4431, 4432, 4433, 4434, 4435, 4436,
        4437, 4438, 4441, 4442, 4443, 4444, 4445, 4446, 4447, 4448, 4450,
        4451, 4452, 4453, 4455, 4456, 4457, 4458, 4460, 4461, 4462, 4463,
        4464, 4465, 4466, 4467, 4469, 4492, 4493, 4494, 4495, 4496, 4497
      ]
    },

    // ── Termine ────────────────────────────────────────────────────────────
    termine: {
      wochenVoraus: 3,      // Halbtage in den nächsten X Wochen anbieten
      vorlaufTage: 2,       // frühestens in X Werktagen
      minAuswahl: 2,
      maxAuswahl: 3
    },

    // ── E-Mail ─────────────────────────────────────────────────────────────
    // Nur eine Info-Mail an uns (ohne Personendaten), keine Bestätigung an Kunden.
    // Die Empfänger-Adresse kann per Environment Variable DC_EMPFAENGER überschrieben werden.
    email: {
      empfaengerIntern: 'info@jaeggivollmer.ch',
      absenderName: 'Jäggi Vollmer',
      absenderAdresse: 'dachcheck@jaeggivollmer.ch',  // Domain muss beim Versanddienst verifiziert sein
      betreffIntern: 'Neue Drohnen-Check-Anfrage'
    },

    // ── Datenhaltung ───────────────────────────────────────────────────────
    loeschfristTage: 60,

    // ── Tracking (leer = kein Pixel, kein Cookie-Hinweis) ──────────────────
    tracking: {
      metaPixelId: ''
    },

    // ── Bilder (null = neutraler Platzhalter mit Beschriftung) ──────────────
    // Dateien nach public/assets/img/ legen, z. B. 'assets/img/hero.jpg'
    bilder: {
      hero: null,
      report: null,     // Bild des Muster-PDFs
      team: null
    },

    // ── Links im Footer ────────────────────────────────────────────────────
    links: {
      impressum: 'impressum.html',
      datenschutz: 'datenschutz.html'
    },

    // ── Texte ──────────────────────────────────────────────────────────────
    texte: {
      cta: 'Gratis Drohnen-Check anfragen',

      hero: {
        titel: 'Wann haben Sie Ihre Dachrinne zuletzt gesehen?',
        unterzeile: 'Wir schauen mit der Drohne nach. Gratis, ohne Leiter, ohne Verpflichtung.',
        bildHinweis: 'Platzhalter: Drohnenaufnahme eines Daches'
      },

      ablauf: {
        titel: 'So funktioniert es',
        schritte: [
          { icon: 'anfrage', titel: 'Anfrage', text: 'Sie füllen das kurze Formular aus. Das dauert etwa zwei Minuten.' },
          { icon: 'termin', titel: 'Termin', text: 'Wir rufen Sie an und bestätigen einen Halbtag, der Ihnen passt.' },
          { icon: 'drohne', titel: 'Drohnenflug', text: 'Wir fliegen ca. 15 Minuten über Ihr Dach. Niemand muss aufs Dach steigen.' },
          { icon: 'report', titel: 'Kurzreport', text: 'Innert 24 Stunden erhalten Sie den Report mit Ampel und 2–3 Fotos.' }
        ]
      },

      report: {
        titel: 'Was Sie bekommen',
        text: 'Einen Kurzreport zu Ihren Rinnen und Fallrohren. Die Ampel zeigt auf einen Blick, wie es steht, die Fotos zeigen, warum.',
        bildHinweis: 'Platzhalter: Vorschau Muster-Report',
        ampel: [
          { stufe: 'gut', wort: 'Gut', text: 'Rinnen und Fallrohre sind frei und intakt. Es ist nichts zu tun.' },
          { stufe: 'beobachten', wort: 'Beobachten', text: 'Leichte Verschmutzung oder kleine Auffälligkeiten. Wir empfehlen, in 6 bis 12 Monaten wieder hinzuschauen.' },
          { stufe: 'handlung', wort: 'Handlungsbedarf', text: 'Verstopfung, Schaden oder Gefahr von Wassereintritt. Wir sagen Ihnen, was zu tun ist.' }
        ]
      },

      versprechen: {
        titel: 'Gereinigt wird nur, was nötig ist.',
        text: 'Wir verkaufen Ihnen keine Reinigung, die Sie nicht brauchen. Ist alles in Ordnung, sagen wir Ihnen das, und Sie erhalten keine Offerte. Sehen wir an anderen Bauteilen etwas, melden wir es als Hinweis. Akute Gefahren melden wir immer sofort und vollständig.'
      },

      mehr: {
        titel: 'Mehr als die Rinne',
        karten: [
          {
            titel: 'Dachkontrolle mit Bericht',
            text: 'Fällt uns beim Flug etwas auf, können wir daraus auf Wunsch eine Dachkontrolle mit ausführlichem Bericht machen.',
            preisKey: 'dachkontrolle',
            preisZusatz: 'anrechnung'
          },
          {
            titel: 'Wartungsabo',
            text: 'Eine jährliche Kontrolle mit Bericht und Rinnenreinigung. Sie müssen an nichts denken.',
            preisKey: 'wartungsabo',
            preisZusatz: 'proJahr'
          }
        ]
      },

      vertrauen: {
        titel: 'Wer wir sind',
        punkte: [
          { zahl: 'seit 2002', text: 'in Basel' },
          { zahl: 'rund 20', text: 'Fachleute' },
          { zahl: 'Suissetec', text: 'Mitglied' }
        ],
        text: 'Wir sind eine Spenglerei und Sanitärfirma aus Basel. Die Drohne fliegen unsere eigenen Leute, und den Report schreibt jemand, der Dächer kennt.',
        bildHinweis: 'Platzhalter: Foto vom Team'
      },

      faq: {
        titel: 'Häufige Fragen',
        fragen: [
          { f: 'Kostet das wirklich nichts?', a: 'Ja. Der Rinnen-Check mit Drohnenflug und Kurzreport ist kostenlos und unverbindlich. Sie gehen damit keine Verpflichtung ein. Eine Offerte erhalten Sie nur, wenn wir einen Befund haben und Sie das möchten.' },
          { f: 'Muss ich zu Hause sein?', a: 'Nein, nicht zwingend. Wir brauchen Zugang zu einem Platz in der Nähe des Hauses, von dem aus wir starten können. Das klären wir beim Telefonat zur Terminbestätigung.' },
          { f: 'Was passiert bei Regen oder Wind?', a: 'Bei Regen, starkem Wind oder schlechter Sicht fliegen wir nicht. Wir melden uns und schlagen einen neuen Termin vor.' },
          { f: 'Was geschieht mit den Aufnahmen?', a: 'Wir verwenden die Aufnahmen für Ihren Rinnen-Check und, falls Sie das wünschen, für einen Dachkontroll-Bericht. Ohne Auftrag löschen wir sie nach 60 Tagen. Für unsere Kommunikation verwenden wir Aufnahmen nur, wenn Sie das ausdrücklich erlauben, und nur anonymisiert.' },
          { f: 'Werden Nachbarn gefilmt?', a: 'Wir richten die Kamera auf Ihr Dach. Lässt es sich nicht vermeiden, dass Nachbargrundstücke am Bildrand zu sehen sind, verwenden wir diese Teile nicht. Sind Personen erkennbar, löschen wir die Aufnahme oder machen sie unkenntlich.' },
          { f: 'Wer fliegt die Drohne?', a: 'Geschulte Mitarbeitende von Jäggi Vollmer. Wir fliegen nach den Regeln des Bundesamts für Zivilluftfahrt (BAZL) und halten uns an Flugverbotszonen.' },
          { f: 'Ich bin Mieter oder Verwaltung, geht das auch?', a: 'Ja. Als Verwaltung können Sie direkt anfragen. Als Mieterin oder Mieter brauchen wir vor dem Flug die Zustimmung der Eigentümerschaft. Geben Sie uns einfach an, wen wir kontaktieren dürfen.' }
        ]
      },

      abschluss: {
        titel: 'Schauen wir nach?',
        text: 'Ein Flug, ein Kurzreport, keine Verpflichtung.'
      },

      formular: {
        titel: 'Gratis Drohnen-Check anfragen',
        schritte: ['Adresse', 'Gebäude', 'Kontakt', 'Wunschtermin', 'Einwilligung'],
        ausserhalb: {
          titel: 'Ihre Region ist noch nicht dabei',
          text: 'Den Drohnen-Check bieten wir zurzeit in Basel-Stadt und Basel-Landschaft an. Möchten Sie benachrichtigt werden, wenn wir in Ihre Region kommen?',
          button: 'Benachrichtigen Sie mich',
          danke: 'Danke. Wir melden uns, sobald wir in Ihrer Region unterwegs sind. Ihre E-Mail-Adresse verwenden wir nur dafür.'
        },
        mieterHinweis: 'Für den Flug brauchen wir die Zustimmung der Eigentümerschaft. Wir klären das mit Ihnen beim Telefonat.',
        terminHinweis: 'Wir bestätigen den Termin telefonisch. Bei schlechtem Wetter verschieben wir.',
        einwilligungBerechtigt: 'Ich bin Eigentümer oder zur Anmeldung berechtigt.',
        einwilligungAufnahmen: 'Ich bin einverstanden, dass beim Drohnenflug das gesamte Dach aufgenommen wird. Die Bilder werden für den Rinnen-Check und, falls gewünscht, für einen Dachkontroll-Bericht verwendet. Ohne Auftrag werden sie nach 60 Tagen gelöscht.',
        einwilligungKommunikation: 'Ihr dürft anonymisierte Aufnahmen meines Daches für eure Kommunikation verwenden.',
        absenden: 'Anfrage absenden'
      },

      danke: {
        titel: 'Danke für Ihre Anfrage',
        text: 'Wir haben Ihre Anfrage erhalten. Bitte notieren Sie sich die Referenznummer, falls Sie uns kontaktieren möchten.',
        naechsteSchritte: [
          'Wir rufen Sie innert zwei Arbeitstagen an und bestätigen den Termin.',
          'Am Termin fliegen wir ca. 15 Minuten über Ihr Dach.',
          'Innert 24 Stunden erhalten Sie den Kurzreport mit Ampel und Fotos.'
        ]
      },

      cookie: {
        text: 'Wir möchten messen, welche Werbung zu Anfragen führt. Dafür laden wir das Meta Pixel, aber nur mit Ihrer Zustimmung.',
        ja: 'Einverstanden',
        nein: 'Ablehnen'
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = config;
  } else {
    root.DC_CONFIG = config;
  }
})(typeof window !== 'undefined' ? window : this);
