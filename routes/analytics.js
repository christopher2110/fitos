/**
 * routes/analytics.js — Traffic and conversion tracking
 *
 * Owns: POST /api/track (accept site events from public pages),
 *       GET /dashboard/analytics (analytics dashboard page),
 *       GET /api/analytics/summary (JSON data for the dashboard).
 * Does NOT: handle coach auth/sessions, Sheets, billing, or trial state.
 */
const express = require('express');
const path    = require('path');
const router  = express.Router();

const {
  recordSiteEvent,
  getUniqueSessionsLast7Days,
  getTopPagesByViews,
  getCtaClicksByPage,
  getCheckoutStartCount,
  getDailyViews,
} = require('../db/site-events');

// POST /api/track — fire-and-forget from client pages; always 200 (fail silently)
router.post('/track', async (req, res) => {
  const { event, page, source, session_id } = req.body || {};

  if (!event || !page) {
    return res.status(400).json({ ok: false, error: 'event and page are required' });
  }

  try {
    await recordSiteEvent({ event, page, source, session_id });
    res.json({ ok: true });
  } catch (err) {
    // Invalid event type or DB error — still 200 so the pixel never blocks page load
    res.json({ ok: false, error: err.message });
  }
});

// GET /api/analytics/summary — JSON data consumed by the analytics dashboard page
router.get('/analytics/summary', async (req, res) => {
  // Gated: only authenticated coaches can read analytics data
  if (!req.coach) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  try {
    const [uniqueSessions, topPages, ctaClicks, checkoutStarts, dailyViews] = await Promise.all([
      getUniqueSessionsLast7Days(),
      getTopPagesByViews(),
      getCtaClicksByPage(),
      getCheckoutStartCount(),
      getDailyViews(),
    ]);

    res.json({ ok: true, uniqueSessions, topPages, ctaClicks, checkoutStarts, dailyViews });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /dashboard/analytics — serve the analytics HTML page
// Auth is handled by trialMiddleware (req.coach populated upstream)
router.get('/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard-analytics.html'));
});

module.exports = router;
