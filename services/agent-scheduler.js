/**
 * services/agent-scheduler.js — In-process scheduler for agent_schedules
 *
 * Owns: 15-minute polling loop that finds due schedules and fires them.
 * Does NOT own: agent execution logic (lib/openai-runner), schedule CRUD (db/agent-schedules).
 *
 * Hard limits:
 *   - Max 4 scheduled runs per schedule per day (daily_run_count tracked in run inputs).
 *   - Auto-pauses schedule after 3 consecutive failures (handled in db/agent-schedules.recordRunResult).
 *   - One retry after 5 minutes for failed runs (tracked via retry_of in agent_runs inputs).
 */

const db       = require('../db/agent-schedules');
const dbAgents = require('../db/agents');
const runner   = require('../lib/openai-runner');

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_RUNS_PER_DAY = 4;

// ── Daily run counter (in-memory, reset on restart — acceptable for hard cap) ──

const dailyRunCounts = new Map(); // key: `${scheduleId}:${YYYY-MM-DD}` => count

function dailyKey(scheduleId) {
  const today = new Date().toISOString().slice(0, 10);
  return `${scheduleId}:${today}`;
}

function getDailyCount(scheduleId) {
  return dailyRunCounts.get(dailyKey(scheduleId)) || 0;
}

function incrementDailyCount(scheduleId) {
  const key = dailyKey(scheduleId);
  dailyRunCounts.set(key, (dailyRunCounts.get(key) || 0) + 1);
}

// ── Run a single schedule ──────────────────────────────────────────────────────

async function runSchedule(schedule) {
  // Hard cap: max 4 scheduled runs per day
  if (getDailyCount(schedule.id) >= MAX_RUNS_PER_DAY) {
    console.warn(`[agent-scheduler] schedule ${schedule.id} hit daily cap — skipping`);
    return;
  }

  const sheetId = schedule.sheet_id || null;
  const sheetsEnabled = !!(sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

  // Only imported agents are executable today; builtin skill scheduling is a future phase
  if (schedule.agent_type !== 'imported') {
    console.warn(`[agent-scheduler] schedule ${schedule.id}: agent_type=${schedule.agent_type} not yet supported — skipping`);
    await db.recordRunResult(schedule.id, 'failed', 'agent_type not supported');
    return;
  }

  const agentId = schedule.agent_id ? Number(schedule.agent_id) : null;
  if (!agentId) {
    console.warn(`[agent-scheduler] schedule ${schedule.id}: no agent_id — skipping`);
    await db.recordRunResult(schedule.id, 'failed', 'no agent_id on schedule');
    return;
  }

  // Fetch the agent record (no coach ownership check — we trust the schedule row)
  const agentRecord = await db.getActiveAgent(agentId, schedule.coach_id);

  if (!agentRecord) {
    console.warn(`[agent-scheduler] schedule ${schedule.id}: agent ${agentId} not found or archived`);
    await db.recordRunResult(schedule.id, 'failed', 'agent not found or archived');
    return;
  }

  // Create agent_runs row
  let runRow;
  try {
    runRow = await db.createScheduledRun(agentRecord.id, schedule.coach_id, schedule.id, sheetsEnabled);
  } catch (err) {
    console.error(`[agent-scheduler] schedule ${schedule.id}: failed to create run row:`, err.message);
    return;
  }

  incrementDailyCount(schedule.id);

  try {
    const { outputText, toolsCalled, usage } = await runner.runAgent({
      agentRecord,
      sheetId: sheetsEnabled ? sheetId : null,
      trigger: 'scheduled',
      contextNote: `Scheduled run (cadence: ${schedule.cadence})`,
    });

    await db.completeScheduledRun(runRow.id, outputText, toolsCalled, usage);

    await db.recordRunResult(schedule.id, 'completed', null);
    console.log(`[agent-scheduler] schedule ${schedule.id} completed — run ${runRow.id}`);
  } catch (err) {
    await db.failScheduledRun(runRow.id, err.message);

    await db.recordRunResult(schedule.id, 'failed', err.message);
    console.error(`[agent-scheduler] schedule ${schedule.id} failed — run ${runRow.id}:`, err.message);
  }
}

// ── Main polling tick ─────────────────────────────────────────────────────────

async function tick() {
  if (!process.env.DATABASE_URL) return;

  let dueSchedules;
  try {
    dueSchedules = await db.getDueSchedules();
  } catch (err) {
    console.error('[agent-scheduler] failed to fetch due schedules:', err.message);
    return;
  }

  if (dueSchedules.length === 0) return;

  console.log(`[agent-scheduler] ${dueSchedules.length} schedule(s) due`);

  // Run sequentially to avoid hammering external APIs
  for (const schedule of dueSchedules) {
    try {
      await runSchedule(schedule);
    } catch (err) {
      console.error(`[agent-scheduler] unexpected error for schedule ${schedule.id}:`, err.message);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the in-process 15-minute scheduler.
 * Called once at server startup from server.js.
 */
function startScheduler() {
  if (!process.env.DATABASE_URL) {
    console.log('[agent-scheduler] no DATABASE_URL — scheduler disabled');
    return;
  }

  // Initial tick after a short delay to let the server fully start
  setTimeout(() => {
    tick().catch(err => console.error('[agent-scheduler] startup tick error:', err.message));
  }, 10000);

  setInterval(() => {
    tick().catch(err => console.error('[agent-scheduler] tick error:', err.message));
  }, INTERVAL_MS);

  console.log('[agent-scheduler] scheduler started (15-min interval)');
}

module.exports = { startScheduler };
