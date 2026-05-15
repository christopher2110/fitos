// lib/sheets/demo-store.js
// Owns: In-memory data store for QA/demo mode — mirrors Sheet API surface using fixture data.
// Does NOT own: real Google Sheets integration, persistence across restarts.
//
// Purpose: When no GOOGLE_SERVICE_ACCOUNT_KEY + COACH_SHEET_ID are configured, routes use
// this store so every page shows real fixture data and writes persist in-memory for the session.

'use strict';

const fixture = require('../demo-fixture');

// Deep-clone fixture data so writes don't mutate the const definitions
let _clients = fixture.CLIENTS.map((c, idx) => ({
  id: idx + 1,
  name: c.name,
  email: c.email,
  program: c.program,
  startDate: c.startDate,
  status: c.status,
  notes: c.notes,
  added: c.startDate,
  // Dashboard-facing fields
  initial: c.name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2),
  block: c.block,
  blockParsed: c.blockParsed,
  compliance7d: c.compliance7d,
  lastCheckin: c.lastCheckin,
  bodyweight: c.bodyweight,
  goal: c.goal,
}));

// Message store: { sarah, marcus, jen } — keyed by client id
const _messages = {
  sarah: [...fixture.SARAH_MESSAGES],
  marcus: [],
  jen: [],
  _global: [...fixture.SARAH_MESSAGES], // global thread for /messages PWA
};

// Checkin store
const _checkins = {
  sarah: [...fixture.SARAH_CHECKINS],
  marcus: [...fixture.MARCUS_CHECKINS],
  jen: [...fixture.JEN_CHECKINS],
};

// Workout store
const _workouts = {
  sarah: [...fixture.SARAH_WORKOUTS],
  marcus: [...fixture.MARCUS_WORKOUTS],
  jen: [...fixture.JEN_WORKOUTS],
};

// Activity feed — synthetic from fixture data
const _activityFeed = [
  { type: 'checkin',  client: 'Sarah Chen',   time: '2026-05-08 09:15', summary: 'Week 4 check-in — weight 62.8 kg, energy 8/10' },
  { type: 'workout',  client: 'Marcus Reeves', time: '2026-05-09 11:30', summary: 'Squat + Accessory completed — 185 kg top set' },
  { type: 'message',  client: 'Sarah Chen',   time: '2026-05-09 15:04', summary: 'Client asked about hip flexibility' },
  { type: 'workout',  client: 'Sarah Chen',   time: '2026-05-09 08:00', summary: 'Day A Lower Hypertrophy completed' },
  { type: 'checkin',  client: 'Marcus Reeves', time: '2026-05-10 07:00', summary: 'Week 12 check-in — fatigue flag raised' },
  { type: 'message',  client: 'Sarah Chen',   time: '2026-05-07 18:30', summary: 'Pull-ups getting easier — client update' },
  { type: 'workout',  client: 'Jen Park',     time: '2026-05-09 10:00', summary: 'Session 2 Intro Lower completed' },
  { type: 'checkin',  client: 'Jen Park',     time: '2026-05-10 08:00', summary: 'Week 1 check-in — some soreness, excited' },
  { type: 'message',  client: 'Sarah Chen',   time: '2026-05-05 09:15', summary: 'Question about cardio on rest days' },
  { type: 'workout',  client: 'Marcus Reeves', time: '2026-05-08 12:00', summary: 'Bench Press Day completed — 130 kg top set' },
];

// ── Read helpers ──────────────────────────────────────────────────────────────

/** List all clients (roster view). */
function getClients() {
  return _clients.filter(c => c.name);
}

/** Get a single client by numeric id. */
function getClientById(id) {
  return _clients.find(c => c.id === id) || _clients[0] || null;
}

/** KPIs computed from in-memory data. */
function getKPIs() {
  const active = _clients.filter(c => c.status === 'Active' || c.status === 'Flag').length;
  const sessionsLast7 = _workouts.sarah.filter(w => {
    const d = new Date(w.date);
    return (Date.now() - d.getTime()) < 7 * 86400000;
  }).length + _workouts.marcus.filter(w => {
    const d = new Date(w.date);
    return (Date.now() - d.getTime()) < 7 * 86400000;
  }).length;

  return {
    activeClients: active,
    activeClientsDelta: 1,
    sessionsLast7,
    avgRpe: 7.4,
    retentionPct: 94,
  };
}

/** Activity feed (most recent first). */
function getActivityFeed(limit = 20) {
  return _activityFeed.slice(0, limit).map(e => ({
    ...e,
    relativeTime: _relTime(e.time),
  }));
}

/** Messages for the client PWA global thread (newest first). */
function getMessages(since) {
  let msgs = [..._messages._global];
  if (since) msgs = msgs.filter(m => m.time > since);
  return msgs.slice().reverse();
}

/** Append a message to global thread. */
function appendMessage(body, sender = 'client') {
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  _messages._global.unshift({ from: sender, time: now, text: body });
  _activityFeed.unshift({
    type: 'message',
    client: 'Demo Client',
    time: now,
    summary: body.slice(0, 80),
  });
}

/** Append a check-in entry. */
function appendCheckIn(data) {
  const entry = { date: data.date || new Date().toISOString().split('T')[0], ...data };
  _checkins.sarah.push(entry);
  return { rowId: _checkins.sarah.length, persisted: true };
}

/** Add a new client. */
function addClient({ name, email, program, notes }) {
  const id = _clients.length + 1;
  const now = new Date().toISOString().split('T')[0];
  const c = {
    id,
    name: name.trim(),
    email: (email || '').trim(),
    program: (program || '').trim(),
    startDate: now,
    status: 'Active',
    notes: (notes || '').trim(),
    added: now,
    initial: name.trim().split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2),
    block: program ? `${program} W1/1` : 'No program',
    blockParsed: { name: program || 'No program', week: 1, totalWeeks: 1, progressPct: 0 },
    compliance7d: 0,
    lastCheckin: '—',
    bodyweight: null,
    goal: '',
  };
  _clients.push(c);
  _activityFeed.unshift({
    type: 'client_added', client: name.trim(),
    time: now + ' 00:00', summary: `New client added — ${program || 'No program'}`,
  });
  return { ok: true, name: c.name, addedAt: now };
}

/** Results data for a client (charts). */
function getResultsData(clientId) {
  // Use Sarah's rich fixture for all clients in demo mode
  return fixture.generateSarahResultsData();
}

/** Recent workouts for client detail. */
function getRecentWorkouts(clientId) {
  const client = getClientById(clientId);
  const key = client ? client.name.split(' ')[0].toLowerCase() : 'sarah';
  const pool = _workouts[key] || _workouts.sarah;
  return pool.slice(0, 5).map(w => ({
    date: w.date,
    exercise: w.exercises[0] ? w.exercises[0].name : 'Session',
    sets: w.exercises[0] ? String(w.exercises[0].sets) : '',
    reps: w.exercises[0] ? String(w.exercises[0].reps) : '',
    weight: w.exercises[0] ? w.exercises[0].load : '',
    rpe: w.exercises[0] ? (w.exercises[0].notes || '') : '',
    status: w.completed ? 'Completed' : 'Pending',
  }));
}

/** Recent check-ins for client detail. */
function getRecentCheckins(clientId) {
  const client = getClientById(clientId);
  const key = client ? client.name.split(' ')[0].toLowerCase() : 'sarah';
  const pool = _checkins[key] || _checkins.sarah;
  return pool.slice(0, 5).map(c => ({
    date: c.date,
    bodyweight: String(c.bodyweight || ''),
    mood: String(c.energy || ''),
    sleep: String(c.sleep || ''),
    energy: String(c.energy || ''),
    notes: c.notes || '',
  }));
}

/** Recent messages for client detail. */
function getRecentMessages() {
  return fixture.SARAH_MESSAGES.slice(0, 6).map(m => ({
    timestamp: m.time,
    sender: m.from === 'coach' ? 'Coach' : 'Client',
    message: m.text,
    read: 'TRUE',
  }));
}

// ── Private ───────────────────────────────────────────────────────────────────

function _relTime(timeStr) {
  const d = new Date(timeStr.replace(' ', 'T'));
  const ms = Date.now() - d.getTime();
  const mins  = Math.round(ms / 60000);
  const hours = Math.round(ms / 3600000);
  const days  = Math.round(ms / 86400000);
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  if (days  < 30)  return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

module.exports = {
  getClients,
  getClientById,
  getKPIs,
  getActivityFeed,
  getMessages,
  appendMessage,
  appendCheckIn,
  addClient,
  getResultsData,
  getRecentWorkouts,
  getRecentCheckins,
  getRecentMessages,
};
