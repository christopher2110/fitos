// routes/agent-schedules.js
// Owns: /api/agent-schedules — CRUD for cron-style agent schedules
// Does NOT own: schedule execution (services/agent-scheduler.js), agent DB (db/agents.js)

const express = require('express');
const db      = require('../db/agent-schedules');
const dbAgent = require('../db/agents');

const router = express.Router();

// ── Auth guard ────────────────────────────────────────────────────────────────

function requireCoach(req, res, next) {
  if (!req.coach) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  next();
}

// ── Validation ────────────────────────────────────────────────────────────────

const VALID_CADENCES    = ['daily', 'weekly', 'monthly'];
const VALID_SCOPES      = ['all', 'filtered', 'single'];
const VALID_OUTPUTS     = ['activity', 'activity_and_dm'];
const VALID_AGENT_TYPES = ['builtin', 'imported'];
const TIME_RE           = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateScheduleBody(body) {
  const errors = [];

  if (!body.agent_type || !VALID_AGENT_TYPES.includes(body.agent_type)) {
    errors.push('agent_type must be "builtin" or "imported"');
  }
  if (!body.agent_name || typeof body.agent_name !== 'string') {
    errors.push('agent_name is required');
  }
  if (!body.cadence || !VALID_CADENCES.includes(body.cadence)) {
    errors.push('cadence must be daily, weekly, or monthly');
  }
  if (!body.run_time || !TIME_RE.test(body.run_time)) {
    errors.push('run_time must be HH:MM (24-hour)');
  }
  if (body.cadence === 'weekly' && body.day_of_week == null) {
    errors.push('day_of_week (0-6) required for weekly cadence');
  }
  if (body.cadence === 'monthly' && body.day_of_month == null) {
    errors.push('day_of_month (1-31) required for monthly cadence');
  }
  if (body.scope_type && !VALID_SCOPES.includes(body.scope_type)) {
    errors.push('scope_type must be all, filtered, or single');
  }
  if (body.output_destination && !VALID_OUTPUTS.includes(body.output_destination)) {
    errors.push('output_destination must be activity or activity_and_dm');
  }

  return errors;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/agent-schedules
 * List all schedules for the authenticated coach.
 */
router.get('/', requireCoach, async (req, res) => {
  try {
    const schedules = await db.getSchedulesByCoach(req.coach.id);
    res.json({ ok: true, schedules });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/agent-schedules
 * Create a new schedule.
 */
router.post('/', requireCoach, async (req, res) => {
  const errors = validateScheduleBody(req.body || {});
  if (errors.length > 0) {
    return res.status(400).json({ ok: false, errors });
  }

  const {
    agent_type, agent_id, agent_name,
    cadence, day_of_week, day_of_month, run_time,
    timezone, scope_type, scope_client_ids, scope_filter,
    output_destination, condition_filter,
  } = req.body;

  // If imported agent, verify ownership
  if (agent_type === 'imported' && agent_id) {
    const agentRecord = await dbAgent.getAgent(Number(agent_id), req.coach.id).catch(() => null);
    if (!agentRecord) {
      return res.status(404).json({ ok: false, error: 'Agent not found or not owned by you' });
    }
  }

  try {
    const schedule = await db.createSchedule({
      coach_id:           req.coach.id,
      agent_type,
      agent_id:           agent_id ? String(agent_id) : null,
      agent_name:         agent_name.trim(),
      cadence,
      day_of_week:        day_of_week != null ? Number(day_of_week) : null,
      day_of_month:       day_of_month != null ? Number(day_of_month) : null,
      run_time,
      timezone:           timezone || 'America/New_York',
      scope_type:         scope_type || 'all',
      scope_client_ids:   Array.isArray(scope_client_ids) ? scope_client_ids : null,
      scope_filter:       scope_filter || null,
      output_destination: output_destination || 'activity',
      condition_filter:   condition_filter || null,
    });
    res.status(201).json({ ok: true, schedule });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PATCH /api/agent-schedules/:id
 * Update a schedule's configuration.
 */
router.patch('/:id', requireCoach, async (req, res) => {
  const scheduleId = Number(req.params.id);
  if (!scheduleId) return res.status(400).json({ ok: false, error: 'Invalid id' });

  try {
    const updated = await db.updateSchedule(scheduleId, req.coach.id, req.body || {});
    if (!updated) return res.status(404).json({ ok: false, error: 'Schedule not found' });
    res.json({ ok: true, schedule: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/agent-schedules/:id
 * Permanently delete a schedule.
 */
router.delete('/:id', requireCoach, async (req, res) => {
  const scheduleId = Number(req.params.id);
  if (!scheduleId) return res.status(400).json({ ok: false, error: 'Invalid id' });

  try {
    const deleted = await db.deleteSchedule(scheduleId, req.coach.id);
    if (!deleted) return res.status(404).json({ ok: false, error: 'Schedule not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/agent-schedules/:id/pause
 */
router.post('/:id/pause', requireCoach, async (req, res) => {
  const scheduleId = Number(req.params.id);
  if (!scheduleId) return res.status(400).json({ ok: false, error: 'Invalid id' });

  try {
    const schedule = await db.pauseSchedule(scheduleId, req.coach.id);
    if (!schedule) return res.status(404).json({ ok: false, error: 'Schedule not found or already paused' });
    res.json({ ok: true, schedule });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/agent-schedules/:id/resume
 */
router.post('/:id/resume', requireCoach, async (req, res) => {
  const scheduleId = Number(req.params.id);
  if (!scheduleId) return res.status(400).json({ ok: false, error: 'Invalid id' });

  try {
    const schedule = await db.resumeSchedule(scheduleId, req.coach.id);
    if (!schedule) return res.status(404).json({ ok: false, error: 'Schedule not found' });
    res.json({ ok: true, schedule });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/agent-schedules/pause-all
 * Emergency stop — pause every active schedule for this coach.
 */
router.post('/pause-all', requireCoach, async (req, res) => {
  try {
    const count = await db.pauseAllForCoach(req.coach.id);
    res.json({ ok: true, paused: count });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/agent-schedules/:id/history
 * List agent_runs for the given schedule (via schedule_id tag in inputs_json).
 */
router.get('/:id/history', requireCoach, async (req, res) => {
  const scheduleId = Number(req.params.id);
  if (!scheduleId) return res.status(400).json({ ok: false, error: 'Invalid id' });

  try {
    // Verify the schedule belongs to this coach
    const schedule = await db.getScheduleById(scheduleId, req.coach.id);
    if (!schedule) return res.status(404).json({ ok: false, error: 'Schedule not found' });

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const runs = await db.listRunsForSchedule(scheduleId, req.coach.id, limit);
    res.json({ ok: true, runs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
