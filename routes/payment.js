/**
 * routes/payment.js — Payment verification and success handling
 *
 * Owns: POST-payment verification, status flip to 'converted'.
 * Does NOT: process payments, store card data, or implement Stripe webhooks.
 *
 * Flow:
 *   1. Stripe redirects to /payment/success?checkout_session_id=xxx
 *   2. We verify the session with Polsia's API
 *   3. On success, flip coach.status = 'converted' in DB
 *   4. Redirect to / with success state
 */
const express = require('express');
const router = express.Router();
const coaches = require('../db/coaches');
const referralsDb = require('../db/referrals');
const { sendEmail } = require('../lib/email/sender');

// GET /payment/success — Stripe returns here after checkout
router.get('/success', async (req, res) => {
  const sessionId = req.query.checkout_session_id || req.query.session_id;

  if (!sessionId) {
    return res.redirect('/trial/expired?error=missing_session');
  }

  let verified = false;
  let customerEmail = null;

  // Verify payment with Polsia's API
  if (process.env.POLSIA_API_URL && process.env.POLSIA_API_KEY) {
    try {
      const response = await fetch(
        `${process.env.POLSIA_API_URL}/api/company-payments/verify?session_id=${encodeURIComponent(sessionId)}`,
        { headers: { Authorization: `Bearer ${process.env.POLSIA_API_KEY}` } }
      );
      const data = await response.json();
      verified = data.verified;
      customerEmail = data.payment?.customer_email;
    } catch (err) {
      console.error('[payment] verification error:', err.message);
    }
  } else {
    // Dev mode — treat any session as verified for local testing
    verified = process.env.NODE_ENV !== 'production';
    console.warn('[payment] POLSIA_API_URL/KEY not set — skipping verification (dev mode)');
  }

  if (!verified) {
    return res.redirect('/trial/expired?error=payment_not_verified');
  }

  // Flip coach to 'converted' + credit referrer
  let convertedCoach = null;
  if (process.env.DATABASE_URL && process.env.COACH_TRIAL_TOKEN) {
    try {
      const coach = await coaches.getCoachByToken(process.env.COACH_TRIAL_TOKEN);
      if (coach) {
        await coaches.markConverted(coach.id);
        convertedCoach = coach;
        console.log(`[payment] Coach ${coach.id} converted after payment`);
      }
      // Also try by email if available (multi-tenant path)
      if (customerEmail) {
        const byEmail = await coaches.markConvertedByEmail(customerEmail);
        if (byEmail && !convertedCoach) convertedCoach = byEmail;
      }
    } catch (err) {
      console.error('[payment] DB update error:', err.message);
      // Non-fatal — coach is still unlocked via session verification
    }
  }

  // Credit referrer on conversion (fire-and-forget — non-fatal)
  if (convertedCoach && process.env.DATABASE_URL) {
    creditReferrerAndSendEmails(convertedCoach).catch(err => {
      console.error('[payment] referral credit error:', err.message);
    });
  }

  // Show success page
  res.type('html').send(buildSuccessPage());
});

/**
 * After purchase: convert any pending referral and send emails.
 * Referrer gets notified they earned $197. Buyer gets their own referral link.
 */
async function creditReferrerAndSendEmails(coach) {
  // Convert the referral row to 'converted' status
  const referral = await referralsDb.convertReferral(coach.id);

  const baseUrl = process.env.APP_BASE_URL || 'https://fitos-zc11.polsia.app';

  // Ensure this coach has a referral code so they can start referring immediately
  const buyerCode = await referralsDb.ensureReferralCode(coach.id).catch(() => null);
  const buyerLink = buyerCode ? `${baseUrl}/ref/${buyerCode}` : null;

  // Email to the new coach with their own referral link
  if (coach.email && buyerLink) {
    await sendEmail({
      to: coach.email,
      subject: 'Your FitOS is live — here\'s how to earn $197 per referral',
      html: buildReferralWelcomeEmail({ coach, referralLink: buyerLink }),
    });
  }

  // If referred by someone, notify the referrer they earned $197
  if (referral) {
    const referrerCoach = await referralsDb.getCoachByReferralCode(referral.referral_code).catch(() => null);
    // We need referrer's email — fetch by id
    const { getCoachById } = require('../db/coaches');
    const referrer = await getCoachById(referral.referrer_coach_id).catch(() => null);
    if (referrer && referrer.email) {
      const referrerStats = await referralsDb.getReferralStats(referrer.id, baseUrl).catch(() => null);
      await sendEmail({
        to: referrer.email,
        subject: 'You just earned $197 — someone used your FitOS referral link',
        html: buildReferrerEarnedEmail({ referrer, referrerStats }),
      });
    }
  }
}

function buildReferralWelcomeEmail({ coach, referralLink }) {
  const name = coach.name ? coach.name.split(' ')[0] : 'Coach';
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Your FitOS referral link</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Georgia,sans-serif;background:#f5f0e8;margin:0;padding:24px}
.wrap{max-width:520px;margin:0 auto}
.card{background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,.07)}
.logo{font-size:22px;font-weight:700;color:#4a5c3a;margin:0 0 24px}
h2{font-size:22px;font-weight:700;color:#2c2c2c;margin:0 0 16px}
p{font-size:15px;color:#555;line-height:1.7;margin:0 0 16px}
.hook{background:#f0f4eb;border-left:3px solid #4a5c3a;border-radius:8px;padding:16px 18px;font-size:15px;color:#2c2c2c;font-weight:600;margin:24px 0}
.link-box{background:#f8f8f6;border:1px solid #ddd;border-radius:8px;padding:14px 16px;font-family:monospace;font-size:14px;color:#2c2c2c;word-break:break-all;margin:0 0 24px}
.cta{display:inline-block;background:#4a5c3a;color:#f5f0e8;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:15px;font-weight:600}
.fine{font-size:13px;color:#999;margin:24px 0 0}
</style></head>
<body><div class="wrap"><div class="card">
<p class="logo">FitOS</p>
<h2>Welcome, ${name}. Your license is active.</h2>
<p>While your coaching system loads, here's one more thing worth knowing:</p>
<div class="hook">Refer 3 coaches → your license was free.<br><span style="font-weight:400;font-size:14px">You earn $197 per coach who purchases. 3 referrals = $591 on a $497 investment.</span></div>
<p>Share your unique link. Anyone who signs up through it and purchases gets credited to you:</p>
<div class="link-box">${referralLink}</div>
<a href="${referralLink}" class="cta">Copy your referral link →</a>
<p class="fine">Payouts processed manually with 30-day hold (chargeback protection). Track referrals in your dashboard under "Refer &amp; Earn".</p>
</div></div></body></html>`;
}

function buildReferrerEarnedEmail({ referrer, referrerStats }) {
  const name = referrer.name ? referrer.name.split(' ')[0] : 'Coach';
  const total = referrerStats ? `$${referrerStats.totalEarned}` : '$197';
  const count = referrerStats ? referrerStats.converted : 1;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>You earned $197</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Georgia,sans-serif;background:#f5f0e8;margin:0;padding:24px}
.wrap{max-width:520px;margin:0 auto}
.card{background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,.07)}
.logo{font-size:22px;font-weight:700;color:#4a5c3a;margin:0 0 24px}
h2{font-size:22px;font-weight:700;color:#2c2c2c;margin:0 0 16px}
p{font-size:15px;color:#555;line-height:1.7;margin:0 0 16px}
.stat{text-align:center;padding:24px 0;border-top:1px solid #eee;border-bottom:1px solid #eee;margin:24px 0}
.stat-num{font-size:48px;font-weight:700;color:#4a5c3a;line-height:1}
.stat-label{font-size:14px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-top:8px}
.cta{display:inline-block;background:#4a5c3a;color:#f5f0e8;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:15px;font-weight:600}
</style></head>
<body><div class="wrap"><div class="card">
<p class="logo">FitOS</p>
<h2>${name}, someone just purchased through your link. 🎉</h2>
<p>You have a 30-day hold period before payout (chargeback protection), then we'll process your reward.</p>
<div class="stat">
  <div class="stat-num">${total}</div>
  <div class="stat-label">Total earned — ${count} conversion${count !== 1 ? 's' : ''}</div>
</div>
<p>Keep sharing your link. The flywheel compounds — each coach you refer gets their own link too.</p>
<a href="https://fitos-zc11.polsia.app/dashboard" class="cta">View your dashboard →</a>
</div></div></body></html>`;
}

function buildSuccessPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to FitOS</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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
      max-width: 480px;
      width: 100%;
      padding: 48px 40px;
      box-shadow: 0 4px 32px rgba(0,0,0,0.08);
      text-align: center;
    }
    .logo { font-size: 28px; font-weight: 700; color: #4a5c3a; margin-bottom: 24px; }
    .check { font-size: 48px; margin-bottom: 20px; }
    .headline { font-size: 24px; font-weight: 700; margin-bottom: 12px; }
    .subtext { font-size: 15px; color: #666; line-height: 1.6; margin-bottom: 32px; }
    .cta {
      display: inline-block;
      background: #4a5c3a;
      color: #f5f0e8;
      text-decoration: none;
      padding: 14px 28px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
    }
    .cta:hover { background: #3a4a2c; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">FitOS</div>
    <div class="check">✓</div>
    <h1 class="headline">You're in. Welcome to FitOS.</h1>
    <p class="subtext">
      Your lifetime license is active. Your first 3 months of managed hosting are on us —
      no charge until month 4, then $7/mo if you want us to keep running it.
      Or self-host free any time. Your Google Sheet data is yours forever.
    </p>
    <a href="/" class="cta">Open FitOS →</a>
  </div>
  <script>
    // Auto-redirect after 4 seconds
    setTimeout(() => { window.location.href = '/'; }, 4000);
  </script>
</body>
</html>`;
}

module.exports = router;
