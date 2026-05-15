// lib/sheets/checkins.js
// Owns: check-in read/write against the FitOS CheckIns and Activity tabs
// Does NOT own: HTTP handling, auth, photo storage (Drive), raw Sheets API calls

const { appendRows } = require('./client');

/** Today as YYYY-MM-DD in server timezone. */
function todayIso() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Append a check-in record to the CheckIns tab and an event row to Activity.
 *
 * CheckIns tab columns (schema order, 0-indexed):
 *   0  Date
 *   1  Week
 *   2  Bodyweight (kg)
 *   3  Body Fat %          — empty on client submit
 *   4  Waist (cm)          — empty on client submit
 *   5  Hips (cm)           — empty on client submit
 *   6  Chest (cm)          — empty on client submit
 *   7  L Arm (cm)          — empty on client submit
 *   8  R Arm (cm)          — empty on client submit
 *   9  L Thigh (cm)        — empty on client submit
 *   10 R Thigh (cm)        — empty on client submit
 *   11 Photo Front URL
 *   12 Photo Side URL      — empty on client submit
 *   13 Mood (1-10)         — empty on client submit
 *   14 Sleep Quality (1-10)
 *   15 Energy (1-10)
 *   16 Stress (1-10)
 *   17 Client Notes        — includes soreness if provided
 *   18 Coach Feedback      — empty on client submit
 *   19 Compliance %        — empty on client submit
 *
 * @param {string} sheetId  Google Sheet ID
 * @param {object} payload
 *   date         {string}        ISO date string (defaults to today)
 *   sleep        {number|null}   1–10
 *   energy       {number|null}   1–10
 *   soreness     {number|null}   1–10 (appended to notes; no dedicated column)
 *   stress       {number|null}   1–10
 *   bodyweight   {number|null}   in kg (caller normalises from lb if needed)
 *   notes        {string}        free text
 *   photoUrl     {string|null}   Drive share URL for Photo Front URL column
 *
 * @returns {Promise<void>}
 */
async function recordCheckIn(sheetId, payload) {
  const {
    date = todayIso(),
    sleep = null,
    energy = null,
    soreness = null,
    stress = null,
    bodyweight = null,
    notes = '',
    photoUrl = null,
    measurements = {},
  } = payload;

  const m = measurements || {};

  // Helper: null-safe numeric column value
  function measureVal(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    return isNaN(n) ? '' : n;
  }

  // Compose client notes — prepend soreness rating if provided
  const clientNotes = soreness != null
    ? `Soreness: ${soreness}/10${notes ? '. ' + notes : ''}`
    : (notes || '');

  const row = [
    date,         // 0 Date
    '',           // 1 Week — not tracked by the mobile client
    bodyweight !== null && bodyweight !== '' ? Number(bodyweight) : '',  // 2 Bodyweight (kg)
    '',                    // 3 Body Fat % — not tracked by mobile client
    measureVal(m.waist),   // 4 Waist (cm)
    measureVal(m.hip),     // 5 Hips (cm)
    measureVal(m.chest),   // 6 Chest (cm)
    measureVal(m.larm),    // 7 L Arm (cm)
    measureVal(m.rarm),    // 8 R Arm (cm)
    measureVal(m.lthigh),  // 9 L Thigh (cm)
    measureVal(m.rthigh),  // 10 R Thigh (cm)
    photoUrl || '',  // 11 Photo Front URL
    '',              // 12 Photo Side URL
    '',              // 13 Mood
    sleep  !== null ? Number(sleep)  : '',   // 14 Sleep Quality
    energy !== null ? Number(energy) : '',   // 15 Energy
    stress !== null ? Number(stress) : '',   // 16 Stress
    clientNotes,     // 17 Client Notes
    '',              // 18 Coach Feedback
    '',              // 19 Compliance %
  ];

  await appendRows(sheetId, 'CheckIns!A:T', [row]);

  // Activity tab — surfaces the check-in on the coach dashboard feed
  // Columns: Date, Activity Type, Duration (min), Intensity, Calories, HR Avg, Distance (km), Notes
  const activityRow = [
    date,
    'Other',
    5,           // 5 minutes to complete check-in
    'Low',
    '', '', '',
    'Check-in logged',
  ];

  await appendRows(sheetId, 'Activity!A:H', [activityRow]);
}

module.exports = { recordCheckIn };
