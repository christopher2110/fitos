// lib/sheets/video-candidates.js
// Owns: VideoCandidates sheet tab — persistent cache of search results per exercise.
//       Enables instant swap picker without burning YouTube API quota on repeat opens.
// Does NOT own: YouTube API calls, HTTP routing, Exercise CRUD

const { getTabValues, appendRows } = require('./client');
const { google }                    = require('googleapis');
const { getAuth }                   = require('./client');

const TAB   = 'VideoCandidates';
const RANGE = `${TAB}!A2:G5000`;

// Tab columns (0-indexed):
// 0: exercise_id, 1: exercise_name, 2: video_url, 3: video_id,
// 4: channel_name, 5: searched_at, 6: rank (1-3 = candidates, 0 = chosen)

function rowToCandidate(row) {
  return {
    exercise_id:   (row[0] || '').trim(),
    exercise_name: (row[1] || '').trim(),
    video_url:     (row[2] || '').trim(),
    video_id:      (row[3] || '').trim(),
    channel_name:  (row[4] || '').trim(),
    searched_at:   (row[5] || '').trim(),
    rank:          parseInt(row[6] || '0', 10),
  };
}

/**
 * List all cached candidates for a given exercise id.
 * Returns up to 3 candidates (rank 1-3) sorted by rank.
 */
async function getCandidates(sheetId, exerciseId) {
  if (!sheetId) return [];
  let rows;
  try {
    rows = await getTabValues(sheetId, RANGE);
  } catch (_) {
    return [];
  }
  if (!rows || rows.length === 0) return [];

  return rows
    .map(r => rowToCandidate(r))
    .filter(c => c.exercise_id === exerciseId && c.video_url && c.rank > 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3);
}

/**
 * Save candidate search results for an exercise (overwrites any existing ones).
 * candidates: array of { video_url, video_id, channel_name }  (up to 3)
 */
async function saveCandidates(sheetId, exerciseId, exerciseName, candidates) {
  if (!sheetId || !candidates || candidates.length === 0) return;

  // First, load existing rows and remove old candidates for this exercise
  let rows;
  try {
    rows = await getTabValues(sheetId, RANGE);
  } catch (_) {
    rows = [];
  }

  const sheets   = google.sheets({ version: 'v4', auth: getAuth() });
  const now      = new Date().toISOString();

  // Find existing rows for this exercise and clear them
  if (rows && rows.length > 0) {
    const toClear = [];
    rows.forEach((row, i) => {
      if ((row[0] || '').trim() === exerciseId) {
        toClear.push(i + 2); // 1-based sheet row
      }
    });
    for (const sheetRow of toClear) {
      try {
        await sheets.spreadsheets.values.clear({
          spreadsheetId: sheetId,
          range: `${TAB}!A${sheetRow}:G${sheetRow}`,
        });
      } catch (_) { /* non-fatal */ }
    }
  }

  // Append new candidate rows
  const newRows = candidates.slice(0, 3).map((c, i) => [
    exerciseId,
    exerciseName,
    c.video_url || '',
    c.video_id  || '',
    c.channel_name || '',
    now,
    i + 1, // rank 1-3
  ]);

  try {
    await appendRows(sheetId, `${TAB}!A:G`, newRows);
  } catch (err) {
    // If tab doesn't exist, silently skip — the cache is optional
    if (err.message && err.message.includes('Unable to parse range')) return;
    throw err;
  }
}

/**
 * Ensure the VideoCandidates tab exists in the sheet.
 * Creates it with a header row if missing. Safe to call multiple times.
 */
async function ensureCandidatesTab(sheetId) {
  if (!sheetId) return;
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });

  // Check if tab exists
  let meta;
  try {
    meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties.title' });
  } catch (_) {
    return; // can't check — skip
  }

  const titles = (meta.data.sheets || []).map(s => s.properties.title);
  if (titles.includes(TAB)) return;

  // Add the sheet
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: TAB } } }],
      },
    });
    // Write header row
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${TAB}!A1:G1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['exercise_id','exercise_name','video_url','video_id','channel_name','searched_at','rank']] },
    });
  } catch (_) {
    // Tab creation failed — cache is optional, don't break the caller
  }
}

module.exports = { getCandidates, saveCandidates, ensureCandidatesTab };
