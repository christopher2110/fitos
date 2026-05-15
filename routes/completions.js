// routes/completions.js
// Owns: POST /api/completions — validate payload and write exercise completions to Google Sheets
// Does NOT own: Sheets auth (lib/sheets/client.js), workout reads, HTML serving

const express = require('express');
const { recordCompletion } = require('../lib/sheets/workouts');

const router = express.Router();

/**
 * POST /api/completions
 * Body (JSON):
 *   exercise   {string}        required — exercise name
 *   sets       {number}        required — number of sets performed
 *   reps       {string}        target reps string (e.g. "8" or "8-10")
 *   weight     {number|null}   weight in kg (null if not entered)
 *   rpe        {number|null}   RPE 1–10
 *   status     {string}        "Completed"|"Skipped"|"Modified"|"PR"
 *   notes      {string}        client comment
 *   weekNum    {number}        current program week
 *   dayName    {string}        day of week, e.g. "Monday"
 *
 * Returns { ok: true } on success, or an error object on failure.
 */
router.post('/', async (req, res) => {
  // req.sheetId is set by resolveSheetMiddleware — per-coach or env fallback
  const sheetId = req.sheetId;

  // If no Sheet is configured, silently succeed — demo mode doesn't persist
  if (!sheetId) {
    return res.json({ ok: true, persisted: false });
  }

  const { exercise, sets, reps, weight, rpe, status, notes, weekNum, dayName } = req.body;

  if (!exercise || typeof exercise !== 'string') {
    return res.status(400).json({ error: 'exercise is required' });
  }
  if (!sets || isNaN(parseInt(sets))) {
    return res.status(400).json({ error: 'sets must be a number' });
  }

  try {
    await recordCompletion(sheetId, {
      exercise: exercise.trim(),
      sets: parseInt(sets),
      reps,
      weight: weight !== null && weight !== undefined && weight !== '' ? parseFloat(weight) : null,
      rpe: rpe !== null && rpe !== undefined && rpe !== '' ? parseFloat(rpe) : null,
      status: status || 'Completed',
      notes: notes || '',
      weekNum: parseInt(weekNum) || 1,
      dayName: dayName || '',
    });
    res.json({ ok: true, persisted: true });
  } catch (err) {
    console.error('[completions] Sheet write error:', err.message);
    res.status(500).json({ error: 'Sheet write failed' });
  }
});

module.exports = router;
