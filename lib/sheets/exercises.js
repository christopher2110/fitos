// lib/sheets/exercises.js
// Owns: Exercises tab CRUD — read, write, update, delete exercises with video URLs
// Does NOT own: HTTP handling, auth, trusted channel config (stored in Profile tab), PWA routing

const { getTabValues, appendRows } = require('./client');
const { google } = require('googleapis');
const { getAuth } = require('./client');

// Exercises tab columns (0-indexed):
// 0: id, 1: name, 2: category, 3: primary_muscle, 4: equipment,
// 5: video_url, 6: coach_notes, 7: created_at, 8: updated_at

const COL = { id: 0, name: 1, category: 2, primary_muscle: 3, equipment: 4, video_url: 5, coach_notes: 6, created_at: 7, updated_at: 8 };
const TAB  = 'Exercises';
const RANGE = `${TAB}!A2:I2000`;

function rowToExercise(row, rowIndex) {
  return {
    id:             (row[COL.id]             || '').trim(),
    name:           (row[COL.name]           || '').trim(),
    category:       (row[COL.category]       || '').trim(),
    primary_muscle: (row[COL.primary_muscle] || '').trim(),
    equipment:      (row[COL.equipment]      || '').trim(),
    video_url:      (row[COL.video_url]      || '').trim(),
    coach_notes:    (row[COL.coach_notes]    || '').trim(),
    created_at:     (row[COL.created_at]     || '').trim(),
    updated_at:     (row[COL.updated_at]     || '').trim(),
    _rowIndex: rowIndex + 2, // 1-based sheet row (data starts at row 2)
  };
}

/**
 * List all exercises from the Exercises tab.
 * Returns array of exercise objects. Empty array if tab not found or empty.
 */
async function listExercises(sheetId) {
  let rows;
  try {
    rows = await getTabValues(sheetId, RANGE);
  } catch (err) {
    // Tab doesn't exist yet — return empty
    if (err.message && err.message.includes('Unable to parse range')) return [];
    throw err;
  }
  if (!rows || rows.length === 0) return [];
  return rows
    .map((row, i) => rowToExercise(row, i))
    .filter(e => e.id && e.name); // skip blank rows
}

/**
 * Add exercises to the Exercises tab (appends rows).
 * Each exercise: { id, name, category, primary_muscle, equipment, video_url, coach_notes }
 * id + created_at + updated_at are auto-filled if not provided.
 */
async function addExercises(sheetId, exercises) {
  if (!exercises || exercises.length === 0) return;
  const now = new Date().toISOString();
  const rows = exercises.map(ex => [
    ex.id         || `ex_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ex.name        || '',
    ex.category    || '',
    ex.primary_muscle || '',
    ex.equipment   || '',
    ex.video_url   || '',
    ex.coach_notes || '',
    ex.created_at  || now,
    ex.updated_at  || now,
  ]);
  await appendRows(sheetId, `${TAB}!A:I`, rows);
}

/**
 * Update a single exercise row by id.
 * Only updates changed fields. Returns true if found and updated.
 */
async function updateExercise(sheetId, id, updates) {
  let rows;
  try {
    rows = await getTabValues(sheetId, RANGE);
  } catch (_) {
    return false;
  }
  if (!rows) return false;

  // Find the row index (0-based in array → sheet row = index + 2)
  const idx = rows.findIndex(row => (row[COL.id] || '').trim() === id);
  if (idx === -1) return false;

  const row    = rows[idx];
  const sheetRow = idx + 2;
  const now    = new Date().toISOString();

  const newRow = [
    row[COL.id]             || id,
    updates.name           !== undefined ? updates.name           : (row[COL.name]           || ''),
    updates.category       !== undefined ? updates.category       : (row[COL.category]       || ''),
    updates.primary_muscle !== undefined ? updates.primary_muscle : (row[COL.primary_muscle] || ''),
    updates.equipment      !== undefined ? updates.equipment      : (row[COL.equipment]      || ''),
    updates.video_url      !== undefined ? updates.video_url      : (row[COL.video_url]      || ''),
    updates.coach_notes    !== undefined ? updates.coach_notes    : (row[COL.coach_notes]    || ''),
    row[COL.created_at]    || now,
    now,
  ];

  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${TAB}!A${sheetRow}:I${sheetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [newRow] },
  });
  return true;
}

/**
 * Delete an exercise by id (clears the entire row).
 * Returns true if found and deleted.
 */
async function deleteExercise(sheetId, id) {
  let rows;
  try {
    rows = await getTabValues(sheetId, RANGE);
  } catch (_) {
    return false;
  }
  if (!rows) return false;

  const idx = rows.findIndex(row => (row[COL.id] || '').trim() === id);
  if (idx === -1) return false;

  const sheetRow = idx + 2;
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  // Clear the row content (doesn't delete the row from the sheet, but empties it)
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `${TAB}!A${sheetRow}:I${sheetRow}`,
  });
  return true;
}

/**
 * Read the trusted YouTube channels list from the Profile tab.
 * Stored as key=value rows under section header "Trusted YouTube Channels".
 * Format: "channel:<display_name>" = "<channel_id>"
 *
 * Returns array of { id, name } objects.
 */
async function getTrustedChannels(sheetId) {
  let rows;
  try {
    rows = await getTabValues(sheetId, 'Profile!A2:D200');
  } catch (_) {
    return defaultChannels();
  }
  if (!rows || rows.length === 0) return defaultChannels();

  const channels = [];
  let inSection = false;

  for (const row of rows) {
    const key = (row[0] || '').trim();
    const val = (row[1] || '').trim();

    if (key === 'Trusted YouTube Channels') { inSection = true; continue; }
    if (inSection) {
      if (!key) break; // blank row = end of section
      if (key.startsWith('channel:')) {
        channels.push({ id: val, name: key.replace('channel:', '') });
      }
    }
  }

  return channels.length > 0 ? channels : defaultChannels();
}

/**
 * Save the trusted YouTube channels list to the Profile tab.
 * Overwrites the existing "Trusted YouTube Channels" section.
 */
async function saveTrustedChannels(sheetId, channels) {
  let rows;
  try {
    rows = await getTabValues(sheetId, 'Profile!A2:D200');
  } catch (_) {
    rows = [];
  }

  const sheets = google.sheets({ version: 'v4', auth: getAuth() });

  // Find the section start row in the sheet
  let sectionStart = -1;
  let sectionEnd   = -1;

  for (let i = 0; i < (rows || []).length; i++) {
    const key = (rows[i][0] || '').trim();
    if (key === 'Trusted YouTube Channels') {
      sectionStart = i + 2; // 1-based sheet row (data starts row 2, so +2)
      // Find end: next blank key after section start
      for (let j = i + 1; j < rows.length; j++) {
        if (!(rows[j][0] || '').trim()) { sectionEnd = j + 2; break; }
      }
      break;
    }
  }

  if (sectionStart === -1) {
    // Append to Profile tab
    const newRows = [
      ['Trusted YouTube Channels', ''],
      ...channels.map(ch => [`channel:${ch.name}`, ch.id]),
      ['', ''],
    ];
    await appendRows(sheetId, 'Profile!A:D', newRows);
  } else {
    // Clear existing section and rewrite
    const clearEnd = sectionEnd !== -1 ? sectionEnd : sectionStart + channels.length + 2;
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `Profile!A${sectionStart}:B${clearEnd}`,
    });
    const newRows = [
      ['Trusted YouTube Channels', ''],
      ...channels.map(ch => [`channel:${ch.name}`, ch.id]),
    ];
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Profile!A${sectionStart}:B${sectionStart + newRows.length - 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: newRows },
    });
  }
}

function defaultChannels() {
  return [
    { id: 'UCIpNp8jFKVPbxbEYVQeP1WA', name: 'Squat University' },
    { id: 'UC68TLK0mAEzUyHu6FqnGBxg', name: 'Jeff Nippard' },
    { id: 'UCfQgsKhHjSyRLOp9mnffqVg', name: 'Renaissance Periodization' },
    { id: 'UCe6h508ajpVYMDNxbQ_YzBg', name: 'NASM' },
    { id: 'UCe0TLA0EsQbE-MjuHXevPRg', name: 'ATHLEAN-X' },
  ];
}

module.exports = { listExercises, addExercises, updateExercise, deleteExercise, getTrustedChannels, saveTrustedChannels };
