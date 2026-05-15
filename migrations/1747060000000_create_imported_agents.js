/**
 * Migration: create imported_agents and agent_runs tables
 *
 * imported_agents — OpenAI agent configs imported by coaches
 * agent_runs      — Audit log of every agent execution
 */
module.exports = {
  name: 'create_imported_agents',
  up: async (client) => {
    // Imported OpenAI agents (per-coach)
    await client.query(`
      CREATE TABLE IF NOT EXISTS imported_agents (
        id              SERIAL PRIMARY KEY,
        coach_id        INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
        display_name    VARCHAR(200) NOT NULL,
        description     TEXT NOT NULL DEFAULT '',
        icon            VARCHAR(10) NOT NULL DEFAULT '🤖',
        assistant_id    VARCHAR(100) NOT NULL,
        openai_key_enc  TEXT NOT NULL,
        granted_scopes  JSONB NOT NULL DEFAULT '[]'::jsonb,
        run_mode        VARCHAR(20) NOT NULL DEFAULT 'on_demand',
        schedule        VARCHAR(100),
        archived        BOOLEAN NOT NULL DEFAULT false,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS imported_agents_coach_id_idx ON imported_agents (coach_id)
    `);

    // Audit log — one row per agent execution
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id             SERIAL PRIMARY KEY,
        agent_id       INTEGER NOT NULL REFERENCES imported_agents(id) ON DELETE CASCADE,
        coach_id       INTEGER NOT NULL,
        status         VARCHAR(20) NOT NULL DEFAULT 'running',
        trigger        VARCHAR(30) NOT NULL DEFAULT 'manual',
        inputs_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
        output_text    TEXT NOT NULL DEFAULT '',
        tools_called   JSONB NOT NULL DEFAULT '[]'::jsonb,
        usage_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_message  TEXT,
        started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at    TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS agent_runs_agent_id_idx ON agent_runs (agent_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS agent_runs_coach_id_idx ON agent_runs (coach_id)
    `);
  },
};
