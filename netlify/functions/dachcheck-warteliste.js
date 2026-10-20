// dachcheck-warteliste.js — E-Mail für «Benachrichtigt mich, wenn ihr in meine Region kommt» speichern
const { antwort, ipHash, rpc } = require('./_lib/dachcheck');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return antwort(405, { error: 'Methode nicht erlaubt' });

  let b;
  try {
    b = JSON.parse(event.body || '{}');
  } catch (e) {
    return antwort(400, { error: 'Ungültige Anfrage' });
  }

  // Honeypot
  if (b.firma_website) return antwort(200, { ok: true });

  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase().slice(0, 200) : '';
  if (!EMAIL_RE.test(email)) return antwort(400, { error: 'Bitte geben Sie eine gültige E-Mail-Adresse an.' });

  const plz = typeof b.plz === 'string' && /^\d{4}$/.test(b.plz.trim()) ? b.plz.trim() : null;
  const ort = typeof b.ort === 'string' ? b.ort.trim().slice(0, 80) : null;
  const utm = {};
  if (b.utm && typeof b.utm === 'object') {
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => {
      if (typeof b.utm[k] === 'string') utm[k] = b.utm[k].slice(0, 200);
    });
  }

  try {
    const r = await rpc('drohnencheck_warteliste_erfassen', {
      p_daten: { email, plz, ort, utm, ip_hash: ipHash(event) },
      p_max_pro_stunde: parseInt(process.env.DC_RATE_LIMIT || '5', 10)
    });
    if (r && r.error === 'rate_limit') return antwort(429, { error: 'Zu viele Anfragen. Bitte versuchen Sie es später nochmals.' });
  } catch (err) {
    console.error(err);
    return antwort(500, { error: 'Speichern fehlgeschlagen' });
  }
  return antwort(200, { ok: true });
};
