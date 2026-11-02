// tools.js — Hilfsfunktionen für den Speicher der Tools (tool-db, tool-asset, tool-blob, Visualisierungen)
// Supabase (PostgREST) und Storage werden wie beim Drohnen-Check direkt per fetch angesprochen.

const crypto = require('crypto');
const dc = require('./dachcheck');

const BUCKET = 'tools';

// Tools, die den Speicher nutzen dürfen (Name = erster Teil des Schlüssels)
const TOOLS = ['terminplaner', 'badvis', 'gaeste-wc', 'plattform'];

// Feste Dateien (nicht über eine Asset-ID): Name → Pfad im Bucket
const DATEIEN = {
  'gaeste-wc-scan': 'gaeste-wc/scan.json'
};

const PFAD_RE = /^[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,120}$/;
const SAMMLUNG_RE = /^[A-Za-z0-9_-]{1,80}$/;
const ASSET_RE = /^[a-f0-9]{32}$/;

const TYPEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/json'];

function json(status, body, extra) {
  return {
    statusCode: status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {}),
    body: JSON.stringify(body)
  };
}

function body(event) {
  try {
    const roh = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '{}');
    return JSON.parse(roh || '{}');
  } catch (e) {
    return null;
  }
}

function neueId() {
  return crypto.randomBytes(16).toString('hex');
}

function assetPfad(id) {
  return 'a/' + id;
}

async function signierteUrl(pfad, sekunden) {
  const urls = await dc.signierteUrls([pfad], sekunden, BUCKET);
  return urls[pfad] || null;
}

async function signierteUrls(pfade, sekunden) {
  return dc.signierteUrls(pfade, sekunden, BUCKET);
}

async function uploadUrl(pfad) {
  return dc.uploadUrl(pfad, BUCKET);
}

async function dateienLoeschen(pfade) {
  return dc.bilderLoeschen(pfade, BUCKET);
}

// Datei direkt aus der Function in einen Bucket schreiben (kleine Dateien, z. B. Feedback-Bilder).
// Überschreibt nie: eine vorhandene Datei gleichen Namens ergibt einen Fehler.
async function speichern(bucket, pfad, inhalt, typ) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL oder SUPABASE_SERVICE_KEY fehlt');
  const res = await fetch(url.replace(/\/$/, '') + '/storage/v1/object/' + bucket + '/' + pfad, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': typ, 'x-upsert': 'false', 'Cache-Control': 'no-store' },
    body: inhalt
  });
  if (!res.ok) throw new Error('Storage-Upload ' + bucket + '/' + pfad + ' fehlgeschlagen: ' + res.status + ' ' + (await res.text()).slice(0, 300));
}

// Datei aus einem Bucket lesen (Buffer, null wenn nicht vorhanden)
async function lesen(bucket, pfad) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL oder SUPABASE_SERVICE_KEY fehlt');
  const res = await fetch(url.replace(/\/$/, '') + '/storage/v1/object/' + bucket + '/' + pfad, {
    headers: { apikey: key, Authorization: 'Bearer ' + key }
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error('Storage-Download ' + bucket + '/' + pfad + ' fehlgeschlagen: ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

// Ein Dokument lesen (null, wenn nicht vorhanden oder gelöscht)
async function docLesen(tool, pfad) {
  const r = await dc.rest('tool_docs?select=pfad,daten,geaendert&tool=eq.' + encodeURIComponent(tool) +
    '&pfad=eq.' + encodeURIComponent(pfad) + '&geloescht=is.false');
  return (r && r[0]) || null;
}

module.exports = {
  BUCKET, TOOLS, DATEIEN, PFAD_RE, SAMMLUNG_RE, ASSET_RE, TYPEN,
  json, body, neueId, assetPfad, signierteUrl, signierteUrls, uploadUrl, dateienLoeschen, docLesen,
  speichern, lesen,
  rest: dc.rest, rpc: dc.rpc, esc: dc.esc, dc
};
