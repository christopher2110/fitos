/**
 * db/email-suppressions.js — Email suppression list query functions
 *
 * Owns: email_suppressions table — reads + inserts for bounce/spam suppression.
 * Does NOT: send emails, manage drip schedules, or validate Postmark webhook signatures.
 */
const pool = require('./index');

/**
 * Check whether an email address is suppressed.
 * Case-insensitive lookup. Returns true if suppressed, false otherwise.
 */
async function isSuppressed(email) {
  const result = await pool.query(
    'SELECT 1 FROM email_suppressions WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email]
  );
  return result.rows.length > 0;
}

/**
 * Add an email address to the suppression list.
 * reason: 'bounce' | 'spam_complaint' | 'inactive' | 'manual'
 * source: 'postmark_webhook' | 'seed' | 'admin'
 * No-ops silently if already suppressed (ON CONFLICT DO NOTHING).
 */
async function suppress(email, reason, source) {
  await pool.query(
    `INSERT INTO email_suppressions (email, reason, source, suppressed_at)
     VALUES (LOWER($1), $2, $3, NOW())
     ON CONFLICT DO NOTHING`,
    [email, reason, source]
  );
}

module.exports = { isSuppressed, suppress };
