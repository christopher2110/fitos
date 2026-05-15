// lib/drive/sheets-provision.js
// Owns: provisioning a new FitOS Sheet from a template via Drive files.copy,
//       sharing the copy with the requesting coach (editor), creating missing tabs.
// Does NOT own: DB writes, HTTP handling, auth for BYOK coaches.

const { google } = require('googleapis');
const { getAuth } = require('../sheets/client');

// All tabs the FitOS template must contain.
const REQUIRED_TABS = [
  'Clients', 'Workouts', 'CheckIns', 'Exercises',
  'Messages', 'ActivityFeed', 'Settings', 'Profile',
];

/**
 * Copy the Polsia-managed FitOS template Sheet into the service account's Drive,
 * then share it with the coach (editor access, notify = false).
 *
 * @param {string} coachName   Pre-fills the copy title so the coach can identify it.
 * @param {string} coachEmail  If provided, Sheet is shared with this address as editor.
 * @returns {Promise<{sheetId: string, sheetUrl: string}>}
 */
async function provisionSheet(coachName, coachEmail) {
  const templateId = process.env.FITOS_TEMPLATE_SHEET_ID;
  if (!templateId) {
    throw new Error('FITOS_TEMPLATE_SHEET_ID env var not set. Cannot provision Sheet.');
  }

  const auth  = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  // 1. Copy the template
  const title = coachName ? `FitOS — ${coachName}` : 'FitOS Coaching Sheet';
  const copy = await drive.files.copy({
    fileId: templateId,
    requestBody: { name: title },
    fields: 'id, webViewLink',
  });

  const sheetId  = copy.data.id;
  const sheetUrl = copy.data.webViewLink;

  // 2. Share with the coach email (editor, no notification — coach will see it via FitOS)
  if (coachEmail) {
    try {
      await drive.permissions.create({
        fileId: sheetId,
        sendNotificationEmail: false,
        requestBody: {
          role: 'writer',
          type: 'user',
          emailAddress: coachEmail,
        },
      });
    } catch (_) {
      // Non-fatal — coach can still access via FitOS; share failure is cosmetic.
    }
  }

  return { sheetId, sheetUrl };
}

/**
 * Check that all required tabs exist in the given Sheet.
 * Creates any missing tabs using the Sheets API.
 * Returns a list of tab names that were auto-created (empty = all present).
 *
 * @param {string} sheetId
 * @param {object} [authOverride]  Optional GoogleAuth instance (for BYOK validation)
 * @returns {Promise<string[]>}  Names of tabs that were created.
 */
async function ensureRequiredTabs(sheetId, authOverride) {
  const auth   = authOverride || getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Get existing sheet tab names
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets.properties.title',
  });
  const existing = (meta.data.sheets || []).map(s => s.properties.title);
  const missing  = REQUIRED_TABS.filter(t => !existing.includes(t));

  if (missing.length === 0) return [];

  // Batch add missing tabs
  const requests = missing.map(title => ({
    addSheet: { properties: { title } },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests },
  });

  return missing;
}

/**
 * Run a test write + delete to confirm the service account has edit access.
 * Used for BYOK validation where we can't rely on our own service account owning the sheet.
 *
 * @param {string} sheetId
 * @param {object} [authOverride]
 * @returns {Promise<void>}  Throws on failure.
 */
async function testWriteAccess(sheetId, authOverride) {
  const auth   = authOverride || getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Write a sentinel value to a safe cell in Settings tab (or fallback to Sheet1)
  const range = 'Settings!Z1';
  const sentinel = `fitos-test-${Date.now()}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [[sentinel]] },
  });

  // Clear it immediately — leaves no trace
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range,
  });
}

/**
 * Build a GoogleAuth instance from a parsed service-account JSON object.
 * Used for BYOK path where the coach provides their own credentials.
 */
function buildByokAuth(credentialsObj) {
  return new google.auth.GoogleAuth({
    credentials: credentialsObj,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
}

module.exports = { provisionSheet, ensureRequiredTabs, testWriteAccess, buildByokAuth, REQUIRED_TABS };
