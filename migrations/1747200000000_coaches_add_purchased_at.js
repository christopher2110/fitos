module.exports = {
  name: 'coaches_add_purchased_at',
  up: async (client) => {
    // Track the exact timestamp of purchase (distinct from converted_at which was used historically).
    // purchased_at is set when payment is verified; converted_at is preserved for backward compat.
    await client.query(`
      ALTER TABLE coaches
        ADD COLUMN IF NOT EXISTS purchased_at TIMESTAMPTZ
    `);
  },
  down: async (client) => {
    await client.query(`
      ALTER TABLE coaches DROP COLUMN IF EXISTS purchased_at
    `);
  },
};
