/**
 * Migration: create deploy_events table
 *
 * deploy_events — tracks self-hosted deploys for the landing page social proof counter.
 * Each row is a deploy event (type: deploy_started) emitted by the deploy webhook or trial signup.
 */
module.exports = {
  name: 'create_deploy_events',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS deploy_events (
        id          SERIAL PRIMARY KEY,
        event_type  VARCHAR(64) NOT NULL DEFAULT 'deploy_started',
        metadata    JSONB NOT NULL DEFAULT '{}',
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS deploy_events_event_type_idx ON deploy_events (event_type)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS deploy_events_occurred_at_idx ON deploy_events (occurred_at)
    `);

    // Seed with 1 initial deploy so counter starts > 0 (our own production instance)
    await client.query(`
      INSERT INTO deploy_events (event_type) VALUES ('deploy_started')
    `);
  },

  down: async (client) => {
    await client.query('DROP TABLE IF EXISTS deploy_events');
  },
};
