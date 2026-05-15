/**
 * db/agent-schedules.js — Agent schedule query functions
 *
 * Owns: agent_schedules table
 * Does NOT own: schedule execution logic, HTTP handling, timezone math
 */
const pool = require('./index');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute the next run timestamp for a schedule given the current time.
 * Returns a Date object.
 *
 * @param {object} s  schedule row (cadence, day_of_week, day_of_month, run_time, timezone)
 * @param {Date}   [from]  base time (defaults to now)
 */
function computeNextRun(s, from = new Date()) {
  // Parse run_time "HH:MM" or "HH:MM:SS"
  const [hh, mm] = (s.run_time || '07:00').split(':').map(Number);

  const tz = s.timezone || 'America/New_York';

  // Get date/time parts in target timezone
  function partsIn(date, timezone) {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = {};
    f.formatToParts(date).forEach(({ type, value }) => { parts[type] = Number(value); });
    return parts;
  }

  // Build UTC Date from TZ-local components
  function buildLocal(year, month, day, hour, minute, timezone) {
    const naive = new Date(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00`);
    const p = partsIn(naive, timezone);
    const naiveUtcMs = naive.getTime();
    const tzMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const offset = naiveUtcMs - tzMs;
    return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) + offset);
  }

  const nowParts = partsIn(from, tz);
  let candidate;

  if (s.cadence === 'daily') {
    candidate = buildLocal(nowParts.year, nowParts.month, nowParts.day, hh, mm, tz);
    if (candidate <= from) {
      const nextDay = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
      const np = partsIn(nextDay, tz);
      candidate = buildLocal(np.year, np.month, np.day, hh, mm, tz);
    }
  } else if (s.cadence === 'weekly') {
    // day_of_week: 0=Sun..6=Sat
    const target = s.day_of_week != null ? s.day_of_week : 1; // default Monday
    candidate = buildLocal(nowParts.year, nowParts.month, nowParts.day, hh, mm, tz);
    const curDowNum = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(
      new Date(from).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' })
    );
    let daysUntil = (target - curDowNum + 7) % 7;
    if (daysUntil === 0 && candidate <= from) daysUntil = 7;
    if (daysUntil > 0) {
      const shifted = new Date(candidate.getTime() + daysUntil * 24 * 60 * 60 * 1000);
      const sp = partsIn(shifted, tz);
      candidate = buildLocal(sp.year, sp.month, sp.day, hh, mm, tz);
    }
  } else if (s.cadence === 'monthly') {
    const dom = s.day_of_month != null ? s.day_of_month : 1;
    candidate = buildLocal(nowParts.year, nowParts.month, dom, hh, mm, tz);
    if (candidate <= from) {
      let nm = nowParts.month + 1;
      let ny = nowParts.year;
      if (nm > 12) { nm = 1; ny++; }
      candidate = buildLocal(ny, nm, dom, hh, mm, tz);
    }
  } else {
    // Fallback: 24h from now
    candidate = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  }

  return candidate;
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

/**
 * Create a new schedule. Computes next_run_at automatically.
 */
async function createSchedule(fields) {
  const {
    coach_id,
    agent_type,
    agent_id = null,
    agent_name,
    cadence,
    day_of_week = null,
    day_of_month = null,
    run_time,
    timezone = 'America/New_York',
    scope_type = 'all',
    scope_client_ids = null,
    scope_filter = null,
    output_destination = 'activity',
    condition_filter = null,
  } = fields;

  const next_run_at = computeNextRun({
    cadence, day_of_week, day_of_month, run_time, timezone,
  });

  const result = await pool.query(
    `INSERT INTO agent_schedules
       (coach_id, agent_type, agent_id, agent_name,
        cadence, day_of_week, day_of_month, run_time, timezone,
        scope_type, scope_client_ids, scope_filter,
        output_destination, condition_filter,
        next_run_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      coach_id, agent_type, agent_id, agent_name,
      cadence, day_of_week, day_of_month, run_time, timezone,
      scope_type,
      scope_client_ids ? scope_client_ids : null,
      scope_filter ? JSON.stringify(scope_filter) : null,
      output_destination,
      condition_filter ? JSON.stringify(condition_filter) : null,
      next_run_at,
    ]
  );
  return result.rows[0];
}

/**
 * List all schedules for a coach (newest first).
 */
async function getSchedulesByCoach(coachId) {
  const result = await pool.query(
    `SELECT * FROM agent_schedules WHERE coach_id = $1 ORDER BY created_at DESC`,
    [coachId]
  );
  return result.rows;
}

/**
 * Get a single schedule by id, enforcing coach ownership.
 */
async function getScheduleById(scheduleId, coachId) {
  const result = await pool.query(
    `SELECT * FROM agent_schedules WHERE id = $1 AND coach_id = $2`,
    [scheduleId, coachId]
  );
  return result.rows[0] || null;
}

/**
 * Update schedule fields. Recomputes next_run_at if timing fields change.
 */
async function updateSchedule(scheduleId, coachId, fields) {
  const current = await getScheduleById(scheduleId, coachId);
  if (!current) return null;

  const merged = {
    agent_name:          fields.agent_name          != null ? fields.agent_name          : current.agent_name,
    cadence:             fields.cadence              != null ? fields.cadence              : current.cadence,
    day_of_week:         fields.day_of_week          !== undefined ? fields.day_of_week    : current.day_of_week,
    day_of_month:        fields.day_of_month         !== undefined ? fields.day_of_month   : current.day_of_month,
    run_time:            fields.run_time             != null ? fields.run_time             : current.run_time,
    timezone:            fields.timezone             != null ? fields.timezone             : current.timezone,
    scope_type:          fields.scope_type           != null ? fields.scope_type           : current.scope_type,
    scope_client_ids:    fields.scope_client_ids     !== undefined ? fields.scope_client_ids : current.scope_client_ids,
    scope_filter:        fields.scope_filter         !== undefined ? fields.scope_filter     : current.scope_filter,
    output_destination:  fields.output_destination   != null ? fields.output_destination   : current.output_destination,
    condition_filter:    fields.condition_filter     !== undefined ? fields.condition_filter : current.condition_filter,
  };

  const next_run_at = computeNextRun({
    cadence:      merged.cadence,
    day_of_week:  merged.day_of_week,
    day_of_month: merged.day_of_month,
    run_time:     merged.run_time,
    timezone:     merged.timezone,
  });

  const result = await pool.query(
    `UPDATE agent_schedules SET
       agent_name         = $3,
       cadence            = $4,
       day_of_week        = $5,
       day_of_month       = $6,
       run_time           = $7,
       timezone           = $8,
       scope_type         = $9,
       scope_client_ids   = $10,
       scope_filter       = $11,
       output_destination = $12,
       condition_filter   = $13,
       next_run_at        = $14,
       updated_at         = NOW()
     WHERE id = $1 AND coach_id = $2
     RETURNING *`,
    [
      scheduleId, coachId,
      merged.agent_name, merged.cadence,
      merged.day_of_week, merged.day_of_month,
      merged.run_time, merged.timezone,
      merged.scope_type,
      merged.scope_client_ids || null,
      merged.scope_filter ? JSON.stringify(merged.scope_filter) : null,
      merged.output_destination,
      merged.condition_filter ? JSON.stringify(merged.condition_filter) : null,
      next_run_at,
    ]
  );
  return result.rows[0] || null;
}

/**
 * Delete a schedule permanently.
 */
async function deleteSchedule(scheduleId, coachId) {
  const result = await pool.query(
    `DELETE FROM agent_schedules WHERE id = $1 AND coach_id = $2 RETURNING id`,
    [scheduleId, coachId]
  );
  return result.rows[0] || null;
}

/**
 * Pause a schedule (status = 'paused').
 */
async function pauseSchedule(scheduleId, coachId) {
  const result = await pool.query(
    `UPDATE agent_schedules SET status = 'paused', updated_at = NOW()
     WHERE id = $1 AND coach_id = $2 AND status != 'paused'
     RETURNING *`,
    [scheduleId, coachId]
  );
  return result.rows[0] || null;
}

/**
 * Resume a paused schedule (status = 'active', reset failures, recompute next_run_at).
 */
async function resumeSchedule(scheduleId, coachId) {
  const current = await getScheduleById(scheduleId, coachId);
  if (!current) return null;

  const next_run_at = computeNextRun({
    cadence:      current.cadence,
    day_of_week:  current.day_of_week,
    day_of_month: current.day_of_month,
    run_time:     current.run_time,
    timezone:     current.timezone,
  });

  const result = await pool.query(
    `UPDATE agent_schedules
     SET status = 'active', consecutive_failures = 0, next_run_at = $3, updated_at = NOW()
     WHERE id = $1 AND coach_id = $2
     RETURNING *`,
    [scheduleId, coachId, next_run_at]
  );
  return result.rows[0] || null;
}

/**
 * Pause all active schedules for a coach (emergency stop).
 * Returns the number of rows affected.
 */
async function pauseAllForCoach(coachId) {
  const result = await pool.query(
    `UPDATE agent_schedules SET status = 'paused', updated_at = NOW()
     WHERE coach_id = $1 AND status = 'active'
     RETURNING id`,
    [coachId]
  );
  return result.rowCount;
}

/**
 * Get schedules that are due to run (next_run_at <= now, status = 'active').
 * Used by the in-process scheduler.
 */
async function getDueSchedules(now = new Date()) {
  const result = await pool.query(
    `SELECT s.*, c.sheet_id
     FROM agent_schedules s
     JOIN coaches c ON c.id = s.coach_id
     WHERE s.status = 'active'
       AND s.next_run_at <= $1
     ORDER BY s.next_run_at ASC
     LIMIT 100`,
    [now]
  );
  return result.rows;
}

/**
 * Record the result of a scheduled run. Advances next_run_at.
 * Auto-pauses the schedule after 3 consecutive failures.
 *
 * @param {number}  scheduleId
 * @param {'completed'|'failed'} runStatus
 * @param {string|null} errorMessage
 */
async function recordRunResult(scheduleId, runStatus, errorMessage = null) {
  const current = await pool.query(
    `SELECT * FROM agent_schedules WHERE id = $1`, [scheduleId]
  );
  if (!current.rows[0]) return null;

  const s = current.rows[0];
  const next_run_at = computeNextRun(s);

  const failures = runStatus === 'failed'
    ? s.consecutive_failures + 1
    : 0;

  // Auto-pause after 3 consecutive failures
  const newStatus = failures >= 3 ? 'errored' : s.status;

  const result = await pool.query(
    `UPDATE agent_schedules SET
       last_run_at          = NOW(),
       last_run_status      = $2,
       last_error           = $3,
       consecutive_failures = $4,
       status               = $5,
       next_run_at          = $6,
       updated_at           = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      scheduleId,
      runStatus,
      errorMessage,
      failures,
      newStatus,
      next_run_at,
    ]
  );
  return result.rows[0] || null;
}



/**
 * List agent_runs for a given schedule_id (via inputs_json tag).
 */
async function listRunsForSchedule(scheduleId, coachId, limit = 50) {
  const result = await pool.query(
    `SELECT id, status, trigger, output_text, tools_called,
              usage_json, error_message, started_at, finished_at
       FROM agent_runs
       WHERE coach_id = $1
         AND inputs_json->>'schedule_id' = $2
       ORDER BY started_at DESC
       LIMIT $3`,
    [coachId, String(scheduleId), limit]
  );
  return result.rows;
}

// ── Scheduler helpers (used by services/agent-scheduler.js only) ─────────────

/**
 * Fetch an active (non-archived) agent by id + coach_id for scheduled execution.
 * Returns null if not found or archived.
 */
async function getActiveAgent(agentId, coachId) {
  const result = await pool.query(
    `SELECT * FROM imported_agents WHERE id = $1 AND coach_id = $2 AND archived = false`,
    [agentId, coachId]
  );
  return result.rows[0] || null;
}

/**
 * Create a 'running' agent_runs row for a scheduled execution.
 * Returns the new run id and started_at.
 */
async function createScheduledRun(agentId, coachId, scheduleId, sheetsEnabled) {
  const result = await pool.query(
    `INSERT INTO agent_runs (agent_id, coach_id, status, trigger, inputs_json)
     VALUES ($1, $2, 'running', 'scheduled', $3)
     RETURNING id, started_at`,
    [agentId, coachId, JSON.stringify({ schedule_id: scheduleId, sheetsEnabled })]
  );
  return result.rows[0];
}

/**
 * Mark a run as completed.
 */
async function completeScheduledRun(runId, outputText, toolsCalled, usageJson) {
  await pool.query(
    `UPDATE agent_runs
     SET status = 'completed', output_text = $2, tools_called = $3, usage_json = $4, finished_at = NOW()
     WHERE id = $1`,
    [runId, outputText, JSON.stringify(toolsCalled), JSON.stringify(usageJson)]
  );
}

/**
 * Mark a run as failed.
 */
async function failScheduledRun(runId, errorMessage) {
  await pool.query(
    `UPDATE agent_runs SET status = 'failed', error_message = $2, finished_at = NOW() WHERE id = $1`,
    [runId, errorMessage]
  );
}

module.exports = {
  computeNextRun,
  listRunsForSchedule,
  getActiveAgent,
  createScheduledRun,
  completeScheduledRun,
  failScheduledRun,
  createSchedule,
  getSchedulesByCoach,
  getScheduleById,
  updateSchedule,
  deleteSchedule,
  pauseSchedule,
  resumeSchedule,
  pauseAllForCoach,
  getDueSchedules,
  recordRunResult,
};
