/**
 * services/email-drip.js — Trial email drip scheduler
 *
 * Owns: hourly cron that finds coaches due for each drip step and sends the email.
 *       Unsubscribe token generation (HMAC-based, no DB state needed).
 * Does NOT: render templates, send emails, or run queries (delegates to lib/email/ and db/coaches.js).
 *
 * Steps: day0 (immediate), day3, day7, day12, day14, day16 (post-expiry win-back).
 * Each step fires once; coaches.trial_email_sent_at JSONB records when each step fired.
 * Unsubscribed coaches have trial_email_sent_at->>'unsubscribed' set to a truthy value.
 */

const coaches = require('../db/coaches');
const { sendEmail } = require('../lib/email/sender');
const { DRIP_STEPS } = require('../lib/email/templates');
const crypto = require('crypto');

const APP_URL = process.env.APP_URL || 'https://fitos-zc11.polsia.app';

// ---------------------------------------------------------------------------
// Unsubscribe tokens — HMAC(coach_id + created_at, secret)
// Stateless: no DB row needed to validate.
// ---------------------------------------------------------------------------
function getUnsubscribeSecret() {
  return process.env.FITOS_KEY_SECRET || 'dev-secret-change-me';
}

function makeUnsubscribeToken(coachId, createdAt) {
  const data = `unsub:${coachId}:${createdAt}`;
  return crypto.createHmac('sha256', getUnsubscribeSecret()).update(data).digest('hex');
}

function verifyUnsubscribeToken(coachId, createdAt, token) {
  const expected = makeUnsubscribeToken(coachId, String(createdAt));
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch (_) {
    return false;
  }
}

function buildUnsubscribeUrl(coachId, createdAt) {
  const token = makeUnsubscribeToken(coachId, String(createdAt));
  return `${APP_URL}/trial/unsubscribe?id=${coachId}&token=${token}`;
}

// ---------------------------------------------------------------------------
// Drip runner — called by the hourly cron
// ---------------------------------------------------------------------------
async function runDrip() {
  if (!process.env.DATABASE_URL) return;
  if (!process.env.POLSIA_API_KEY) {
    console.warn('[email-drip] POLSIA_API_KEY not set — skipping drip run');
    return;
  }

  let rows;
  try {
    rows = await coaches.getDripEligibleCoaches();
  } catch (err) {
    console.error('[email-drip] DB fetch error:', err.message);
    return;
  }

  const now = Date.now();

  for (const coach of rows) {
    const sent = coach.trial_email_sent_at || {};
    const createdAt = new Date(coach.created_at).getTime();
    const daysSinceSignup = (now - createdAt) / (1000 * 60 * 60 * 24);
    const unsubUrl = buildUnsubscribeUrl(coach.id, String(coach.created_at));

    for (const { step, dayOffset, template, skipIfConverted } of DRIP_STEPS) {
      // Already sent this step
      if (sent[step]) continue;

      // Not yet due
      if (daysSinceSignup < dayOffset) continue;

      // Skip conversion-gated steps for paying coaches
      if (skipIfConverted && coach.status === 'converted') {
        // Mark skipped so we don't re-evaluate every hour
        await coaches.setEmailStepSent(coach.id, step, 'skipped').catch(err =>
          console.error(`[email-drip] setEmailStepSent(${coach.id}, ${step}) error:`, err.message)
        );
        continue;
      }

      // Render and send
      const { subject, html, text } = template({ name: coach.name, unsubscribeUrl: unsubUrl });

      const ok = await sendEmail({ to: coach.email, subject, body: text, html });

      if (ok) {
        await coaches.setEmailStepSent(coach.id, step, new Date().toISOString()).catch(err =>
          console.error(`[email-drip] setEmailStepSent(${coach.id}, ${step}) error:`, err.message)
        );
        console.log(`[email-drip] sent ${step} to ${coach.email}`);
      } else {
        // Leave unsent — will retry next hour
        console.warn(`[email-drip] failed to send ${step} to ${coach.email} — will retry`);
      }

      // One step per coach per cron tick to avoid hammering the proxy
      break;
    }
  }
}

/**
 * Mark a coach as unsubscribed. Called by the /trial/unsubscribe route.
 */
async function markUnsubscribed(coachId) {
  try {
    await coaches.markEmailUnsubscribed(coachId);
    return true;
  } catch (err) {
    console.error(`[email-drip] markUnsubscribed(${coachId}) error:`, err.message);
    return false;
  }
}

/**
 * Send day0 immediately after signup — called from routes/trial.js.
 * Fire-and-forget: errors are logged, not thrown.
 */
async function sendDay0Immediately(coach) {
  if (!process.env.POLSIA_API_KEY) return;

  const day0Step = DRIP_STEPS.find(s => s.step === 'day0');
  if (!day0Step) return;

  const unsubUrl = buildUnsubscribeUrl(coach.id, String(coach.created_at));
  const { subject, html, text } = day0Step.template({ name: coach.name, unsubscribeUrl: unsubUrl });

  const ok = await sendEmail({ to: coach.email, subject, body: text, html });
  if (ok) {
    await coaches.setEmailStepSent(coach.id, 'day0', new Date().toISOString()).catch(() => {});
    console.log(`[email-drip] day0 sent immediately to ${coach.email}`);
  } else {
    console.warn(`[email-drip] day0 immediate send failed for ${coach.email} — cron will retry`);
  }
}

/**
 * Start the hourly cron. Called once at server startup.
 */
function startDripCron() {
  if (!process.env.DATABASE_URL) {
    console.log('[email-drip] no DATABASE_URL — drip cron disabled');
    return;
  }

  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  // Run immediately on startup to catch any missed sends across deploys
  runDrip().catch(err => console.error('[email-drip] cron startup run error:', err.message));

  setInterval(() => {
    runDrip().catch(err => console.error('[email-drip] cron error:', err.message));
  }, INTERVAL_MS);

  console.log('[email-drip] drip cron started (hourly)');
}

module.exports = {
  startDripCron,
  sendDay0Immediately,
  markUnsubscribed,
  verifyUnsubscribeToken,
};
