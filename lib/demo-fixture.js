// lib/demo-fixture.js
// Owns: Static in-memory fixture data for the public /demo experience
// Does NOT own: real Sheet integration, auth, DB — demo mode only

'use strict';

const COACH = {
  name: 'Coach Alex',
  specialty: 'Strength & Hypertrophy',
  initials: 'CA',
  clientCount: 3,
  activeClients: 3,
  avgAdherence: 87,
};

// ── CLIENTS ────────────────────────────────────────────────────────────
const CLIENTS = [
  {
    id: 'sarah',
    name: 'Sarah Chen',
    initials: 'SC',
    email: 'sarah@demo.fitos',
    status: 'Active',
    program: 'Hypertrophy Block',
    block: 'Hypertrophy W4/6',
    blockParsed: { name: 'Hypertrophy Block', week: 4, totalWeeks: 6, progressPct: 67 },
    startDate: '2026-04-07',
    goal: 'Body recomposition — lose fat while building glutes/hamstrings',
    compliance7d: 5,
    lastCheckin: '3 days ago',
    bodyweight: { current: 62.8, change: -2.1, unit: 'kg' },
    notes: '4 weeks in, logging consistently. Down 2.1 kg. Energy improving.'
  },
  {
    id: 'marcus',
    name: 'Marcus Reeves',
    initials: 'MR',
    email: 'marcus@demo.fitos',
    status: 'Flag',
    program: 'Powerlifting Peak',
    block: 'Peaking W2/3',
    blockParsed: { name: 'Peaking', week: 2, totalWeeks: 3, progressPct: 67 },
    startDate: '2026-02-03',
    goal: 'Compete at 93 kg class — squat/bench/deadlift total PR',
    compliance7d: 7,
    lastCheckin: '1 day ago',
    bodyweight: { current: 92.4, change: 0.3, unit: 'kg' },
    notes: '12 weeks in, powerlifting peak. Top-set PRs visible. Flag: fatigue spike this week.'
  },
  {
    id: 'jen',
    name: 'Jen Park',
    initials: 'JP',
    email: 'jen@demo.fitos',
    status: 'Onboarding',
    program: 'Foundation Strength',
    block: 'Onboarding W1/2',
    blockParsed: { name: 'Foundation Strength', week: 1, totalWeeks: 2, progressPct: 50 },
    startDate: '2026-05-05',
    goal: 'Learn to lift with good form. Build sustainable habits.',
    compliance7d: 2,
    lastCheckin: 'Yesterday',
    bodyweight: { current: 58.5, change: 0, unit: 'kg' },
    notes: 'New client, week 1. Just onboarded. Needs technique cues on squat.'
  }
];

// ── SARAH WORKOUTS (last 4 weeks, Mon/Wed/Fri) ──────────────────────────
const SARAH_WORKOUTS = [
  {
    date: '2026-05-09', label: 'Day A — Lower Hypertrophy',
    exercises: [
      { name: 'Barbell Squat',       sets: 4, reps: '8–10', load: '60 kg',  notes: 'RPE 7–8' },
      { name: 'Romanian Deadlift',   sets: 3, reps: '10–12', load: '50 kg', notes: 'Slow eccentric' },
      { name: 'Leg Press',           sets: 3, reps: '12–15', load: '100 kg', notes: '' },
      { name: 'Hip Thrust',          sets: 3, reps: '12',    load: '70 kg',  notes: 'Squeeze glutes at top' },
      { name: 'Leg Curl',            sets: 3, reps: '12–15', load: '35 kg',  notes: '' },
    ],
    completed: true,
  },
  {
    date: '2026-05-07', label: 'Day B — Upper Hypertrophy',
    exercises: [
      { name: 'Incline DB Press',    sets: 4, reps: '8–10', load: '20 kg',  notes: '' },
      { name: 'Chest-Supported Row', sets: 4, reps: '8–10', load: '25 kg',  notes: '' },
      { name: 'Overhead Press',      sets: 3, reps: '8–10', load: '30 kg',  notes: '' },
      { name: 'Pull-Up (Assisted)',  sets: 3, reps: '6–8',  load: 'BW–20 kg', notes: '' },
      { name: 'Lateral Raise',       sets: 3, reps: '15–20', load: '8 kg', notes: '' },
    ],
    completed: true,
  },
  {
    date: '2026-05-05', label: 'Day A — Lower Hypertrophy',
    exercises: [
      { name: 'Barbell Squat',       sets: 4, reps: '8–10', load: '57.5 kg', notes: '' },
      { name: 'Romanian Deadlift',   sets: 3, reps: '10–12', load: '47.5 kg', notes: '' },
      { name: 'Leg Press',           sets: 3, reps: '12–15', load: '97.5 kg', notes: '' },
      { name: 'Hip Thrust',          sets: 3, reps: '12',    load: '67.5 kg', notes: '' },
      { name: 'Leg Curl',            sets: 3, reps: '12–15', load: '32.5 kg', notes: '' },
    ],
    completed: true,
  },
  {
    date: '2026-05-02', label: 'Day B — Upper Hypertrophy',
    exercises: [
      { name: 'Incline DB Press',    sets: 4, reps: '8–10', load: '18 kg',  notes: '' },
      { name: 'Chest-Supported Row', sets: 4, reps: '8–10', load: '22 kg',  notes: '' },
      { name: 'Overhead Press',      sets: 3, reps: '8–10', load: '28 kg',  notes: '' },
      { name: 'Pull-Up (Assisted)',  sets: 3, reps: '6–8',  load: 'BW–22 kg', notes: '' },
      { name: 'Lateral Raise',       sets: 3, reps: '15–20', load: '7 kg',  notes: '' },
    ],
    completed: true,
  },
];

// ── SARAH CHECK-INS ──────────────────────────────────────────────────────
const SARAH_CHECKINS = [
  {
    date: '2026-05-08', week: 4,
    bodyweight: 62.8, sleep: 7.8, energy: 8, stress: 3,
    waist: 73.5, hips: 96.0, chest: 88.5, rightArm: 30.0,
    notes: 'Feeling really good this week. Squats felt smooth. Energy is up since dropping carbs earlier in the day.',
    photo: null,
  },
  {
    date: '2026-05-01', week: 3,
    bodyweight: 63.2, sleep: 7.2, energy: 7, stress: 4,
    waist: 74.0, hips: 96.5, chest: 88.8, rightArm: 29.8,
    notes: 'A bit tired mid-week. Sleep was shorter Thu/Fri. Still hit all my workouts.',
    photo: null,
  },
  {
    date: '2026-04-24', week: 2,
    bodyweight: 63.8, sleep: 7.5, energy: 7, stress: 4,
    waist: 74.5, hips: 97.0, chest: 89.0, rightArm: 29.5,
    notes: 'Getting used to the program. Upper body days feel hard but manageable.',
    photo: null,
  },
  {
    date: '2026-04-17', week: 1,
    bodyweight: 64.9, sleep: 8.0, energy: 6, stress: 5,
    waist: 75.5, hips: 97.8, chest: 89.5, rightArm: 29.2,
    notes: 'First check-in. Starting weight 64.9 kg. Looking forward to week 2.',
    photo: null,
  },
];

// ── SARAH MESSAGES ──────────────────────────────────────────────────────
const SARAH_MESSAGES = [
  { from: 'coach', time: '2026-05-09 14:22', text: 'Great squat session today Sarah 🙌 Weight moved well — bump to 62.5 kg next session.' },
  { from: 'client', time: '2026-05-09 15:04', text: 'Thank you! Felt strong. My hips felt a bit tight at the bottom — should I be stretching more?' },
  { from: 'coach', time: '2026-05-09 15:19', text: 'Yes — hip flexor stretches post-workout will help. Also try box squatting a set or two to practice depth without worrying about load.' },
  { from: 'client', time: '2026-05-07 18:30', text: 'Upper body done ✅ Pull-ups are getting easier!' },
  { from: 'coach', time: '2026-05-07 19:02', text: 'Excellent! Once you can get 3×8 unassisted, we drop the band. Probably another 2–3 weeks.' },
  { from: 'client', time: '2026-05-05 09:15', text: 'Do I do cardio on rest days or is that too much?' },
  { from: 'coach', time: '2026-05-05 09:41', text: '20–30 min easy walking is fine and actually helps recovery. Avoid anything high-intensity — save that energy for the lifts.' },
];

// ── SARAH RESULTS DATA (for charts) ────────────────────────────────────
function generateSarahResultsData() {
  const today = new Date('2026-05-11');
  // Bodyweight 90-day trend: 65.2 → 62.8
  const bw = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const base = 65.2 - (89 - i) * (2.4 / 89);
    const noise = Math.sin(i * 3.7) * 0.3 + Math.cos(i * 1.3) * 0.2;
    bw.push({ date: d.toISOString().split('T')[0], weight: Math.round((base + noise) * 10) / 10 });
  }
  // Weekly check-in bodyweights
  const checkinBW = SARAH_CHECKINS.map(c => ({ date: c.date, weight: c.bodyweight })).reverse();
  // Wellness last 30d
  const wellness = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    wellness.push({
      date: d.toISOString().split('T')[0],
      sleep: 7.2 + Math.sin(i * 2.1) * 0.6,
      energy: 6.5 + Math.sin(i * 1.4) * 1.2,
      stress: 3.5 + Math.cos(i * 1.8) * 1.0,
    });
  }
  // Lifts 12-week progression
  const squatPR = [];
  const hipThrustPR = [];
  for (let w = 11; w >= 0; w--) {
    const d = new Date(today);
    d.setDate(today.getDate() - w * 7);
    squatPR.push({ week: `W${12 - w}`, date: d.toISOString().split('T')[0], weight: 47.5 + (11 - w) * 1.1 });
    hipThrustPR.push({ week: `W${12 - w}`, date: d.toISOString().split('T')[0], weight: 50 + (11 - w) * 1.8 });
  }
  // Circumferences 12-week
  const circ = [];
  const circWeeks = SARAH_CHECKINS.map(c => ({
    date: c.date, waist: c.waist, hips: c.hips, chest: c.chest
  })).reverse();
  return { bw, checkinBW, wellness, lifts: { squatPR, hipThrustPR }, circumferences: circWeeks };
}

// ── MARCUS DATA (summary only) ──────────────────────────────────────────
const MARCUS_WORKOUTS = [
  {
    date: '2026-05-09', label: 'Squat + Accessory',
    exercises: [
      { name: 'Competition Squat',   sets: 3, reps: '3',   load: '185 kg', notes: 'Top set — RPE 9' },
      { name: 'Pause Squat',         sets: 2, reps: '2',   load: '150 kg', notes: '2s pause' },
      { name: 'Belt Squat',          sets: 3, reps: '8',   load: '120 kg', notes: '' },
      { name: 'GHR',                 sets: 3, reps: '10',  load: 'BW',    notes: '' },
    ],
    completed: true,
  },
  {
    date: '2026-05-08', label: 'Bench Press Day',
    exercises: [
      { name: 'Competition Bench',   sets: 3, reps: '3',   load: '130 kg', notes: 'Touch and go' },
      { name: 'Close-Grip Bench',    sets: 2, reps: '5',   load: '110 kg', notes: '' },
      { name: 'Dumbbell Row',        sets: 3, reps: '8',   load: '50 kg',  notes: '' },
      { name: 'Face Pulls',          sets: 3, reps: '20',  load: '20 kg',  notes: '' },
    ],
    completed: true,
  },
];

// ── MARCUS CHECK-INS ─────────────────────────────────────────────────────
const MARCUS_CHECKINS = [
  {
    date: '2026-05-10', week: 12,
    bodyweight: 92.4, sleep: 6.5, energy: 6, stress: 7,
    notes: 'Fatigued. Knees a bit achy. Still hit everything but felt heavy. Pre-meet nerves probably.',
    photo: null,
  },
  {
    date: '2026-05-03', week: 11,
    bodyweight: 92.1, sleep: 7.5, energy: 8, stress: 4,
    notes: 'Big week. Hit a 192.5 squat double. Feeling strong. Keeping weight close to 93.',
    photo: null,
  },
];

// ── JEN DATA (minimal — new client) ────────────────────────────────────
const JEN_WORKOUTS = [
  {
    date: '2026-05-09', label: 'Session 2 — Intro Lower',
    exercises: [
      { name: 'Goblet Squat',        sets: 3, reps: '10',  load: '12 kg', notes: 'Focus on depth' },
      { name: 'DB Romanian Deadlift', sets: 3, reps: '10', load: '15 kg', notes: '' },
      { name: 'Hip Thrust (BW)',      sets: 3, reps: '12', load: 'BW',   notes: '' },
      { name: 'Walking Lunges',       sets: 2, reps: '10/leg', load: 'BW', notes: '' },
    ],
    completed: true,
  },
];

const JEN_CHECKINS = [
  {
    date: '2026-05-10', week: 1,
    bodyweight: 58.5, sleep: 7.0, energy: 6, stress: 5,
    notes: 'A bit sore from first session but excited. Squat feels awkward but I\'m getting it.',
    photo: null,
  },
];

// ── AI SKILL OUTPUTS (pre-canned) ────────────────────────────────────────
const AI_OUTPUTS = {
  'checkin-summary': {
    skill: 'Weekly Check-In Summary',
    client: 'Sarah Chen',
    generatedAt: '2026-05-08 14:30',
    output: `**Week 4 Summary — Sarah Chen**

**Overall: On Track ✅**

Weight: 62.8 kg (−0.4 kg this week, −2.1 kg total). Trend is excellent for a recomp — lean in the right direction.

**Highlights:**
- Sleep improved to 7.8h avg vs 7.2h last week — likely from managing evening screen time
- Energy rating up to 8/10, highest since starting
- All 5 sessions completed with progressive loads

**Coaching Note:**
Squat form note from Sarah: hip tightness at depth. Recommend hip flexor protocol post-session (3×60s couch stretch). Box squat variation next Lower day to reinforce pattern.

**Next Week:** Progress squat load to 62.5 kg. Keep calories at current level — recomp is working.`
  },
  'deload-flag': {
    skill: 'Deload / Fatigue Flag',
    client: 'Marcus Reeves',
    generatedAt: '2026-05-10 09:15',
    output: `**⚠️ Fatigue Flag — Marcus Reeves**

**Recommendation: Deload or reduce intensity this week**

Fatigue indicators:
- Sleep dropped to 6.5h (−1h vs 4-week avg)
- Stress rating 7/10 — highest in 8 weeks
- Reported knee ache (first time in 12 weeks)
- Energy 6/10, down from 8/10 last check-in

**Context:** Week 2 of 3-week peaking block. This is expected accumulation fatigue, not a red flag — but competing into a comp squat attempt from here risks a poor performance.

**Recommendation:** Reduce top-set load 5–8% for 3–4 days. Maintain movement pattern. Meet prep continues on schedule. Pre-meet emotional stress is masking his real readiness — heart rate at working sets is the better signal right now.`
  },
  'form-cue': {
    skill: 'Exercise Form Cue',
    client: 'Sarah Chen',
    generatedAt: '2026-05-09 15:20',
    output: `**Form Cue — Barbell Squat (Sarah Chen)**

**Issue:** Hip tightness at depth, causing slight forward lean and butt wink at ~90°.

**Root cause:** Limited hip flexor mobility and anterior hip capsule restriction — common at 4 weeks into a hypertrophy block when lower body volume increases rapidly.

**Cues to use:**
1. *"Push knees out over pinky toes"* — activates external rotators, opens the hip socket
2. *"Tall chest all the way down"* — counteracts forward lean
3. *"Sit between your heels, not behind them"* — shifts load back without sacrificing depth

**Protocol:**
- 90/90 hip stretch: 2×60s per side before squatting
- Couch stretch: 3×60s per side post-session
- Box squat 1 warm-up set: establishes depth cue before load

**Expected timeline:** Noticeably better in 2–3 weeks of consistency.`
  }
};

// ── PROGRAM (for builder demo) ────────────────────────────────────────────
const DEMO_PROGRAM = {
  name: '4-Week Hypertrophy Block (Generated for Sarah)',
  generatedFor: 'Sarah Chen',
  weeks: [
    {
      week: 1, label: 'Accumulation — Lighter / Higher Volume',
      days: [
        {
          day: 1, label: 'Lower A',
          exercises: [
            { name: 'Barbell Back Squat', sets: 4, reps: '10–12', load: '~57.5 kg', rpe: '7' },
            { name: 'Romanian Deadlift', sets: 3, reps: '12', load: '~45 kg', rpe: '7' },
            { name: 'Hip Thrust', sets: 3, reps: '12–15', load: '~65 kg', rpe: '7' },
            { name: 'Leg Curl (Machine)', sets: 3, reps: '12–15', load: 'As able', rpe: '8' },
            { name: 'Walking Lunges', sets: 2, reps: '12/leg', load: 'BW', rpe: '6' },
          ]
        },
        {
          day: 2, label: 'Upper A',
          exercises: [
            { name: 'Incline DB Press', sets: 4, reps: '10–12', load: '~17.5 kg', rpe: '7' },
            { name: 'Chest-Supported Row', sets: 4, reps: '10–12', load: '~20 kg', rpe: '7' },
            { name: 'Overhead Press', sets: 3, reps: '10', load: '~27.5 kg', rpe: '7' },
            { name: 'Lat Pulldown', sets: 3, reps: '12', load: 'As able', rpe: '7' },
            { name: 'Lateral Raise', sets: 3, reps: '15–20', load: '~7 kg', rpe: '6' },
          ]
        },
        {
          day: 3, label: 'Lower B',
          exercises: [
            { name: 'Leg Press', sets: 4, reps: '12–15', load: '~90 kg', rpe: '7' },
            { name: 'Stiff-Leg Deadlift', sets: 3, reps: '10', load: '~45 kg', rpe: '7' },
            { name: 'Step-Up (DB)', sets: 3, reps: '10/leg', load: '~12 kg', rpe: '7' },
            { name: 'Leg Extension', sets: 3, reps: '15', load: 'As able', rpe: '7' },
            { name: 'Calf Raise', sets: 4, reps: '20', load: 'BW', rpe: '6' },
          ]
        },
      ]
    },
    {
      week: 2, label: 'Load Week — Increase by 2.5 kg per session',
      days: [
        {
          day: 1, label: 'Lower A +2.5 kg',
          exercises: [
            { name: 'Barbell Back Squat', sets: 4, reps: '10–12', load: '~60 kg', rpe: '7–8' },
            { name: 'Romanian Deadlift', sets: 3, reps: '12', load: '~47.5 kg', rpe: '7–8' },
            { name: 'Hip Thrust', sets: 3, reps: '12–15', load: '~67.5 kg', rpe: '7–8' },
            { name: 'Leg Curl', sets: 3, reps: '12–15', load: 'Add 2.5 kg', rpe: '8' },
            { name: 'Walking Lunges', sets: 3, reps: '12/leg', load: '5 kg DBs', rpe: '7' },
          ]
        },
      ]
    },
    { week: 3, label: 'Overreach — Push RPE to 8–9', days: [] },
    { week: 4, label: 'Deload — 50% volume, 85% load', days: [] },
  ]
};

module.exports = {
  COACH,
  CLIENTS,
  SARAH_WORKOUTS,
  SARAH_CHECKINS,
  SARAH_MESSAGES,
  MARCUS_WORKOUTS,
  MARCUS_CHECKINS,
  JEN_WORKOUTS,
  JEN_CHECKINS,
  AI_OUTPUTS,
  DEMO_PROGRAM,
  generateSarahResultsData,
};
