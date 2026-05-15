// routes/demo.js
// Owns: /demo — public interactive demo (no auth, no Sheet required)
// Does NOT own: real coach auth, Sheets writes, DB — all reads from lib/demo-fixture.js

'use strict';

const express = require('express');
const path = require('path');
const {
  COACH, CLIENTS,
  SARAH_WORKOUTS, SARAH_CHECKINS, SARAH_MESSAGES,
  MARCUS_WORKOUTS, MARCUS_CHECKINS,
  JEN_WORKOUTS, JEN_CHECKINS,
  AI_OUTPUTS, DEMO_PROGRAM,
  generateSarahResultsData,
} = require('../lib/demo-fixture');

const router = express.Router();

// ── HTML PAGES ─────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo.html'));
});

router.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo-dashboard.html'));
});

router.get('/dashboard/clients', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo-clients.html'));
});

router.get('/dashboard/clients/sarah', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo-client-sarah.html'));
});

router.get('/dashboard/clients/marcus', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo-client-marcus.html'));
});

router.get('/dashboard/clients/jen', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo-client-jen.html'));
});

router.get('/dashboard/agents', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo-agents.html'));
});

router.get('/dashboard/agents/builder', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo-builder.html'));
});

// ── API ENDPOINTS ──────────────────────────────────────────────────────────

/** GET /demo/api/dashboard — KPIs and activity feed */
router.get('/api/dashboard', (req, res) => {
  const activity = [
    { type: 'workout',   client: 'Sarah Chen',   text: 'Completed Lower A workout',         time: '2h ago' },
    { type: 'checkin',   client: 'Marcus Reeves', text: 'Submitted weekly check-in',         time: '8h ago' },
    { type: 'message',   client: 'Sarah Chen',   text: 'Replied to form cue message',        time: '9h ago' },
    { type: 'workout',   client: 'Marcus Reeves', text: 'Completed Squat + Accessory session', time: 'Yesterday' },
    { type: 'checkin',   client: 'Jen Park',     text: 'Submitted first check-in',           time: 'Yesterday' },
    { type: 'milestone', client: 'Marcus Reeves', text: 'Hit 192.5 kg squat PR',             time: '3 days ago' },
    { type: 'workout',   client: 'Jen Park',     text: 'Completed Session 2 — Intro Lower',  time: '3 days ago' },
    { type: 'flag',      client: 'Marcus Reeves', text: 'Fatigue flag raised by AI agent',   time: '8h ago' },
  ];
  res.json({
    ok: true, demo: true,
    coach: COACH,
    kpis: {
      activeClients: 3,
      avgAdherence: 87,
      checkinsThisWeek: 2,
      flaggedClients: 1,
    },
    clients: CLIENTS.map(c => ({
      id: c.id, name: c.name, initials: c.initials,
      status: c.status, block: c.block, blockParsed: c.blockParsed,
      compliance7d: c.compliance7d, lastCheckin: c.lastCheckin,
    })),
    activity,
  });
});

/** GET /demo/api/clients — list */
router.get('/api/clients', (req, res) => {
  res.json({ ok: true, demo: true, clients: CLIENTS });
});

/** GET /demo/api/clients/:id — detail */
router.get('/api/clients/:id', (req, res) => {
  const client = CLIENTS.find(c => c.id === req.params.id);
  if (!client) return res.status(404).json({ ok: false, error: 'client not found' });
  let workouts, checkins, messages;
  if (req.params.id === 'sarah') {
    workouts = SARAH_WORKOUTS; checkins = SARAH_CHECKINS; messages = SARAH_MESSAGES;
  } else if (req.params.id === 'marcus') {
    workouts = MARCUS_WORKOUTS; checkins = MARCUS_CHECKINS; messages = [];
  } else {
    workouts = JEN_WORKOUTS; checkins = JEN_CHECKINS; messages = [];
  }
  res.json({ ok: true, demo: true, client, workouts, checkins, messages });
});

/** GET /demo/api/clients/sarah/results — chart data */
router.get('/api/clients/sarah/results', (req, res) => {
  const data = generateSarahResultsData();
  res.json({ ok: true, demo: true, client: CLIENTS[0], ...data });
});

/** GET /demo/api/ai/:skill — pre-canned AI output */
router.get('/api/ai/:skill', (req, res) => {
  const output = AI_OUTPUTS[req.params.skill];
  if (!output) return res.status(404).json({ ok: false, error: 'skill not found' });
  // Simulate 300ms delay to feel realistic
  setTimeout(() => res.json({ ok: true, demo: true, ...output }), 300);
});

/** POST /demo/api/builder/chat — fake streaming program generation */
router.post('/api/builder/chat', (req, res) => {
  // SSE streaming response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const lines = [
    'Analyzing client profile: Sarah Chen, 4 weeks in, hypertrophy block...',
    '',
    '**4-Week Hypertrophy Block — Sarah Chen**',
    '',
    'I\'ll design this around her current capacity (squat ~60 kg, hip thrust ~70 kg) with progressive overload across 4 weeks.',
    '',
    '**Structure:** 3 days/week (Lower A / Upper / Lower B), 4–6 exercises per session.',
    '',
    '---',
    '',
    '**Week 1 — Accumulation (RPE 7)**',
    '- Lower A: Squat 4×10–12 @ 57.5 kg | RDL 3×12 @ 45 kg | Hip Thrust 3×12–15 @ 65 kg',
    '- Upper: Incline DB Press 4×10–12 @ 17.5 kg | Row 4×10–12 @ 20 kg | OHP 3×10',
    '- Lower B: Leg Press 4×12–15 | Stiff-Leg DL 3×10 | Step-Up 3×10/leg',
    '',
    '**Week 2 — Load Week (+2.5 kg per session, RPE 7–8)**',
    '- Progress all primary lifts by 2.5 kg',
    '- Add 1 extra set to Lower A exercises',
    '',
    '**Week 3 — Overreach (RPE 8–9)**',
    '- Push loads 5 kg above Week 1 baseline',
    '- Reduce reps slightly (8–10 range) to keep quality high',
    '',
    '**Week 4 — Deload (50% volume, 85% load)**',
    '- 2 sets per exercise, maintain load within 5% of peak',
    '- Full recovery before next block',
    '',
    '---',
    '',
    '**Coaching notes:**',
    '- Hip tightness noted — include 90/90 stretch pre-session on Lower days',
    '- Progress photos Week 1 vs Week 4 to track body composition',
    '- Re-assess energy and recovery mid-block (after Week 2 check-in)',
    '',
    'Ready to assign to Sarah\'s program tab ✅',
  ];

  let idx = 0;
  const interval = setInterval(() => {
    if (idx >= lines.length) {
      res.write('data: [DONE]\n\n');
      res.end();
      clearInterval(interval);
      return;
    }
    const line = lines[idx++];
    res.write(`data: ${JSON.stringify({ delta: line + '\n' })}\n\n`);
  }, 60);
});

/** POST /demo/api/builder/assign — intercept write, return toast */
router.post('/api/builder/assign', (req, res) => {
  setTimeout(() => {
    res.json({
      ok: true,
      demo: true,
      message: 'Demo mode — program not saved. Start a real trial to keep your work.',
    });
  }, 400);
});

/** POST /demo/api/write — intercept any write attempt */
router.post('/api/write', (req, res) => {
  res.json({ ok: true, demo: true, message: 'Demo mode — changes aren\'t saved.' });
});

/** POST /demo/api/analytics — lightweight demo event tracking (fire-and-forget) */
router.post('/api/analytics', (req, res) => {
  // Log demo events for conversion tracking; non-blocking
  const { event, ts } = req.body || {};
  if (event && typeof event === 'string') {
    console.log(`[demo-analytics] event=${event} ts=${ts || Date.now()}`);
  }
  res.json({ ok: true });
});

module.exports = router;
