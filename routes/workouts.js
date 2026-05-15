// routes/workouts.js
// Owns: /workouts page serve + config injection with real or demo workout data
// Does NOT own: Sheets API auth, raw API calls (lib/sheets/), write path (/api/completions)

const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Real Sheets helpers — only used when COACH_SHEET_ID is set
const { getWorkoutForDate, getTodaysWorkout, getCompletionsForDate, getTodaysCompletions } = require('../lib/sheets/workouts');

// ── Demo data ─────────────────────────────────────────────────────────────────
// Used when COACH_SHEET_ID is not configured (dev / new-coach onboarding).
const DEMO_WORKOUT = {
  date: null, // filled in at request time
  title: 'Lower Body Strength A',
  weekNum: 1,
  dayName: 'Monday',
  coachNote: {
    coach: 'Alex',
    initial: 'A',
    message: "Focus on depth on the squats today — we've been seeing some forward lean. Push the heel through the floor on the way up. Great week so far, keep it going 💪",
  },
  exercises: [
    {
      id: 0, name: 'Back Squat', sets: 4, reps: '5', rpe: 7, note: 'Pause 2s at bottom',
      videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      clientNotes: 'Used belt for working sets',
    },
    {
      id: 1, name: 'Romanian Deadlift', sets: 3, reps: '8', rpe: 7, note: '',
      videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      clientNotes: '',
    },
    {
      id: 2, name: 'Leg Press', sets: 3, reps: '12', rpe: 7, note: 'Full range of motion',
      videoUrl: null,
      clientNotes: '',
    },
    {
      id: 3, name: 'Nordic Hamstring Curl', sets: 3, reps: '6', rpe: 8, note: 'Controlled negative',
      videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      clientNotes: 'Left knee tracking — watched video twice before set 3',
    },
    {
      id: 4, name: 'Standing Calf Raise', sets: 4, reps: '15', rpe: 6, note: '',
      videoUrl: null,
      clientNotes: '',
    },
  ],
};

// ── Route ─────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'workouts.html');
  let html;
  try {
    html = fs.readFileSync(htmlPath, 'utf8');
  } catch (_) {
    return res.status(500).send('workouts.html not found');
  }

  // req.sheetId is set by resolveSheetMiddleware — per-coach or env fallback
  const sheetId = req.sheetId;
  let workout = null;
  let completions = {};
  let sheetConnected = false;

  if (sheetId) {
    try {
      workout = await getTodaysWorkout(sheetId);
      if (workout) {
        completions = await getTodaysCompletions(sheetId);
        sheetConnected = true;
      }
    } catch (err) {
      // Non-fatal: Sheet misconfigured or unavailable → fall back to demo
      console.error('[workouts] Sheets read failed:', err.message);
    }
  }

  // Fall back to demo workout if Sheet not configured or today has no program entries
  if (!workout) {
    const today = new Date().toISOString().split('T')[0];
    workout = { ...DEMO_WORKOUT, date: today };
  }

  const config = JSON.stringify({ workout, completions, sheetConnected });
  html = html.replace('__FITOS_CONFIG__', config);
  res.type('html').send(html);
});

// ── Day-switch API ────────────────────────────────────────────────────────────
// GET /workouts/api/day?date=YYYY-MM-DD
// Returns { workout, completions, sheetConnected } JSON for the requested date.
// Falls back to a date-stamped copy of DEMO_WORKOUT when Sheet is not configured.

router.get('/api/day', async (req, res) => {
  const dateStr = (req.query.date || '').trim();

  // Basic validation: must be YYYY-MM-DD
  if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  // req.sheetId is set by resolveSheetMiddleware — per-coach or env fallback
  const sheetId = req.sheetId;
  let workout = null;
  let completions = {};
  let sheetConnected = false;

  if (sheetId) {
    try {
      workout = await getWorkoutForDate(sheetId, dateStr || null);
      if (workout) {
        completions = await getCompletionsForDate(sheetId, workout.date);
        sheetConnected = true;
      }
    } catch (err) {
      // Non-fatal — fall through to demo
      console.error('[workouts/api/day] Sheets read failed:', err.message);
    }
  }

  if (!workout) {
    const targetIso = dateStr || new Date().toISOString().split('T')[0];
    workout = { ...DEMO_WORKOUT, date: targetIso };
  }

  res.json({ workout, completions, sheetConnected });
});

module.exports = router;
