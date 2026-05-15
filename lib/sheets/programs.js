// lib/sheets/programs.js
// Owns: Program tab CRUD — reading full program structure and writing new exercises
// Does NOT own: HTTP handling, auth, Profile tab parsing, workout completions

const { getTabValues, appendRows } = require('./client');

/**
 * Read the full Program tab and return exercises grouped by week → day.
 * Program tab columns (0-indexed):
 *   0: Week, 1: Phase, 2: Day, 3: Focus, 4: Exercise,
 *   5: Sets, 6: Reps/Duration, 7: Load, 8: Rest(s), 9: Tempo, 10: Cues/Notes
 *
 * @param {string} sheetId
 * @returns {{ weeks: Object[], meta: { totalWeeks, phases } }}
 */
async function getFullProgram(sheetId) {
  const rows = await getTabValues(sheetId, 'Program!A2:K500');

  if (!rows || rows.length === 0) {
    return { weeks: [], meta: { totalWeeks: 0, phases: [] } };
  }

  // Group by week number
  const weekMap = {};
  const phases = new Set();

  for (const row of rows) {
    const week = parseInt(row[0]) || 1;
    const phase = (row[1] || '').trim();
    const day = (row[2] || '').trim();
    const focus = (row[3] || '').trim();
    const exercise = (row[4] || '').trim();

    if (!exercise) continue; // Skip empty rows

    if (phase) phases.add(phase);

    if (!weekMap[week]) weekMap[week] = { week, phase, days: {} };
    if (!weekMap[week].days[day]) {
      weekMap[week].days[day] = { day, focus, exercises: [] };
    }

    weekMap[week].days[day].exercises.push({
      name: exercise,
      sets: (row[5] || '').trim(),
      reps: (row[6] || '').trim(),
      load: (row[7] || '').trim(),
      rest: (row[8] || '').trim(),
      tempo: (row[9] || '').trim(),
      notes: (row[10] || '').trim(),
    });
  }

  // Convert to sorted array
  const weeks = Object.values(weekMap)
    .sort((a, b) => a.week - b.week)
    .map(w => ({
      ...w,
      days: Object.values(w.days),
    }));

  return {
    weeks,
    meta: {
      totalWeeks: weeks.length,
      phases: Array.from(phases),
    },
  };
}

/**
 * Add exercises to the Program tab.
 * Each exercise becomes one row in the sheet.
 *
 * @param {string} sheetId
 * @param {Array<Object>} exercises — each: { week, phase, day, focus, name, sets, reps, load, rest, tempo, notes }
 */
async function addProgramExercises(sheetId, exercises) {
  if (!exercises || exercises.length === 0) return;

  const rows = exercises.map(ex => [
    ex.week || 1,
    ex.phase || '',
    ex.day || '',
    ex.focus || '',
    ex.name || '',
    ex.sets || '',
    ex.reps || '',
    ex.load || '',
    ex.rest || '',
    ex.tempo || '',
    ex.notes || '',
  ]);

  await appendRows(sheetId, 'Program!A:K', rows);
}

/**
 * Read Profile tab to get program metadata (start date, duration, coach name).
 *
 * @param {string} sheetId
 * @returns {{ coachName, programStartDate, programDuration }}
 */
async function getProgramMeta(sheetId) {
  const rows = await getTabValues(sheetId, 'Profile!A2:D50');
  const profile = {};
  for (const row of rows) {
    const field = (row[0] || '').trim();
    if (field) profile[field] = (row[1] || '').trim();
  }
  return {
    coachName: profile['Coach Name'] || 'Coach',
    programStartDate: profile['Program Start Date'] || '',
    programDuration: profile['Program Duration'] || '',
  };
}

module.exports = { getFullProgram, addProgramExercises, getProgramMeta };
