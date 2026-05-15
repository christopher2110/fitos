/**
 * db/coaches.js — Coach account query functions
 *
 * Owns: coaches table — trial status, expiry timestamps, conversion tracking,
 *       password hashing for self-signup flow.
 * Does NOT: handle session management or payment processing.
 */
const pool = require('./index');
const crypto = require('crypto');

// PBKDF2 password hash — no external dependency required.
// Returns "pbkdf2:<salt>:<hash>" stored in password_hash column.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `pbkdf2:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('pbkdf2:')) return false;
  const [, salt, hash] = stored.split(':');
  const candidate = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

/**
 * Find a coach by their unique access token.
 * Returns null if no coach found.
 */
async function getCoachByToken(token) {
  const result = await pool.query(
    'SELECT * FROM coaches WHERE access_token = $1',
    [token]
  );
  return result.rows[0] || null;
}

/**
 * Find a coach by email.
 */
async function getCoachByEmail(email) {
  const result = await pool.query(
    'SELECT * FROM coaches WHERE email = $1',
    [email]
  );
  return result.rows[0] || null;
}

/**
 * Create a new coach with trial starting now.
 * trial_expires_at defaults to 14 days from now.
 */
async function createCoach({ email, name, accessToken }) {
  const result = await pool.query(
    `INSERT INTO coaches (email, name, access_token, status, trial_expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'trial', NOW() + INTERVAL '14 days', NOW(), NOW())
     ON CONFLICT (access_token) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [email, name, accessToken]
  );
  return result.rows[0];
}

/**
 * Mark a coach's trial as expired.
 * Called by the trial middleware when trial_expires_at has passed.
 */
async function markTrialExpired(coachId) {
  await pool.query(
    `UPDATE coaches
     SET status = 'expired', trial_expired_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'trial'`,
    [coachId]
  );
}

/**
 * Mark a coach as converted (paid).
 * Sets purchased_at to record exact payment timestamp (converted_at preserved for backward compat).
 */
async function markConverted(coachId) {
  await pool.query(
    `UPDATE coaches
     SET status = 'converted', converted_at = COALESCE(converted_at, NOW()), purchased_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [coachId]
  );
}

/**
 * Mark a coach as converted by email (for payment success flow).
 */
async function markConvertedByEmail(email) {
  const result = await pool.query(
    `UPDATE coaches
     SET status = 'converted', converted_at = COALESCE(converted_at, NOW()), purchased_at = NOW(), updated_at = NOW()
     WHERE email = $1
     RETURNING *`,
    [email]
  );
  return result.rows[0] || null;
}

/**
 * Get trial status summary for a coach.
 * Returns days remaining (negative if expired), status, etc.
 */
async function getTrialStatus(coachId) {
  const result = await pool.query(
    `SELECT
       id,
       email,
       name,
       status,
       trial_expires_at,
       trial_expired_at,
       converted_at,
       EXTRACT(EPOCH FROM (trial_expires_at - NOW())) / 86400 AS days_remaining
     FROM coaches
     WHERE id = $1`,
    [coachId]
  );
  return result.rows[0] || null;
}

/**
 * Create a new coach via self-signup (email + name + password).
 * Generates a unique access_token + referral_code, hashes the password, starts 14-day trial.
 * Returns null if email already exists.
 */
async function createCoachWithPassword({ email, name, password }) {
  const accessToken = crypto.randomBytes(32).toString('hex');
  const passwordHash = hashPassword(password);
  // 8-char uppercase referral code — every coach gets one from day 1
  const referralCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  try {
    const result = await pool.query(
      `INSERT INTO coaches (email, name, access_token, password_hash, referral_code, status, trial_expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'trial', NOW() + INTERVAL '14 days', NOW(), NOW())
       RETURNING *`,
      [email.toLowerCase().trim(), name.trim(), accessToken, passwordHash, referralCode]
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === '23505') {
      // Unique constraint on email OR referral_code — retry with new code for referral_code collision
      if (err.constraint && err.constraint.includes('referral_code')) {
        // Extremely rare — recurse once to try a fresh code
        return createCoachWithPassword({ email, name, password });
      }
      return null; // Email already exists
    }
    throw err;
  }
}

/**
 * Verify email + password. Returns coach row or null on bad credentials.
 */
async function getCoachByCredentials(email, password) {
  const result = await pool.query(
    'SELECT * FROM coaches WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  const coach = result.rows[0];
  if (!coach) return null;
  if (!verifyPassword(password, coach.password_hash)) return null;
  return coach;
}

/**
 * Look up a coach by primary key.
 */
async function getCoachById(id) {
  const result = await pool.query('SELECT * FROM coaches WHERE id = $1', [id]);
  return result.rows[0] || null;
}

/**
 * Persist the verified Google Sheet ID for a coach.
 * Called by /api/setup/verify after a successful Sheet connection test.
 */
async function saveSheetId(coachId, sheetId) {
  await pool.query(
    'UPDATE coaches SET sheet_id = $1, updated_at = NOW() WHERE id = $2',
    [sheetId, coachId]
  );
}

/**
 * Fetch all coaches eligible for drip emails:
 * - Not unsubscribed (trial_email_sent_at->>'unsubscribed' is null)
 * - Have an email address
 */
async function getDripEligibleCoaches() {
  const result = await pool.query(`
    SELECT id, email, name, status, created_at, trial_email_sent_at
    FROM coaches
    WHERE (trial_email_sent_at->>'unsubscribed') IS NULL
      AND email IS NOT NULL
  `);
  return result.rows;
}

/**
 * Record that a drip step was sent (or skipped) for a coach.
 * step: e.g. 'day0', 'day3'. value: ISO timestamp or 'skipped'.
 */
async function setEmailStepSent(coachId, step, value) {
  // Cast $1 explicitly to text — PostgreSQL can't infer jsonb_build_object key type from param alone.
  await pool.query(
    `UPDATE coaches
     SET trial_email_sent_at = COALESCE(trial_email_sent_at, '{}'::jsonb) || jsonb_build_object($1::text, $2::text),
         updated_at = NOW()
     WHERE id = $3`,
    [step, value, coachId]
  );
}

/**
 * Mark a coach as unsubscribed from the drip sequence.
 */
async function markEmailUnsubscribed(coachId) {
  await pool.query(
    `UPDATE coaches
     SET trial_email_sent_at = COALESCE(trial_email_sent_at, '{}'::jsonb) || '{"unsubscribed": "true"}'::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [coachId]
  );
}

/**
 * Save encrypted BYOK credentials for a coach.
 * Called by /api/onboarding/validate-byok-sheet after validation.
 */
async function saveByokCreds(coachId, encryptedCreds) {
  await pool.query(
    'UPDATE coaches SET byok_creds_enc = $1, updated_at = NOW() WHERE id = $2',
    [encryptedCreds, coachId]
  );
}

/**
 * Record that onboarding completed (path = 'polsia' | 'byok').
 */
async function markOnboardingComplete(coachId, path) {
  await pool.query(
    `UPDATE coaches
     SET onboarding_path = $1, onboarding_completed_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [path, coachId]
  );
}

module.exports = {
  getCoachByToken,
  getCoachByEmail,
  getCoachById,
  createCoach,
  markTrialExpired,
  markConverted,
  markConvertedByEmail,
  getTrialStatus,
  createCoachWithPassword,
  getCoachByCredentials,
  saveSheetId,
  saveByokCreds,
  markOnboardingComplete,
  getDripEligibleCoaches,
  setEmailStepSent,
  markEmailUnsubscribed,
};
