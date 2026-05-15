/**
 * db/deploy-events.js — Deploy event counters
 *
 * Owns: deploy_events table. Tracks self-hosted deploys for social proof counter.
 * Does NOT: handle coach accounts, trial state, or any authentication.
 */
const pool = require('./index');

/**
 * Record a new deploy event (called from Render deploy webhook or trial signup).
 * @param {string} eventType - e.g. 'deploy_started', 'trial_signup'
 * @param {object} metadata - optional context
 */
async function recordDeployEvent(eventType = 'deploy_started', metadata = {}) {
  const result = await pool.query(
    `INSERT INTO deploy_events (event_type, metadata)
     VALUES ($1, $2)
     RETURNING id, occurred_at`,
    [eventType, JSON.stringify(metadata)]
  );
  return result.rows[0];
}

/**
 * Get total deploy count (all events of type 'deploy_started').
 * Returns a number ≥ 1 (seeded with production instance at migration time).
 */
async function getDeployCount() {
  const result = await pool.query(
    `SELECT COUNT(*) AS count FROM deploy_events WHERE event_type = 'deploy_started'`
  );
  return parseInt(result.rows[0].count, 10);
}

module.exports = { recordDeployEvent, getDeployCount };
