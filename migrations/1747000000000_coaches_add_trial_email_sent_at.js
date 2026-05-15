module.exports = {
  name: 'coaches_add_trial_email_sent_at',
  up: async (client) => {
    // Tracks which drip emails have fired for each coach.
    // Keys are email step names (e.g. "day0", "day3", "day7", "day12", "day14", "day16").
    // Values are ISO timestamps of when each email was sent.
    // JSONB allows adding new steps without schema changes.
    await client.query(`
      ALTER TABLE coaches
      ADD COLUMN IF NOT EXISTS trial_email_sent_at JSONB DEFAULT '{}'::jsonb
    `);
  },
  down: async (client) => {
    await client.query(`
      ALTER TABLE coaches
      DROP COLUMN IF EXISTS trial_email_sent_at
    `);
  },
};
