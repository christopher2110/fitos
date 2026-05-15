/**
 * Migration: create site_events table
 *
 * site_events — lightweight traffic and conversion tracking.
 * Stores page_view, cta_click, and checkout_start events from public pages.
 */
module.exports = {
  name: 'create_site_events',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS site_events (
        id         SERIAL PRIMARY KEY,
        event      VARCHAR(64)  NOT NULL,
        page       VARCHAR(255) NOT NULL,
        source     VARCHAR(255),
        session_id VARCHAR(128),
        created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS site_events_event_idx      ON site_events (event)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS site_events_page_idx       ON site_events (page)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS site_events_created_at_idx ON site_events (created_at)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS site_events_session_idx    ON site_events (session_id)
    `);
  },

  down: async (client) => {
    await client.query('DROP TABLE IF EXISTS site_events');
  },
};
