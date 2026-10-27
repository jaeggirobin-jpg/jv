// config.js — Zentrale Konfiguration «Gratis Drohnen-Rinnen-Check»
//
// Alle Texte, die PLZ-Liste und die Empfänger-Adresse stehen hier. Das Titelvideo wird im Admin importiert.
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
      uid: 'CHE-109.860.682',
      whatsapp: null                    // optional, z. B. '+41790000000'
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

    // ── E-Mail ─────────────────────────────────────────────────────────────
    // Nur eine Info-Mail an uns (ohne Personendaten, mit Link zur Übersicht), keine Bestätigung an Kunden.
    // Die Empfänger-Adresse kann per Environment Variable DC_EMPFAENGER überschrieben werden.
    email: {
      empfaengerIntern: 'info@jaeggivollmer.ch',
      absenderName: 'Jäggi Vollmer',
      absenderAdresse: 'dachcheck@jaeggivollmer.ch',  // Domain muss beim Versanddienst verifiziert sein
      uebersichtUrl: 'https://dachcheck.jaeggivollmer.ch/admin.html',  // Link in der Info-Mail
      betreffIntern: 'Neue Drohnen-Check-Anfrage'
    },

    // ── Datenhaltung ───────────────────────────────────────────────────────
    loeschfristTage: 60,

    // ── Tracking (leer = kein Pixel, kein Cookie-Hinweis) ──────────────────
    tracking: {
      metaPixelId: ''
    },

    // ── Links im Footer ────────────────────────────────────────────────────
    links: {
      impressum: 'impressum.html',
      datenschutz: 'datenschutz.html',
      // Kundenlink zum Bericht (absolut, weil das Admin-Panel auf docs.jaeggivollmer.ch läuft)
      bericht: 'https://dachcheck.jaeggivollmer.ch/bericht.html'
    },

    // ── Texte ──────────────────────────────────────────────────────────────
    texte: {
      cta: 'Gratis Drohnen-Check anfragen',

      hero: {
        titel: 'Wann haben Sie Ihre Dachrinne zuletzt gesehen?',
        unterzeile: 'Wir schauen mit der Drohne nach. Gratis, ohne Leiter, und Sie müssen nicht zu Hause sein.'
      },

      ablauf: {
        titel: 'So funktioniert es',
        schritte: [
          { icon: 'anfrage', titel: 'Anfragen', text: 'Name, Kontakt und Adresse genügen. Das dauert eine Minute.' },
          { icon: 'drohne', titel: 'Wir fliegen vorbei', text: 'Sobald wir in Ihrer Nähe sind, kündigen wir den Flug per E-Mail an. Sie müssen nicht zu Hause sein.' },
          { icon: 'report', titel: 'Kurzbericht', text: 'Wenige Tage danach erhalten Sie den Bericht mit Ampel und Fotos Ihrer Rinnen.' }
        ]
      },

      report: {
        titel: 'Was Sie bekommen',
        text: 'Einen kurzen Bericht zu Ihren Rinnen und Fallrohren. Die Ampel zeigt auf einen Blick, wie es steht, die Fotos zeigen, warum. Gereinigt wird nur, was nötig ist: Ist alles in Ordnung, sagen wir Ihnen das.',
        ampel: [
          { stufe: 'gut', wort: 'Gut', text: 'Rinnen und Fallrohre sind frei und intakt. Es ist nichts zu tun.' },
          { stufe: 'beobachten', wort: 'Beobachten', text: 'Leichte Verschmutzung oder kleine Auffälligkeiten. Wir empfehlen, in 6 bis 12 Monaten wieder hinzuschauen.' },
          { stufe: 'handlung', wort: 'Handlungsbedarf', text: 'Verstopfung, Schaden oder Gefahr von Wassereintritt. Wir sagen Ihnen, was zu tun ist.' }
        ]
      },

      vertrauen: {
        punkte: [
          { zahl: 'seit 2002', text: 'in Basel' },
          { zahl: 'rund 20', text: 'Fachleute' },
          { zahl: 'Suissetec', text: 'Mitglied' }
        ]
      },

      faq: {
        titel: 'Häufige Fragen',
        fragen: [
          { f: 'Kostet das wirklich nichts?', a: 'Ja. Der Rinnen-Check mit Drohnenflug und Kurzbericht ist kostenlos und unverbindlich. Eine Offerte erhalten Sie nur, wenn wir einen Befund haben und Sie das möchten.' },
          { f: 'Muss ich zu Hause sein?', a: 'Nein. Wir fliegen, wenn unser Projektleiter in Ihrer Nähe ist, und kündigen den Flug vorher per E-Mail an. Wir starten von der Strasse oder einem Platz in der Nähe. Brauchen wir ausnahmsweise Zugang zum Grundstück, melden wir uns.' },
          { f: 'Wann bekomme ich den Bericht?', a: 'In der Regel wenige Tage nach dem Flug, per E-Mail mit einem Link. Bei Regen oder starkem Wind fliegen wir nicht und kommen an einem anderen Tag.' },
          { f: 'Was geschieht mit den Aufnahmen?', a: 'Wir verwenden sie für Ihren Bericht und, falls Sie das wünschen, für eine Offerte. Ohne Auftrag löschen wir Anfrage, Bericht und Aufnahmen nach 60 Tagen. Nachbargrundstücke am Bildrand verwenden wir nicht, erkennbare Personen machen wir unkenntlich.' },
          { f: 'Wer fliegt die Drohne?', a: 'Geschulte Mitarbeitende von Jäggi Vollmer, nach den Regeln des Bundesamts für Zivilluftfahrt (BAZL) und unter Beachtung der Flugverbotszonen.' }
        ]
      },

      abschluss: {
        titel: 'Schauen wir nach?',
        text: 'Ein Flug, ein Kurzbericht, keine Verpflichtung.'
      },

      formular: {
        titel: 'Gratis Drohnen-Check anfragen',
        ausserhalb: {
          titel: 'Ihre Region ist noch nicht dabei',
          text: 'Den Drohnen-Check bieten wir zurzeit in Basel-Stadt und Basel-Landschaft an. Sollen wir Sie benachrichtigen, wenn wir in Ihre Region kommen?',
          button: 'Ja, benachrichtigen',
          danke: 'Danke. Wir melden uns, sobald wir in Ihrer Region unterwegs sind. Ihre E-Mail-Adresse verwenden wir nur dafür.'
        },
        einwilligung: 'Ich bin Eigentümer/in oder zur Anmeldung berechtigt und einverstanden, dass beim Drohnenflug das Dach aufgenommen wird. Ohne Auftrag werden Anfrage und Aufnahmen nach 60 Tagen gelöscht.',
        einwilligungKommunikation: 'Sie dürfen anonymisierte Aufnahmen meines Daches für Ihre Kommunikation verwenden.',
        absenden: 'Anfrage absenden'
      },

      danke: {
        titel: 'Danke für Ihre Anfrage',
        text: 'Wir haben Ihre Anfrage erhalten. Bitte notieren Sie sich die Referenznummer, falls Sie uns kontaktieren möchten.',
        naechsteSchritte: [
          'Sobald unser Projektleiter in Ihrer Nähe ist, kündigen wir den Flug per E-Mail an.',
          'Sie müssen dafür nicht zu Hause sein. Der Flug dauert rund 15 Minuten.',
          'Wenige Tage danach erhalten Sie den Kurzbericht mit Ampel und Fotos per E-Mail.'
        ]
      },

      bericht: {
        titel: 'Ihr Rinnen-Check',
        empfehlungTitel: 'Unsere Empfehlung',
        fotosTitel: 'Fotos',
        kontaktText: 'Fragen zum Bericht oder eine Offerte gewünscht? Wir sind gerne für Sie da.',
        nichtGefunden: 'Dieser Bericht ist nicht (mehr) verfügbar. Bitte kontaktieren Sie uns.'
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
