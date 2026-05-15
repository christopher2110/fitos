/**
 * Migration: add byok_creds_enc to coaches
 * Stores AES-256-GCM encrypted service-account JSON for BYOK path.
 * onboarding_path: 'polsia' | 'byok' | null (null = not yet completed)
 */

exports.up = async (db) => {
  await db.query(`
    ALTER TABLE coaches
      ADD COLUMN IF NOT EXISTS byok_creds_enc TEXT,
      ADD COLUMN IF NOT EXISTS onboarding_path TEXT,
      ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ
  `);
};

exports.down = async (db) => {
  await db.query(`
    ALTER TABLE coaches
      DROP COLUMN IF EXISTS byok_creds_enc,
      DROP COLUMN IF EXISTS onboarding_path,
      DROP COLUMN IF EXISTS onboarding_completed_at
  `);
};
