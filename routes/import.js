// routes/import.js
// Owns: /dashboard/import HTML page + /api/import/* endpoints
// Handles CSV imports from Trainerize and TrueCoach into the coach's FitOS Sheet.
// Does NOT own: Sheets auth, client/workout schema, auth middleware.

const express = require('express');
const path    = require('path');
const fs      = require('fs');

let multer = null;
try { multer = require('multer'); } catch (_) {}

const { parseCSV, rowsToObjects } = require('../lib/import/csv-parser');

let trainerizeMapper = null;
try { trainerizeMapper = require('../lib/import/trainerize'); } catch (_) {}

let truecoachMapper = null;
try { truecoachMapper = require('../lib/import/truecoach'); } catch (_) {}

let sheetsClients = null;
try { sheetsClients = require('../lib/sheets/clients'); } catch (_) {}

const { appendRows } = require('../lib/sheets/client');

const router = express.Router();

// ── Multer config: in-memory storage, 5 MB limit, CSV only ───────────────────

let upload = null;
if (multer) {
  const storage = multer.memoryStorage();
  upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter(req, file, cb) {
      const ok = /\.csv$/i.test(file.originalname) || file.mimetype === 'text/csv' || file.mimetype === 'text/plain';
      cb(ok ? null : new Error('Only CSV files are accepted'), ok);
    },
  });
}

// ── Auth guard ────────────────────────────────────────────────────────────────

function requireCoach(req, res, next) {
  if (!req.coach) return res.redirect('/trial');
  next();
}

// ── HTML page ─────────────────────────────────────────────────────────────────

router.get('/', requireCoach, (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'dashboard-import.html');
  if (!fs.existsSync(htmlPath)) return res.status(404).send('Import page not found');
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const coachName = (req.coach && req.coach.name) || 'Coach';
  let html = fs.readFileSync(htmlPath, 'utf8');
  const injection = `<script>window.__COACH_LIVE__ = ${JSON.stringify({ sheetsEnabled, coachName })};</script>`;
  html = html.replace('</head>', `${injection}\n</head>`);
  res.type('html').send(html);
});

// ── Helper: parse CSV from buffer ─────────────────────────────────────────────

function parseCsvBuffer(buffer) {
  const text = buffer.toString('utf8');
  return parseCSV(text);
}

// ── Helper: detect source + data type from rows ───────────────────────────────

function detectMapping(rows, source) {
  if (!rows || rows.length < 2) return { fileType: 'unknown', confidence: 0 };

  // Use source-specific detector if available
  if (source === 'trainerize' && trainerizeMapper) {
    return trainerizeMapper.detectFileType(rows);
  }
  if (source === 'truecoach' && truecoachMapper) {
    return truecoachMapper.detectFileType(rows);
  }

  // Generic: look for known headers
  const headers = rows[0].map(h => h.toLowerCase());
  const hasEmail   = headers.some(h => h.includes('email'));
  const hasExercise = headers.some(h => ['exercise', 'movement', 'lift'].some(k => h.includes(k)));
  const hasDate    = headers.some(h => h.includes('date'));

  if (hasExercise && hasDate) return { fileType: 'workouts', confidence: 0.6 };
  if (hasEmail) return { fileType: 'clients', confidence: 0.5 };
  return { fileType: 'unknown', confidence: 0 };
}

// ── POST /api/import/preview ──────────────────────────────────────────────────
// Accepts multipart CSV upload, returns detected mapping + first 5 rows.
// Body fields: source ('trainerize'|'truecoach'|'generic'), file (CSV).

router.post('/api/preview', requireCoach, (req, res, next) => {
  if (!upload) {
    return res.status(503).json({ ok: false, error: 'File upload module not available. Contact support.' });
  }
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No file uploaded. Attach a CSV with field name "file".' });
  }

  const source = (req.body && req.body.source) || 'generic';
  let rows;
  try {
    rows = parseCsvBuffer(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ ok: false, error: `CSV parse error: ${err.message}` });
  }

  if (rows.length < 2) {
    return res.status(400).json({ ok: false, error: 'CSV appears empty (no data rows).' });
  }

  const detection = detectMapping(rows, source);
  const { headers } = rowsToObjects(rows);
  const preview = rows.slice(1, 6); // first 5 data rows (raw arrays)

  return res.json({
    ok: true,
    source,
    fileType:   detection.fileType,
    confidence: detection.confidence,
    totalRows:  rows.length - 1, // exclude header
    headers,
    preview,   // array of arrays, first 5 data rows
  });
});

// ── POST /api/import/run ──────────────────────────────────────────────────────
// Runs the actual import. Accepts multipart CSV upload.
// Body fields: source ('trainerize'|'truecoach'|'generic'), fileType ('clients'|'workouts'), file.
// Returns: { ok, imported, skipped, errors }

router.post('/api/run', requireCoach, (req, res, next) => {
  if (!upload) {
    return res.status(503).json({ ok: false, error: 'File upload module not available.' });
  }
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No file uploaded.' });
  }

  if (!req.sheetId) {
    return res.status(400).json({ ok: false, error: 'No Google Sheet connected. Complete the setup wizard at /setup first.' });
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return res.status(500).json({ ok: false, error: 'Google Sheets not configured. Contact support.' });
  }

  const source   = (req.body && req.body.source)   || 'generic';
  const fileType = (req.body && req.body.fileType); // 'clients' | 'workouts' | undefined (auto-detect)

  let rows;
  try {
    rows = parseCsvBuffer(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ ok: false, error: `CSV parse error: ${err.message}` });
  }

  if (rows.length < 2) {
    return res.status(400).json({ ok: false, error: 'CSV appears empty.' });
  }

  // Determine actual file type
  const detectedType = fileType || detectMapping(rows, source).fileType;

  if (detectedType === 'clients') {
    return _importClients(req, res, rows, source);
  }
  if (detectedType === 'workouts') {
    return _importWorkouts(req, res, rows, source);
  }

  return res.status(400).json({
    ok: false,
    error: 'Could not detect file type. Pass fileType="clients" or fileType="workouts" to force.',
  });
});

// ── Import handlers ───────────────────────────────────────────────────────────

async function _importClients(req, res, rows, source) {
  let mapped;
  let skipped = 0;

  try {
    let result;
    if (source === 'trainerize' && trainerizeMapper) {
      result = trainerizeMapper.mapClients(rows);
    } else if (source === 'truecoach' && truecoachMapper) {
      result = truecoachMapper.mapClients(rows);
    } else {
      // Generic: best-effort from trainerize mapper (most flexible aliases)
      result = trainerizeMapper ? trainerizeMapper.mapClients(rows) : { mapped: [], skipped: rows.length - 1 };
    }
    mapped  = result.mapped;
    skipped = result.skipped;
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Mapping failed: ${err.message}` });
  }

  if (!mapped.length) {
    return res.json({ ok: true, imported: 0, skipped, message: 'No valid client rows found. Check that your CSV has Name and Email columns.' });
  }

  // Idempotency: load existing clients and skip duplicates by name (case-insensitive) + email
  let existing = [];
  if (sheetsClients) {
    try { existing = await sheetsClients.getClientList(req.sheetId); } catch (_) {}
  }
  const existingNames  = new Set(existing.map(c => c.name.toLowerCase()));
  const existingEmails = new Set(existing.map(c => c.email.toLowerCase()).filter(Boolean));

  const toAdd  = [];
  let duplicate = 0;

  for (const c of mapped) {
    const nameLower  = c.name.toLowerCase();
    const emailLower = (c.email || '').toLowerCase();
    if (existingNames.has(nameLower) || (emailLower && existingEmails.has(emailLower))) {
      duplicate++;
    } else {
      toAdd.push(c);
      existingNames.add(nameLower);
      if (emailLower) existingEmails.add(emailLower);
    }
  }

  if (!toAdd.length) {
    return res.json({ ok: true, imported: 0, skipped: skipped + duplicate, duplicates: duplicate, message: 'All clients already exist in your Sheet.' });
  }

  // Batch-write to Clients tab
  await sheetsClients.ensureClientsTab(req.sheetId);
  const now = new Date().toISOString().split('T')[0];
  const clientRows = toAdd.map(c => [
    c.name,
    c.email    || '',
    c.program  || '',
    c.startDate || now,
    'Active',
    c.notes    || '',
    now,
  ]);

  try {
    await appendRows(req.sheetId, 'Clients!A:G', clientRows);
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Sheets write failed: ${err.message}` });
  }

  // Log to Activity tab (non-fatal)
  appendRows(req.sheetId, 'Activity!A:F', [[
    new Date().toISOString(), 'coach_action', 'import_clients',
    `Imported ${toAdd.length} clients from ${source}`,
    '', JSON.stringify({ source, imported: toAdd.length, skipped, duplicate }),
  ]]).catch(() => {});

  return res.json({
    ok: true,
    imported:   toAdd.length,
    skipped,
    duplicates: duplicate,
    message:    `Imported ${toAdd.length} client${toAdd.length !== 1 ? 's' : ''} into your Sheet.${duplicate ? ` ${duplicate} duplicate${duplicate !== 1 ? 's' : ''} skipped.` : ''}`,
  });
}

async function _importWorkouts(req, res, rows, source) {
  let mapped;
  let skipped = 0;

  try {
    let result;
    if (source === 'trainerize' && trainerizeMapper) {
      result = trainerizeMapper.mapWorkouts(rows);
    } else if (source === 'truecoach' && truecoachMapper) {
      result = truecoachMapper.mapWorkouts(rows);
    } else {
      result = trainerizeMapper ? trainerizeMapper.mapWorkouts(rows) : { mapped: [], skipped: rows.length - 1 };
    }
    mapped  = result.mapped;
    skipped = result.skipped;
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Mapping failed: ${err.message}` });
  }

  if (!mapped.length) {
    return res.json({ ok: true, imported: 0, skipped, message: 'No valid workout rows found. Check that your CSV has Date, Exercise, Sets, and Reps columns.' });
  }

  // Build Workouts tab rows
  // Schema: Date | Week | Day | Exercise | Set# | Reps | Weight(kg) | RPE | Volume | Status | Notes
  const workoutRows = mapped.map(w => [
    w.date,
    '',                        // week (not available in import)
    '',                        // day name (not available)
    w.exercise,
    1,                         // set number (imported as single set per row)
    w.reps  || '',
    w.weight !== null ? w.weight : '',
    '',                        // RPE not typically in exports
    '',                        // volume
    w.status || 'Completed',
    w.notes  || '',
  ]);

  try {
    await appendRows(req.sheetId, 'Workouts!A:K', workoutRows);
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Sheets write failed: ${err.message}` });
  }

  // Log to Activity tab (non-fatal)
  appendRows(req.sheetId, 'Activity!A:F', [[
    new Date().toISOString(), 'coach_action', 'import_workouts',
    `Imported ${mapped.length} workout records from ${source}`,
    '', JSON.stringify({ source, imported: mapped.length, skipped }),
  ]]).catch(() => {});

  return res.json({
    ok: true,
    imported: mapped.length,
    skipped,
    message:  `Imported ${mapped.length} workout record${mapped.length !== 1 ? 's' : ''} into your Sheet.${skipped ? ` ${skipped} row${skipped !== 1 ? 's' : ''} skipped (missing date or exercise name).` : ''}`,
  });
}

module.exports = router;
