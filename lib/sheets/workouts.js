// lib/sheets/workouts.js
// Owns: workout data read/write against the FitOS Google Sheets schema
// Does NOT own: HTTP handling, auth, raw Sheets API calls (those are in client.js)

const { getTabValues, appendRows } = require('./client');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse "RPE 7" or "RPE7" or "rpe 7.5" → float. Returns null if not found. */
function parseRpe(load) {
  if (!load) return null;
  const m = String(load).match(/RPE\s*(\d+(?:\.\d+)?)/i);
  return m ? parseFloat(m[1]) : null;
}

/** Today as YYYY-MM-DD in the local server timezone. */
function todayIso() {
  return new Date().toISOString().split('T')[0];
}

/** Full day name for a Date object: "Monday", "Tuesday", etc. */
function dayNameForDate(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

/** Full day name for today: "Monday", "Tuesday", etc. */
function todayDayName() {
  return dayNameForDate(new Date());
}

/**
 * Calculate which program week a given date falls in, given the program start date string.
 * Returns 1 for the first week, 2 for the second, etc.
 * Returns 1 if either date can't be parsed (safe fallback).
 *
 * @param {string} programStartDateStr  YYYY-MM-DD
 * @param {Date}   [asOf]               target date (defaults to now)
 */
function currentWeekNumber(programStartDateStr, asOf) {
  try {
    const start  = new Date(programStartDateStr);
    const target = asOf || new Date();
    if (isNaN(start) || isNaN(target)) return 1;
    const diffMs   = target.getTime() - start.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.floor(diffDays / 7) + 1);
  } catch (_) {
    return 1;
  }
}

/**
 * Parse the Profile tab (key→value rows) into a plain object.
 * Profile layout: col A = Field label, col B = Value.
 */
function parseProfileRows(rows) {
  const profile = {};
  for (const row of rows) {
    const field = (row[0] || '').trim();
    if (field) profile[field] = (row[1] || '').trim();
  }
  return profile;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch the workout for a specific date from the Program tab.
 * Returns null if no exercises are scheduled for that day.
 *
 * @param {string} sheetId
 * @param {string} dateStr  YYYY-MM-DD string (defaults to today)
 *
 * Shape returned:
 *   { date, title, weekNum, dayName, coachNote: { coach, initial, message }, exercises: [...] }
 *
 * Each exercise:
 *   { id, name, sets, reps, rpe, note, videoUrl, clientNotes }
 */
async function getWorkoutForDate(sheetId, dateStr) {
  const targetDate = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const targetIso  = targetDate.toISOString().split('T')[0];

  // 1. Read Profile
  const profileRows = await getTabValues(sheetId, 'Profile!A2:D50');
  const profile = parseProfileRows(profileRows);

  const coachName = profile['Coach Name'] || 'Coach';
  const programStartDate = profile['Program Start Date'] || targetIso;

  // 2. Determine program week for target date and day name
  const weekNum = currentWeekNumber(programStartDate, targetDate);
  const dayName = dayNameForDate(targetDate);

  // 3. Read Program tab
  // Headers: Week, Phase, Day, Focus, Exercise, Sets, Reps/Duration, Load, Rest(s), Tempo, Cues/Notes
  const programRows = await getTabValues(sheetId, 'Program!A2:K500');
  if (!programRows.length) return null;

  const dayRows = programRows.filter(row => {
    return parseInt(row[0]) === weekNum && (row[2] || '').trim() === dayName;
  });
  if (!dayRows.length) return null;

  const focus = (dayRows[0][3] || 'Training').trim();

  const exercises = dayRows.map((row, i) => ({
    id: i,
    name: (row[4] || 'Exercise').trim(),
    sets: parseInt(row[5]) || 3,
    reps: (row[6] || '8').trim(),
    rpe: parseRpe(row[7]),
    note: (row[10] || '').trim(),
    videoUrl: null,
    clientNotes: '',
  }));

  // 4. Pull coach note from KPIs tab (Coach Notes = col 17, index 16, 1-based col Q)
  let coachNoteText = '';
  try {
    const kpiRows = await getTabValues(sheetId, 'KPIs!A2:Q200');
    const weekRow = kpiRows.find(r => parseInt(r[0]) === weekNum);
    if (weekRow && weekRow[16]) coachNoteText = weekRow[16].trim();
  } catch (_) {
    // KPIs tab missing or empty — non-fatal
  }

  // Friendly display name: "Coach Alex" → "Alex"
  const displayName = coachName.replace(/^Coach\s+/i, '').trim() || 'Coach';
  const initial = displayName.charAt(0).toUpperCase();

  return {
    date: targetIso,
    title: focus,
    weekNum,
    dayName,
    coachNote: {
      coach: displayName,
      initial,
      message: coachNoteText || `Week ${weekNum} — ${focus}. Let's get it! 💪`,
    },
    exercises,
  };
}

/**
 * Fetch today's workout — convenience wrapper over getWorkoutForDate.
 */
async function getTodaysWorkout(sheetId) {
  return getWorkoutForDate(sheetId, todayIso());
}

/**
 * Read existing completions for a given date from the Workouts tab.
 * Returns a map: exerciseName → { weight, rpe, status, notes, completed }
 * Used to restore checkbox/weight state on page load or day switch.
 *
 * Workouts tab columns (0-indexed):
 *   0: Date, 1: Week, 2: Day, 3: Exercise, 4: Set#, 5: Reps,
 *   6: Weight(kg), 7: RPE, 8: Volume, 9: Status, 10: Notes
 *
 * @param {string} sheetId
 * @param {string} [dateStr]  YYYY-MM-DD (defaults to today)
 */
async function getCompletionsForDate(sheetId, dateStr) {
  const targetDate = dateStr || todayIso();
  const rows = await getTabValues(sheetId, 'Workouts!A2:K2000');
  const completions = {};

  for (const row of rows) {
    if ((row[0] || '').trim() !== targetDate) continue;
    const exercise = (row[3] || '').trim();
    if (!exercise) continue;
    // Only store the first matching row per exercise (most recent write wins on subsequent calls)
    if (!completions[exercise]) {
      completions[exercise] = {
        weight: row[6] !== undefined && row[6] !== '' ? parseFloat(row[6]) : null,
        rpe: row[7] !== undefined && row[7] !== '' ? parseFloat(row[7]) : null,
        status: (row[9] || '').trim(),
        notes: (row[10] || '').trim(),
        completed: ['Completed', 'PR', 'Modified'].includes((row[9] || '').trim()),
      };
    }
  }
  return completions;
}

/**
 * Read today's existing completions — convenience wrapper over getCompletionsForDate.
 */
async function getTodaysCompletions(sheetId) {
  return getCompletionsForDate(sheetId, todayIso());
}

/**
 * Append a completion record to the Workouts tab.
 * Writes one row per set (matching the schema's per-set logging model).
 *
 * @param {string} sheetId
 * @param {object} opts
 *   exercise  {string}  exercise name
 *   sets      {number}  total sets
 *   reps      {string}  target reps/duration string
 *   weight    {number|null}  weight in kg (null if not entered)
 *   rpe       {number|null}  RPE 1–10
 *   status    {string}  "Completed"|"Skipped"|"Modified"|"PR"
 *   notes     {string}  client's comment
 *   weekNum   {number}  current program week
 *   dayName   {string}  "Monday" etc.
 */
async function recordCompletion(sheetId, { exercise, sets, reps, weight, rpe, status, notes, weekNum, dayName }) {
  const today = todayIso();
  const safeWeight = (weight !== null && weight !== undefined && weight !== '') ? parseFloat(weight) : '';
  const safeRpe = (rpe !== null && rpe !== undefined && rpe !== '') ? parseFloat(rpe) : '';
  const safeReps = reps || '';

  const rowsToAppend = [];
  const totalSets = parseInt(sets) || 1;

  for (let s = 1; s <= totalSets; s++) {
    // Volume = reps × weight; leave as formula so Sheet auto-calculates
    const volume = (safeWeight !== '' && safeReps !== '') ? parseFloat(safeWeight) * parseFloat(safeReps) : '';
    rowsToAppend.push([
      today,
      weekNum || 1,
      dayName || '',
      exercise,
      s,
      safeReps,
      safeWeight,
      safeRpe,
      volume,
      status || 'Completed',
      s === 1 ? (notes || '') : '', // notes only on first set row to avoid duplication
    ]);
  }

  await appendRows(sheetId, 'Workouts!A:K', rowsToAppend);
}

module.exports = { getWorkoutForDate, getTodaysWorkout, getCompletionsForDate, getTodaysCompletions, recordCompletion };
