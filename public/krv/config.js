// config.js — Zentrale Konfiguration «Gratis KRV-Check» (krv.jaeggivollmer.ch)
//
// Alle Texte, die PLZ-Liste und die Empfänger-Adresse stehen hier. Das Anleitungsvideo wird im Admin importiert.
// Die Datei wird vom Browser (window.KRV_CONFIG) UND von den Netlify Functions
// (require) gelesen. Deshalb: nur reines JS-Objekt, keine Funktionen, keine Geheimnisse.
//
// Aussagen über Pflichten und Fristen nur so, wie sie in den IWB-Unterlagen stehen
// (Flyer «Rückflussverhinderung in Trinkwasserinstallationen», Brief an Hauseigentümer vom 1.10.2021).

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
      website: 'https://www.jaeggivollmer.ch'
    },

    // ── Einzugsgebiet: Versorgungsgebiet IWB (Basel, Riehen, Bettingen) ───
    einzugsgebiet: {
      bezeichnung: 'Basel, Riehen und Bettingen',
      plz: ['4000-4099', 4125, 4126]
    },

    // ── Fotos ──────────────────────────────────────────────────────────────
    fotos: {
      max: 5,           // muss zu MAX_FOTOS in netlify/functions/krv-anfrage.js passen
      maxKante: 1800    // werden im Browser verkleinert (JPEG, ohne Standortdaten)
    },

    // ── E-Mail ─────────────────────────────────────────────────────────────
    // Nur eine Info-Mail an uns (ohne Personendaten, mit Link zur Übersicht), keine Bestätigung an Kunden.
    // Absender: Netlify-Env KRV_ABSENDER, sonst DC_ABSENDER (bereits in Resend verifiziert).
    email: {
      empfaengerIntern: 'info@jaeggivollmer.ch',
      absenderName: 'Jäggi Vollmer',
      absenderAdresse: 'anfrage@dachcheck.jaeggivollmer.ch',
      uebersichtUrl: 'https://krv.jaeggivollmer.ch/admin.html',
      betreffIntern: 'Neue KRV-Check-Anfrage'
    },

    // ── Datenhaltung ───────────────────────────────────────────────────────
    loeschfristTage: 90,

    // ── Tracking (leer = kein Pixel, kein Cookie-Hinweis) ──────────────────
    tracking: {
      metaPixelId: ''
    },

    links: {
      impressum: 'impressum.html',
      datenschutz: 'datenschutz.html'
    },

    // ── Texte ──────────────────────────────────────────────────────────────
    texte: {
      cta: 'Gratis prüfen lassen',

      hero: {
        titel: 'Hat Ihr Haus schon einen Rückflussverhinderer?',
        unterzeile: 'Zwei Fotos vom Wasserzähler genügen. Wir sagen Ihnen gratis, ob er eingebaut ist.',
        punkte: ['Gratis und unverbindlich', 'In 2 Minuten erledigt', 'Antwort per E-Mail']
      },

      pflicht: {
        titel: 'Worum es geht',
        text: 'Gemäss IWB braucht jede Liegenschaft nach dem Wasserzähler einen Rückflussverhinderer, eingebaut auf Kosten der Eigentümerschaft (§ 28 Ausführungsbestimmungen IWB, SG 772.800). Er verhindert, dass Wasser aus dem Haus zurück ins Trinkwassernetz fliesst.',
        frist: 'IWB hat Liegenschaften ohne Rückflussverhinderer angeschrieben und um Nachrüstung bis zum 1. Januar 2027 gebeten.',
        gebiet: 'Versorgungsgebiet IWB: Basel, Riehen und Bettingen',
        quelle: 'Quelle: IWB, Flyer «Rückflussverhinderung in Trinkwasserinstallationen» und Schreiben an Hauseigentümer. Jäggi Vollmer ist ein unabhängiges Sanitärunternehmen und nicht Teil von IWB.'
      },

      anleitung: {
        titel: 'So machen Sie die richtigen Fotos',
        text: 'Bitte nichts auf- oder zudrehen und nichts abschrauben. Licht an, Handy ruhig halten, kein Zoom.',
        schritte: [
          { titel: 'Wasserzähler finden', text: 'Meist im Keller, dort wo die Wasserleitung ins Haus kommt, oft im Heizungs- oder Waschraum. Am Zähler steht «m³».' },
          { titel: 'Foto 1: die ganze Stelle', text: 'Einen Meter zurückstehen. Auf dem Foto sollen der Zähler und die Leitung links und rechts davon sein, mit allen Ventilen.' },
          { titel: 'Foto 2: nach dem Zähler', text: 'Näher ran an die Ventile direkt nach dem Zähler, also auf der Seite, wo die Leitung ins Haus weitergeht.' },
          { titel: 'Foto 3: Beschriftung (wenn vorhanden)', text: 'Gibt es auf einem Ventil eine Aufschrift, ein Schild oder einen Pfeil? Dann davon ein Nahfoto. Freiwillig.' }
        ],
        nichtGefunden: 'Sie finden den Wasserzähler nicht oder er liegt in einem Schacht im Boden? Kein Problem: Kreuzen Sie im Formular «Ich finde den Wasserzähler nicht» an, wir rufen Sie an.'
      },

      faq: {
        titel: 'Häufige Fragen',
        fragen: [
          { f: 'Was ist ein Rückflussverhinderer (KRV)?', a: 'Eine Armatur nach dem Wasserzähler, die Wasser nur in eine Richtung durchlässt: ins Haus hinein, aber nicht zurück ins öffentliche Netz. Oft ist er mit dem Absperrventil kombiniert, dann spricht man von einem KRV-Ventil.' },
          { f: 'Muss ich einen einbauen?', a: 'Gemäss IWB braucht jede Liegenschaft im Versorgungsgebiet einen kontrollierbaren Rückflussverhinderer nach dem Wasserzähler, eingebaut auf Kosten der Eigentümerschaft. Wurden Sie von IWB angeschrieben, hat IWB bei Ihrer Liegenschaft keinen festgestellt und bittet um Nachrüstung bis zum 1. Januar 2027.' },
          { f: 'Kostet der Check etwas?', a: 'Nein. Die Beurteilung Ihrer Fotos ist kostenlos und unverbindlich. Eine Offerte erhalten Sie nur, wenn ein Rückflussverhinderer fehlt und Sie das möchten.' },
          { f: 'Wie sicher ist eine Beurteilung per Foto?', a: 'Auf guten Fotos erkennen wir meist, ob ein Rückflussverhinderer vorhanden ist. Es bleibt eine Einschätzung und ersetzt keine Kontrolle vor Ort. Sind die Fotos nicht eindeutig, fragen wir nach.' },
          { f: 'Ich habe schon einen. Was nun?', a: 'Dann müssen Sie nichts einbauen. Wurden Sie von IWB angeschrieben, melden Sie IWB mit der beigelegten Rückantwortkarte, dass bereits ein Rückflussverhinderer vorhanden ist.' },
          { f: 'Wer darf den Rückflussverhinderer einbauen?', a: 'Gemäss IWB ein Sanitärunternehmen mit Installationsbewilligung von IWB. Jäggi Vollmer hat diese Bewilligung und meldet den Einbau direkt an IWB.' },
        ]
      },

      abschluss: {
        titel: 'Zwei Fotos, eine klare Antwort',
        text: 'Gratis, unverbindlich, von Sanitärfachleuten aus Basel.'
      },

      formular: {
        titel: 'Gratis KRV-Check',
        fotosTitel: 'Fotos hochladen',
        fotosText: 'Mindestens ein Foto, am besten zwei: die ganze Stelle mit Zähler und ein Nahfoto der Ventile nach dem Zähler.',
        fotoKnopf: 'Foto aufnehmen oder auswählen',
        keineFotos: 'Ich finde den Wasserzähler nicht oder kann kein Foto machen. Bitte rufen Sie mich an.',
        kontaktTitel: 'Ihre Angaben',
        rollen: [
          { wert: 'eigentuemer', label: 'Eigentümer/in' },
          { wert: 'verwaltung', label: 'Verwaltung' },
          { wert: 'mieter', label: 'Mieter/in' }
        ],
        iwbBrief: 'Ich habe von IWB einen Brief zum Rückflussverhinderer erhalten.',
        einwilligung: 'Ich bin einverstanden, dass Jäggi Vollmer meine Angaben und Fotos für die Beurteilung und eine allfällige Offerte verwendet. Ohne Auftrag werden sie nach 90 Tagen gelöscht.',
        weiter: 'Weiter',
        absenden: 'Gratis prüfen lassen',
        ausserhalb: {
          titel: 'Ausserhalb des IWB-Gebiets',
          text: 'Den Gratis-Check per Foto bieten wir zurzeit für Liegenschaften in Basel, Riehen und Bettingen an. Ausserhalb gelten die Vorgaben Ihres Wasserversorgers. Rufen Sie uns an, wir beraten Sie gerne.'
        }
      },

      danke: {
        titel: 'Danke, wir schauen es uns an',
        text: 'Ihre Anfrage und die Fotos sind bei uns. Bitte notieren Sie sich die Referenznummer.',
        naechsteSchritte: [
          'Unsere Sanitärfachleute beurteilen die Fotos, in der Regel innert weniger Arbeitstage.',
          'Sie erhalten unsere Einschätzung per E-Mail.',
          'Fehlt der Rückflussverhinderer, erhalten Sie auf Wunsch eine Offerte für den Einbau.'
        ],
        nachfrage: 'Sind die Fotos nicht eindeutig, melden wir uns telefonisch oder per E-Mail.'
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
    root.KRV_CONFIG = config;
  }
})(typeof window !== 'undefined' ? window : this);
