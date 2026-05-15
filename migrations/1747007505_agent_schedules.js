/**
 * Migration: create agent_schedules table
 *
 * agent_schedules — cron-style scheduling for imported and built-in agents
 */
module.exports = {
  name: 'agent_schedules',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_schedules (
        id                   SERIAL PRIMARY KEY,
        coach_id             INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
        agent_type           VARCHAR(50) NOT NULL,
        agent_id             VARCHAR(255),
        agent_name           VARCHAR(255) NOT NULL,
        cadence              VARCHAR(20) NOT NULL,
        day_of_week          INTEGER,
        day_of_month         INTEGER,
        run_time             TIME NOT NULL,
        timezone             VARCHAR(100) NOT NULL DEFAULT 'America/New_York',
        scope_type           VARCHAR(20) NOT NULL DEFAULT 'all',
        scope_client_ids     TEXT[],
        scope_filter         JSONB,
        output_destination   VARCHAR(20) NOT NULL DEFAULT 'activity',
        condition_filter     JSONB,
        status               VARCHAR(20) NOT NULL DEFAULT 'active',
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_run_at          TIMESTAMPTZ,
        last_run_status      VARCHAR(20),
        last_error           TEXT,
        next_run_at          TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_schedules_coach_id
        ON agent_schedules(coach_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_schedules_next_run
        ON agent_schedules(next_run_at)
        WHERE status = 'active'
    `);
  },

  down: async (client) => {
    await client.query(`DROP TABLE IF EXISTS agent_schedules`);
  },
};
