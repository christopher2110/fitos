/**
 * lib/email/sender.js — Polsia email proxy wrapper
 *
 * Owns: sending emails via the Polsia email proxy API.
 *       Suppression check before every send (prevents Postmark 422 on inactive addresses).
 * Does NOT: template rendering, drip scheduling, contact list management.
 */

const PROXY_URL = 'https://polsia.com/api/proxy/email';

// Lazy-load to avoid circular dep during startup if db/index isn't ready yet
let _suppressions;
function getSuppressions() {
  if (!_suppressions) _suppressions = require('../../db/email-suppressions');
  return _suppressions;
}

/**
 * Register a coach as a known contact so drip emails are never rate-limited.
 */
async function registerContact({ email, name }) {
  const apiKey = process.env.POLSIA_API_KEY;
  if (!apiKey) {
    console.warn('[email] POLSIA_API_KEY not set — skipping contact registration');
    return;
  }
  try {
    const res = await fetch(`${PROXY_URL}/contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ email, name: name || undefined, source: 'signup' }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[email] contact registration failed (${res.status}): ${body}`);
    }
  } catch (err) {
    console.warn('[email] contact registration error:', err.message);
  }
}

/**
 * Send an email via the Polsia proxy.
 * Returns true on success, false on failure (non-throwing — drip must not crash the app).
 * Suppressed addresses are skipped silently at info level — no error noise.
 */
async function sendEmail({ to, subject, body, html }) {
  const apiKey = process.env.POLSIA_API_KEY;
  if (!apiKey) {
    console.warn('[email] POLSIA_API_KEY not set — skipping send');
    return false;
  }

  // Suppression check — skip known-inactive/bounced addresses before hitting Postmark
  if (process.env.DATABASE_URL) {
    try {
      const suppressed = await getSuppressions().isSuppressed(to);
      if (suppressed) {
        console.log(`[email] suppressed — skipping send to ${to}`);
        return false;
      }
    } catch (err) {
      // Suppression DB error must not block sends — log and continue
      console.warn('[email] suppression check error (continuing):', err.message);
    }
  }

  try {
    const res = await fetch(`${PROXY_URL}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ to, subject, body, html }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[email] send failed to ${to} (${res.status}): ${errBody}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[email] send error to ${to}:`, err.message);
    return false;
  }
}

module.exports = { registerContact, sendEmail };
