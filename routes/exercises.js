// routes/exercises.js
// Owns: /dashboard/exercises HTML pages + /api/exercises JSON CRUD endpoints
//       + /api/exercises/find-videos (Exercise Video Finder skill trigger)
// Does NOT own: Exercises tab schema definition, auth middleware, Sheet auth, YouTube API key storage

const express = require('express');
const path    = require('path');
const fs      = require('fs');

let sheetsEx = null;
try {
  sheetsEx = require('../lib/sheets/exercises');
} catch (_) {
  // sheets dep unavailable — demo fallback
}

let videoFinder = null;
try {
  videoFinder = require('../lib/sheets/video-finder');
} catch (_) {
  // optional dep — feature degrades gracefully if module missing
}

let videoCandidates = null;
try {
  videoCandidates = require('../lib/sheets/video-candidates');
} catch (_) {
  // optional dep
}

const router = express.Router();

// ── Auth guard ────────────────────────────────────────────────────────────────

function requireCoach(req, res, next) {
  if (!req.coach) return res.redirect('/trial');
  next();
}

// ── HTML page helper ──────────────────────────────────────────────────────────

function sendPage(res, filename, injection = '') {
  const htmlPath = path.join(__dirname, '..', 'public', filename);
  if (!fs.existsSync(htmlPath)) return res.status(404).send(`Page not found: ${filename}`);
  let html = fs.readFileSync(htmlPath, 'utf8');
  if (injection) html = html.replace('</head>', `${injection}\n</head>`);
  res.type('html').send(html);
}

function liveInjection(req) {
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsEx);
  const coachName = (req.coach && req.coach.name) || 'Coach';
  return `<script>window.__COACH_LIVE__ = ${JSON.stringify({ sheetsEnabled, coachName })};</script>`;
}

// ── HTML Pages ────────────────────────────────────────────────────────────────

/** GET /dashboard/exercises — exercise library main view */
router.get('/', requireCoach, (req, res) => {
  sendPage(res, 'dashboard-exercises.html', liveInjection(req));
});

/** GET /dashboard/exercises/sources — trusted YouTube channels */
router.get('/sources', requireCoach, (req, res) => {
  sendPage(res, 'dashboard-exercises-sources.html', liveInjection(req));
});

// ── JSON API ──────────────────────────────────────────────────────────────────

/** GET /api/exercises — list all exercises */
router.get('/api/exercises', requireCoach, async (req, res) => {
  if (!sheetsEx || !req.sheetId || !process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return res.json({ ok: true, exercises: [], needsSetup: !req.sheetId });
  }
  try {
    const exercises = await sheetsEx.listExercises(req.sheetId);
    res.json({ ok: true, exercises });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** POST /api/exercises — add one or more exercises (bulk import + single add) */
router.post('/api/exercises', requireCoach, async (req, res) => {
  if (!sheetsEx || !req.sheetId) {
    return res.status(400).json({ ok: false, error: 'Sheet not connected' });
  }
  const { exercises } = req.body;
  if (!exercises || !Array.isArray(exercises) || exercises.length === 0) {
    return res.status(400).json({ ok: false, error: 'exercises array required' });
  }

  // Validate: each exercise must have at least a name
  const invalid = exercises.filter(e => !e.name || !String(e.name).trim());
  if (invalid.length > 0) {
    return res.status(400).json({ ok: false, error: 'Each exercise must have a name' });
  }

  // Ensure unique ids
  const now = Date.now();
  const withIds = exercises.map((ex, i) => ({
    ...ex,
    id: ex.id || `ex_${now}_${i}_${Math.random().toString(36).slice(2, 6)}`,
  }));

  try {
    await sheetsEx.addExercises(req.sheetId, withIds);
    res.json({ ok: true, count: withIds.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** PATCH /api/exercises/:id — update a single exercise field(s) */
router.patch('/api/exercises/:id', requireCoach, async (req, res) => {
  if (!sheetsEx || !req.sheetId) {
    return res.status(400).json({ ok: false, error: 'Sheet not connected' });
  }
  const { id } = req.params;
  const updates = req.body;
  // Whitelist fields
  const allowed = ['name', 'category', 'primary_muscle', 'equipment', 'video_url', 'coach_notes'];
  const clean = {};
  for (const k of allowed) {
    if (updates[k] !== undefined) clean[k] = updates[k];
  }

  try {
    const found = await sheetsEx.updateExercise(req.sheetId, id, clean);
    if (!found) return res.status(404).json({ ok: false, error: 'Exercise not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** DELETE /api/exercises/:id — delete an exercise */
router.delete('/api/exercises/:id', requireCoach, async (req, res) => {
  if (!sheetsEx || !req.sheetId) {
    return res.status(400).json({ ok: false, error: 'Sheet not connected' });
  }
  try {
    const found = await sheetsEx.deleteExercise(req.sheetId, req.params.id);
    if (!found) return res.status(404).json({ ok: false, error: 'Exercise not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/exercises/sources — trusted YouTube channels */
router.get('/api/sources', requireCoach, async (req, res) => {
  if (!sheetsEx || !req.sheetId || !process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    // Return defaults if no sheet
    return res.json({ ok: true, channels: sheetsEx ? await sheetsEx.getTrustedChannels(null).catch(() => []) : [] });
  }
  try {
    const channels = await sheetsEx.getTrustedChannels(req.sheetId);
    res.json({ ok: true, channels });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** PUT /api/exercises/sources — save trusted YouTube channels */
router.put('/api/sources', requireCoach, async (req, res) => {
  if (!sheetsEx || !req.sheetId) {
    return res.status(400).json({ ok: false, error: 'Sheet not connected' });
  }
  const { channels } = req.body;
  if (!Array.isArray(channels)) {
    return res.status(400).json({ ok: false, error: 'channels array required' });
  }
  try {
    await sheetsEx.saveTrustedChannels(req.sheetId, channels);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/exercises/find-videos
 * Triggers the Exercise Video Finder skill for exercises missing a video URL.
 * Body (optional): { dryRun: boolean }
 *
 * Uses YOUTUBE_API_KEY env var. Returns found/skipped/results summary.
 */
router.post('/api/find-videos', requireCoach, async (req, res) => {
  if (!videoFinder) {
    return res.status(503).json({ ok: false, error: 'Video finder not available' });
  }
  if (!sheetsEx || !req.sheetId) {
    return res.status(400).json({ ok: false, error: 'Sheet not connected' });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      error: 'YouTube API key not configured. Contact support to enable video auto-fill.',
    });
  }

  const dryRun = !!(req.body && req.body.dryRun);

  try {
    const result = await videoFinder.runVideoFinder({
      sheetId: req.sheetId,
      apiKey,
      dryRun,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/exercises/bulk-fill/count
 * Returns the number of exercises missing a YouTube URL.
 * Used to label the "Auto-fill N missing videos" button before starting the run.
 */
router.get('/api/bulk-fill/count', requireCoach, async (req, res) => {
  if (!sheetsEx || !req.sheetId || !process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return res.json({ ok: true, missing: 0, total: 0 });
  }
  try {
    const exercises = await sheetsEx.listExercises(req.sheetId);
    const missing   = exercises.filter(e => e.name && !e.video_url).length;
    res.json({ ok: true, missing, total: exercises.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/exercises/bulk-fill/stream
 * SSE endpoint — streams live progress while the bulk auto-fill runs.
 *
 * Events (text/event-stream):
 *   data: {"type":"start","total":47,"alreadyHad":3}
 *   data: {"type":"progress","exerciseId":"ex_123","exerciseName":"Squat","result":"filled","url":"...","filled":1,"skipped":0,"failed":0,"total":47}
 *   data: {"type":"quota_exhausted","filled":12,"skipped":0,"failed":0,"total":47}
 *   data: {"type":"done","filled":47,"skipped":0,"failed":0,"total":47,"quotaHit":false,"summary":"..."}
 *
 * The stream ends with a "done" or "quota_exhausted" event.
 */
router.get('/api/bulk-fill/stream', requireCoach, async (req, res) => {
  if (!videoFinder || !videoFinder.runVideoFinderStreaming) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Video finder not available' })}\n\n`);
    return res.end();
  }
  if (!sheetsEx || !req.sheetId) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Sheet not connected' })}\n\n`);
    return res.end();
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'YouTube API key not configured' })}\n\n`);
    return res.end();
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering
  res.flushHeaders();

  // Heartbeat every 20 s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) {}
  }, 20000);

  function send(event) {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (_) {}
  }

  try {
    await videoFinder.runVideoFinderStreaming({
      sheetId: req.sheetId,
      apiKey,
      onProgress: send,
      maxSearches: 200,
    });
  } catch (err) {
    send({ type: 'error', error: err.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

/**
 * GET /api/exercises/swap-candidates/:id
 * Returns up to 3 alternate video candidates for a specific exercise.
 * Checks VideoCandidates sheet cache first; falls back to a live YouTube search.
 *
 * Query param: name (exercise name, required for cache-miss search)
 */
router.get('/api/swap-candidates/:id', requireCoach, async (req, res) => {
  if (!videoFinder || !videoFinder.getSwapCandidates) {
    return res.json({ ok: true, candidates: [] });
  }
  if (!sheetsEx || !req.sheetId) {
    return res.status(400).json({ ok: false, error: 'Sheet not connected' });
  }

  const exerciseId   = req.params.id;
  const exerciseName = (req.query.name || '').trim();

  if (!exerciseName) {
    return res.status(400).json({ ok: false, error: 'name query param required' });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;

  try {
    const candidates = await videoFinder.getSwapCandidates({
      sheetId:      req.sheetId,
      exerciseId,
      exerciseName,
      apiKey: apiKey || null,
    });
    res.json({ ok: true, candidates });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/exercises/swap-video/:id
 * Apply a swapped video URL to a single exercise + log to Activity feed.
 * Body: { video_url: string, channel_name?: string }
 */
router.post('/api/swap-video/:id', requireCoach, async (req, res) => {
  if (!sheetsEx || !req.sheetId) {
    return res.status(400).json({ ok: false, error: 'Sheet not connected' });
  }

  const exerciseId = req.params.id;
  const { video_url, channel_name } = req.body || {};

  if (!video_url) {
    return res.status(400).json({ ok: false, error: 'video_url required' });
  }

  try {
    const found = await sheetsEx.updateExercise(req.sheetId, exerciseId, { video_url });
    if (!found) return res.status(404).json({ ok: false, error: 'Exercise not found' });

    // Log swap to Activity feed
    const { appendRows } = require('../lib/sheets/client');
    appendRows(req.sheetId, 'Activity!A:F', [[
      new Date().toISOString(), 'coach_action', 'exercise_video_swap',
      `Video swapped for exercise ${exerciseId}${channel_name ? ` from ${channel_name}` : ''}`,
      '', JSON.stringify({ exercise_id: exerciseId, video_url, channel_name: channel_name || '' }),
    ]]).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
