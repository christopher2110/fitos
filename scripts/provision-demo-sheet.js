#!/usr/bin/env node
/**
 * scripts/provision-demo-sheet.js
 *
 * One-shot script: creates a fully-populated FitOS demo Google Sheet and
 * prints the Sheet ID to stdout so you can paste it into Render env vars.
 *
 * Usage:
 *   GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}' node scripts/provision-demo-sheet.js
 *
 * Or with a key file:
 *   GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/path/to/key.json node scripts/provision-demo-sheet.js
 *
 * The script creates:
 *   - Clients tab  — 3 demo clients (Sarah Chen, Marcus Reeves, Jen Park)
 *   - Workouts tab — recent workout sets for all 3 clients
 *   - CheckIns tab — weekly check-ins for all 3 clients
 *   - Messages tab — sample coach-client messages
 *   - Profile tab  — coach info + skill key storage
 *   - Program tab  — sample weekly program blocks
 *   - Exercises tab — exercise library
 *
 * After this script runs, set these env vars on your Render service:
 *   GOOGLE_SERVICE_ACCOUNT_KEY  — the same JSON key this script used
 *   GOOGLE_SHEET_ID             — the Sheet ID printed by this script
 */

'use strict';

const { google } = require('googleapis');
const fs = require('fs');

// ── Auth ──────────────────────────────────────────────────────────────────────

function getServiceAccountKey() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
    return JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE, 'utf8'));
  }
  // Try local dev fallback
  const localKey = './service-account-key.json';
  if (fs.existsSync(localKey)) {
    console.log('[auth] Using local service-account-key.json');
    return JSON.parse(fs.readFileSync(localKey, 'utf8'));
  }
  console.error(`
ERROR: No service account key found.

Set one of these env vars:
  GOOGLE_SERVICE_ACCOUNT_KEY    — full service account JSON string
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE — path to the JSON key file

Or place service-account-key.json in the project root.

How to get a service account key:
  1. https://console.cloud.google.com/iam-admin/serviceaccounts
  2. Create / select a service account
  3. Keys → Add Key → Create new key → JSON
  4. Enable the Google Sheets API and Google Drive API on the project
`);
  process.exit(1);
}

async function getAuth(credentials) {
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
}

// ── Sheet creation ────────────────────────────────────────────────────────────

async function createSheet(sheetsApi, title) {
  const res = await sheetsApi.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [{ properties: { title: 'Profile', index: 0 } }],
    },
    fields: 'spreadsheetId',
  });
  return res.data.spreadsheetId;
}

async function addTab(sheetsApi, spreadsheetId, title, index) {
  const res = await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title, index } } }],
    },
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}

async function writeValues(sheetsApi, spreadsheetId, range, values) {
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

// ── Share sheet ───────────────────────────────────────────────────────────────

async function sharePublicReadOnly(driveApi, fileId) {
  // Grant anyone-with-link viewer access so coaches can share with clients
  await driveApi.permissions.create({
    fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });
}

// ── Demo data ─────────────────────────────────────────────────────────────────

function buildProfileData() {
  return [
    ['Field', 'Value'],
    ['Coach Name', 'Coach Alex'],
    ['Specialty', 'Strength & Hypertrophy'],
    ['Client Count', '3'],
    ['Sheet Version', '1.0'],
    ['Created', new Date().toISOString().split('T')[0]],
    ['App URL', 'https://fitos-zc11.polsia.app'],
  ];
}

function buildClientsData() {
  return [
    ['Name', 'Email', 'Program', 'Start Date', 'Status', 'Notes', 'Added'],
    ['Sarah Chen',   'sarah@demo.fitos',  'Hypertrophy Block',   '2026-04-07', 'Active',      '4 weeks in, logging consistently. Down 2.1 kg. Energy improving.',       '2026-04-07'],
    ['Marcus Reeves','marcus@demo.fitos', 'Powerlifting Peak',   '2026-02-03', 'Flag',        '12 weeks in. Top-set PRs visible. Flag: fatigue spike this week.',         '2026-02-03'],
    ['Jen Park',     'jen@demo.fitos',    'Foundation Strength', '2026-05-05', 'Onboarding',  'New client, week 1. Just onboarded. Needs technique cues on squat.',       '2026-05-05'],
  ];
}

function buildWorkoutsData() {
  // Columns: Date | Client | Exercise | Sets | Reps | Load | RPE | Notes | Status
  const rows = [
    ['Date', 'Client', 'Exercise', 'Sets', 'Reps', 'Load', 'RPE', 'Notes', 'Session Label', 'Status'],
    // Sarah — Lower Hypertrophy (2026-05-09)
    ['2026-05-09', 'Sarah Chen', 'Barbell Squat',        4, '8-10',  '60 kg',     7.5, 'RPE 7-8', 'Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-09', 'Sarah Chen', 'Romanian Deadlift',    3, '10-12', '50 kg',     7,   'Slow eccentric', 'Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-09', 'Sarah Chen', 'Leg Press',            3, '12-15', '100 kg',    6.5, '', 'Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-09', 'Sarah Chen', 'Hip Thrust',           3, '12',    '70 kg',     8,   'Squeeze glutes at top', 'Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-09', 'Sarah Chen', 'Leg Curl',             3, '12-15', '35 kg',     7,   '', 'Day A — Lower Hypertrophy', 'Completed'],
    // Sarah — Upper Hypertrophy (2026-05-07)
    ['2026-05-07', 'Sarah Chen', 'Incline DB Press',     4, '8-10',  '20 kg',     7.5, '', 'Day B — Upper Hypertrophy', 'Completed'],
    ['2026-05-07', 'Sarah Chen', 'Chest-Supported Row',  4, '8-10',  '25 kg',     7.5, '', 'Day B — Upper Hypertrophy', 'Completed'],
    ['2026-05-07', 'Sarah Chen', 'Overhead Press',       3, '8-10',  '30 kg',     7,   '', 'Day B — Upper Hypertrophy', 'Completed'],
    ['2026-05-07', 'Sarah Chen', 'Pull-Up (Assisted)',   3, '6-8',   'BW-20 kg',  8,   '', 'Day B — Upper Hypertrophy', 'Completed'],
    ['2026-05-07', 'Sarah Chen', 'Lateral Raise',        3, '15-20', '8 kg',      7,   '', 'Day B — Upper Hypertrophy', 'Completed'],
    // Sarah — Lower (2026-05-05)
    ['2026-05-05', 'Sarah Chen', 'Barbell Squat',        4, '8-10',  '57.5 kg',   7,   '', 'Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-05', 'Sarah Chen', 'Romanian Deadlift',    3, '10-12', '47.5 kg',   7,   '', 'Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-05', 'Sarah Chen', 'Leg Press',            3, '12-15', '97.5 kg',   6,   '', 'Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-05', 'Sarah Chen', 'Hip Thrust',           3, '12',    '67.5 kg',   7.5, '', 'Day A — Lower Hypertrophy', 'Completed'],
    ['2026-05-05', 'Sarah Chen', 'Leg Curl',             3, '12-15', '32.5 kg',   7,   '', 'Day A — Lower Hypertrophy', 'Completed'],
    // Marcus — Squat + Accessory (2026-05-09)
    ['2026-05-09', 'Marcus Reeves', 'Back Squat',        5, '2',     '185 kg',    9,   'Top set', 'Squat + Accessory', 'Completed'],
    ['2026-05-09', 'Marcus Reeves', 'Pause Squat',       3, '3',     '155 kg',    8,   '', 'Squat + Accessory', 'Completed'],
    ['2026-05-09', 'Marcus Reeves', 'Leg Press',         4, '6',     '220 kg',    7,   '', 'Squat + Accessory', 'Completed'],
    ['2026-05-09', 'Marcus Reeves', 'Leg Extension',     3, '15',    '85 kg',     7,   '', 'Squat + Accessory', 'Completed'],
    // Marcus — Bench (2026-05-08)
    ['2026-05-08', 'Marcus Reeves', 'Competition Bench Press', 5, '2', '130 kg',  8.5, 'Top set', 'Bench Press Day', 'Completed'],
    ['2026-05-08', 'Marcus Reeves', 'Close-Grip Bench', 4, '4',     '110 kg',    7.5, '', 'Bench Press Day', 'Completed'],
    ['2026-05-08', 'Marcus Reeves', 'DB Row',            4, '8',     '45 kg',     7,   '', 'Bench Press Day', 'Completed'],
    ['2026-05-08', 'Marcus Reeves', 'Tricep Pushdown',   3, '12',    '50 kg',     7,   '', 'Bench Press Day', 'Completed'],
    // Jen — Intro Lower (2026-05-09)
    ['2026-05-09', 'Jen Park', 'Goblet Squat',           3, '12',    '16 kg',     6,   'Focus on depth', 'Session 2 — Intro Lower', 'Completed'],
    ['2026-05-09', 'Jen Park', 'Hip Hinge (KB)',         3, '12',    '12 kg',     5,   '', 'Session 2 — Intro Lower', 'Completed'],
    ['2026-05-09', 'Jen Park', 'Leg Press',              3, '12',    '40 kg',     6,   '', 'Session 2 — Intro Lower', 'Completed'],
    // Jen — Intro Upper (2026-05-07)
    ['2026-05-07', 'Jen Park', 'DB Bench Press',         3, '10',    '8 kg',      5,   'First time, form cues', 'Session 1 — Intro Upper', 'Completed'],
    ['2026-05-07', 'Jen Park', 'Seated Row (Cable)',     3, '12',    '30 kg',     5,   '', 'Session 1 — Intro Upper', 'Completed'],
    ['2026-05-07', 'Jen Park', 'Shoulder Press (DB)',    3, '10',    '6 kg',      5,   '', 'Session 1 — Intro Upper', 'Completed'],
  ];
  return rows;
}

function buildCheckInsData() {
  return [
    ['Date', 'Client', 'Bodyweight (kg)', 'Energy (1-10)', 'Sleep (hrs)', 'Stress (1-10)', 'Soreness (1-10)', 'Mood', 'Notes'],
    // Sarah
    ['2026-05-08', 'Sarah Chen',    62.8, 8, 7.5, 3, 4, 'Great', 'Feeling strong. Pull-ups getting easier.'],
    ['2026-05-01', 'Sarah Chen',    63.2, 7, 7,   4, 5, 'Good',  'Energy dipped mid-week but picked up. No joint issues.'],
    ['2026-04-24', 'Sarah Chen',    63.9, 6, 6.5, 5, 6, 'Okay',  'Tired but consistent. Hip tightness after squats — added stretching.'],
    ['2026-04-17', 'Sarah Chen',    64.5, 7, 7,   4, 5, 'Good',  'Down 0.4 kg this week. Progress photos look better.'],
    ['2026-04-10', 'Sarah Chen',    64.9, 6, 6,   5, 7, 'Okay',  'First full week logged. Glute soreness from hip thrusts!'],
    // Marcus
    ['2026-05-10', 'Marcus Reeves', 92.4, 6, 7.5, 5, 7, 'Tired', 'Fatigue hitting hard this week. Top sets still went up but RPE felt very high.'],
    ['2026-05-03', 'Marcus Reeves', 92.1, 8, 8,   4, 5, 'Good',  'Great week. Squat felt locked in. Meet prep going well.'],
    ['2026-04-26', 'Marcus Reeves', 91.8, 8, 8,   3, 4, 'Great', 'Best training week in months. Peaking is working.'],
    ['2026-04-19', 'Marcus Reeves', 91.5, 7, 7.5, 4, 5, 'Good',  'Weight coming up. Feeling confident about the meet.'],
    // Jen
    ['2026-05-10', 'Jen Park',      58.5, 7, 8,   4, 5, 'Good',  'Some soreness from squats but excited! Technique feeling better.'],
  ];
}

function buildMessagesData() {
  return [
    ['Timestamp', 'Client', 'From', 'Message', 'Read'],
    ['2026-05-09 15:04', 'Sarah Chen', 'client', 'Hey! Quick question about hip flexibility — my hips feel tight after squats. Should I be stretching more?', 'TRUE'],
    ['2026-05-09 15:30', 'Sarah Chen', 'coach',  'Yes! Add 2 min of hip flexor stretch and pigeon pose after every session. This is super common with squatting frequency.', 'TRUE'],
    ['2026-05-09 15:45', 'Sarah Chen', 'client', 'Perfect, thanks! Also — pull-ups are actually getting easier this week 🎉', 'TRUE'],
    ['2026-05-09 16:00', 'Sarah Chen', 'coach',  'Love to hear it! That upper body accessory work is paying off. Keep going 💪', 'TRUE'],
    ['2026-05-07 18:30', 'Sarah Chen', 'client', 'Finished the upper hypertrophy session. Pull-ups felt different today — actually controlled the negative!', 'TRUE'],
    ['2026-05-05 09:15', 'Sarah Chen', 'client', 'Quick question — should I do cardio on rest days or will it hurt recovery?', 'TRUE'],
    ['2026-05-05 10:00', 'Sarah Chen', 'coach',  'Light cardio (20-30 min walk, bike) is fine and actually helps recovery. Avoid HIIT on rest days.', 'TRUE'],
    ['2026-05-10 07:30', 'Marcus Reeves', 'client', 'Fatigue is real this week. Still hit my numbers but RPE was way higher than usual.', 'TRUE'],
    ['2026-05-10 08:00', 'Marcus Reeves', 'coach',  'This is normal in the peak — the accumulated fatigue is what drives super-compensation. Trust the process. One more week.', 'TRUE'],
    ['2026-05-10 08:15', 'Jen Park', 'client', 'Session 2 done! My legs are really sore but in a good way I think?', 'TRUE'],
    ['2026-05-10 08:30', 'Jen Park', 'coach',  'That soreness is normal for week 1 — your body is adapting. It gets better after 2-3 weeks!', 'TRUE'],
  ];
}

function buildProgramData() {
  return [
    ['Week', 'Phase', 'Day', 'Exercise', 'Sets', 'Reps', 'Load', 'Notes'],
    // Sarah — Hypertrophy W4
    [4, 'Hypertrophy Block', 'Lower A', 'Barbell Squat',      4, '8-10', '60 kg',  'Primary compound — progress load weekly'],
    [4, 'Hypertrophy Block', 'Lower A', 'Romanian Deadlift',  3, '10-12', '50 kg', 'Hinge focus — slow eccentric'],
    [4, 'Hypertrophy Block', 'Lower A', 'Leg Press',          3, '12-15', '100 kg', ''],
    [4, 'Hypertrophy Block', 'Lower A', 'Hip Thrust',         3, '12', '70 kg', 'Drive hips at top'],
    [4, 'Hypertrophy Block', 'Lower A', 'Leg Curl',           3, '12-15', '35 kg', ''],
    [4, 'Hypertrophy Block', 'Upper B', 'Incline DB Press',   4, '8-10', '20 kg',  ''],
    [4, 'Hypertrophy Block', 'Upper B', 'Chest-Supported Row', 4, '8-10', '25 kg', ''],
    [4, 'Hypertrophy Block', 'Upper B', 'Overhead Press',     3, '8-10', '30 kg',  ''],
    [4, 'Hypertrophy Block', 'Upper B', 'Pull-Up (Assisted)', 3, '6-8', 'BW-20 kg', 'Eccentric focus'],
    [4, 'Hypertrophy Block', 'Upper B', 'Lateral Raise',      3, '15-20', '8 kg',  ''],
  ];
}

function buildExercisesData() {
  return [
    ['Name', 'Category', 'Primary Muscle', 'Equipment', 'Notes', 'Video URL', 'Added'],
    ['Barbell Squat',         'Compound', 'Quads/Glutes',     'Barbell',    'King of lower body', '', '2026-04-07'],
    ['Romanian Deadlift',     'Compound', 'Hamstrings/Glutes','Barbell',    'Hinge pattern, slow eccentric', '', '2026-04-07'],
    ['Hip Thrust',            'Isolation','Glutes',           'Barbell',    'Drive hips fully at top', '', '2026-04-07'],
    ['Incline DB Press',      'Compound', 'Upper Chest',      'Dumbbells',  'Upper chest focus', '', '2026-04-07'],
    ['Pull-Up',               'Compound', 'Lats',             'Bodyweight', 'Add weight when 3x8 easy', '', '2026-04-07'],
    ['Overhead Press',        'Compound', 'Shoulders',        'Barbell',    'Strict press', '', '2026-04-07'],
    ['Competition Bench Press','Compound','Chest',            'Barbell',    'Powerlifting technique', '', '2026-02-03'],
    ['Back Squat',            'Compound', 'Quads/Glutes',     'Barbell',    'Competition squat', '', '2026-02-03'],
    ['Conventional Deadlift', 'Compound', 'Posterior Chain',  'Barbell',    'Competition pull', '', '2026-02-03'],
    ['Goblet Squat',          'Compound', 'Quads/Glutes',     'Kettlebell', 'Beginner squat pattern', '', '2026-05-05'],
  ];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🏋️  FitOS Demo Sheet Provisioner\n');

  const credentials = getServiceAccountKey();
  const serviceAccountEmail = credentials.client_email;
  console.log(`[auth] Service account: ${serviceAccountEmail}`);

  const auth = await getAuth(credentials);
  const sheetsApi = google.sheets({ version: 'v4', auth });
  const driveApi  = google.drive({ version: 'v3', auth });

  // 1. Create spreadsheet
  console.log('\n[create] Creating spreadsheet "FitOS Demo"...');
  const spreadsheetId = await createSheet(sheetsApi, 'FitOS Demo');
  console.log(`[create] Spreadsheet ID: ${spreadsheetId}`);
  console.log(`[create] URL: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);

  // 2. Add all tabs (Profile already created as first tab)
  console.log('\n[tabs] Adding tabs...');
  const tabs = ['Clients', 'Workouts', 'CheckIns', 'Messages', 'Program', 'Exercises', 'Activity', 'AgentRuns'];
  for (let i = 0; i < tabs.length; i++) {
    await addTab(sheetsApi, spreadsheetId, tabs[i], i + 1);
    process.stdout.write(`  + ${tabs[i]}\n`);
  }

  // 3. Write data to each tab
  console.log('\n[data] Writing demo data...');

  const sections = [
    { tab: 'Profile',   data: buildProfileData(),   rows: 7 },
    { tab: 'Clients',   data: buildClientsData(),    rows: 4 },
    { tab: 'Workouts',  data: buildWorkoutsData(),   rows: 30 },
    { tab: 'CheckIns',  data: buildCheckInsData(),   rows: 11 },
    { tab: 'Messages',  data: buildMessagesData(),   rows: 12 },
    { tab: 'Program',   data: buildProgramData(),    rows: 11 },
    { tab: 'Exercises', data: buildExercisesData(),  rows: 11 },
  ];

  // Activity tab — write a header at minimum
  await writeValues(sheetsApi, spreadsheetId, 'Activity!A1:H1', [
    ['Date', 'Client', 'Type', 'Exercise', 'Sets', 'Reps', 'Load', 'Notes'],
  ]);

  // AgentRuns tab — write a header
  await writeValues(sheetsApi, spreadsheetId, 'AgentRuns!A1:H1', [
    ['Timestamp', 'Client', 'Skill', 'Status', 'Input', 'Output', 'Tokens', 'Duration (ms)'],
  ]);

  for (const { tab, data } of sections) {
    const range = `${tab}!A1`;
    try {
      await writeValues(sheetsApi, spreadsheetId, range, data);
      console.log(`  ✓ ${tab} — ${data.length - 1} rows`);
    } catch (err) {
      console.error(`  ✗ ${tab} — ${err.message}`);
    }
  }

  // 4. Share sheet (anyone with link can view)
  console.log('\n[share] Setting anyone-with-link viewer access...');
  try {
    await sharePublicReadOnly(driveApi, spreadsheetId);
    console.log('[share] Done — coaches can share the link with clients');
  } catch (err) {
    // Non-fatal — sheet still usable, just not publicly viewable
    console.warn(`[share] Warning: ${err.message}`);
  }

  // 5. Done
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Demo sheet created successfully!

Sheet ID:  ${spreadsheetId}
Sheet URL: https://docs.google.com/spreadsheets/d/${spreadsheetId}

Next steps — set these env vars on your Render service:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  GOOGLE_SERVICE_ACCOUNT_KEY  =  <the same JSON key you used to run this script>
  GOOGLE_SHEET_ID             =  ${spreadsheetId}

After setting env vars, redeploy the service and check:
  https://fitos-zc11.polsia.app/admin/diagnostics?key=fitos-diag-2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  // Machine-readable output for automation
  console.log(`SHEET_ID=${spreadsheetId}`);
}

main().catch(err => {
  console.error('\n[FATAL]', err.message);
  if (err.message.includes('permission') || err.message.includes('403')) {
    console.error(`
The service account doesn't have Drive/Sheets access.
Make sure these APIs are enabled on your GCP project:
  - Google Sheets API
  - Google Drive API
    `);
  }
  process.exit(1);
});
