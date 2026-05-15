const express = require('express');
const path = require('path');
const fs = require('fs');

const workoutsRouter     = require('./routes/workouts');
const historyRouter      = require('./routes/history');
const checkinRouter      = require('./routes/checkin');
const messagesRouter     = require('./routes/messages');
const dashboardRouter    = require('./routes/dashboard');
const completionsRouter  = require('./routes/completions');
const checkinsRouter     = require('./routes/checkins');
const agentsRouter       = require('./routes/agents');
const trialRouter        = require('./routes/trial');
const paymentRouter      = require('./routes/payment');
const clientsRouter      = require('./routes/clients');
const setupRouter        = require('./routes/setup');
const programsRouter     = require('./routes/programs');
const builderRouter      = require('./routes/builder');
const demoRouter         = require('./routes/demo');
const customAgentsRouter = require('./routes/custom-agents');
const exercisesRouter    = require('./routes/exercises');
const referralRouter          = require('./routes/referral');
const agentSchedulesRouter    = require('./routes/agent-schedules');
const importRouter            = require('./routes/import');
const adminDiagnosticsRouter  = require('./routes/admin-diagnostics');
const onboardingRouter        = require('./routes/onboarding');
const statsRouter             = require('./routes/stats');
const analyticsRouter         = require('./routes/analytics');
const emailWebhookRouter      = require('./routes/email-webhook');
const templatesRouter         = require('./routes/templates');
const { publicRouter: programsPublicRouter, apiRouter: templatesApiRouter } = require('./routes/templates');
const githubPushRouter = require('./routes/github-push');

const { trialMiddleware, seedCoachIfNeeded } = require('./lib/trial');
const { startDripCron }    = require('./services/email-drip');
const { startScheduler }   = require('./services/agent-scheduler');
const { resolveSheetMiddleware } = require('./lib/sheets/middleware');

const app = express();
const port = process.env.PORT || 3000;

// 6 MB limit to accommodate base64-encoded progress photos (~4 MB source → ~5.3 MB base64)
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: false }));

// Inline cookie parser — parses req.headers.cookie into req.cookies object.
// Avoids external cookie-parser dependency (Render build caching can miss new deps).
app.use((req, _res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    header.split(';').forEach(pair => {
      const idx = pair.indexOf('=');
      if (idx < 0) return;
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      req.cookies[key] = decodeURIComponent(val);
    });
  }
  next();
});

// Health check endpoint (required for Render)
// Note: Does NOT query database to allow Neon auto-suspend
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Trial expiry middleware — attaches req.coach, redirects expired, injects banner.
// Must run before resolveSheetMiddleware since sheet routing depends on req.coach.
app.use(trialMiddleware);

// Sheet resolution — sets req.sheetId for every request.
// Priority: req.coach.sheet_id → COACH_SHEET_ID env → null (demo).
app.use(resolveSheetMiddleware);

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Public interactive demo — no auth, no Sheet, fixture data only
// Mount before trial middleware consumers so demo is fully public
app.use('/demo', demoRouter);

// Trial gate + payment conversion
app.use('/trial', trialRouter);
app.use('/payment', paymentRouter);

// Referral landing page (/ref/:code sets cookie + redirects to /trial/signup)
// API routes under /api/referrals/* serve the dashboard Refer & Earn card
app.use('/ref', referralRouter);
app.use('/api/referrals', referralRouter);

// Client PWA routes
app.use('/workouts',  workoutsRouter);
app.use('/history',   historyRouter);
app.use('/checkin',   checkinRouter);
app.use('/messages',  messagesRouter);

// Client management (must mount before /dashboard to match the more specific path first)
app.use('/dashboard/clients', clientsRouter);

// Coach dashboard
app.use('/dashboard', dashboardRouter);

// Sheets write path — exercise completions
app.use('/api/completions', completionsRouter);

// Sheets + Drive write path — weekly check-ins with optional photo upload
app.use('/api/checkins', checkinsRouter);

// Program management — read/create workout programs
app.use('/api/programs', programsRouter);

// AI Program Builder — chat + program assign
app.use('/dashboard/agents/builder', builderRouter);
app.use('/api/agents/builder', builderRouter);

// Exercise library — must mount before /dashboard to resolve /dashboard/exercises/*
app.use('/dashboard/exercises', exercisesRouter);
app.use('/api/exercises', exercisesRouter);

// Agent schedules API
app.use('/api/agent-schedules', agentSchedulesRouter);

// Custom imported OpenAI agents — must mount before /dashboard to resolve /dashboard/agents/*
app.use('/dashboard/agents', customAgentsRouter);
app.use('/api/custom-agents', customAgentsRouter);

// Agent settings — BYOK Anthropic key + skill runner
app.use('/settings/agents', agentsRouter);

// Onboarding wizard — Sheet connection + first client (always accessible)
app.use('/setup', setupRouter);
app.use('/api/setup', setupRouter);

// New guided onboarding wizard (4-step: choose path → provision/connect → verify → done)
app.use('/onboarding', onboardingRouter);
app.use('/api/onboarding', onboardingRouter);

// Data import wizard — Trainerize / TrueCoach / Generic CSV
app.use('/dashboard/import', importRouter);
app.use('/api/import',       importRouter);

// Docs — skill authoring guide
app.get('/docs/agents', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs-agents.html'));
});

// Docs — migration guide (Trainerize / TrueCoach → FitOS)
app.get('/docs/migration', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs-migration.html'));
});

// Pricing page — also accessible at /buy for direct CTAs
app.get('/pricing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pricing.html'));
});
app.get('/buy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pricing.html'));
});

// Comparison index — lists all 3 competitor pages; /compare is a canonical alias
app.get(['/vs', '/compare'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vs', 'index.html'));
});

// Competitor comparison pages — /vs/:competitor
// trainerize + truecoach use flat public/ files (legacy); everfit uses subdirectory pattern
app.get('/vs/:competitor', (req, res) => {
  const { competitor } = req.params;
  const flatFile = path.join(__dirname, 'public', `vs-${competitor}.html`);
  const dirFile  = path.join(__dirname, 'public', 'vs', competitor, 'index.html');
  if (fs.existsSync(dirFile)) {
    res.sendFile(dirFile);
  } else if (fs.existsSync(flatFile)) {
    res.sendFile(flatFile);
  } else {
    res.redirect('/');
  }
});

// School partnership pages — noindex, shared directly by Christopher with PT schools
app.get('/partners/schools', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'partners', 'schools', 'index.html'));
});
app.get('/partners/schools/calculator', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'partners', 'schools', 'calculator.html'));
});
app.get('/partners/schools/agreement', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'partners', 'schools', 'agreement.html'));
});

// Admin diagnostics — gated by ADMIN_KEY env var
// HTML page: /admin/diagnostics?key=...  JSON: /admin/diagnostics/api?key=...
app.use('/admin/diagnostics', adminDiagnosticsRouter);

// TEMPORARY: one-shot GitHub push endpoint — remove after use (v5)
app.use('/api/github-push', githubPushRouter);

// Public stats API — deploy counter for landing page social proof
app.use('/api/stats', statsRouter);

// Traffic + conversion tracking — POST /api/track (public pixel), GET /dashboard/analytics
app.use('/api', analyticsRouter);
app.use('/dashboard', analyticsRouter);

// Postmark bounce + spam_complaint webhook — auto-suppresses inactive addresses
app.use('/api/email/webhook', emailWebhookRouter);

// Template library — dashboard pages + API
app.use('/dashboard/templates', templatesRouter);
app.use('/api/templates',       templatesApiRouter);

// Public program preview pages — SEO, no auth required
app.use('/programs', programsPublicRouter);

// Landing page with analytics beacon injected
app.get('/', (req, res) => {
  const slug = process.env.POLSIA_ANALYTICS_SLUG || '';
  const htmlPath = path.join(__dirname, 'public', 'index.html');

  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, 'utf8');
    // Inject the slug into the HTML
    html = html.replace('__POLSIA_SLUG__', slug);
    res.type('html').send(html);
  } else {
    res.json({ message: 'Hello from Polsia Instance!' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  // Seed coach record on startup if COACH_TRIAL_TOKEN is set
  seedCoachIfNeeded().catch(err => {
    console.error('[trial] startup seed error:', err.message);
  });
  // Start hourly email drip cron (runs immediately + every 60 min)
  startDripCron();
  // Start agent scheduler (15-min polling for due schedules)
  startScheduler();
});
