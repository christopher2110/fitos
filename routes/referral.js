/**
 * routes/referral.js — Coach referral program
 *
 * Owns: /ref/:code landing (cookie attribution), /api/referrals/* (stats, dashboard card).
 * Does NOT: handle payment processing, Stripe integration, or coach auth.
 *
 * Flow:
 *   1. Referrer shares /ref/ABCD1234 link
 *   2. Visitor lands → fitos_ref cookie set (30 days) → redirect to /trial/signup
 *   3. On signup, POST /trial/signup reads cookie → calls createReferral()
 *   4. On purchase, payment.js calls convertReferral()
 *   5. GET /api/referrals/my-link returns stats + link for dashboard card
 */
const express = require('express');
const router = express.Router();
const referrals = require('../db/referrals');

// REF_COOKIE: 30-day attribution window
const REF_COOKIE = 'fitos_ref';

// GET /ref/:code — set attribution cookie, redirect to signup
router.get('/:code', async (req, res) => {
  const { code } = req.params;

  if (!code || !/^[A-Z0-9]{8,16}$/i.test(code)) {
    return res.redirect('/trial/signup');
  }

  // Verify the code exists (don't silently drop invalid codes)
  const referrer = await referrals.getCoachByReferralCode(code).catch(() => null);
  if (!referrer) {
    return res.redirect('/trial/signup');
  }

  // Set attribution cookie (30 days, httpOnly, secure in prod)
  res.cookie(REF_COOKIE, code.toUpperCase(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  });

  // Redirect to signup with referral context in the URL for the page to use
  res.redirect(`/trial/signup?ref=${encodeURIComponent(code.toUpperCase())}`);
});

// GET /api/referrals/my-link — returns referral stats + link for dashboard card
// Requires req.coach (set by trialMiddleware)
router.get('/api/my-link', async (req, res) => {
  if (!req.coach) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }
  if (!process.env.DATABASE_URL) {
    return res.json({ ok: false, error: 'Database not configured' });
  }

  try {
    const baseUrl = process.env.APP_BASE_URL || `https://${req.headers.host}`;
    const stats = await referrals.getReferralStats(req.coach.id, baseUrl);
    res.json({ ok: true, ...stats });
  } catch (err) {
    console.error('[referral] getReferralStats error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load referral stats' });
  }
});

// GET /api/referrals/list — detailed list of referrals for the coach
router.get('/api/list', async (req, res) => {
  if (!req.coach) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }
  if (!process.env.DATABASE_URL) {
    return res.json({ ok: false, error: 'Database not configured' });
  }

  try {
    const list = await referrals.getReferralList(req.coach.id);
    res.json({ ok: true, referrals: list });
  } catch (err) {
    console.error('[referral] getReferralList error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load referral list' });
  }
});

module.exports = router;
module.exports.REF_COOKIE = REF_COOKIE;
