// routes/clients.js
// Owns: /dashboard/clients — client list page, add client, client detail page + API
// Does NOT own: Sheets auth, dashboard KPIs, messages

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { generateMockData } = require('../lib/mockCoachData');

// Sheets modules — loaded at startup, gated per-request by req.sheetId
let sheetsClients = null;
let sheetsDashboard = null;
let sheetsWorkouts = null;
let sheetsCheckins = null;
let sheetsMessages = null;
try {
  sheetsClients   = require('../lib/sheets/clients');
  sheetsDashboard = require('../lib/sheets/dashboard');
  sheetsWorkouts  = require('../lib/sheets/workouts');
  sheetsCheckins  = require('../lib/sheets/checkins');
  sheetsMessages  = require('../lib/sheets/messages');
} catch (_) {
  // sheets dep not available — demo mode
}

// In-memory demo store — used when no Sheet credentials configured (QA/demo mode)
const demoStore = require('../lib/sheets/demo-store');

const router = express.Router();

// ── Client List Page ──────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'dashboard-clients.html');
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send('Clients page not found');
  }
  // Demo mode treated as sheetsEnabled so the JS fetches data (API returns fixture data)
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsClients) || true;
  const coachName = (req.coach && req.coach.name) || process.env.COACH_NAME || 'Coach Alex';
  let html = fs.readFileSync(htmlPath, 'utf8');
  const injection = `<script>
    window.__COACH_LIVE__ = ${JSON.stringify({ sheetsEnabled, coachName })};
  </script>`;
  html = html.replace('</head>', `${injection}\n</head>`);
  res.type('html').send(html);
});

// ── API: List clients ─────────────────────────────────────────────────────────

router.get('/api/list', async (req, res) => {
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsClients);
  if (!sheetsEnabled) {
    // Demo mode — return fixture clients so dashboard is functional for QA
    return res.json({ ok: true, demo: true, needsSetup: false, clients: demoStore.getClients() });
  }
  try {
    const sheetId = req.sheetId;
    // Merge: Clients tab roster + dashboard profile data (for the configured client)
    const [tabClients, dashClients] = await Promise.all([
      sheetsClients.getClientList(sheetId),
      sheetsDashboard.getClients(sheetId),
    ]);

    // Build combined list — tab clients are the source of truth for the roster
    let clients = tabClients.map((c, idx) => {
      const initial = c.name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2);
      return {
        id: idx + 1,
        name: c.name,
        email: c.email,
        initial,
        status: c.status || 'Active',
        program: c.program,
        startDate: c.startDate,
        notes: c.notes,
        block: c.program ? `${c.program} W1/1` : 'No program',
        blockParsed: { name: c.program || 'No program', week: 1, totalWeeks: 1, progressPct: 0 },
        compliance7d: 0,
        lastCheckin: '—',
      };
    });

    // If no clients in tab but there's a profile client, include it
    if (clients.length === 0 && dashClients.length > 0) {
      clients = dashClients;
    }

    res.json({ ok: true, demo: false, clients });
  } catch (err) {
    console.error('[clients] list error:', err.message);
    res.status(500).json({ ok: false, error: err.message, clients: [] });
  }
});

// ── API: Add client ───────────────────────────────────────────────────────────

router.post('/api/add', async (req, res) => {
  const { name, email, program, notes } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ ok: false, error: 'Client name is required' });
  }

  const sheetsReady = !!(sheetsClients && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && req.sheetId);

  if (!sheetsReady) {
    // Demo mode — persist to in-memory store for this session
    const result = demoStore.addClient({ name: name.trim(), email, program, notes });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return res.json({ ok: true, demo: true, name: result.name, pwaUrl: `${baseUrl}/workouts`, addedAt: result.addedAt });
  }

  try {
    const result = await sheetsClients.addClient(req.sheetId, {
      name: name.trim(),
      email: (email || '').trim(),
      program: (program || '').trim(),
      notes: (notes || '').trim(),
    });
    // Generate PWA link for the new client
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const pwaUrl = `${baseUrl}/workouts`;
    res.json({ ok: true, demo: false, name: name.trim(), pwaUrl, ...result });
  } catch (err) {
    console.error('[clients] add error:', err.message);
    res.status(500).json({ ok: false, error: `Failed to add client: ${err.message}` });
  }
});

// ── Calendar Page ─────────────────────────────────────────────────────────────

router.get('/:id/calendar', (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'calendar.html');
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send('Calendar page not found');
  }
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsClients) || true;
  const coachName = (req.coach && req.coach.name) || process.env.COACH_NAME || 'Coach Alex';
  const clientId  = parseInt(req.params.id, 10) || 1;
  let html = fs.readFileSync(htmlPath, 'utf8');
  const injection = `<script>
    window.__COACH_LIVE__ = ${JSON.stringify({ sheetsEnabled, coachName })};
    window.__CLIENT_ID__ = ${clientId};
  </script>`;
  html = html.replace('</head>', `${injection}\n</head>`);
  res.type('html').send(html);
});

// ── API: Calendar data — program days mapped to real dates ────────────────────

router.get('/:id/api/calendar', async (req, res) => {
  const clientId = parseInt(req.params.id, 10) || 1;
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsClients);

  if (!sheetsEnabled) {
    // Demo: return a mock program anchored to a realistic start date from fixture
    const demoClient = demoStore.getClientById(clientId);
    const startDate = (demoClient && demoClient.startDate) || new Date().toISOString().split('T')[0];
    return res.json({
      ok: true,
      demo: true,
      client: {
        id: clientId,
        name: demoClient ? demoClient.name : 'Demo Client',
        program: demoClient ? demoClient.program : 'Strength Phase 1',
        programStartDate: startDate,
      },
      programDays: _mockCalendarDays(startDate),
    });
  }

  try {
    const sheetId = req.sheetId;
    const sheetsPrograms = require('../lib/sheets/programs');

    const [tabClients, programData] = await Promise.all([
      sheetsClients.getClientList(sheetId),
      sheetsPrograms.getFullProgram(sheetId),
    ]);

    let allClients = tabClients;
    const client = allClients.find(c => c.id === clientId) || allClients[0];

    if (!client) {
      return res.status(404).json({ ok: false, error: 'Client not found' });
    }

    // Resolve program_start_date: use client's startDate from Clients tab
    const programStartDate = client.startDate || '';

    // Convert program weeks/days to calendar events
    const calendarDays = _mapProgramToCalendar(programData.weeks, programStartDate);

    res.json({
      ok: true,
      demo: false,
      client: {
        id: client.id,
        name: client.name,
        program: client.program || '',
        programStartDate,
      },
      programDays: calendarDays,
    });
  } catch (err) {
    console.error('[clients] calendar error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API: Update program start date ────────────────────────────────────────────
// Writes back to Clients tab column D (Start Date) for the given client row.

router.post('/:id/api/calendar/set-start', async (req, res) => {
  const clientId = parseInt(req.params.id, 10) || 1;
  const { startDate } = req.body || {};

  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return res.status(400).json({ ok: false, error: 'startDate (YYYY-MM-DD) required' });
  }

  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsClients);
  if (!sheetsEnabled) {
    return res.json({ ok: true, demo: true, startDate });
  }

  try {
    const sheetId = req.sheetId;
    const clients = await sheetsClients.getClientList(sheetId);
    const clientIdx = clients.findIndex(c => c.id === clientId);
    if (clientIdx === -1) {
      return res.status(404).json({ ok: false, error: 'Client not found' });
    }

    // Row in sheet = header(1) + 0-indexed position + 1 = clientIdx + 2
    const sheetRow = clientIdx + 2;
    const { google } = require('googleapis');
    const { getAuth } = require('../lib/sheets/client');
    const sheets = google.sheets({ version: 'v4', auth: getAuth() });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Clients!D${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[startDate]] },
    });

    res.json({ ok: true, startDate });
  } catch (err) {
    console.error('[clients] set-start error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Map program week/day entries to ISO date strings.
 * Week 1 Day 1 anchors to programStartDate.
 * Day names (Monday=1 … Sunday=7) offset from anchor.
 */
function _mapProgramToCalendar(weeks, programStartDate) {
  const dayNameToOffset = {
    monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
    friday: 4, saturday: 5, sunday: 6,
  };

  // If no start date, return days without real dates so UI can prompt
  const hasAnchor = !!programStartDate;
  let anchorDate = null;

  if (hasAnchor) {
    // Anchor is the Monday of Week 1
    anchorDate = new Date(programStartDate + 'T00:00:00');
    // Normalize to a Monday (shift forward if needed — we treat the start date as Week 1 Mon)
  }

  const result = [];
  for (const week of weeks) {
    for (const day of week.days) {
      const dayKey = (day.day || '').toLowerCase();
      const dayOffset = dayNameToOffset[dayKey] ?? null;

      let isoDate = null;
      if (hasAnchor && dayOffset !== null) {
        const d = new Date(anchorDate);
        d.setDate(anchorDate.getDate() + (week.week - 1) * 7 + dayOffset);
        isoDate = d.toISOString().split('T')[0];
      }

      result.push({
        date: isoDate,
        week: week.week,
        phase: week.phase || '',
        day: day.day,
        focus: day.focus,
        exerciseCount: day.exercises.length,
        exercises: day.exercises,
      });
    }
  }
  return result;
}

function _mockCalendarDays(startDate) {
  const days = [
    { day: 'Monday', focus: 'Lower Body Strength', exercises: [
      { name: 'Back Squat', sets: '4', reps: '6', load: 'RPE 7', rest: '180', notes: 'Depth focus.' },
      { name: 'Romanian Deadlift', sets: '3', reps: '10', load: 'RPE 7', rest: '120', notes: '' },
      { name: 'Bulgarian Split Squat', sets: '3', reps: '8/side', load: 'RPE 7', rest: '90', notes: '' },
    ]},
    { day: 'Wednesday', focus: 'Upper Body Push', exercises: [
      { name: 'Bench Press', sets: '4', reps: '8', load: 'RPE 7', rest: '150', notes: 'Retract scapula.' },
      { name: 'DB Shoulder Press', sets: '3', reps: '10', load: 'RPE 7', rest: '90', notes: '' },
    ]},
    { day: 'Friday', focus: 'Upper Body Pull + Core', exercises: [
      { name: 'Barbell Row', sets: '4', reps: '8', load: 'RPE 7', rest: '120', notes: '' },
      { name: 'Lat Pulldown', sets: '3', reps: '10', load: 'RPE 7', rest: '90', notes: '' },
    ]},
  ];

  const dayNameToOffset = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
  const anchor = new Date(startDate + 'T00:00:00');

  return days.map(d => {
    const offset = dayNameToOffset[(d.day || '').toLowerCase()] ?? 0;
    const dt = new Date(anchor);
    dt.setDate(anchor.getDate() + offset);
    return {
      date: dt.toISOString().split('T')[0],
      week: 1,
      phase: 'Accumulation',
      day: d.day,
      focus: d.focus,
      exerciseCount: d.exercises.length,
      exercises: d.exercises,
    };
  });
}

// ── Results Page ──────────────────────────────────────────────────────────────

router.get('/:id/results', (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'results.html');
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send('Results page not found');
  }
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsClients) || true;
  const coachName = (req.coach && req.coach.name) || process.env.COACH_NAME || 'Coach Alex';
  const clientId  = parseInt(req.params.id, 10) || 1;
  let html = fs.readFileSync(htmlPath, 'utf8');
  const injection = `<script>
    window.__COACH_LIVE__ = ${JSON.stringify({ sheetsEnabled, coachName })};
    window.__CLIENT_ID__ = ${clientId};
  </script>`;
  html = html.replace('</head>', `${injection}\n</head>`);
  res.type('html').send(html);
});

// ── API: Client results data — charts, summary cards, photo comparison ────────

router.get('/:id/api/results', async (req, res) => {
  const clientId = parseInt(req.params.id, 10) || 1;
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsClients);

  if (!sheetsEnabled) {
    // Demo mode: return deterministic chart data using the same engine as /history
    const { generateDemoHistory } = require('../lib/demo-history');
    const history = generateDemoHistory();

    // Build summary cards from demo data
    const bwArr = history.bodyweight || [];
    const now = new Date();
    const cutoff30 = new Date(now);
    cutoff30.setDate(now.getDate() - 30);

    const bwNow = bwArr.length ? bwArr[bwArr.length - 1].weight : null;
    const bw30dAgo = bwArr.find(r => new Date(r.date) >= cutoff30);
    const bwDelta = (bwNow != null && bw30dAgo) ? Math.round((bwNow - bw30dAgo.weight) * 10) / 10 : null;

    const wrkCutoff = new Date(now);
    wrkCutoff.setDate(now.getDate() - 30);
    const workoutsLast30d = (history.squatSets || []).filter(r => new Date(r.date) >= wrkCutoff).length;

    const lastCheckin = bwArr.length ? bwArr[bwArr.length - 1].date : null;

    const wellnessArr = history.wellness || [];
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - now.getDay());
    const thisWeekWellness = wellnessArr.filter(r => new Date(r.date) >= thisWeekStart);
    const adherencePct = thisWeekWellness.length > 0
      ? Math.round((thisWeekWellness.length / 5) * 100)
      : 0;

    const demoClient = demoStore.getClientById(clientId);
    return res.json({
      ok: true,
      demo: true,
      client: { id: clientId, name: demoClient ? demoClient.name : 'Demo Client', program: demoClient ? demoClient.program : 'Strength Phase 1' },
      summary: {
        currentBodyweight: bwNow,
        bwDelta30d: bwDelta,
        workoutsLast30d,
        adherencePct: Math.min(adherencePct, 100),
        lastCheckin,
      },
      charts: {
        bodyweight: history.bodyweight,
        wellness: history.wellness,
        measurements: history.measurements,
        squatSets: history.squatSets,
      },
      photoCheckins: history.photoCheckins || [],
    });
  }

  // ── Live Sheet data ────────────────────────────────────────────────────────
  try {
    const sheetId = req.sheetId;

    const [tabClients, dashClients] = await Promise.all([
      sheetsClients.getClientList(sheetId),
      sheetsDashboard.getClients(sheetId),
    ]);

    let allClients = tabClients.length > 0 ? tabClients : dashClients;
    const client = allClients.find(c => c.id === clientId) || allClients[0];

    if (!client) {
      return res.status(404).json({ ok: false, error: 'Client not found' });
    }

    const { getTabValues } = require('../lib/sheets/client');

    // CheckIns!A:T (see lib/sheets/checkins.js for column map)
    // Workouts!A:K for squat/lift top sets
    const [checkinRows, workoutRows] = await Promise.all([
      getTabValues(sheetId, 'CheckIns!A2:T200').catch(() => []),
      getTabValues(sheetId, 'Workouts!A2:K200').catch(() => []),
    ]);

    // ── Parse check-ins ──────────────────────────────────────────────────────
    const bodyweight  = [];
    const wellness    = [];
    const measurements = [];
    const photoCheckins = [];

    for (const r of checkinRows) {
      const date = r[0];
      if (!date) continue;

      // Bodyweight
      const bw = parseFloat(r[2]);
      if (!isNaN(bw) && bw > 0) bodyweight.push({ date, weight: bw });

      // Wellness: sleep(14), energy(15), stress(16), soreness from notes(17)
      const sleep   = parseFloat(r[14]);
      const energy  = parseFloat(r[15]);
      const stress  = parseFloat(r[16]);
      if (!isNaN(sleep) || !isNaN(energy) || !isNaN(stress)) {
        wellness.push({
          date,
          sleep:   !isNaN(sleep)  ? sleep  : null,
          energy:  !isNaN(energy) ? energy : null,
          stress:  !isNaN(stress) ? stress : null,
          soreness: null, // not a dedicated column — extracted from notes if present
        });
      }

      // Measurements: waist(4) hip(5) chest(6) larm(7) rarm(8) lthigh(9) rthigh(10)
      const hasMeasure = [4,5,6,7,8,9,10].some(i => r[i] && !isNaN(parseFloat(r[i])));
      if (hasMeasure) {
        measurements.push({
          date,
          waist:  parseNum(r[4]),
          hip:    parseNum(r[5]),
          chest:  parseNum(r[6]),
          larm:   parseNum(r[7]),
          rarm:   parseNum(r[8]),
          lthigh: parseNum(r[9]),
          rthigh: parseNum(r[10]),
        });
      }

      // Photos: col 11 = Photo Front URL
      if (r[11]) {
        photoCheckins.push({
          date,
          photoUrl: r[11],
          bodyweight: !isNaN(bw) ? bw : null,
          measurements: hasMeasure ? {
            waist: parseNum(r[4]), hip: parseNum(r[5]), chest: parseNum(r[6]),
            larm:  parseNum(r[7]), rarm: parseNum(r[8]),
          } : null,
        });
      }
    }

    // Sort all arrays oldest→newest
    [bodyweight, wellness, measurements, photoCheckins].forEach(arr => arr.sort((a, b) => a.date < b.date ? -1 : 1));

    // ── Parse workout top sets (one row per exercise completion) ─────────────
    // Workouts columns: 0=date, 1=week, 2=day, 3=exercise, 4=sets, 5=reps, 6=weight, 7=rpe
    const squatSets = [];
    const KEY_LIFTS = ['squat', 'bench', 'deadlift', 'ohp', 'overhead press', 'press'];

    for (const r of workoutRows) {
      const date = r[0];
      const exName = (r[3] || '').toLowerCase();
      const weight = parseFloat(r[6]);
      if (!date || !exName || isNaN(weight)) continue;

      const isKeyLift = KEY_LIFTS.some(k => exName.includes(k));
      if (isKeyLift && exName.includes('squat')) {
        squatSets.push({ date, exercise: r[3], weight });
      }
    }

    squatSets.sort((a, b) => a.date < b.date ? -1 : 1);

    // ── Summary cards ────────────────────────────────────────────────────────
    const now = new Date();
    const cutoff30 = new Date(now);
    cutoff30.setDate(now.getDate() - 30);

    const bwNow = bodyweight.length ? bodyweight[bodyweight.length - 1].weight : null;
    const bw30dEntry = bodyweight.slice().reverse().find(r => new Date(r.date + 'T00:00:00') <= cutoff30);
    const bwDelta30d = (bwNow != null && bw30dEntry) ? Math.round((bwNow - bw30dEntry.weight) * 10) / 10 : null;

    const wrkCutoff = new Date(now);
    wrkCutoff.setDate(now.getDate() - 30);
    const workoutsLast30d = workoutRows.filter(r => {
      if (!r[0]) return false;
      return new Date(r[0] + 'T00:00:00') >= wrkCutoff;
    }).length;

    const lastCheckin = bodyweight.length ? bodyweight[bodyweight.length - 1].date : null;

    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - now.getDay());
    const thisWeekCheckins = bodyweight.filter(r => new Date(r.date + 'T00:00:00') >= thisWeekStart).length;
    const adherencePct = Math.min(Math.round((thisWeekCheckins / 5) * 100), 100);

    res.json({
      ok: true,
      demo: false,
      client: {
        id: client.id,
        name: client.name,
        program: client.program || client.block || '',
      },
      summary: {
        currentBodyweight: bwNow,
        bwDelta30d,
        workoutsLast30d,
        adherencePct,
        lastCheckin,
      },
      charts: { bodyweight, wellness, measurements, squatSets },
      photoCheckins,
    });
  } catch (err) {
    console.error('[clients] results error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function parseNum(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// ── Client Detail Page ────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'client-detail.html');
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send('Client detail page not found');
  }
  // Demo mode treated as sheetsEnabled so the JS fetches data (API returns fixture data)
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsClients) || true;
  const coachName = (req.coach && req.coach.name) || process.env.COACH_NAME || 'Coach Alex';
  const clientId  = parseInt(req.params.id, 10) || 1;
  let html = fs.readFileSync(htmlPath, 'utf8');
  const injection = `<script>
    window.__COACH_LIVE__ = ${JSON.stringify({ sheetsEnabled, coachName })};
    window.__CLIENT_ID__ = ${clientId};
  </script>`;
  html = html.replace('</head>', `${injection}\n</head>`);
  res.type('html').send(html);
});

// ── API: Client detail data ───────────────────────────────────────────────────

router.get('/:id/api/detail', async (req, res) => {
  const clientId = parseInt(req.params.id, 10) || 1;
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY && sheetsClients);

  if (!sheetsEnabled) {
    // Demo mode — return fixture data so client detail page is functional
    const client = demoStore.getClientById(clientId);
    return res.json({
      ok: true,
      demo: true,
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
        initial: client.initial,
        status: client.status,
        program: client.program,
        startDate: client.startDate,
        compliance7d: client.compliance7d,
        lastCheckin: client.lastCheckin,
        goal: client.goal,
      },
      recentWorkouts: demoStore.getRecentWorkouts(clientId),
      recentCheckins: demoStore.getRecentCheckins(clientId),
      recentMessages: demoStore.getRecentMessages(),
    });
  }

  try {
    const sheetId = req.sheetId;

    // Get client info from Clients tab or profile
    const [tabClients, dashClients] = await Promise.all([
      sheetsClients.getClientList(sheetId),
      sheetsDashboard.getClients(sheetId),
    ]);

    let allClients = tabClients.length > 0 ? tabClients : dashClients;
    const client = allClients.find(c => c.id === clientId) || allClients[0];

    if (!client) {
      return res.status(404).json({ ok: false, error: 'Client not found' });
    }

    // Pull recent data from the configured sheet
    const { getTabValues } = require('../lib/sheets/client');
    const [workoutRows, checkinRows, messageRows] = await Promise.all([
      getTabValues(sheetId, 'Workouts!A2:K50').catch(() => []),
      getTabValues(sheetId, 'CheckIns!A2:T20').catch(() => []),
      getTabValues(sheetId, 'Messages!A2:E50').catch(() => []),
    ]);

    const recentWorkouts = workoutRows.slice(-10).reverse().map(r => ({
      date: r[0] || '', exercise: r[3] || '', sets: r[4] || '',
      reps: r[5] || '', weight: r[6] || '', rpe: r[7] || '',
      status: r[9] || '',
    }));

    const recentCheckins = checkinRows.slice(-5).reverse().map(r => ({
      date: r[0] || '', bodyweight: r[2] || '',
      mood: r[13] || '', sleep: r[14] || '', energy: r[15] || '',
      notes: r[17] || '',
    }));

    const recentMessages = messageRows.slice(-10).reverse().map(r => ({
      timestamp: r[0] || '', sender: r[1] || '',
      message: r[2] || '', read: r[3] || '',
    }));

    res.json({
      ok: true,
      demo: false,
      client: {
        id: client.id,
        name: client.name,
        email: client.email || '',
        initial: client.initial || client.name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2),
        status: client.status || 'Active',
        program: client.program || client.block || '',
        startDate: client.startDate || '',
        compliance7d: client.compliance7d || 0,
        lastCheckin: client.lastCheckin || '—',
      },
      recentWorkouts,
      recentCheckins,
      recentMessages,
    });
  } catch (err) {
    console.error('[clients] detail error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Mock detail data for demo mode ────────────────────────────────────────────

function _mockWorkouts() {
  return [
    { date: '2026-05-07', exercise: 'Back Squat', sets: '4', reps: '6', weight: '85', rpe: '8', status: 'Completed' },
    { date: '2026-05-07', exercise: 'Romanian Deadlift', sets: '3', reps: '10', weight: '60', rpe: '7', status: 'Completed' },
    { date: '2026-05-05', exercise: 'Bench Press', sets: '4', reps: '8', weight: '70', rpe: '7.5', status: 'Completed' },
    { date: '2026-05-05', exercise: 'DB Shoulder Press', sets: '3', reps: '12', weight: '20', rpe: '7', status: 'Completed' },
    { date: '2026-05-03', exercise: 'Lat Pulldown', sets: '4', reps: '10', weight: '55', rpe: '7', status: 'Completed' },
  ];
}

function _mockCheckins() {
  return [
    { date: '2026-05-07', bodyweight: '71.5', mood: '8', sleep: '7', energy: '8', notes: 'Feeling strong this week.' },
    { date: '2026-04-30', bodyweight: '72.0', mood: '7', sleep: '6', energy: '7', notes: 'Slightly tired from travel.' },
    { date: '2026-04-23', bodyweight: '72.3', mood: '7', sleep: '7', energy: '7', notes: '' },
  ];
}

function _mockMessages(clientName) {
  return [
    { timestamp: '2026-05-07 14:30', sender: 'Client', message: 'Squats felt great today — added 2.5kg!', read: 'TRUE' },
    { timestamp: '2026-05-07 09:00', sender: 'Coach', message: 'Nice work! Push through this week and we\'ll deload next.', read: 'TRUE' },
    { timestamp: '2026-05-05 18:45', sender: 'Client', message: 'Bench felt a bit off, left shoulder tight.', read: 'TRUE' },
    { timestamp: '2026-05-05 19:30', sender: 'Coach', message: 'Let\'s add some band pull-aparts as warm-up. Keep RPE at 7 for now.', read: 'TRUE' },
  ];
}

module.exports = router;
