// lib/mockCoachData.js
// Owns: deterministic mock data for Coach Dashboard demo (clients, KPIs, activity feed)
// Does NOT own: real Sheets integration (Phase 5), authentication, user sessions

// Seeded PRNG — identical output on every call, safe for demo
function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = Math.imul(1664525, s) + 1013904223 | 0;
    return (s >>> 0) / 0xffffffff;
  };
}

const FIRST_NAMES = [
  'Emma','Liam','Olivia','Noah','Ava','William','Sophia','James',
  'Isabella','Oliver','Mia','Benjamin','Amelia','Elijah','Harper',
  'Lucas','Evelyn','Mason','Abigail','Logan','Emily','Ethan','Ella','Aiden'
];

const LAST_NAMES = [
  'Campbell','Morrison','Fletcher','Davies','Hughes','Walker','Clarke',
  'Scott','Turner','Hall','White','Wilson','Taylor','Evans','Thomas',
  'Jackson','Harris','Martin','Thompson','Garcia','Martinez','Robinson','Lewis','Lee'
];

const STATUSES = ['Active','Active','Active','Active','Active','Flag','Missed','Deload','Onboarding'];
const BLOCKS = [
  'Hypertrophy W1/6','Hypertrophy W2/6','Hypertrophy W3/6','Hypertrophy W4/6',
  'Hypertrophy W5/6','Hypertrophy W6/6',
  'Strength W1/4','Strength W2/4','Strength W3/4','Strength W4/4',
  'Peaking W1/3','Peaking W2/3','Peaking W3/3',
  'Deload W1/2','Deload W2/2',
  'Onboarding W1/2','Onboarding W2/2',
];

const EVENT_TYPES = [
  { type: 'checkin',   label: 'Submitted check-in',     icon: 'check' },
  { type: 'workout',   label: 'Completed workout',       icon: 'dumbbell' },
  { type: 'flag',      label: 'Flag raised',             icon: 'flag' },
  { type: 'message',   label: 'Sent a message',          icon: 'message' },
  { type: 'milestone', label: 'Hit a personal record',   icon: 'trophy' },
  { type: 'missed',    label: 'Missed check-in',         icon: 'alert' },
];

// Parse block string like "Hypertrophy W3/6" → { name, week, totalWeeks, progressPct }
function parseBlock(blockStr) {
  const m = blockStr.match(/^(.+)\s+W(\d+)\/(\d+)$/);
  if (!m) return { name: blockStr, week: 1, totalWeeks: 1, progressPct: 100 };
  return {
    name: m[1],
    week: parseInt(m[2], 10),
    totalWeeks: parseInt(m[3], 10),
    progressPct: Math.round((parseInt(m[2], 10) / parseInt(m[3], 10)) * 100),
  };
}

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

function generateMockData() {
  const rng = seededRng(2026);
  const now = Date.now();

  // ── 24 CLIENTS ──────────────────────────────────────────────────
  const clients = FIRST_NAMES.map((first, idx) => {
    const last     = LAST_NAMES[idx];
    const statusIdx = Math.floor(rng() * STATUSES.length);
    const status   = STATUSES[statusIdx];
    const blockStr = BLOCKS[Math.floor(rng() * BLOCKS.length)];
    const block    = parseBlock(blockStr);

    // Compliance 7-day: Active 70–100%, others lower
    let complianceBase = status === 'Active' ? 0.72 : 0.38;
    const compliance7d = Math.min(100, Math.round((complianceBase + rng() * 0.28) * 100));

    // Last check-in: 0–10 days ago, weighted recent for Active
    const daysAgo = status === 'Active'
      ? Math.floor(rng() * 3)          // 0–2 days for active
      : Math.floor(rng() * 10) + 1;    // 1–10 days for others
    const lastCheckinMs = now - daysAgo * 86400000 - Math.floor(rng() * 86400000);

    // Avg RPE last 7 days (5.5 – 9.0)
    const avgRpe = Math.round((5.5 + rng() * 3.5) * 10) / 10;

    // Initial derived from name
    const initial = first[0].toUpperCase() + last[0].toUpperCase();

    return {
      id: idx + 1,
      name: `${first} ${last}`,
      initial,
      status,
      block: blockStr,
      blockParsed: block,
      compliance7d,
      lastCheckinMs,
      lastCheckin: relativeTime(now - lastCheckinMs),
      avgRpe,
      sessionsLast7: Math.floor(rng() * 4) + (status === 'Active' ? 2 : 0),
      sheetId: `mock-sheet-${idx + 1}`,
    };
  });

  // ── KPI ROLLUPS ─────────────────────────────────────────────────
  const activeClients   = clients.filter(c => c.status === 'Active' || c.status === 'Deload').length;
  const sessionsLast7   = clients.reduce((s, c) => s + c.sessionsLast7, 0);
  const avgRpe          = Math.round(
    (clients.reduce((s, c) => s + c.avgRpe, 0) / clients.length) * 10
  ) / 10;

  // Retention: clients who checked in within 30 days / total
  const thirtyDaysAgo  = now - 30 * 86400000;
  const retained       = clients.filter(c => c.lastCheckinMs > thirtyDaysAgo).length;
  const retentionPct   = Math.round((retained / clients.length) * 100);

  // Prior-period trends (mock deltas)
  const kpis = {
    activeClients,
    activeClientsDelta:  +2,
    sessionsLast7,
    sessionsLast7Delta:  sessionsLast7 - 38,
    avgRpe,
    avgRpeDelta:         -0.2,
    retentionPct,
    retentionPctDelta:   +3,
  };

  // ── ACTIVITY FEED (last 20 events) ──────────────────────────────
  const rng2 = seededRng(777);
  const events = [];
  let cursor = now;

  for (let i = 0; i < 20; i++) {
    const client   = clients[Math.floor(rng2() * clients.length)];
    const evType   = EVENT_TYPES[Math.floor(rng2() * EVENT_TYPES.length)];
    // Gap between events: 10 min – 4 hours
    const gapMs    = Math.floor((rng2() * 230 + 10) * 60000);
    cursor        -= gapMs;

    // Mark ~20% of events as agent-initiated for variety
    const isAgent = rng2() < 0.2;

    events.push({
      id:          i,
      clientId:    client.id,
      clientName:  client.name,
      clientInit:  client.initial,
      type:        evType.type,
      label:       evType.label,
      icon:        evType.icon,
      relTime:     relativeTime(now - cursor),
      tsMs:        cursor,
      isAgent,
    });
  }

  return { clients, kpis, events };
}

module.exports = { generateMockData };
