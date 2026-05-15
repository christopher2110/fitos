/**
 * routes/stats.js — Public stats API
 *
 * Owns: GET /api/stats/deploys — returns deploy count for landing page social proof.
 *       POST /api/stats/deploys — called by Render deploy webhook to increment counter.
 * Does NOT: handle coach auth, trial state, or any billing logic.
 */
const express = require('express');
const router = express.Router();
const { getDeployCount, recordDeployEvent } = require('../db/deploy-events');

// GET /api/stats/deploys — public, no auth required
router.get('/deploys', async (req, res) => {
  try {
    const count = await getDeployCount();
    res.json({ count });
  } catch (err) {
    // Fail gracefully — counter is cosmetic, don't surface DB errors to public
    res.json({ count: 1 });
  }
});

// POST /api/stats/deploys — called by Render deploy webhook (DEPLOY_WEBHOOK_SECRET gate)
// Also callable by the trial signup flow to record new coach deployments
router.post('/deploys', async (req, res) => {
  const secret = process.env.DEPLOY_WEBHOOK_SECRET;
  const provided = req.headers['x-deploy-secret'] || req.body?.secret;

  if (secret && provided !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const event = await recordDeployEvent('deploy_started', {
      source: req.body?.source || 'webhook',
      timestamp: new Date().toISOString(),
    });
    const count = await getDeployCount();
    res.json({ event, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
