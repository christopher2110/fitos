module.exports = {
  name: 'coaches_add_sheet_id',
  up: async (client) => {
    // Add sheet_id for multi-tenant Sheet routing.
    // Set during /setup Step 1 "Verify Connection".
    // Null = no Sheet connected yet (coach in onboarding or demo mode).
    await client.query(`
      ALTER TABLE coaches
      ADD COLUMN IF NOT EXISTS sheet_id VARCHAR(255)
    `);
  },
  down: async (client) => {
    await client.query(`
      ALTER TABLE coaches
      DROP COLUMN IF EXISTS sheet_id
    `);
  },
};
