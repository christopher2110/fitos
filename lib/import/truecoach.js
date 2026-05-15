// lib/import/truecoach.js
// Maps TrueCoach CSV export columns to FitOS Sheets schema.
// TrueCoach exports: Clients (roster) and Results (workout completions).
//
// TrueCoach was acquired by Xplor in 2022. Export formats have stayed
// largely stable since then.

const { rowsToObjects } = require('./csv-parser');

// ── Clients mapping ───────────────────────────────────────────────────────────
// TrueCoach "Clients" export headers (observed):
//   Name, Email, Phone, Program, Start Date, Status, Notes, Tags

const CLIENT_FIELD_ALIASES = {
  name:      ['name', 'full_name', 'client_name', 'athlete_name', 'athlete'],
  firstName: ['first_name', 'firstname'],
  lastName:  ['last_name', 'lastname'],
  email:     ['email', 'email_address'],
  program:   ['program', 'program_name', 'plan', 'training_plan'],
  notes:     ['notes', 'goal', 'goals', 'tags', 'objectives'],
  startDate: ['start_date', 'joined', 'created_at', 'member_since'],
  status:    ['status'],
};

function pickField(record, aliases) {
  for (const alias of aliases) {
    if (record[alias] !== undefined && record[alias] !== '') return record[alias];
  }
  return '';
}

/**
 * Map TrueCoach client CSV rows to FitOS addClient shape.
 * Returns { mapped: [{name, email, program, notes, startDate}], skipped: number }
 */
function mapClients(rows) {
  const { records } = rowsToObjects(rows);
  const mapped = [];
  let skipped = 0;

  for (const rec of records) {
    let name = pickField(rec, CLIENT_FIELD_ALIASES.name);
    if (!name) {
      const first = pickField(rec, CLIENT_FIELD_ALIASES.firstName);
      const last  = pickField(rec, CLIENT_FIELD_ALIASES.lastName);
      name = [first, last].filter(Boolean).join(' ').trim();
    }
    if (!name) { skipped++; continue; }

    mapped.push({
      name:      name,
      email:     pickField(rec, CLIENT_FIELD_ALIASES.email),
      program:   pickField(rec, CLIENT_FIELD_ALIASES.program),
      notes:     pickField(rec, CLIENT_FIELD_ALIASES.notes),
      startDate: pickField(rec, CLIENT_FIELD_ALIASES.startDate),
    });
  }

  return { mapped, skipped };
}

// ── Workouts / Results mapping ────────────────────────────────────────────────
// TrueCoach "Results" export headers (observed):
//   Date, Client, Exercise, Sets, Reps, Weight, Notes, Completed

const WORKOUT_FIELD_ALIASES = {
  date:     ['date', 'workout_date', 'completed_date', 'session_date'],
  client:   ['client', 'client_name', 'athlete', 'athlete_name', 'name'],
  exercise: ['exercise', 'exercise_name', 'movement', 'block_title'],
  sets:     ['sets', 'prescribed_sets', 'actual_sets'],
  reps:     ['reps', 'repetitions', 'prescribed_reps', 'actual_reps'],
  weight:   ['weight', 'load', 'weight_kg', 'kg', 'resistance'],
  notes:    ['notes', 'client_notes', 'comments', 'results', 'result'],
  status:   ['status', 'completed'],
};

/**
 * Map TrueCoach results/workout CSV rows to FitOS recordCompletion shape.
 * Returns { mapped: [{date, client, exercise, sets, reps, weight, notes, status}], skipped: number }
 */
function mapWorkouts(rows) {
  const { records } = rowsToObjects(rows);
  const mapped = [];
  let skipped = 0;

  for (const rec of records) {
    const exercise = pickField(rec, WORKOUT_FIELD_ALIASES.exercise);
    const date     = pickField(rec, WORKOUT_FIELD_ALIASES.date);
    if (!exercise || !date) { skipped++; continue; }

    const rawWeight = pickField(rec, WORKOUT_FIELD_ALIASES.weight);
    const weight    = rawWeight !== '' ? parseFloat(rawWeight) || null : null;

    // TrueCoach "completed" column may be "true"/"false"/"1"/"0"
    const rawStatus = pickField(rec, WORKOUT_FIELD_ALIASES.status);
    const status    = resolveStatus(rawStatus);

    mapped.push({
      date:     normalizeDate(date),
      client:   pickField(rec, WORKOUT_FIELD_ALIASES.client),
      exercise: exercise,
      sets:     parseInt(pickField(rec, WORKOUT_FIELD_ALIASES.sets)) || 1,
      reps:     pickField(rec, WORKOUT_FIELD_ALIASES.reps) || '1',
      weight:   weight,
      notes:    pickField(rec, WORKOUT_FIELD_ALIASES.notes),
      status:   status,
    });
  }

  return { mapped, skipped };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveStatus(raw) {
  if (!raw) return 'Completed';
  const lower = raw.toLowerCase().trim();
  if (['false', '0', 'no', 'incomplete', 'skipped'].includes(lower)) return 'Skipped';
  if (['true', '1', 'yes', 'completed', 'done'].includes(lower)) return 'Completed';
  // Pass through if it already looks like a FitOS status
  if (['Completed', 'Skipped', 'Modified', 'PR'].includes(raw)) return raw;
  return 'Completed';
}

function normalizeDate(raw) {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const eu = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (eu) return `${eu[3]}-${eu[2]}-${eu[1]}`;
  try {
    const d = new Date(raw);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  } catch (_) {}
  return raw;
}

/**
 * Detect if a CSV file looks like a TrueCoach clients or results export.
 * Returns { type: 'clients'|'workouts'|'unknown', confidence: 0–1 }
 */
function detectFileType(rows) {
  if (!rows || rows.length < 2) return { type: 'unknown', confidence: 0 };
  const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));

  const clientSignals  = ['name', 'email', 'program', 'start_date', 'tags'];
  const workoutSignals = ['exercise', 'sets', 'reps', 'weight', 'completed', 'results'];

  const clientScore  = clientSignals.filter(s  => headers.some(h => h.includes(s))).length;
  const workoutScore = workoutSignals.filter(s => headers.some(h => h.includes(s))).length;

  if (clientScore > workoutScore && clientScore >= 2) {
    return { type: 'clients', confidence: Math.min(clientScore / clientSignals.length, 1) };
  }
  if (workoutScore > clientScore && workoutScore >= 2) {
    return { type: 'workouts', confidence: Math.min(workoutScore / workoutSignals.length, 1) };
  }
  return { type: 'unknown', confidence: 0 };
}

module.exports = { mapClients, mapWorkouts, detectFileType, normalizeDate };
