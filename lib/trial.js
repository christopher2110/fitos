/**
 * lib/trial.js — Trial expiry middleware and status helpers
 *
 * Owns: trial expiry checking, banner injection, status transitions.
 * Does NOT: handle payment processing, Stripe verification, or auth.
 *
 * How it works:
 * - Each deployed FitOS instance has a COACH_TRIAL_TOKEN env var (set at provisioning time).
 * - On first request, a coaches row is seeded automatically.
 * - Every request checks trial status and either:
 *   (a) blocks + redirects to /trial/expired, or
 *   (b) injects a "X days remaining" banner into HTML responses.
 */
const coaches = require('../db/coaches');
const crypto = require('crypto');

// Verify the HMAC-signed cookie produced by routes/trial.js signToken().
// Returns the raw access_token string or null if invalid.
function verifySignedCookieToken(signed) {
  if (!signed) return null;
  const lastDot = signed.lastIndexOf('.');
  if (lastDot === -1) return null;
  const token = signed.slice(0, lastDot);
  const sig = signed.slice(lastDot + 1);
  const secret = process.env.FITOS_KEY_SECRET || 'dev-secret-change-me';
  const expected = crypto.createHmac('sha256', secret).update(token).digest('hex');
  try {
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch (_) { return null; }
  return token;
}

// Routes that are always accessible — even after trial expires.
// Public pages, static assets, the expired page itself, payment flow, signup, and setup.
const ALWAYS_ALLOWED = [
  '/trial/expired',
  '/trial/signup',
  '/payment/success',
  '/health',
];

const ALWAYS_ALLOWED_PREFIXES = [
  '/public/',
  '/_next/',
  '/api/setup',
  '/setup',
  '/onboarding',
  '/api/onboarding',
];

/**
 * Seed a coach record on first visit if none exists.
 * Uses COACH_TRIAL_TOKEN env var as the unique key.
 * In dev (no DATABASE_URL), skip silently.
 */
async function seedCoachIfNeeded() {
  if (!process.env.DATABASE_URL) return null;
  if (!process.env.COACH_TRIAL_TOKEN) return null;

  try {
    let coach = await coaches.getCoachByToken(process.env.COACH_TRIAL_TOKEN);
    if (!coach) {
      coach = await coaches.createCoach({
        email: process.env.COACH_EMAIL || null,
        name: process.env.COACH_NAME || null,
        accessToken: process.env.COACH_TRIAL_TOKEN,
      });
      console.log(`[trial] New coach seeded — trial expires ${coach.trial_expires_at}`);
    }
    return coach;
  } catch (err) {
    // Non-fatal — DB might not be ready yet during migration
    console.error('[trial] seedCoachIfNeeded error:', err.message);
    return null;
  }
}

/**
 * Express middleware: checks trial status on every request.
 *
 * Coach identification priority:
 *   1. fitos_coach session cookie (self-signup coaches)
 *   2. COACH_TRIAL_TOKEN env var (provisioned/seeded coaches)
 *   3. No token → dev mode / landing page, pass through
 *
 * - If trial active: attach coach to req, inject banner if ≤3 days.
 * - If trial expired and status != converted: redirect to /trial/expired.
 * - If converted: full access.
 */
async function trialMiddleware(req, res, next) {
  // No DB — dev mode, skip entirely
  if (!process.env.DATABASE_URL) return next();

  // Always-allowed routes bypass the trial check
  if (ALWAYS_ALLOWED.includes(req.path)) return next();
  for (const prefix of ALWAYS_ALLOWED_PREFIXES) {
    if (req.path.startsWith(prefix)) return next();
  }
  // Static assets
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map)$/)) {
    return next();
  }

  // Determine which token to look up
  let accessToken = process.env.COACH_TRIAL_TOKEN || null;

  // Cookie-based session takes precedence (self-signup coaches)
  const cookieRaw = req.cookies && req.cookies['fitos_coach'];
  if (cookieRaw) {
    const verifiedToken = verifySignedCookieToken(cookieRaw);
    if (verifiedToken) accessToken = verifiedToken;
  }

  // No token at all — landing page visitors, pass through
  if (!accessToken) return next();

  try {
    const coach = await coaches.getCoachByToken(accessToken);
    if (!coach) {
      // Token doesn't match any coach — pass through (landing page or stale cookie)
      return next();
    }

    // Attach coach to request for downstream use
    req.coach = coach;

    // Converted coaches get full access
    if (coach.status === 'converted') {
      return next();
    }

    const now = new Date();
    const expiresAt = new Date(coach.trial_expires_at);
    const msRemaining = expiresAt - now;
    const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);

    // Trial expired
    if (daysRemaining <= 0) {
      // Flip status if still 'trial'
      if (coach.status === 'trial') {
        await coaches.markTrialExpired(coach.id);
      }
      return res.redirect('/trial/expired');
    }

    // Trial active — attach days remaining for banner
    req.trialDaysRemaining = Math.ceil(daysRemaining);

    // Inject banner on HTML responses if ≤3 days remaining
    if (req.trialDaysRemaining <= 3) {
      const originalSend = res.send.bind(res);
      res.send = function(body) {
        if (typeof body === 'string' && body.includes('</body>')) {
          body = body.replace('</body>', `${buildBannerHtml(req.trialDaysRemaining)}</body>`);
        }
        return originalSend(body);
      };
    }

    return next();
  } catch (err) {
    console.error('[trial] middleware error:', err.message);
    // Fail open — don't block the app on a DB error
    return next();
  }
}

/**
 * Build the persistent trial banner HTML.
 */
function buildBannerHtml(daysRemaining) {
  const dayLabel = daysRemaining === 1 ? 'day' : 'days';
  const urgency = daysRemaining <= 1 ? 'trial-banner--urgent' : '';
  return `
<style>
.trial-banner {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: #4a5c3a;
  color: #f5f0e8;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  z-index: 9999;
  box-shadow: 0 -2px 12px rgba(0,0,0,0.15);
}
.trial-banner--urgent {
  background: #8b3a2a;
}
.trial-banner strong {
  font-weight: 600;
}
.trial-banner a {
  background: #f5f0e8;
  color: #4a5c3a;
  padding: 6px 14px;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
}
.trial-banner--urgent a {
  color: #8b3a2a;
}
</style>
<div class="trial-banner ${urgency}">
  <strong>Your trial ends in ${daysRemaining} ${dayLabel}.</strong>
  <span>Your data stays in your Google Sheet — it's yours forever.</span>
  <a href="/pricing">Buy FitOS →</a>
</div>`;
}

module.exports = { trialMiddleware, seedCoachIfNeeded };
