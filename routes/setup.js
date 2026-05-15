/**
 * routes/setup.js — Coach onboarding wizard routes
 *
 * Owns: /setup (wizard page), /api/setup/verify (Sheet connection + DB save),
 *       /api/setup/add-client (first client creation),
 *       /api/setup/provision-demo (one-shot demo sheet creation, admin-only).
 * Does NOT: manage sessions or handle payment.
 *
 * On verify success, sheet_id is persisted to the coaches row so all
 * subsequent API calls route to this coach's Sheet automatically.
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const { getTabValues } = require('../lib/sheets/client');
const { addClient } = require('../lib/sheets/clients');
const { saveSheetId } = require('../db/coaches');
const { provisionDemoSheet } = require('../lib/sheets/provision');

// GET /setup — serve the wizard HTML
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/setup.html'));
});

// GET /api/setup/verify?sheetId=X
// Tests that the service account can read the Profile tab of the given Sheet.
// Returns: { ok: true, sheetId, profileName } or { ok: false, error }
router.get('/verify', async (req, res) => {
  const { sheetId } = req.query;
  if (!sheetId) {
    return res.status(400).json({ ok: false, error: 'Missing sheetId parameter' });
  }

  // Must have Google Sheets configured
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    // In dev mode without credentials, return a success stub for testing
    if (process.env.NODE_ENV !== 'production') {
      return res.json({ ok: true, sheetId, profileName: 'Demo Coach (dev mode)', devMode: true });
    }
    return res.status(500).json({ ok: false, error: 'Google Sheets not configured on this server' });
  }

  try {
    // Try to read the Profile tab — this validates both the sheet ID and sharing
    const rows = await getTabValues(sheetId, 'Profile!A1:B10');
    // Extract coach name from Profile tab if present (typically A1/B1 pattern)
    let profileName = null;
    for (const row of rows) {
      const label = (row[0] || '').toString().toLowerCase().trim();
      if (label === 'coach name' || label === 'name') {
        profileName = row[1] || null;
        break;
      }
    }

    // Persist sheet_id to the coach's DB row so multi-tenant routing kicks in.
    // req.coach is attached by trialMiddleware (session-based coaches).
    // Fail silently if no coach session — sheet will still work via localStorage.
    if (req.coach && req.coach.id && process.env.DATABASE_URL) {
      try {
        await saveSheetId(req.coach.id, sheetId);
      } catch (dbErr) {
        // Non-fatal — coach can still use the app; sheet_id just won't be persisted
        console.error('[setup/verify] Failed to save sheet_id to DB:', dbErr.message);
      }
    }

    return res.json({ ok: true, sheetId, profileName });
  } catch (err) {
    // Surface a helpful error — the most common case is permission denied
    let error = 'Could not read the Sheet. Make sure you shared it with the service account.';
    if (err.message && err.message.includes('not found')) {
      error = 'Sheet not found. Double-check the Sheet ID.';
    } else if (err.message && err.message.includes('permission')) {
      error = 'Permission denied. Share the Sheet with the service account email (Editor).';
    }
    return res.status(400).json({ ok: false, error, detail: err.message });
  }
});

// POST /api/setup/add-client
// Body: { sheetId, name, email? }
// Writes a row to the Clients tab. Returns the client PWA URL.
router.post('/add-client', async (req, res) => {
  const { sheetId, name, email } = req.body || {};

  if (!sheetId) return res.status(400).json({ ok: false, error: 'Missing sheetId' });
  if (!name || !name.trim()) return res.status(400).json({ ok: false, error: 'Client name is required' });

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    if (process.env.NODE_ENV !== 'production') {
      // Dev mode stub — return fake PWA URL
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      return res.json({ ok: true, name: name.trim(), pwaUrl: `${baseUrl}/workouts` });
    }
    return res.status(500).json({ ok: false, error: 'Google Sheets not configured on this server' });
  }

  try {
    await addClient(sheetId, { name: name.trim(), email: email || '' });
    // The client PWA is the app itself — each client is identified by their Sheet row.
    // For now the URL is the base app URL (coaches share the app with their client).
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const pwaUrl = `${baseUrl}/workouts`;
    return res.json({ ok: true, name: name.trim(), pwaUrl });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Failed to add client to Sheet', detail: err.message });
  }
});

// GET /api/setup/service-account — returns the service account email
// Coaches need this to share their Sheet with FitOS.
router.get('/service-account', (req, res) => {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    // No credentials configured — tell the coach to contact support
    return res.json({ email: 'Not configured — contact support@polsia.com', devMode: true });
  }
  try {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    return res.json({ email: creds.client_email || 'Not configured — contact support@polsia.com' });
  } catch (_) {
    return res.status(500).json({ error: 'Could not parse service account credentials' });
  }
});

// GET /api/setup/template-info — returns the FitOS template Sheet URL for the connect wizard.
// FITOS_TEMPLATE_SHEET_ID env var enables one-click "Open Template" for coaches.
router.get('/template-info', (req, res) => {
  const templateSheetId = process.env.FITOS_TEMPLATE_SHEET_ID;
  if (templateSheetId) {
    return res.json({
      ok: true,
      templateUrl: `https://docs.google.com/spreadsheets/d/${templateSheetId}/copy`,
      templateName: 'FitOS Coaching Sheet Template',
    });
  }
  // No template configured — fall back to sheets.new (blank sheet)
  return res.json({ ok: false, templateUrl: null, templateName: null });
});

// POST /api/setup/provision-demo
// Creates a new Google Sheet with all tabs + demo data.
// Auth: requires ADMIN_KEY via ?key= param or Authorization header.
// Returns: { ok: true, spreadsheetId, sheetUrl, sheetId }
//
// After calling this, set GOOGLE_SHEET_ID env var on Render to the returned spreadsheetId.
router.post('/provision-demo', async (req, res) => {
  // Auth gate — same key as admin diagnostics
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey) {
    const provided = req.query.key || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (provided.trim() !== adminKey.trim()) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return res.status(400).json({
      ok: false,
      error: 'GOOGLE_SERVICE_ACCOUNT_KEY not set — cannot provision sheet without service account credentials',
      instructions: [
        '1. Create a Google Cloud project at https://console.cloud.google.com/',
        '2. Enable Google Sheets API + Google Drive API',
        '3. Create a Service Account → IAM & Admin → Service Accounts',
        '4. Generate a JSON key → Actions → Manage Keys → Add Key → JSON',
        '5. Set GOOGLE_SERVICE_ACCOUNT_KEY env var on Render to the full JSON content',
        '6. Then POST to this endpoint again',
      ],
    });
  }

  const title = (req.body && req.body.title) || 'FitOS Demo';

  try {
    const { spreadsheetId, sheetUrl, serviceAccountEmail } = await provisionDemoSheet(title);

    return res.json({
      ok: true,
      spreadsheetId,
      sheetUrl,
      sheetId: spreadsheetId,
      serviceAccountEmail,
      nextSteps: [
        `Set GOOGLE_SHEET_ID=${spreadsheetId} in your Render env vars`,
        'Redeploy the service',
        'Visit /admin/diagnostics to verify the connection',
      ],
    });
  } catch (err) {
    const isPerm = err.message && (err.message.includes('403') || err.message.includes('permission'));
    return res.status(500).json({
      ok: false,
      error: err.message,
      hint: isPerm
        ? 'Enable Google Sheets API and Google Drive API in your GCP project, then retry'
        : 'Check GOOGLE_SERVICE_ACCOUNT_KEY is valid JSON',
    });
  }
});

module.exports = router;
