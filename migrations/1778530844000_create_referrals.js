/**
 * Migration: add referral_code to coaches + create referrals table
 *
 * coaches.referral_code — unique 8-char code, generated at signup, used for referral links
 * referrals — one row per coach-to-coach referral, tracks status and reward
 */
module.exports = {
  name: 'create_referrals',
  up: async (client) => {
    // Add referral_code column to coaches
    await client.query(`
      ALTER TABLE coaches
      ADD COLUMN IF NOT EXISTS referral_code VARCHAR(16) UNIQUE
    `);

    // referrals table — one row per referral relationship
    await client.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id                SERIAL PRIMARY KEY,
        referrer_coach_id INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
        referred_coach_id INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
        referral_code     VARCHAR(16) NOT NULL,
        status            VARCHAR(20) NOT NULL DEFAULT 'pending',
        reward_amount     INTEGER NOT NULL DEFAULT 197,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        converted_at      TIMESTAMPTZ,
        paid_at           TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS referrals_referrer_coach_id_idx ON referrals (referrer_coach_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS referrals_referral_code_idx ON referrals (referral_code)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS referrals_referred_coach_id_idx ON referrals (referred_coach_id)
    `);
  },

  down: async (client) => {
    await client.query('DROP TABLE IF EXISTS referrals');
    await client.query('ALTER TABLE coaches DROP COLUMN IF EXISTS referral_code');
  },
};
