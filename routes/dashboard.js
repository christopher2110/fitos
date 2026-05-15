// routes/dashboard.js
// Owns: Coach Dashboard — HTML page render, KPI/activity/client JSON endpoints
// Does NOT own: client PWA routes, Sheets OAuth, auth middleware

const express = require('express');
const path    = require('path');
const fs      = require('fs');

// Sheets module — loaded at startup, gated per-request by req.sheetId
let sheetsDashboard = null;
try {
  sheetsDashboard = require('../lib/sheets/dashboard');
} catch (_) {
  // sheets dep not available — stay in demo mode
}

// In-memory demo store — used when no Sheet credentials configured (QA/demo mode)
const demoStore = require('../lib/sheets/demo-store');

const router = express.Router();

// ── HTML page ──────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'dashboard.html');
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send('Dashboard not found');
  }

  // If a real coach session exists (not demo mode) but no Sheet is connected yet,
  // send them to the connect-sheet wizard (clear, focused, self-service).
  // Only redirect when: (a) coach row exists in DB, (b) no sheet_id yet,
  // (c) Google Sheets is configured (production), (d) onboarding not already completed.
  if (
    req.coach &&
    !req.coach.sheet_id &&
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY &&
    !req.coach.onboarding_completed_at
  ) {
    return res.redirect('/dashboard/connect-sheet');
  }

  // req.sheetId set by resolveSheetMiddleware — per-coach or env fallback.
  // Demo mode (no credentials) treated as sheetsEnabled so the JS fetches data via API.
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsDashboard) || true;

  // Only inject __COACH__ window blob in demo mode so the JS can hydrate
  // immediately without a round-trip. In live mode the page fetches via API.
  const coachName = (req.coach && req.coach.name) || process.env.COACH_NAME || 'Coach Alex';

  let html = fs.readFileSync(htmlPath, 'utf8');

  // Demo mode: sheetsEnabled=true so the JS fetches data — API returns fixture data
  const injection = `<script>
    window.__COACH_LIVE__ = ${JSON.stringify({ sheetsEnabled, coachName })};
  </script>`;

  html = html.replace('</head>', `${injection}\n</head>`);
  res.type('html').send(html);
});

// ── JSON API ───────────────────────────────────────────────────────────────

/** GET /api/dashboard/kpis */
router.get('/api/kpis', async (req, res) => {
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsDashboard);
  if (!sheetsEnabled) {
    // Demo mode — return fixture KPIs so dashboard is functional for QA
    return res.json({ ok: true, demo: true, needsSetup: false, kpis: demoStore.getKPIs() });
  }
  try {
    const kpis = await sheetsDashboard.getKPIs(req.sheetId);
    res.json({ ok: true, demo: false, kpis });
  } catch (err) {
    console.error('[dashboard] getKPIs error:', err.message);
    res.status(500).json({ ok: false, error: err.message, kpis: {
      activeClients: 0, activeClientsDelta: 0, sessionsLast7: 0, avgRpe: null, retentionPct: 0,
    }});
  }
});

/** GET /api/dashboard/activity */
router.get('/api/activity', async (req, res) => {
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsDashboard);
  if (!sheetsEnabled) {
    // Demo mode — return fixture activity feed
    return res.json({ ok: true, demo: true, needsSetup: false, events: demoStore.getActivityFeed(20) });
  }
  try {
    const events = await sheetsDashboard.getActivityFeed(req.sheetId, 20);
    res.json({ ok: true, demo: false, events });
  } catch (err) {
    console.error('[dashboard] getActivityFeed error:', err.message);
    res.status(500).json({ ok: false, error: err.message, events: [] });
  }
});

/** GET /api/dashboard/clients */
router.get('/api/clients', async (req, res) => {
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsDashboard);
  if (!sheetsEnabled) {
    // Demo mode — return fixture clients
    return res.json({ ok: true, demo: true, needsSetup: false, clients: demoStore.getClients() });
  }
  try {
    const clients = await sheetsDashboard.getClients(req.sheetId);
    res.json({ ok: true, demo: false, clients });
  } catch (err) {
    console.error('[dashboard] getClients error:', err.message);
    res.status(500).json({ ok: false, error: err.message, clients: [] });
  }
});

/** GET /dashboard/connect-sheet — Self-service Sheet connection wizard */
router.get('/connect-sheet', (req, res) => {
  // If sheet already connected, redirect to dashboard (nothing to do)
  if (req.coach && req.coach.sheet_id) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard-connect-sheet.html'));
});

/** GET /dashboard/messages — Coach Messages panel */
router.get('/messages', (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'dashboard-messages.html');
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send('Messages panel not found');
  }

  // Demo mode treated as sheetsEnabled so the JS fetches data (API returns fixture data)
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsDashboard) || true;
  const coachName = (req.coach && req.coach.name) || process.env.COACH_NAME || 'Coach Alex';
  const clientName = process.env.CLIENT_NAME || 'Sarah Chen';

  let html = fs.readFileSync(htmlPath, 'utf8');

  const injection = `<script>
    window.__COACH_LIVE__ = ${JSON.stringify({ sheetsEnabled, coachName, clientName })};
  </script>`;

  html = html.replace('</head>', `${injection}\n</head>`);
  res.type('html').send(html);
});

module.exports = router;
