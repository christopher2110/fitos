/**
 * db/referrals.js — Referral program query functions
 *
 * Owns: referrals table — creation, status tracking, reward attribution.
 * Does NOT: handle payment processing, email sending, or cookie management.
 */
const pool = require('./index');
const crypto = require('crypto');

/**
 * Generate a unique 8-char uppercase referral code.
 * Format: e.g. "A3B7F2K9"
 */
function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

/**
 * Get a coach's referral code. Creates one if none exists yet.
 * Idempotent — safe to call on every dashboard load.
 */
async function ensureReferralCode(coachId) {
  // Try to get existing code first
  let result = await pool.query(
    'SELECT referral_code FROM coaches WHERE id = $1',
    [coachId]
  );
  const coach = result.rows[0];
  if (!coach) return null;
  if (coach.referral_code) return coach.referral_code;

  // Generate a new unique code with retry on collision
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    try {
      const updated = await pool.query(
        `UPDATE coaches SET referral_code = $1, updated_at = NOW()
         WHERE id = $2 AND referral_code IS NULL
         RETURNING referral_code`,
        [code, coachId]
      );
      if (updated.rows[0]) return updated.rows[0].referral_code;
      // Race condition — someone else set it, fetch theirs
      result = await pool.query('SELECT referral_code FROM coaches WHERE id = $1', [coachId]);
      return result.rows[0]?.referral_code || null;
    } catch (err) {
      // Unique constraint violation — try again
      if (err.code !== '23505') throw err;
    }
  }
  throw new Error('Failed to generate unique referral code after 5 attempts');
}

/**
 * Look up a coach by referral code.
 */
async function getCoachByReferralCode(code) {
  const result = await pool.query(
    'SELECT id, name, email FROM coaches WHERE referral_code = $1',
    [code.toUpperCase()]
  );
  return result.rows[0] || null;
}

/**
 * Record a referral attribution — called when a referred coach signs up.
 * referrerCoachId: the coach who owns the code
 * referredCoachId: the new coach who used the code
 * referralCode: the code used
 */
async function createReferral({ referrerCoachId, referredCoachId, referralCode }) {
  // Prevent self-referral
  if (referrerCoachId === referredCoachId) return null;

  // Prevent duplicate attribution (one code → one coach)
  const existing = await pool.query(
    'SELECT id FROM referrals WHERE referred_coach_id = $1',
    [referredCoachId]
  );
  if (existing.rows.length > 0) return null;

  const result = await pool.query(
    `INSERT INTO referrals (referrer_coach_id, referred_coach_id, referral_code, status, reward_amount)
     VALUES ($1, $2, $3, 'pending', 197)
     RETURNING *`,
    [referrerCoachId, referredCoachId, referralCode]
  );
  return result.rows[0];
}

/**
 * Convert a referral to 'converted' status when the referred coach purchases.
 * A 30-day hold period before marking payable (chargeback protection).
 * referredCoachId: the coach who just purchased
 */
async function convertReferral(referredCoachId) {
  const result = await pool.query(
    `UPDATE referrals
     SET status = 'converted', converted_at = NOW()
     WHERE referred_coach_id = $1 AND status = 'pending'
     RETURNING *`,
    [referredCoachId]
  );
  return result.rows[0] || null;
}

/**
 * Get referral stats for a coach's dashboard card.
 * Returns: referralCode, referralLink, totalReferrals, converted, totalEarned, payable
 */
async function getReferralStats(coachId, appBaseUrl) {
  const code = await ensureReferralCode(coachId);
  const referralLink = `${appBaseUrl}/ref/${code}`;

  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending')   AS pending_count,
       COUNT(*) FILTER (WHERE status = 'converted') AS converted_count,
       COUNT(*) FILTER (WHERE status = 'paid')      AS paid_count,
       COALESCE(SUM(reward_amount) FILTER (WHERE status IN ('converted','paid')), 0) AS total_earned,
       COALESCE(SUM(reward_amount) FILTER (
         WHERE status = 'converted'
           AND converted_at <= NOW() - INTERVAL '30 days'
       ), 0) AS payable_amount
     FROM referrals
     WHERE referrer_coach_id = $1`,
    [coachId]
  );

  const row = result.rows[0];
  return {
    referralCode: code,
    referralLink,
    totalReferrals: parseInt(row.pending_count) + parseInt(row.converted_count) + parseInt(row.paid_count),
    converted: parseInt(row.converted_count) + parseInt(row.paid_count),
    totalEarned: parseInt(row.total_earned),
    payableAmount: parseInt(row.payable_amount),
  };
}

/**
 * Get full referral list for a coach (for detailed view).
 */
async function getReferralList(coachId) {
  const result = await pool.query(
    `SELECT r.id, r.status, r.reward_amount, r.created_at, r.converted_at, r.paid_at,
            c.name AS referred_name, c.email AS referred_email
     FROM referrals r
     LEFT JOIN coaches c ON c.id = r.referred_coach_id
     WHERE r.referrer_coach_id = $1
     ORDER BY r.created_at DESC`,
    [coachId]
  );
  return result.rows;
}

module.exports = {
  generateReferralCode,
  ensureReferralCode,
  getCoachByReferralCode,
  createReferral,
  convertReferral,
  getReferralStats,
  getReferralList,
};
