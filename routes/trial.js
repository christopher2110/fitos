/**
 * routes/trial.js — Trial lifecycle routes: signup, expiry page, session.
 *
 * Owns: /trial/signup (GET form + POST handler), /trial/expired page,
 *       /trial/session (cookie set after signup for dashboard welcome).
 * Does NOT: handle payment processing, Stripe webhooks, or auth middleware.
 *
 * Auth model: after signup, a signed session cookie (coach_token) lets the
 * trial middleware identify the coach instead of COACH_TRIAL_TOKEN env var.
 * This is a simple server-side cookie — no JWT, no sessions library needed.
 */
const express = require('express');
const router = express.Router();
const coaches = require('../db/coaches');
const crypto = require('crypto');
const { registerContact } = require('../lib/email/sender');
const { sendDay0Immediately, markUnsubscribed, verifyUnsubscribeToken } = require('../services/email-drip');
const referralsDb = require('../db/referrals');

// Cookie name for self-signup session
const SESSION_COOKIE = 'fitos_coach';

// Simple HMAC-signed cookie value: "token.signature"
function signToken(token) {
  const secret = process.env.FITOS_KEY_SECRET || 'dev-secret-change-me';
  const sig = crypto.createHmac('sha256', secret).update(token).digest('hex');
  return `${token}.${sig}`;
}

function verifySignedToken(signed) {
  if (!signed) return null;
  const lastDot = signed.lastIndexOf('.');
  if (lastDot === -1) return null;
  const token = signed.slice(0, lastDot);
  const sig = signed.slice(lastDot + 1);
  const expected = crypto.createHmac('sha256', process.env.FITOS_KEY_SECRET || 'dev-secret-change-me').update(token).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch (_) { return null; }
  return token;
}

// Expose for lib/trial.js to read cookie-based sessions
function getCoachTokenFromRequest(req) {
  const raw = req.cookies && req.cookies[SESSION_COOKIE];
  return verifySignedToken(raw);
}

// GET /trial/signup — serve the signup page HTML
router.get('/signup', (req, res) => {
  // If no DB, redirect to landing
  if (!process.env.DATABASE_URL) return res.redirect('/');
  res.sendFile(require('path').join(__dirname, '../public/trial-signup.html'));
});

// POST /trial/signup — handle form submission (JSON or form-encoded)
router.post('/signup', async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { name, email, password } = req.body || {};
  const errors = [];

  if (!name || name.trim().length < 2) errors.push('Name must be at least 2 characters.');
  if (!email || !email.includes('@')) errors.push('Valid email address required.');
  if (!password || password.length < 8) errors.push('Password must be at least 8 characters.');

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  try {
    const coach = await coaches.createCoachWithPassword({ email, name, password });

    if (!coach) {
      // Email already in use — show login hint
      return res.status(409).json({ errors: ['An account with that email already exists.'] });
    }

    // Set signed session cookie (30-day expiry)
    const signed = signToken(coach.access_token);
    res.cookie(SESSION_COOKIE, signed, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });

    // Register as known contact so drip emails are never rate-limited
    registerContact({ email: coach.email, name: coach.name }).catch(() => {});

    // Fire day-0 welcome email immediately (fire-and-forget; cron retries on failure)
    sendDay0Immediately(coach).catch(() => {});

    // Referral attribution — read fitos_ref cookie set by /ref/:code landing page
    const refCode = req.cookies && req.cookies['fitos_ref'];
    if (refCode && process.env.DATABASE_URL) {
      referralsDb.getCoachByReferralCode(refCode).then(referrer => {
        if (!referrer || referrer.id === coach.id) return;
        return referralsDb.createReferral({
          referrerCoachId: referrer.id,
          referredCoachId: coach.id,
          referralCode: refCode,
        });
      }).catch(() => {}); // Non-fatal
      // Clear the attribution cookie after use
      res.clearCookie('fitos_ref');
    };

    // Redirect to setup wizard — connects their Sheet and adds first client
    return res.json({ redirect: '/setup' });
  } catch (err) {
    console.error('[trial/signup] error:', err.message);
    return res.status(500).json({ errors: ['Something went wrong. Please try again.'] });
  }
});

const STRIPE_PAYMENT_URL = 'https://buy.stripe.com/eVq9ATbHdeUz6AA4v6fAc01';
const GITHUB_REPO_URL = 'https://github.com/Polsia-Inc/fitos';

// GET /trial/expired — Conversion gate page
router.get('/expired', async (req, res) => {
  // Fetch coach stats if available
  let stats = { clients: 0, checkins: 0, workouts: 0 };
  let coachName = null;
  let daysUsed = 14;

  if (process.env.DATABASE_URL && process.env.COACH_TRIAL_TOKEN) {
    try {
      const coach = await coaches.getCoachByToken(process.env.COACH_TRIAL_TOKEN);
      if (coach) {
        coachName = coach.name;
        // If converted — redirect them home
        if (coach.status === 'converted') {
          return res.redirect('/');
        }
        // Calculate days they actually used
        const createdAt = new Date(coach.created_at);
        daysUsed = Math.min(14, Math.round((Date.now() - createdAt) / (1000 * 60 * 60 * 24)));
      }
    } catch (err) {
      console.error('[trial] /expired stats error:', err.message);
    }
  }

  // Try to get Sheet stats for "what they built" section
  // Uses req.sheetId (per-coach, set by resolveSheetMiddleware)
  let sheetStats = null;
  if (req.sheetId) {
    try {
      const { getWorkouts } = require('../lib/sheets/workouts');
      const workoutsData = await getWorkouts(req.sheetId);
      if (workoutsData && workoutsData.length) {
        sheetStats = {
          workouts: workoutsData.length,
        };
      }
    } catch (_) {
      // Non-fatal — sheet may not be configured
    }
  }

  const html = buildExpiredPage({ coachName, daysUsed, sheetStats, stripeUrl: STRIPE_PAYMENT_URL, githubUrl: GITHUB_REPO_URL });
  res.type('html').send(html);
});

function buildExpiredPage({ coachName, daysUsed, sheetStats, stripeUrl, githubUrl }) {
  const greeting = coachName ? `${coachName},` : 'Coach,';
  const statsHtml = sheetStats
    ? `<div class="stats-row">
        ${sheetStats.workouts ? `<div class="stat"><span class="stat-num">${sheetStats.workouts}</span><span class="stat-label">Workouts tracked</span></div>` : ''}
      </div>`
    : `<div class="stats-row">
        <div class="stat"><span class="stat-num">${daysUsed}</span><span class="stat-label">Days of coaching</span></div>
      </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your FitOS Trial Has Ended</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Georgia, sans-serif;
      background: #f5f0e8;
      color: #2c2c2c;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .card {
      background: #fff;
      border-radius: 16px;
      max-width: 560px;
      width: 100%;
      padding: 48px 40px;
      box-shadow: 0 4px 32px rgba(0,0,0,0.08);
      text-align: center;
    }

    .logo {
      font-size: 28px;
      font-weight: 700;
      color: #4a5c3a;
      letter-spacing: -0.5px;
      margin-bottom: 32px;
    }

    .headline {
      font-size: 26px;
      font-weight: 700;
      color: #2c2c2c;
      line-height: 1.3;
      margin-bottom: 16px;
    }

    .subtext {
      font-size: 15px;
      color: #666;
      line-height: 1.6;
      margin-bottom: 32px;
    }

    .data-safe {
      background: #f0f4eb;
      border-left: 3px solid #4a5c3a;
      border-radius: 8px;
      padding: 14px 18px;
      font-size: 14px;
      color: #4a5c3a;
      font-weight: 500;
      margin-bottom: 32px;
      text-align: left;
    }

    .stats-row {
      display: flex;
      gap: 16px;
      justify-content: center;
      margin-bottom: 32px;
    }

    .stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }

    .stat-num {
      font-size: 36px;
      font-weight: 700;
      color: #4a5c3a;
      line-height: 1;
    }

    .stat-label {
      font-size: 12px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .cta-primary {
      display: block;
      background: #4a5c3a;
      color: #f5f0e8;
      text-decoration: none;
      padding: 16px 24px;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
      transition: background 0.15s;
    }

    .cta-primary:hover {
      background: #3a4a2c;
    }

    .price-note {
      font-size: 13px;
      color: #888;
      margin-bottom: 24px;
    }

    .cta-secondary {
      display: block;
      color: #4a5c3a;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 10px;
      border: 1.5px solid #4a5c3a;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 12px;
      transition: background 0.15s;
    }

    .cta-secondary:hover {
      background: #f0f4eb;
    }

    .cta-tertiary {
      display: block;
      font-size: 13px;
      color: #888;
      margin-top: 20px;
    }

    .cta-tertiary a {
      color: #4a5c3a;
    }

    .divider {
      border: none;
      border-top: 1px solid #eee;
      margin: 28px 0;
    }

    @media (max-width: 480px) {
      .card { padding: 32px 24px; }
      .headline { font-size: 22px; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">FitOS</div>

    <h1 class="headline">Your 14-day trial has ended.</h1>
    <p class="subtext">
      ${greeting} thanks for spending your trial with FitOS. Here's what you built:
    </p>

    ${statsHtml}

    <div class="data-safe">
      ✓ Your data is safe in your Google Sheet — it's yours forever, regardless of what you decide.
    </div>

    <a href="${stripeUrl}" class="cta-primary">Buy FitOS — $497 Lifetime License</a>
    <p class="price-note">One payment. Includes 3 months free hosting. Then $7/mo (or self-host free).</p>

    <hr class="divider">

    <a href="${githubUrl}" class="cta-secondary" target="_blank" rel="noopener">
      Deploy it yourself — free forever →
    </a>

    <p class="cta-tertiary">
      Questions? <a href="mailto:fitos@polsia.app">fitos@polsia.app</a>
    </p>
  </div>
</body>
</html>`;
}

// GET /trial/unsubscribe?id=<coachId>&token=<hmac>
// Unsubscribes the coach from the drip sequence. Stateless token validation.
router.get('/unsubscribe', async (req, res) => {
  const { id, token } = req.query || {};
  if (!id || !token) {
    return res.status(400).type('html').send('<p>Invalid unsubscribe link.</p>');
  }

  // Look up coach to get created_at for HMAC verification
  let coach = null;
  try {
    coach = await coaches.getCoachById(parseInt(id, 10));
  } catch (_) {}

  if (!coach) {
    return res.status(404).type('html').send('<p>Account not found.</p>');
  }

  const valid = verifyUnsubscribeToken(coach.id, String(coach.created_at), token);
  if (!valid) {
    return res.status(403).type('html').send('<p>Invalid or expired unsubscribe link.</p>');
  }

  await markUnsubscribed(coach.id);

  return res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribed — FitOS</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Georgia, sans-serif;
           background: #f5f0e8; display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box; }
    .card { background: #fff; border-radius: 16px; max-width: 480px; width: 100%;
            padding: 40px; box-shadow: 0 4px 24px rgba(0,0,0,0.07); text-align: center; }
    .logo { font-size: 22px; font-weight: 700; color: #4a5c3a; margin: 0 0 24px; }
    h1 { font-size: 22px; font-weight: 700; color: #2c2c2c; margin: 0 0 12px; }
    p { font-size: 15px; color: #666; line-height: 1.6; margin: 0 0 16px; }
    a { color: #4a5c3a; }
  </style>
</head>
<body>
  <div class="card">
    <p class="logo">FitOS</p>
    <h1>You're unsubscribed.</h1>
    <p>You won't receive any more trial emails from FitOS.</p>
    <p>Your Google Sheet data is still yours. <a href="/">Visit FitOS →</a></p>
  </div>
</body>
</html>`);
});

// Expose for lib/trial.js (session cookie reads)
module.exports = router;
