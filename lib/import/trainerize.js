// lib/import/trainerize.js
// Maps Trainerize CSV export columns to FitOS Sheets schema.
// Trainerize exports two file types: Clients and Workouts (Training Log).
//
// Column mappings are flexible — they match by normalized lowercase header names
// and fall back gracefully if columns are absent.

const { rowsToObjects } = require('./csv-parser');

// ── Clients mapping ───────────────────────────────────────────────────────────
// Trainerize "Clients" export headers (common variants):
//   Full Name, First Name, Last Name, Email, Phone, Goal, Notes, Status, Start Date

const CLIENT_FIELD_ALIASES = {
  name:       ['full_name', 'name', 'client_name', 'client'],
  firstName:  ['first_name', 'firstname'],
  lastName:   ['last_name', 'lastname'],
  email:      ['email', 'email_address'],
  program:    ['program', 'program_name', 'training_plan', 'plan'],
  notes:      ['notes', 'goal', 'goals', 'objective'],
  startDate:  ['start_date', 'started', 'joined_date'],
  status:     ['status', 'active'],
};

function pickField(record, aliases) {
  for (const alias of aliases) {
    if (record[alias] !== undefined && record[alias] !== '') return record[alias];
  }
  return '';
}

/**
 * Map Trainerize client CSV rows to FitOS addClient shape.
 * Returns { mapped: [{name, email, program, notes, startDate}], skipped: number }
 */
function mapClients(rows) {
  const { records } = rowsToObjects(rows);
  const mapped = [];
  let skipped = 0;

  for (const rec of records) {
    let name = pickField(rec, CLIENT_FIELD_ALIASES.name);
    if (!name) {
      // Try to compose from first + last
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

// ── Workouts mapping ──────────────────────────────────────────────────────────
// Trainerize "Training Log" export headers (common variants):
//   Date, Client Name, Exercise, Sets, Reps, Weight (lbs / kg), Notes
//   Also seen: Exercise Name, Set Number, Reps Completed, Load, Weight

const WORKOUT_FIELD_ALIASES = {
  date:     ['date', 'workout_date', 'log_date', 'completed_date'],
  client:   ['client_name', 'client', 'athlete', 'name'],
  exercise: ['exercise', 'exercise_name', 'movement', 'lift'],
  sets:     ['sets', 'total_sets', 'num_sets'],
  reps:     ['reps', 'reps_completed', 'repetitions', 'reps_performed'],
  weight:   ['weight', 'load', 'weight_kg', 'weight_lbs', 'kg', 'lbs'],
  notes:    ['notes', 'comment', 'comments', 'coach_notes', 'client_notes'],
  status:   ['status', 'result'],
};

/**
 * Map Trainerize workout CSV rows to FitOS recordCompletion shape.
 * Each row maps to one workout completion record.
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

    mapped.push({
      date:     normalizeDate(date),
      client:   pickField(rec, WORKOUT_FIELD_ALIASES.client),
      exercise: exercise,
      sets:     parseInt(pickField(rec, WORKOUT_FIELD_ALIASES.sets)) || 1,
      reps:     pickField(rec, WORKOUT_FIELD_ALIASES.reps) || '1',
      weight:   weight,
      notes:    pickField(rec, WORKOUT_FIELD_ALIASES.notes),
      status:   pickField(rec, WORKOUT_FIELD_ALIASES.status) || 'Completed',
    });
  }

  return { mapped, skipped };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Attempt to normalize a date string to YYYY-MM-DD.
 * Handles: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY (ambiguous — prefers US format).
 * Returns original string if normalization fails.
 */
function normalizeDate(raw) {
  if (!raw) return '';
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // MM/DD/YYYY or M/D/YYYY
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  // DD-MM-YYYY
  const eu = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (eu) return `${eu[3]}-${eu[2]}-${eu[1]}`;
  // Month name: "Jan 5, 2026" or "January 5 2026"
  try {
    const d = new Date(raw);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  } catch (_) {}
  return raw;
}

/**
 * Detect if a CSV file looks like a Trainerize clients export.
 * Returns confidence score 0–1 and detected type.
 */
function detectFileType(rows) {
  if (!rows || rows.length < 2) return { type: 'unknown', confidence: 0 };
  const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));

  const clientSignals = ['full_name', 'first_name', 'email', 'program', 'training_plan', 'start_date'];
  const workoutSignals = ['exercise', 'exercise_name', 'sets', 'reps', 'weight', 'load', 'training_log'];

  const clientScore  = clientSignals.filter(s => headers.some(h => h.includes(s.split('_')[0]))).length;
  const workoutScore = workoutSignals.filter(s => headers.some(h => h.includes(s.split('_')[0]))).length;

  if (clientScore > workoutScore && clientScore >= 2) {
    return { type: 'clients', confidence: Math.min(clientScore / clientSignals.length, 1) };
  }
  if (workoutScore > clientScore && workoutScore >= 2) {
    return { type: 'workouts', confidence: Math.min(workoutScore / workoutSignals.length, 1) };
  }
  return { type: 'unknown', confidence: 0 };
}

module.exports = { mapClients, mapWorkouts, detectFileType, normalizeDate };
