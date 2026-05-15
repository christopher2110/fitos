// routes/programs.js
// Owns: /api/programs — Program tab CRUD (read full program, add exercises)
// Does NOT own: client list, workout completions, auth

const express = require('express');
const router = express.Router();

let sheetsPrograms = null;
try {
  sheetsPrograms = require('../lib/sheets/programs');
} catch (_) {
  // sheets dep not available — demo mode
}

// ── GET /api/programs — Fetch full program structure ─────────────────────────

router.get('/', async (req, res) => {
  const sheetId = req.sheetId;
  if (!sheetId || !process.env.GOOGLE_SERVICE_ACCOUNT_KEY || !sheetsPrograms) {
    // Demo mode — return mock program
    return res.json({ ok: true, demo: true, program: _mockProgram(), meta: { totalWeeks: 4, phases: ['Accumulation'] } });
  }

  try {
    const [programData, metaData] = await Promise.all([
      sheetsPrograms.getFullProgram(sheetId),
      sheetsPrograms.getProgramMeta(sheetId),
    ]);

    res.json({
      ok: true,
      demo: false,
      program: programData.weeks,
      meta: {
        ...programData.meta,
        ...metaData,
      },
    });
  } catch (err) {
    console.error('[programs] fetch error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/programs/exercises — Add exercises to Program tab ──────────────

router.post('/exercises', async (req, res) => {
  const sheetId = req.sheetId;
  if (!sheetId || !process.env.GOOGLE_SERVICE_ACCOUNT_KEY || !sheetsPrograms) {
    return res.status(400).json({
      ok: false,
      error: 'Google Sheet not connected. Complete setup at /setup first.',
    });
  }

  const { exercises } = req.body || {};
  if (!exercises || !Array.isArray(exercises) || exercises.length === 0) {
    return res.status(400).json({ ok: false, error: 'exercises array is required' });
  }

  // Validate each exercise has at minimum a name
  for (let i = 0; i < exercises.length; i++) {
    if (!exercises[i].name || !exercises[i].name.trim()) {
      return res.status(400).json({ ok: false, error: `Exercise ${i + 1} requires a name` });
    }
  }

  try {
    await sheetsPrograms.addProgramExercises(sheetId, exercises);
    res.json({ ok: true, added: exercises.length });
  } catch (err) {
    console.error('[programs] add exercises error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Mock data for demo mode ─────────────────────────────────────────────────

function _mockProgram() {
  return [
    {
      week: 1,
      phase: 'Accumulation',
      days: [
        {
          day: 'Monday',
          focus: 'Lower Body Strength',
          exercises: [
            { name: 'Back Squat', sets: '4', reps: '6', load: 'RPE 7', rest: '180', tempo: '3-1-1-0', notes: 'Warm up thoroughly. Depth focus.' },
            { name: 'Romanian Deadlift', sets: '3', reps: '10', load: 'RPE 7', rest: '120', tempo: '3-1-1-0', notes: 'Hip hinge, soft knee.' },
            { name: 'Bulgarian Split Squat', sets: '3', reps: '8/side', load: 'RPE 7', rest: '90', tempo: '2-1-1-0', notes: 'Keep torso upright.' },
            { name: 'Leg Curl', sets: '3', reps: '12', load: 'RPE 8', rest: '60', tempo: '2-0-1-1', notes: '' },
          ],
        },
        {
          day: 'Wednesday',
          focus: 'Upper Body Push',
          exercises: [
            { name: 'Bench Press', sets: '4', reps: '8', load: 'RPE 7', rest: '150', tempo: '3-1-1-0', notes: 'Retract scapula.' },
            { name: 'DB Shoulder Press', sets: '3', reps: '10', load: 'RPE 7', rest: '90', tempo: '2-1-1-0', notes: '' },
            { name: 'Incline DB Fly', sets: '3', reps: '12', load: 'RPE 7', rest: '60', tempo: '3-0-1-1', notes: 'Stretch at bottom.' },
            { name: 'Tricep Pushdown', sets: '3', reps: '15', load: 'RPE 8', rest: '60', tempo: '2-0-1-1', notes: '' },
          ],
        },
        {
          day: 'Friday',
          focus: 'Upper Body Pull + Core',
          exercises: [
            { name: 'Barbell Row', sets: '4', reps: '8', load: 'RPE 7', rest: '120', tempo: '2-1-1-0', notes: 'Squeeze at top.' },
            { name: 'Lat Pulldown', sets: '3', reps: '10', load: 'RPE 7', rest: '90', tempo: '3-0-1-1', notes: '' },
            { name: 'Face Pulls', sets: '3', reps: '15', load: 'RPE 7', rest: '60', tempo: '2-1-1-0', notes: 'External rotation at top.' },
            { name: 'Hanging Leg Raise', sets: '3', reps: '12', load: 'BW', rest: '60', tempo: '2-0-1-0', notes: '' },
          ],
        },
      ],
    },
  ];
}

module.exports = router;
