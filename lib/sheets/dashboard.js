// lib/sheets/dashboard.js
// Owns: Coach Dashboard data — getClients, getActivityFeed, getKPIs computed from Sheets
// Does NOT own: HTTP handling, raw Sheets API calls (those are in client.js)

const { getTabValues } = require('./client');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Return ISO date N days ago. */
function daysAgoIso(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().split('T')[0];
}

/** Human-readable relative time string. */
function relativeTime(msAgo) {
  const mins  = Math.round(msAgo / 60000);
  const hours = Math.round(msAgo / 3600000);
  const days  = Math.round(msAgo / 86400000);
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  if (days  < 30)  return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

/** Parse "Coach Alex" → "Alex", or return raw if no "Coach " prefix. */
function shortenCoachName(name) {
  return (name || 'Coach').replace(/^Coach\s+/i, '').trim() || 'Coach';
}

/** Parse a Profile tab (col A = Field, col B = Value) into a plain object. */
function parseProfile(rows) {
  const out = {};
  for (const r of rows) {
    const key = (r[0] || '').trim();
    if (key) out[key] = (r[1] || '').trim();
  }
  return out;
}

/** Parse block string "Hypertrophy W3/6" → { name, week, totalWeeks, progressPct } */
function parseBlock(blockStr) {
  const m = (blockStr || '').match(/^(.+)\s+W(\d+)\/(\d+)$/);
  if (!m) return { name: blockStr || 'Program', week: 1, totalWeeks: 1, progressPct: 100 };
  return {
    name: m[1],
    week: parseInt(m[2], 10),
    totalWeeks: parseInt(m[3], 10),
    progressPct: Math.round((parseInt(m[2], 10) / parseInt(m[3], 10)) * 100),
  };
}

// KPI cache: avoids re-computing from Workouts + CheckIns on every request
const _kpiCache = { data: null, expires: 0 };
const KPI_TTL_MS = 60_000; // 60s for computed KPIs (heavier compute than raw reads)

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read all clients from the Clients tab (multi-client model).
 *
 * Clients tab columns: Name | Email | Program | Start Date | Status | Notes | Added
 *
 * For each client, we also compute:
 *   - lastCheckin / lastCheckinMs  from CheckIns tab (filtered by Client name)
 *   - compliance7d                 from Workouts tab (filtered by Client name)
 *   - block / blockParsed          from Status column or Program column
 *
 * Returns array of client objects matching the shape the dashboard frontend expects.
 */
async function getClients(sheetId) {
  const now = Date.now();

  // Read all three tabs in parallel
  const [clientRows, checkinRows, workoutRows] = await Promise.all([
    getTabValues(sheetId, 'Clients!A2:G500').catch(() => []),
    getTabValues(sheetId, 'CheckIns!A2:I5000').catch(() => []),
    getTabValues(sheetId, 'Workouts!A2:J5000').catch(() => []),
  ]);

  const sevenDaysAgo = daysAgoIso(7);
  const thirtyDaysAgo = daysAgoIso(30);

  return clientRows
    .map((r, idx) => {
      const name    = (r[0] || '').trim();
      if (!name) return null;

      const email     = (r[1] || '').trim();
      const program   = (r[2] || '').trim();
      const startDate = (r[3] || '').trim();
      const status    = (r[4] || 'Active').trim();
      const notes     = (r[5] || '').trim();

      const initial = name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2);

      // Last check-in for this client
      let lastCheckinMs = 0;
      for (const cr of checkinRows) {
        const crClient = (cr[1] || '').trim();
        if (crClient.toLowerCase() !== name.toLowerCase()) continue;
        const d = cr[0] ? new Date(cr[0]).getTime() : 0;
        if (d > lastCheckinMs) lastCheckinMs = d;
      }

      // Infer displayed status: respect explicit Status column values (Active/Flag/Onboarding)
      // but also infer Missed if no check-in for 7+ days and status wasn't set manually
      let displayStatus = status;
      if (displayStatus === 'Active' && lastCheckinMs) {
        const daysSince = Math.floor((now - lastCheckinMs) / 86400000);
        if (daysSince > 7) displayStatus = 'Missed';
        else if (daysSince > 3) displayStatus = 'Flag';
      }

      // Compliance 7d for this client (distinct training days / 7)
      const clientWorkouts = workoutRows.filter(wr => {
        const wrClient = (wr[1] || '').trim();
        return wrClient.toLowerCase() === name.toLowerCase();
      });
      const recentDays = new Set(
        clientWorkouts
          .filter(wr => (wr[0] || '') >= sevenDaysAgo && ['Completed', 'PR', 'Modified'].includes((wr[9] || '').trim()))
          .map(wr => wr[0])
      );
      const compliance7d = Math.round((recentDays.size / 7) * 100);

      // Block string from Program column (e.g. "Hypertrophy Block W4/6")
      // If it doesn't match the block pattern, synthesise from program name
      const block = program ? `${program} W1/1` : 'No program';
      const blockParsed = parseBlock(block);

      return {
        id: idx + 1,
        name,
        email,
        program,
        startDate,
        status: displayStatus,
        notes,
        initial,
        block,
        blockParsed,
        compliance7d,
        lastCheckinMs,
        lastCheckin: lastCheckinMs ? relativeTime(now - lastCheckinMs) : 'Never',
        sheetId,
      };
    })
    .filter(Boolean);
}

/**
 * Count distinct client+date pairs with Completed sets in the last 7 days.
 * Workouts columns: Date(0) | Client(1) | Exercise(2) | Sets(3) | Reps(4) | Load(5) | RPE(6) | Notes(7) | Label(8) | Status(9)
 */
async function _countSessions7d(sheetId) {
  try {
    const rows = await getTabValues(sheetId, 'Workouts!A2:J2000');
    const sevenDaysAgo = daysAgoIso(7);
    const sessions = new Set(
      rows
        .filter(r => (r[0] || '') >= sevenDaysAgo && ['Completed', 'PR', 'Modified'].includes((r[9] || '').trim()))
        .map(r => `${r[0]}:${(r[1] || '').trim()}`)  // date:client composite key
    );
    return sessions.size;
  } catch (_) {
    return 0;
  }
}

/**
 * Average RPE (col 6) across Completed sets in the last 7 days.
 * Workouts columns: Date(0) | Client(1) | Exercise(2) | Sets(3) | Reps(4) | Load(5) | RPE(6) | ...
 */
async function _computeAvgRpe7d(sheetId) {
  try {
    const rows = await getTabValues(sheetId, 'Workouts!A2:J2000');
    const sevenDaysAgo = daysAgoIso(7);
    const rpes = rows
      .filter(r => (r[0] || '') >= sevenDaysAgo && r[6] !== '' && r[6] !== undefined)
      .map(r => parseFloat(r[6]))
      .filter(n => !isNaN(n) && n > 0);
    if (!rpes.length) return null;
    return Math.round((rpes.reduce((s, v) => s + v, 0) / rpes.length) * 10) / 10;
  } catch (_) {
    return null;
  }
}

/**
 * Read the Activity tab newest-first, up to `limit` rows.
 * Also synthesises workout completions from the Workouts tab into the feed.
 * Shape matches the mockCoachData event type used by the dashboard frontend.
 */
async function getActivityFeed(sheetId, limit = 20) {
  const events = [];
  const now = Date.now();

  // 1. CheckIns tab — each row is a check-in event
  // Columns: Date(0) | Client(1) | Bodyweight(2) | Energy(3) | Sleep(4) | Stress(5) | Soreness(6) | Mood(7) | Notes(8)
  try {
    const ciRows = await getTabValues(sheetId, 'CheckIns!A2:I2000');
    for (const r of ciRows) {
      const dateStr = (r[0] || '').trim();
      const client  = (r[1] || '').trim();
      if (!dateStr) continue;
      const tsMs = new Date(dateStr).getTime();
      const bw   = r[2] ? `${r[2]} kg` : '';
      const mood = (r[7] || '').trim();
      const notes = (r[8] || '').trim();
      const summary = [bw, mood, notes].filter(Boolean).join(' · ').slice(0, 80);
      events.push({
        id:      `ci-${dateStr}:${client}`,
        type:    'checkin',
        label:   summary ? `Check-in: ${summary}` : 'Submitted check-in',
        icon:    'check',
        tsMs,
        relTime: relativeTime(now - tsMs),
        isAgent: false,
        source:  'client',
        client,
      });
    }
  } catch (_) { /* non-fatal */ }

  // 1b. Activity tab rows (explicit activity log entries)
  try {
    const actRows = await getTabValues(sheetId, 'Activity!A2:H1000');
    for (const r of actRows) {
      const dateStr = (r[0] || '').trim();
      if (!dateStr) continue;
      const tsMs  = new Date(dateStr).getTime();
      const client = (r[1] || '').trim();
      const notes = (r[7] || '').trim();
      const isCheckin = notes.toLowerCase().includes('check-in');
      events.push({
        id:      `act-${events.length}`,
        type:    isCheckin ? 'checkin' : 'workout',
        label:   isCheckin ? 'Submitted check-in' : 'Logged activity',
        icon:    isCheckin ? 'check' : 'dumbbell',
        tsMs,
        relTime: relativeTime(now - tsMs),
        isAgent: false,
        source:  'client',
        client,
      });
    }
  } catch (_) { /* non-fatal */ }

  // 2. Workouts tab — distinct client+date sessions (Completed sets)
  // Columns: Date(0) | Client(1) | Exercise(2) | ... | Status(9)
  try {
    const wkRows = await getTabValues(sheetId, 'Workouts!A2:J2000');
    const seenSessions = new Set();
    for (const r of wkRows) {
      const dateStr  = (r[0] || '').trim();
      const client   = (r[1] || '').trim();
      const label    = (r[8] || '').trim();
      const sessionKey = `${dateStr}:${client}`;
      if (!dateStr || seenSessions.has(sessionKey)) continue;
      if (!['Completed', 'PR', 'Modified'].includes((r[9] || '').trim())) continue;
      seenSessions.add(sessionKey);
      const tsMs = new Date(dateStr).getTime();
      events.push({
        id:      `wk-${sessionKey}`,
        type:    'workout',
        label:   label ? `Completed: ${label}` : 'Completed workout',
        icon:    'dumbbell',
        tsMs,
        relTime: relativeTime(now - tsMs),
        isAgent: false,
        source:  'client',
        client,
      });
    }
  } catch (_) { /* non-fatal */ }

  // Sort newest first, deduplicate by id, trim to limit
  const seen = new Set();
  return events
    .sort((a, b) => b.tsMs - a.tsMs)
    .filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; })
    .slice(0, limit);
}

/**
 * Compute KPIs from Workouts + CheckIns tabs.
 * Cached for 60s.
 *
 * Returns: { activeClients, sessionsLast7, avgRpe, retentionPct,
 *            activeClientsDelta, sessionsLast7Delta, avgRpeDelta, retentionPctDelta }
 */
async function getKPIs(sheetId) {
  if (_kpiCache.data && Date.now() < _kpiCache.expires) return _kpiCache.data;

  const [clients, sessionsLast7, avgRpe] = await Promise.all([
    getClients(sheetId),
    _countSessions7d(sheetId),
    _computeAvgRpe7d(sheetId),
  ]);

  // Retention: % of clients who checked in within the last 30 days
  let retentionPct = 0;
  if (clients.length) {
    const thirtyDaysAgo = Date.now() - 30 * 86400000;
    const retained = clients.filter(c => c.lastCheckinMs > thirtyDaysAgo).length;
    retentionPct = Math.round((retained / clients.length) * 100);
  }

  const activeClients = clients.filter(c => ['Active', 'Deload', 'Onboarding'].includes(c.status)).length;

  const kpis = {
    activeClients,
    activeClientsDelta:  0,
    sessionsLast7,
    sessionsLast7Delta:  0,
    avgRpe:              avgRpe || 0,
    avgRpeDelta:         0,
    retentionPct,
    retentionPctDelta:   0,
  };

  _kpiCache.data    = kpis;
  _kpiCache.expires = Date.now() + KPI_TTL_MS;
  return kpis;
}

module.exports = { getClients, getActivityFeed, getKPIs };
