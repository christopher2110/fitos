// lib/sheets/client.js
// Owns: Google Sheets API auth and low-level tab read/write
// Does NOT own: data transformation, workout logic, HTTP handling

const { google } = require('googleapis');

// Auth singleton — built once from env, reused for all requests
let _auth = null;

function getAuth() {
  if (_auth) return _auth;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set');
  const credentials = JSON.parse(keyJson);
  _auth = new google.auth.GoogleAuth({
    credentials,
    // Both scopes: spreadsheets for read/write, drive for photo uploads
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  return _auth;
}

// In-memory read cache: cacheKey → { data, expires }
// 30-second TTL — keeps reads fast during dev without hammering quota
const _cache = new Map();
const CACHE_TTL_MS = 30_000;

/**
 * Read a range from a Google Sheet.
 * Returns a 2D array of cell values (rows × cols).
 */
async function getTabValues(sheetId, range) {
  const cacheKey = `${sheetId}:${range}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() < cached.expires) return cached.data;

  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });
  const data = res.data.values || [];
  _cache.set(cacheKey, { data, expires: Date.now() + CACHE_TTL_MS });
  return data;
}

/**
 * Append rows to a sheet tab.
 * values: array of arrays (one inner array = one row).
 * Invalidates the read cache for this sheet.
 */
async function appendRows(sheetId, range, values) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'USER_ENTERED', // lets the Sheet parse dates/formulas
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  // Purge all cached reads for this sheet so next read is fresh
  for (const key of _cache.keys()) {
    if (key.startsWith(`${sheetId}:`)) _cache.delete(key);
  }
}

// Exported so Drive utilities can reuse the same auth singleton
module.exports = { getAuth, getTabValues, appendRows };
