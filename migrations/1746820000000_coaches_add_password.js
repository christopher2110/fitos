module.exports = {
  name: 'coaches_add_password',
  up: async (client) => {
    // Add password_hash for self-signup flow.
    // Nullable — seeded coaches (COACH_TRIAL_TOKEN) have no password.
    await client.query(`
      ALTER TABLE coaches
      ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)
    `);
  },
  down: async (client) => {
    await client.query(`
      ALTER TABLE coaches
      DROP COLUMN IF EXISTS password_hash
    `);
  },
};
