// lib/skills/keystore.js
// Owns: Encrypting/decrypting the coach's Anthropic API key stored in the Profile tab
// Does NOT own: Sheet auth, HTTP handling, skill execution

const crypto = require('crypto');
const { getTabValues, appendRows } = require('../sheets/client');

// Profile tab layout: col A = Field label, col B = Value
// The key is stored at the row with Field = "anthropic_api_key"
const PROFILE_RANGE = 'Profile!A2:B100';
const FIELD_NAME    = 'anthropic_api_key';
const ALGO          = 'aes-256-gcm';

// Encryption secret: 32-byte key derived from FITOS_KEY_SECRET env var (or fallback for dev)
// In production, set FITOS_KEY_SECRET in Render env vars.
function getSecret() {
  const raw = process.env.FITOS_KEY_SECRET || 'fitos-dev-secret-key-do-not-ship';
  // Derive exactly 32 bytes via SHA-256
  return crypto.createHash('sha256').update(raw).digest();
}

/**
 * Encrypt a string using AES-256-GCM.
 * Returns a base64 string: iv(12B) + authTag(16B) + ciphertext, all concatenated.
 */
function encrypt(plaintext) {
  const iv  = crypto.randomBytes(12);
  const key = getSecret();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag  = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * Decrypt a base64 string produced by encrypt().
 * Throws if the ciphertext has been tampered with.
 */
function decrypt(b64) {
  const buf    = Buffer.from(b64, 'base64');
  const iv     = buf.subarray(0, 12);
  const tag    = buf.subarray(12, 28);
  const enc    = buf.subarray(28);
  const key    = getSecret();
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/**
 * Read and decrypt the coach's Anthropic API key from their Sheet.
 * Returns null if the key has not been saved yet.
 */
async function getAnthropicKey(sheetId) {
  const rows = await getTabValues(sheetId, PROFILE_RANGE);
  for (const row of rows) {
    if ((row[0] || '').trim() === FIELD_NAME && row[1]) {
      try { return decrypt(row[1].trim()); } catch (_) { return null; }
    }
  }
  return null;
}

/**
 * Encrypt and upsert the Anthropic API key into the Profile tab.
 * If the row already exists it is overwritten via batchUpdate; otherwise appended.
 * This keeps the Profile tab clean (one row per field).
 *
 * Uses the raw googleapis client because we need sheets.spreadsheets.values.update
 * (range-targeted write, not append).
 */
async function saveAnthropicKey(sheetId, plainKey) {
  const { google } = require('googleapis');
  const { getAuth } = require('../sheets/client');

  const encrypted = encrypt(plainKey);
  const rows = await getTabValues(sheetId, PROFILE_RANGE);

  // Find the row index (1-based within the data range, 2-based from sheet row 1)
  const rowIndex = rows.findIndex(r => (r[0] || '').trim() === FIELD_NAME);

  const sheets = google.sheets({ version: 'v4', auth: getAuth() });

  if (rowIndex >= 0) {
    // Overwrite existing row (row 2 = index 0, so sheetRow = rowIndex + 2)
    const sheetRow = rowIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Profile!A${sheetRow}:B${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[FIELD_NAME, encrypted]] },
    });
  } else {
    // Append new row — direct append to Profile tab
    await appendRows(sheetId, 'Profile!A:B', [[FIELD_NAME, encrypted]]);
  }
}

/**
 * Read enabled_skills JSON from Profile tab.
 * Returns an object like { "weekly-checkin-summary": true, ... }
 */
async function getEnabledSkills(sheetId) {
  const rows = await getTabValues(sheetId, PROFILE_RANGE);
  for (const row of rows) {
    if ((row[0] || '').trim() === 'enabled_skills' && row[1]) {
      try { return JSON.parse(row[1].trim()); } catch (_) { return {}; }
    }
  }
  return {};
}

/**
 * Save enabled_skills JSON to Profile tab.
 * @param {string} sheetId
 * @param {object} enabled  e.g. { "weekly-checkin-summary": true }
 */
async function saveEnabledSkills(sheetId, enabled) {
  const { google } = require('googleapis');
  const { getAuth } = require('../sheets/client');

  const rows = await getTabValues(sheetId, PROFILE_RANGE);
  const rowIndex = rows.findIndex(r => (r[0] || '').trim() === 'enabled_skills');
  const value = JSON.stringify(enabled);
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });

  if (rowIndex >= 0) {
    const sheetRow = rowIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Profile!A${sheetRow}:B${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [['enabled_skills', value]] },
    });
  } else {
    await appendRows(sheetId, 'Profile!A:B', [['enabled_skills', value]]);
  }
}

module.exports = { getAnthropicKey, saveAnthropicKey, getEnabledSkills, saveEnabledSkills };
