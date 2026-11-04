// antwort-mail.js — Antwort an den Kunden nach der Beurteilung (KRV-Check)
//
// EINE Quelle für Betreff, Text und gestaltete HTML-Mail. Der Admin (window.KRV_ANTWORT) zeigt die Vorschau
// und lädt den Entwurf als .eml für Outlook (Robin 4.11.2026); der Text dient auch dem mailto-Entwurf.
// Die HTML-Mail ist für Outlook, Gmail und Apple Mail gebaut: Tabellen, Stil inline, feste Breite 600 px,
// keine Hintergrundbilder, alles lesbar auch ohne Bilder.
//
// Werbung (cfg.texte.antwortWerbung): nur eigene, ähnliche Leistungen an Kundschaft, die selbst angefragt hat,
// ohne Abmeldehinweis (Robin 4.11.2026: einzelne Antwort, keine Massenwerbung).

(function (root) {
  var F = {
    text: '#25292E', grau: '#5E676C', hell: '#929A9D', anthrazit: '#4B575D',
    kupfer: '#BD843A', kupferDunkel: '#94621F', kupferHell: '#F4EADD', gruen: '#3D7A4A', gruenHell: '#E6F0E8', grund: '#F7F5F2', linie: '#E6E1DA'
  };
  var SCHRIFT = "Arial,Helvetica,sans-serif";
  var BASIS = 'https://krv.jaeggivollmer.ch/';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function adresse(a) {
    return ((a.strasse || '') + ' ' + (a.hausnummer || '')).trim() + ', ' + ((a.plz || '') + ' ' + (a.ort || '')).trim();
  }
  function plzIn(plz, liste) {
    var n = parseInt(plz, 10);
    return (liste || []).some(function (e) {
      if (typeof e === 'number') return e === n;
      var t = String(e).split('-');
      return n >= parseInt(t[0], 10) && n <= parseInt(t[1] || t[0], 10);
    });
  }
  function flyerUrl(cfg, plz) {
    var liste = (cfg.texte && cfg.texte.iwb && cfg.texte.iwb.flyer) || [];
    var f = liste.filter(function (x) { return plzIn(plz, x.plz); })[0];
    return f ? BASIS + f.datei : '';
  }

  // Inhalt als Bausteine: { titel, ergebnis, ton, absaetze[], knopf? }
  function inhalt(a, cfg) {
    var begruendung = (a.beurteilung_text || '').trim();
    var mieter = a.rolle === 'mieter'
      ? 'Den Einbau muss die Eigentümerschaft oder die Verwaltung in Auftrag geben. Leiten Sie diese E-Mail gerne weiter.'
      : '';
    var r = { absaetze: [] };
    if (a.beurteilung === 'vorhanden') {
      r.betreff = 'Ihr KRV-Check ' + a.referenz + ': Rückflussverhinderer vorhanden';
      r.ergebnis = 'Rückflussverhinderer vorhanden';
      r.ton = 'gut';
      r.absaetze.push('Gute Nachricht: Auf Ihren Fotos ist nach dem Wasserzähler ein Rückflussverhinderer zu erkennen. Sie müssen nichts einbauen.');
      if (begruendung) r.absaetze.push(begruendung);
      r.absaetze.push('Wir melden IWB per E-Mail, dass bei Ihnen bereits ein Rückflussverhinderer vorhanden ist. Sie müssen dafür nichts weiter tun.');
    } else if (a.beurteilung === 'fehlt') {
      r.betreff = 'Ihr KRV-Check ' + a.referenz + ': Rückflussverhinderer fehlt';
      r.ergebnis = 'Kein Rückflussverhinderer zu sehen';
      r.ton = 'achtung';
      r.absaetze.push('Auf Ihren Fotos sehen wir nach dem Wasserzähler keinen Rückflussverhinderer.');
      if (begruendung) r.absaetze.push(begruendung);
      r.absaetze.push(a.offerte_gewuenscht === false
        ? 'Gemäss IWB muss die Eigentümerschaft einen Rückflussverhinderer auf eigene Kosten einbauen lassen. Wenn Sie dafür eine Offerte möchten, antworten Sie einfach auf diese E-Mail. Den Einbau melden wir anschliessend direkt an IWB.'
        : 'Gemäss IWB muss die Eigentümerschaft einen Rückflussverhinderer auf eigene Kosten einbauen lassen. Wie gewünscht erstellen wir Ihnen dafür eine Offerte und senden sie Ihnen in den nächsten Tagen. Den Einbau melden wir anschliessend direkt an IWB.');
      if (mieter) r.absaetze.push(mieter);
      var fl = flyerUrl(cfg, a.plz);
      if (fl) r.knopf = { text: 'IWB-Flyer zum Rückflussverhinderer (PDF)', url: fl };
    } else {
      r.betreff = 'Ihr KRV-Check ' + a.referenz + ': noch ein Foto, bitte';
      r.ergebnis = 'Noch nicht sicher erkennbar';
      r.ton = 'offen';
      r.absaetze.push('Auf Ihren Fotos können wir leider nicht sicher erkennen, ob ein Rückflussverhinderer eingebaut ist.');
      if (begruendung) r.absaetze.push(begruendung);
      r.absaetze.push('Können Sie uns noch ein Foto senden? Antworten Sie einfach auf diese E-Mail und hängen Sie das Foto an. Am besten von etwa einem Meter Abstand, mit dem Wasserzähler und allen Ventilen rechts und links davon. Alternativ kommen wir gerne kurz vorbei.');
    }
    return r;
  }

  function werbung(cfg) {
    return (cfg.texte && cfg.texte.antwortWerbung) || null;
  }

  // ── Reiner Text (Text-Teil der Mail und Entwurf im eigenen Mailprogramm) ──
  function text(a, cfg) {
    var r = inhalt(a, cfg);
    var fi = cfg.firma || {};
    var t = 'Guten Tag ' + a.vorname + ' ' + a.nachname + '\n\n' +
      'Vielen Dank für Ihre Anfrage zum Gratis KRV-Check (' + a.referenz + ', ' + adresse(a) + ').\n\n' +
      r.absaetze.join('\n\n') + '\n\n' +
      (r.knopf ? r.knopf.text + ': ' + r.knopf.url + '\n\n' : '') +
      'Freundliche Grüsse\nJäggi Vollmer\n' + String(fi.website || '').replace(/^https?:\/\//, '') + '\n' + (fi.telefon || '');
    var w = werbung(cfg);
    if (w) {
      t += '\n\n— ' + w.titel + ' —\n' + w.kacheln.map(function (k) {
        return k.titel + ': ' + k.text + ' ' + k.url;
      }).join('\n');
    }
    t += '\n\n' + [fi.name, fi.strasse, fi.ort].filter(Boolean).join(', ');
    return { betreff: r.betreff, text: t };
  }

  // ── Gestaltete HTML-Mail ──
  function knopf(t, url, farbe) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td bgcolor="' + farbe + '" style="border-radius:6px;background:' + farbe + '">' +
      '<a href="' + esc(url) + '" target="_blank" style="display:inline-block;padding:12px 20px;font-family:' + SCHRIFT + ';font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px">' + esc(t) + '</a>' +
      '</td></tr></table>';
  }
  function absatz(t, extra) {
    return '<p style="margin:0 0 16px;font-family:' + SCHRIFT + ';font-size:16px;line-height:24px;color:' + F.text + (extra || '') + '">' + esc(t).replace(/\n/g, '<br>') + '</p>';
  }

  function html(a, cfg, opts) {
    opts = opts || {};
    var r = inhalt(a, cfg);
    var fi = cfg.firma || {};
    var w = werbung(cfg);
    var logo = opts.logoUrl || BASIS + 'assets/logo-mail.png';
    var symbol = { gut: '&#10003;', achtung: '!', offen: '?' }[r.ton];
    var randFarbe = r.ton === 'gut' ? F.gruen : F.kupfer;
    var feldFarbe = r.ton === 'gut' ? F.gruenHell : F.kupferHell;
    var vorschau = r.ergebnis + ' – ' + adresse(a);

    var kacheln = '';
    if (w) {
      var zellen = w.kacheln.map(function (k) {
        return '<td class="kachel" valign="top" width="50%" style="padding:0 6px 12px">' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ' + F.linie + ';border-radius:8px"><tr>' +
          '<td style="border-top:4px solid ' + F.kupfer + ';border-radius:8px 8px 0 0;padding:16px 16px 18px">' +
          '<p style="margin:0 0 4px;font-family:' + SCHRIFT + ';font-size:12px;letter-spacing:1px;text-transform:uppercase;color:' + F.kupferDunkel + ';font-weight:bold">' + esc(k.bereich) + '</p>' +
          '<p style="margin:0 0 8px;font-family:' + SCHRIFT + ';font-size:17px;line-height:22px;font-weight:bold;color:' + F.text + '">' + esc(k.titel) + '</p>' +
          '<p style="margin:0 0 14px;font-family:' + SCHRIFT + ';font-size:14px;line-height:21px;color:' + F.grau + '">' + esc(k.text) + '</p>' +
          '<a href="' + esc(k.url) + '" target="_blank" style="font-family:' + SCHRIFT + ';font-size:14px;font-weight:bold;color:' + F.kupferDunkel + ';text-decoration:none">' + esc(k.link) + ' &rarr;</a>' +
          '</td></tr></table></td>';
      });
      var reihen = '';
      for (var i = 0; i < zellen.length; i += 2) reihen += '<tr>' + zellen[i] + (zellen[i + 1] || '<td class="kachel" width="50%"></td>') + '</tr>';
      kacheln =
        '<tr><td style="padding:8px 26px 0">' +
          '<p style="margin:0 0 4px;font-family:' + SCHRIFT + ';font-size:20px;line-height:26px;font-weight:bold;color:' + F.anthrazit + '">' + esc(w.titel) + '</p>' +
          '<p style="margin:0 0 16px;font-family:' + SCHRIFT + ';font-size:15px;line-height:22px;color:' + F.grau + '">' + esc(w.text) + '</p>' +
        '</td></tr>' +
        '<tr><td style="padding:0 20px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + reihen + '</table></td></tr>';
    }

    return '<!DOCTYPE html><html lang="de-CH"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
      '<title>' + esc(r.betreff) + '</title>' +
      '<style>@media (max-width:620px){.huelle{width:100%!important}.kachel{display:block!important;width:100%!important;box-sizing:border-box}.innen{padding-left:18px!important;padding-right:18px!important}}</style>' +
      '</head><body style="margin:0;padding:0;background:' + F.grund + '">' +
      '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:' + F.grund + '">' + esc(vorschau) + '</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + F.grund + '" style="background:' + F.grund + '"><tr><td align="center" style="padding:24px 10px">' +
      '<table role="presentation" class="huelle" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">' +

      // Kopf: Logo direkt auf dem Hintergrund (kein Kasten)
      '<tr><td style="padding:4px 26px 18px"><a href="' + esc(fi.website || 'https://www.jaeggivollmer.ch') + '" target="_blank"><img src="' + esc(logo) + '" width="200" alt="Jäggi Vollmer" style="display:block;width:200px;max-width:60%;height:auto;border:0;font-family:' + SCHRIFT + ';font-size:20px;font-weight:bold;color:' + F.anthrazit + '"></a></td></tr>' +

      // Hauptkarte
      '<tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:10px;border-top:5px solid ' + F.kupfer + '">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
        '<tr><td class="innen" style="padding:26px 30px 6px">' +
          '<p style="margin:0 0 6px;font-family:' + SCHRIFT + ';font-size:13px;letter-spacing:1px;text-transform:uppercase;color:' + F.kupferDunkel + ';font-weight:bold">Gratis KRV-Check · ' + esc(a.referenz) + '</p>' +
          '<p style="margin:0 0 20px;font-family:' + SCHRIFT + ';font-size:14px;color:' + F.hell + '">' + esc(adresse(a)) + '</p>' +
          // Ergebnis
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>' +
            '<td bgcolor="' + feldFarbe + '" style="background:' + feldFarbe + ';border-left:5px solid ' + randFarbe + ';border-radius:6px;padding:14px 16px">' +
              '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
                '<td width="34" valign="middle"><div style="width:30px;height:30px;line-height:30px;border-radius:15px;background:' + randFarbe + ';color:#ffffff;text-align:center;font-family:' + SCHRIFT + ';font-size:17px;font-weight:bold">' + symbol + '</div></td>' +
                '<td valign="middle" style="padding-left:10px;font-family:' + SCHRIFT + ';font-size:18px;line-height:24px;font-weight:bold;color:' + F.text + '">' + esc(r.ergebnis) + '</td>' +
              '</tr></table>' +
            '</td></tr></table>' +
          absatz('Guten Tag ' + a.vorname + ' ' + a.nachname) +
          absatz('Vielen Dank für Ihre Anfrage zum Gratis KRV-Check.') +
          r.absaetze.map(function (t) { return absatz(t); }).join('') +
          (r.knopf ? '<div style="margin:4px 0 20px">' + knopf(r.knopf.text, r.knopf.url, F.kupferDunkel) + '</div>' : '') +
          absatz('Freundliche Grüsse') +
          '<p style="margin:0 0 24px;font-family:' + SCHRIFT + ';font-size:16px;line-height:24px;color:' + F.text + '"><strong>Jäggi Vollmer</strong><br>' +
            '<a href="' + esc(fi.website || '') + '" target="_blank" style="color:' + F.kupferDunkel + ';text-decoration:none">' + esc(String(fi.website || '').replace(/^https?:\/\//, '')) + '</a><br>' +
            '<a href="tel:' + esc(fi.telefonLink || '') + '" style="color:' + F.kupferDunkel + ';text-decoration:none">' + esc(fi.telefon || '') + '</a></p>' +
        '</td></tr>' +
      '</table></td></tr>' +

      '<tr><td style="height:26px;line-height:26px;font-size:0">&nbsp;</td></tr>' +
      kacheln +

      // Fuss
      '<tr><td style="padding:14px 26px 8px;border-top:1px solid ' + F.linie + '">' +
        '<p style="margin:0 0 8px;font-family:' + SCHRIFT + ';font-size:13px;line-height:19px;color:' + F.anthrazit + '"><strong>' + esc(fi.name || 'Jäggi Vollmer GmbH') + '</strong> · Spenglerei · Sanitär · Planung<br>' +
          esc([fi.strasse, fi.ort].filter(Boolean).join(', ')) + ' · <a href="' + esc(fi.website || '') + '" target="_blank" style="color:' + F.anthrazit + '">' + esc(String(fi.website || '').replace(/^https?:\/\//, '')) + '</a></p>' +
      '</td></tr>' +

      '</table></td></tr></table></body></html>';
  }

  // ── Entwurf als .eml-Datei (Outlook öffnet sie dank «X-Unsent: 1» als neue, bearbeitbare Mail) ──
  // logoBase64: PNG des Logos ohne «data:»-Vorspann; dann hängt es als Inline-Bild an (cid), sonst Link
  function b64(t) {
    if (typeof Buffer !== 'undefined') return Buffer.from(t, 'utf8').toString('base64');
    return btoa(unescape(encodeURIComponent(t)));
  }
  function zeilen76(t) {
    return t.replace(/.{1,76}/g, '$&\r\n');
  }
  function kopfWort(t) {
    return /^[\x20-\x7e]*$/.test(t) ? t : '=?UTF-8?B?' + b64(t) + '?=';
  }
  function eml(a, cfg, opts) {
    opts = opts || {};
    var t = text(a, cfg);
    var h = html(a, cfg, { logoUrl: opts.logoBase64 ? 'cid:logo-jv' : undefined });
    var g = 'krv' + Date.now().toString(36);
    var alt = '----=_alt_' + g, rel = '----=_rel_' + g;
    var teilAlt =
      'Content-Type: multipart/alternative; boundary="' + alt + '"\r\n\r\n' +
      '--' + alt + '\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + zeilen76(b64(t.text)) +
      '--' + alt + '\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + zeilen76(b64(h)) +
      '--' + alt + '--\r\n';
    var kopf =
      'X-Unsent: 1\r\n' +
      'To: ' + String(a.email || '').replace(/[\r\n<>,;"]/g, '') + '\r\n' +
      'Subject: ' + kopfWort(t.betreff) + '\r\n' +
      'MIME-Version: 1.0\r\n';
    if (!opts.logoBase64) return kopf + teilAlt;
    return kopf +
      'Content-Type: multipart/related; boundary="' + rel + '"; type="multipart/alternative"\r\n\r\n' +
      '--' + rel + '\r\n' + teilAlt +
      '--' + rel + '\r\nContent-Type: image/png; name="logo.png"\r\nContent-Transfer-Encoding: base64\r\n' +
      'Content-ID: <logo-jv>\r\nContent-Disposition: inline; filename="logo.png"\r\n\r\n' + zeilen76(opts.logoBase64) +
      '--' + rel + '--\r\n';
  }

  var api = { inhalt: inhalt, text: text, html: html, eml: eml, flyerUrl: flyerUrl, BASIS: BASIS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KRV_ANTWORT = api;
})(typeof window !== 'undefined' ? window : this);
