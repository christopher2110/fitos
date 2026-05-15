/**
 * db/agents.js — Imported agent and agent run query functions
 *
 * Owns: imported_agents table, agent_runs table
 * Does NOT own: encryption/decryption (that's lib/openai-runner), HTTP handling, OpenAI calls
 */
const pool = require('./index');

// ── Imported Agents ──────────────────────────────────────────────────────────

/**
 * List all non-archived agents for a coach.
 * Returns agent records without the encrypted key field.
 */
async function listAgents(coachId) {
  const result = await pool.query(
    `SELECT id, display_name, description, icon, assistant_id,
            granted_scopes, run_mode, schedule, archived, created_at, updated_at
     FROM imported_agents
     WHERE coach_id = $1 AND archived = false
     ORDER BY created_at DESC`,
    [coachId]
  );
  return result.rows;
}

/**
 * Get a single agent by id, enforcing coach ownership.
 * Returns null if not found or unauthorized.
 */
async function getAgent(agentId, coachId) {
  const result = await pool.query(
    `SELECT * FROM imported_agents WHERE id = $1 AND coach_id = $2`,
    [agentId, coachId]
  );
  return result.rows[0] || null;
}

/**
 * Create a new imported agent.
 * @param {object} fields
 *   coach_id, display_name, description, icon, assistant_id,
 *   openai_key_enc, granted_scopes, run_mode, schedule
 */
async function createAgent(fields) {
  const {
    coach_id, display_name, description = '', icon = '🤖',
    assistant_id, openai_key_enc,
    granted_scopes = [], run_mode = 'on_demand', schedule = null,
  } = fields;

  const result = await pool.query(
    `INSERT INTO imported_agents
       (coach_id, display_name, description, icon, assistant_id,
        openai_key_enc, granted_scopes, run_mode, schedule)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, display_name, description, icon, assistant_id,
               granted_scopes, run_mode, schedule, created_at`,
    [
      coach_id, display_name, description, icon,
      assistant_id, openai_key_enc,
      JSON.stringify(granted_scopes),
      run_mode, schedule,
    ]
  );
  return result.rows[0];
}

/**
 * Update an existing agent's metadata. Does NOT update the key.
 */
async function updateAgent(agentId, coachId, fields) {
  const { display_name, description, icon, granted_scopes, run_mode, schedule } = fields;
  const result = await pool.query(
    `UPDATE imported_agents
     SET display_name = COALESCE($3, display_name),
         description  = COALESCE($4, description),
         icon         = COALESCE($5, icon),
         granted_scopes = COALESCE($6, granted_scopes),
         run_mode     = COALESCE($7, run_mode),
         schedule     = $8,
         updated_at   = now()
     WHERE id = $1 AND coach_id = $2
     RETURNING id, display_name, description, icon, assistant_id,
               granted_scopes, run_mode, schedule, updated_at`,
    [
      agentId, coachId,
      display_name, description, icon,
      granted_scopes ? JSON.stringify(granted_scopes) : null,
      run_mode, schedule,
    ]
  );
  return result.rows[0] || null;
}

/**
 * Soft-delete an agent (set archived = true).
 */
async function archiveAgent(agentId, coachId) {
  const result = await pool.query(
    `UPDATE imported_agents SET archived = true, updated_at = now()
     WHERE id = $1 AND coach_id = $2
     RETURNING id`,
    [agentId, coachId]
  );
  return result.rows[0] || null;
}

// ── Agent Runs ───────────────────────────────────────────────────────────────

/**
 * Create a run record, returning the run id.
 */
async function createRun(agentId, coachId, trigger = 'manual', inputsJson = {}) {
  const result = await pool.query(
    `INSERT INTO agent_runs (agent_id, coach_id, status, trigger, inputs_json)
     VALUES ($1, $2, 'running', $3, $4)
     RETURNING id, started_at`,
    [agentId, coachId, trigger, JSON.stringify(inputsJson)]
  );
  return result.rows[0];
}

/**
 * Mark a run as completed with output, tools called, and usage.
 */
async function completeRun(runId, { outputText, toolsCalled = [], usageJson = {} }) {
  await pool.query(
    `UPDATE agent_runs
     SET status = 'completed',
         output_text  = $2,
         tools_called = $3,
         usage_json   = $4,
         finished_at  = now()
     WHERE id = $1`,
    [runId, outputText, JSON.stringify(toolsCalled), JSON.stringify(usageJson)]
  );
}

/**
 * Mark a run as failed.
 */
async function failRun(runId, errorMessage) {
  await pool.query(
    `UPDATE agent_runs
     SET status = 'failed', error_message = $2, finished_at = now()
     WHERE id = $1`,
    [runId, errorMessage]
  );
}

/**
 * List recent runs for a specific agent.
 */
async function listRuns(agentId, coachId, limit = 50) {
  const result = await pool.query(
    `SELECT id, status, trigger, output_text, tools_called,
            usage_json, error_message, started_at, finished_at
     FROM agent_runs
     WHERE agent_id = $1 AND coach_id = $2
     ORDER BY started_at DESC
     LIMIT $3`,
    [agentId, coachId, limit]
  );
  return result.rows;
}

/**
 * Get a single run by id (enforces coach ownership via agent join).
 */
async function getRun(runId, coachId) {
  const result = await pool.query(
    `SELECT r.* FROM agent_runs r
     JOIN imported_agents a ON a.id = r.agent_id
     WHERE r.id = $1 AND r.coach_id = $2`,
    [runId, coachId]
  );
  return result.rows[0] || null;
}

module.exports = {
  listAgents, getAgent, createAgent, updateAgent, archiveAgent,
  createRun, completeRun, failRun, listRuns, getRun,
};
