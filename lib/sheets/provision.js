// lib/sheets/provision.js
// Owns: One-shot demo Sheet provisioning — creates tabs and seeds demo data.
// Does NOT own: ongoing data reads/writes (those are in clients.js, dashboard.js, etc.)
//
// Called from:
//   - POST /api/setup/provision-demo (admin endpoint, auth-gated)
//   - server startup auto-provision when GOOGLE_SERVICE_ACCOUNT_KEY set but no GOOGLE_SHEET_ID

'use strict';

const { google } = require('googleapis');
const { getAuth } = require('./client');

// ── Tab definitions ───────────────────────────────────────────────────────────

const TABS = ['Profile', 'Clients', 'Workouts', 'CheckIns', 'Messages', 'Program', 'Exercises', 'Activity', 'AgentRuns'];

// ── Demo data builders ────────────────────────────────────────────────────────

function profileRows() {
  return [
    ['Field', 'Value'],
    ['Coach Name', 'Coach Alex'],
    ['Specialty', 'Strength & Hypertrophy'],
    ['Client Count', '3'],
    ['Sheet Version', '1.0'],
    ['Created', new Date().toISOString().split('T')[0]],
    ['App URL', process.env.APP_URL || 'https://fitos-zc11.polsia.app'],
  ];
}

function clientRows() {
  return [
    ['Name', 'Email', 'Program', 'Start Date', 'Status', 'Notes', 'Added'],
    ['Sarah Chen',    'sarah@demo.fitos',  'Hypertrophy Block',   '2026-04-07', 'Active',     '4 weeks in, logging consistently. Down 2.1 kg. Energy improving.',        '2026-04-07'],
    ['Marcus Reeves', 'marcus@demo.fitos', 'Powerlifting Peak',   '2026-02-03', 'Flag',       '12 weeks in. Top-set PRs visible. Flag: fatigue spike this week.',          '2026-02-03'],
    ['Jen Park',      'jen@demo.fitos',    'Foundation Strength', '2026-05-05', 'Onboarding', 'New client, week 1. Just onboarded. Needs technique cues on squat.',        '2026-05-05'],
  ];
}

function workoutRows() {
  return [
    ['Date', 'Client', 'Exercise', 'Sets', 'Reps', 'Load', 'RPE', 'Notes', 'Session Label', 'Status'],
    ['2026-05-09', 'Sarah Chen',    'Barbell Squat',           4, '8-10',  '60 kg',    7.5, 'RPE 7-8',             'Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-09', 'Sarah Chen',    'Romanian Deadlift',       3, '10-12', '50 kg',    7,   'Slow eccentric',       'Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-09', 'Sarah Chen',    'Leg Press',               3, '12-15', '100 kg',   6.5, '',                     'Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-09', 'Sarah Chen',    'Hip Thrust',              3, '12',    '70 kg',    8,   'Squeeze glutes at top','Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-09', 'Sarah Chen',    'Leg Curl',                3, '12-15', '35 kg',    7,   '',                     'Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-07', 'Sarah Chen',    'Incline DB Press',        4, '8-10',  '20 kg',    7.5, '',                     'Day B — Upper Hypertrophy', 'Completed'],
    ['2026-05-07', 'Sarah Chen',    'Chest-Supported Row',     4, '8-10',  '25 kg',    7.5, '',                     'Day B — Upper Hypertrophy', 'Completed'],
    ['2026-05-07', 'Sarah Chen',    'Overhead Press',          3, '8-10',  '30 kg',    7,   '',                     'Day B — Upper Hypertrophy', 'Completed'],
    ['2026-05-07', 'Sarah Chen',    'Pull-Up (Assisted)',      3, '6-8',   'BW-20 kg', 8,   '',                     'Day B — Upper Hypertrophy', 'Completed'],
    ['2026-05-07', 'Sarah Chen',    'Lateral Raise',           3, '15-20', '8 kg',     7,   '',                     'Day B — Upper Hypertrophy', 'Completed'],
    ['2026-05-05', 'Sarah Chen',    'Barbell Squat',           4, '8-10',  '57.5 kg',  7,   '',                     'Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-05', 'Sarah Chen',    'Romanian Deadlift',       3, '10-12', '47.5 kg',  7,   '',                     'Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-09', 'Marcus Reeves', 'Back Squat',              5, '2',     '185 kg',   9,   'Top set',              'Squat + Accessory',         'Completed'],
    ['2026-05-09', 'Marcus Reeves', 'Pause Squat',             3, '3',     '155 kg',   8,   '',                     'Squat + Accessory',         'Completed'],
    ['2026-05-09', 'Marcus Reeves', 'Leg Press',               4, '6',     '220 kg',   7,   '',                     'Squat + Accessory',         'Completed'],
    ['2026-05-08', 'Marcus Reeves', 'Competition Bench Press', 5, '2',     '130 kg',   8.5, 'Top set',              'Bench Press Day',           'Completed'],
    ['2026-05-08', 'Marcus Reeves', 'Close-Grip Bench',        4, '4',     '110 kg',   7.5, '',                     'Bench Press Day',           'Completed'],
    ['2026-05-08', 'Marcus Reeves', 'DB Row',                  4, '8',     '45 kg',    7,   '',                     'Bench Press Day',           'Completed'],
    ['2026-05-09', 'Jen Park',      'Goblet Squat',            3, '12',    '16 kg',    6,   'Focus on depth',       'Session 2 — Intro Lower',   'Completed'],
    ['2026-05-09', 'Jen Park',      'Hip Hinge (KB)',          3, '12',    '12 kg',    5,   '',                     'Session 2 — Intro Lower',   'Completed'],
    ['2026-05-09', 'Jen Park',      'Leg Press',               3, '12',    '40 kg',    6,   '',                     'Session 2 — Intro Lower',   'Completed'],
    ['2026-05-07', 'Jen Park',      'DB Bench Press',          3, '10',    '8 kg',     5,   'Form cues',            'Session 1 — Intro Upper',   'Completed'],
    ['2026-05-07', 'Jen Park',      'Seated Row (Cable)',      3, '12',    '30 kg',    5,   '',                     'Session 1 — Intro Upper',   'Completed'],
  ];
}

function checkinRows() {
  return [
    ['Date', 'Client', 'Bodyweight (kg)', 'Energy (1-10)', 'Sleep (hrs)', 'Stress (1-10)', 'Soreness (1-10)', 'Mood', 'Notes'],
    ['2026-05-08', 'Sarah Chen',    62.8, 8, 7.5, 3, 4, 'Great', 'Feeling strong. Pull-ups getting easier.'],
    ['2026-05-01', 'Sarah Chen',    63.2, 7, 7,   4, 5, 'Good',  'Energy dipped mid-week but picked up.'],
    ['2026-04-24', 'Sarah Chen',    63.9, 6, 6.5, 5, 6, 'Okay',  'Tired but consistent. Hip tightness after squats.'],
    ['2026-04-17', 'Sarah Chen',    64.5, 7, 7,   4, 5, 'Good',  'Down 0.4 kg this week. Progress photos look better.'],
    ['2026-04-10', 'Sarah Chen',    64.9, 6, 6,   5, 7, 'Okay',  'First full week logged. Glute soreness from hip thrusts!'],
    ['2026-05-10', 'Marcus Reeves', 92.4, 6, 7.5, 5, 7, 'Tired', 'Fatigue hitting hard. Top sets still hit but RPE high.'],
    ['2026-05-03', 'Marcus Reeves', 92.1, 8, 8,   4, 5, 'Good',  'Great week. Squat locked in. Meet prep going well.'],
    ['2026-04-26', 'Marcus Reeves', 91.8, 8, 8,   3, 4, 'Great', 'Best training week in months. Peaking is working.'],
    ['2026-04-19', 'Marcus Reeves', 91.5, 7, 7.5, 4, 5, 'Good',  'Weight up. Feeling confident about the meet.'],
    ['2026-05-10', 'Jen Park',      58.5, 7, 8,   4, 5, 'Good',  'Some soreness from squats but excited! Technique better.'],
  ];
}

function messageRows() {
  return [
    ['Timestamp', 'Client', 'From', 'Message', 'Read'],
    ['2026-05-09 15:04', 'Sarah Chen',    'client', 'Hey! Quick question — my hips feel tight after squats. Should I stretch more?',                                                    'TRUE'],
    ['2026-05-09 15:30', 'Sarah Chen',    'coach',  'Yes! Add 2 min hip flexor stretch + pigeon pose after every session. Very common with squatting frequency.',                         'TRUE'],
    ['2026-05-09 15:45', 'Sarah Chen',    'client', 'Perfect, thanks! Also — pull-ups are getting easier this week 🎉',                                                                  'TRUE'],
    ['2026-05-09 16:00', 'Sarah Chen',    'coach',  'Love to hear it! That upper body accessory work is paying off. Keep going 💪',                                                       'TRUE'],
    ['2026-05-07 18:30', 'Sarah Chen',    'client', 'Finished upper hypertrophy. Pull-ups felt different — actually controlled the negative!',                                            'TRUE'],
    ['2026-05-05 09:15', 'Sarah Chen',    'client', 'Should I do cardio on rest days or will it hurt recovery?',                                                                          'TRUE'],
    ['2026-05-05 10:00', 'Sarah Chen',    'coach',  'Light cardio (20-30 min walk/bike) is fine and helps recovery. Avoid HIIT on rest days.',                                           'TRUE'],
    ['2026-05-10 07:30', 'Marcus Reeves', 'client', 'Fatigue is real this week. Still hit my numbers but RPE was way higher than usual.',                                                 'TRUE'],
    ['2026-05-10 08:00', 'Marcus Reeves', 'coach',  'This is normal in the peak — accumulated fatigue drives super-compensation. Trust the process. One more week.',                     'TRUE'],
    ['2026-05-10 08:15', 'Jen Park',      'client', 'Session 2 done! My legs are really sore but in a good way I think?',                                                                'TRUE'],
    ['2026-05-10 08:30', 'Jen Park',      'coach',  'That soreness is normal for week 1 — your body is adapting. Gets better after 2-3 weeks!',                                         'TRUE'],
  ];
}

function programRows() {
  return [
    ['Week', 'Phase', 'Day', 'Exercise', 'Sets', 'Reps', 'Load', 'Notes'],
    [4, 'Hypertrophy Block', 'Lower A', 'Barbell Squat',       4, '8-10',  '60 kg',    'Primary compound — progress load weekly'],
    [4, 'Hypertrophy Block', 'Lower A', 'Romanian Deadlift',   3, '10-12', '50 kg',    'Hinge focus — slow eccentric'],
    [4, 'Hypertrophy Block', 'Lower A', 'Leg Press',           3, '12-15', '100 kg',   ''],
    [4, 'Hypertrophy Block', 'Lower A', 'Hip Thrust',          3, '12',    '70 kg',    'Drive hips at top'],
    [4, 'Hypertrophy Block', 'Upper B', 'Incline DB Press',    4, '8-10',  '20 kg',    ''],
    [4, 'Hypertrophy Block', 'Upper B', 'Chest-Supported Row', 4, '8-10',  '25 kg',    ''],
    [4, 'Hypertrophy Block', 'Upper B', 'Pull-Up (Assisted)',  3, '6-8',   'BW-20 kg', 'Eccentric focus'],
    [4, 'Hypertrophy Block', 'Upper B', 'Overhead Press',      3, '8-10',  '30 kg',    ''],
  ];
}

function exerciseRows() {
  return [
    ['Name', 'Category', 'Primary Muscle', 'Equipment', 'Notes', 'Video URL', 'Added'],
    ['Barbell Squat',          'Compound', 'Quads/Glutes',      'Barbell',    'King of lower body',         '', '2026-04-07'],
    ['Romanian Deadlift',      'Compound', 'Hamstrings/Glutes', 'Barbell',    'Hinge — slow eccentric',     '', '2026-04-07'],
    ['Hip Thrust',             'Isolation','Glutes',            'Barbell',    'Drive hips fully at top',    '', '2026-04-07'],
    ['Incline DB Press',       'Compound', 'Upper Chest',       'Dumbbells',  'Upper chest emphasis',        '', '2026-04-07'],
    ['Pull-Up',                'Compound', 'Lats',              'Bodyweight', 'Add weight when 3x8 easy',   '', '2026-04-07'],
    ['Overhead Press',         'Compound', 'Shoulders',         'Barbell',    'Strict press',               '', '2026-04-07'],
    ['Competition Bench Press','Compound', 'Chest',             'Barbell',    'Powerlifting technique',     '', '2026-02-03'],
    ['Back Squat',             'Compound', 'Quads/Glutes',      'Barbell',    'Competition squat',          '', '2026-02-03'],
    ['Goblet Squat',           'Compound', 'Quads/Glutes',      'Kettlebell', 'Beginner squat pattern',     '', '2026-05-05'],
  ];
}

// ── Core provisioner ──────────────────────────────────────────────────────────

/**
 * Create a new Google Sheet with all FitOS tabs and seed with demo data.
 * Returns { spreadsheetId, sheetUrl, serviceAccountEmail }.
 *
 * Requires GOOGLE_SERVICE_ACCOUNT_KEY to be set (via getAuth() from client.js).
 */
async function provisionDemoSheet(title = 'FitOS Demo') {
  const auth     = getAuth();
  const sheets   = google.sheets({ version: 'v4', auth });
  const drive    = google.drive({ version: 'v3', auth });

  // 1. Parse service account email for logging
  let serviceAccountEmail = 'unknown';
  try {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    serviceAccountEmail = creds.client_email || 'unknown';
  } catch (_) {}

  // 2. Create spreadsheet with first tab already named Profile
  const createRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [{ properties: { title: 'Profile', index: 0 } }],
    },
    fields: 'spreadsheetId',
  });
  const spreadsheetId = createRes.data.spreadsheetId;

  // 3. Add remaining tabs in order
  const tabsToAdd = ['Clients', 'Workouts', 'CheckIns', 'Messages', 'Program', 'Exercises', 'Activity', 'AgentRuns'];
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: tabsToAdd.map((title, i) => ({
        addSheet: { properties: { title, index: i + 1 } },
      })),
    },
  });

  // 4. Write data to all tabs
  const writes = [
    { range: 'Profile!A1',   values: profileRows() },
    { range: 'Clients!A1',   values: clientRows() },
    { range: 'Workouts!A1',  values: workoutRows() },
    { range: 'CheckIns!A1',  values: checkinRows() },
    { range: 'Messages!A1',  values: messageRows() },
    { range: 'Program!A1',   values: programRows() },
    { range: 'Exercises!A1', values: exerciseRows() },
    { range: 'Activity!A1',  values: [['Date', 'Client', 'Type', 'Exercise', 'Sets', 'Reps', 'Load', 'Notes']] },
    { range: 'AgentRuns!A1', values: [['Timestamp', 'Client', 'Skill', 'Status', 'Input', 'Output', 'Tokens', 'Duration (ms)']] },
  ];

  for (const { range, values } of writes) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  // 5. Share as public viewer so coaches can share the link
  try {
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: { role: 'reader', type: 'anyone' },
    });
  } catch (_) {
    // Non-fatal — app still works, sheet just won't be publicly viewable
  }

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  return { spreadsheetId, sheetUrl, serviceAccountEmail };
}

module.exports = { provisionDemoSheet, TABS };
