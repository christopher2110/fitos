/**
 * routes/email-webhook.js — Postmark inbound webhook handler
 *
 * Owns: POST /api/email/webhook — receives Postmark bounce + spam_complaint events
 *       and auto-adds addresses to the email_suppressions table.
 * Does NOT: send emails, validate drip state, or touch the coaches table.
 *
 * Postmark webhook payload docs:
 *   Bounce:          { RecordType: 'Bounce', Email: '...', Type: 'HardBounce|SoftBounce|...' }
 *   SpamComplaint:   { RecordType: 'SpamComplaint', Email: '...' }
 */
const { Router } = require('express');
const { suppress } = require('../db/email-suppressions');

const router = Router();

// Optional shared secret for basic webhook auth.
// Set POSTMARK_WEBHOOK_SECRET env var in Render to a random string,
// then configure the same value as the "X-Postmark-Token" header in the Postmark UI.
// If the env var is unset, the endpoint is unauthenticated (still safe — it can only add suppressions).
const WEBHOOK_SECRET = process.env.POSTMARK_WEBHOOK_SECRET;

router.post('/', async (req, res) => {
  // Optional token check — fail open if not configured
  if (WEBHOOK_SECRET) {
    const token = req.headers['x-postmark-token'];
    if (token !== WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const { RecordType, Email } = req.body || {};

  if (!Email || typeof Email !== 'string') {
    // Postmark sends test pings without an Email field — return 200 so it doesn't retry
    return res.json({ ok: true, action: 'noop' });
  }

  const email = Email.trim().toLowerCase();

  if (RecordType === 'Bounce') {
    // Hard bounces + most soft bounces warrant suppression; Postmark deactivates on hard bounce anyway
    await suppress(email, 'bounce', 'postmark_webhook').catch(err =>
      console.warn(`[email-webhook] suppress(${email}) error:`, err.message)
    );
    console.log(`[email-webhook] bounce suppressed: ${email}`);
    return res.json({ ok: true, action: 'suppressed', reason: 'bounce' });
  }

  if (RecordType === 'SpamComplaint') {
    await suppress(email, 'spam_complaint', 'postmark_webhook').catch(err =>
      console.warn(`[email-webhook] suppress(${email}) error:`, err.message)
    );
    console.log(`[email-webhook] spam_complaint suppressed: ${email}`);
    return res.json({ ok: true, action: 'suppressed', reason: 'spam_complaint' });
  }

  // Other event types (Open, Click, etc.) — acknowledge and ignore
  return res.json({ ok: true, action: 'noop' });
});

module.exports = router;
