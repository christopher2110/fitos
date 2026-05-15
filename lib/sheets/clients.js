// lib/sheets/clients.js
// Owns: Clients tab CRUD on coach's Google Sheet — list, add, ensure tab exists
// Does NOT own: HTTP handling, Sheets auth (delegated to client.js)

const { google } = require('googleapis');
const { getAuth, getTabValues, appendRows } = require('./client');

/**
 * Ensure the Clients tab exists on the sheet. Creates it with headers if missing.
 * Columns: Name | Email | Program | Start Date | Status | Notes | Added
 */
async function ensureClientsTab(sheetId) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'sheets.properties.title',
    });
    const titles = meta.data.sheets.map(s => s.properties.title);
    if (titles.includes('Clients')) return;
  } catch (_) {
    // If we can't read metadata, try creating anyway
  }

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: 'Clients' } } }],
      },
    });
    // Write header row
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Clients!A1:G1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [['Name', 'Email', 'Program', 'Start Date', 'Status', 'Notes', 'Added']],
      },
    });
  } catch (err) {
    // Tab already exists (race condition) — safe to ignore
    if (!err.message?.includes('already exists')) throw err;
  }
}

/**
 * List all clients from the Clients tab.
 * Returns array of { id, name, email, program, startDate, status, notes, added }
 */
async function getClientList(sheetId) {
  try {
    const rows = await getTabValues(sheetId, 'Clients!A2:G500');
    return rows
      .map((r, idx) => ({
        id: idx + 1,
        name: (r[0] || '').trim(),
        email: (r[1] || '').trim(),
        program: (r[2] || '').trim(),
        startDate: (r[3] || '').trim(),
        status: (r[4] || 'Active').trim(),
        notes: (r[5] || '').trim(),
        added: (r[6] || '').trim(),
      }))
      .filter(c => c.name);
  } catch (_) {
    // Tab may not exist yet — return empty list
    return [];
  }
}

/**
 * Add a new client to the Clients tab.
 * Creates the tab automatically if it doesn't exist.
 */
async function addClient(sheetId, { name, email, program, notes }) {
  await ensureClientsTab(sheetId);
  const now = new Date().toISOString().split('T')[0];
  await appendRows(sheetId, 'Clients!A:G', [
    [name, email || '', program || '', now, 'Active', notes || '', now],
  ]);
  return { ok: true, name, addedAt: now };
}

module.exports = { getClientList, addClient, ensureClientsTab };
