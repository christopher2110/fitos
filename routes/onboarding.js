/**
 * routes/onboarding.js — New-coach onboarding wizard routes
 *
 * Owns: /onboarding/sheet (wizard page), /api/onboarding/provision-sheet (path A),
 *       /api/onboarding/validate-byok-sheet (path B), /api/onboarding/verify-tabs,
 *       /api/onboarding/add-first-client.
 * Does NOT own: auth/sessions, Stripe payment, legacy /setup flow.
 *
 * Path A: Polsia-managed service account copies the template Sheet into Drive,
 *         pre-populates with coach name + demo client, persists sheet_id to DB.
 * Path B: Coach pastes their own service-account JSON + Sheet ID; we validate
 *         access, store encrypted JSON, persist sheet_id to DB.
 */
const express  = require('express');
const router   = express.Router();
const path     = require('path');
const crypto   = require('crypto');

const coachesDb = require('../db/coaches');
const { addClient }  = require('../lib/sheets/clients');
const {
  provisionSheet,
  ensureRequiredTabs,
  testWriteAccess,
  buildByokAuth,
  REQUIRED_TABS,
} = require('../lib/drive/sheets-provision');

// ── Encryption helpers (AES-256-GCM, same scheme as keystore.js) ────────────
const KEY_SECRET = process.env.FITOS_KEY_SECRET || 'dev-secret-change-me';

function encryptText(plaintext) {
  const key  = crypto.scryptSync(KEY_SECRET, 'fitos-onboarding-salt', 32);
  const iv   = crypto.randomBytes(12);
  const ciph = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc  = Buffer.concat([ciph.update(plaintext, 'utf8'), ciph.final()]);
  const tag  = ciph.getAuthTag();
  return [iv.toString('hex'), enc.toString('hex'), tag.toString('hex')].join(':');
}

function decryptText(ciphertext) {
  const [ivHex, encHex, tagHex] = ciphertext.split(':');
  const key   = crypto.scryptSync(KEY_SECRET, 'fitos-onboarding-salt', 32);
  const iv    = Buffer.from(ivHex, 'hex');
  const enc   = Buffer.from(encHex, 'hex');
  const tag   = Buffer.from(tagHex, 'hex');
  const deciph = crypto.createDecipheriv('aes-256-gcm', key, iv);
  deciph.setAuthTag(tag);
  return deciph.update(enc) + deciph.final('utf8');
}

// ── HTML page ────────────────────────────────────────────────────────────────

router.get('/sheet', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/onboarding-sheet.html'));
});

// ── Path A: Polsia-provisioned Sheet ────────────────────────────────────────

/**
 * POST /api/onboarding/provision-sheet
 * Body: { coachName?, coachEmail? }
 * Copies the FitOS template Sheet onto the Polsia service account, shares with coach,
 * adds demo client, persists sheet_id.
 * Returns: { ok, sheetId, sheetUrl, createdTabs }
 */
router.post('/provision-sheet', async (req, res) => {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    // Dev mode stub
    if (process.env.NODE_ENV !== 'production') {
      const stubId = 'DEMO_SHEET_ID_' + Date.now();
      if (req.coach && req.coach.id) {
        await coachesDb.saveSheetId(req.coach.id, stubId).catch(() => {});
        await coachesDb.markOnboardingComplete(req.coach.id, 'polsia').catch(() => {});
      }
      return res.json({ ok: true, sheetId: stubId, sheetUrl: '#', createdTabs: [], devMode: true });
    }
    return res.status(500).json({ ok: false, error: 'Google Sheets not configured on this server.' });
  }

  const coachName  = (req.body && req.body.coachName)  || (req.coach && req.coach.name)  || null;
  const coachEmail = (req.body && req.body.coachEmail) || (req.coach && req.coach.email) || null;

  try {
    const { sheetId, sheetUrl } = await provisionSheet(coachName, coachEmail);
    const createdTabs = await ensureRequiredTabs(sheetId);

    // Pre-populate with the demo client so the dashboard isn't empty
    const demoClientName = coachName ? `${coachName.split(' ')[0]}'s Demo Client` : 'Demo Client';
    try {
      await addClient(sheetId, { name: demoClientName, email: '' });
    } catch (_) {
      // Non-fatal — Sheet is connected even if demo client write fails
    }

    // Persist to DB
    if (req.coach && req.coach.id && process.env.DATABASE_URL) {
      await coachesDb.saveSheetId(req.coach.id, sheetId).catch(() => {});
      await coachesDb.markOnboardingComplete(req.coach.id, 'polsia').catch(() => {});
    }

    return res.json({ ok: true, sheetId, sheetUrl, createdTabs });
  } catch (err) {
    const msg = err.message || 'Failed to provision Sheet.';
    return res.status(500).json({ ok: false, error: msg });
  }
});

// ── Path B: BYOK (coach's own GCP project) ─────────────────────────────────

/**
 * POST /api/onboarding/validate-byok-sheet
 * Body: { serviceAccountJson: <string>, sheetId: <string> }
 * Parses and validates JSON client-side; here we validate API access then store.
 * Returns: { ok, sheetId, serviceAccountEmail, createdTabs }
 */
router.post('/validate-byok-sheet', async (req, res) => {
  const { serviceAccountJson, sheetId } = req.body || {};

  if (!sheetId) return res.status(400).json({ ok: false, error: 'Missing sheetId.' });
  if (!serviceAccountJson) return res.status(400).json({ ok: false, error: 'Missing service account JSON.' });

  // Parse JSON
  let credObj;
  try {
    credObj = typeof serviceAccountJson === 'string'
      ? JSON.parse(serviceAccountJson)
      : serviceAccountJson;
  } catch (_) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON — could not parse service account credentials.' });
  }

  const email = credObj.client_email || '(unknown)';

  // Dev mode stub
  if (process.env.NODE_ENV !== 'production' && !process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    if (req.coach && req.coach.id) {
      await coachesDb.saveSheetId(req.coach.id, sheetId).catch(() => {});
      await coachesDb.markOnboardingComplete(req.coach.id, 'byok').catch(() => {});
    }
    return res.json({ ok: true, sheetId, serviceAccountEmail: email, createdTabs: [], devMode: true });
  }

  try {
    const byokAuth   = buildByokAuth(credObj);
    const createdTabs = await ensureRequiredTabs(sheetId, byokAuth);
    await testWriteAccess(sheetId, byokAuth);

    // Encrypt + store
    const encryptedCreds = encryptText(JSON.stringify(credObj));

    if (req.coach && req.coach.id && process.env.DATABASE_URL) {
      await coachesDb.saveSheetId(req.coach.id, sheetId).catch(() => {});
      await coachesDb.saveByokCreds(req.coach.id, encryptedCreds).catch(() => {});
      await coachesDb.markOnboardingComplete(req.coach.id, 'byok').catch(() => {});
    }

    return res.json({ ok: true, sheetId, serviceAccountEmail: email, createdTabs });
  } catch (err) {
    let error = 'Could not access the Sheet with that service account.';
    if (err.message && (err.message.includes('permission') || err.message.includes('forbidden'))) {
      error = `Service account ${email} needs Editor access on Sheet ${sheetId}. Open the Sheet → Share → paste that email → set to Editor.`;
    } else if (err.message && err.message.includes('not found')) {
      error = `Sheet not found. Double-check the Sheet ID.`;
    }
    return res.status(400).json({ ok: false, error, detail: err.message });
  }
});

// ── Shared: tab verification checklist ──────────────────────────────────────

/**
 * GET /api/onboarding/verify-tabs?sheetId=X
 * Used by the Step 3 animated checklist.
 * Returns per-tab status after ensuring required tabs exist.
 */
router.get('/verify-tabs', async (req, res) => {
  const { sheetId } = req.query;
  if (!sheetId) return res.status(400).json({ ok: false, error: 'Missing sheetId.' });

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    if (process.env.NODE_ENV !== 'production') {
      return res.json({ ok: true, tabs: REQUIRED_TABS.map(t => ({ name: t, status: 'ok' })), devMode: true });
    }
    return res.status(500).json({ ok: false, error: 'Sheets not configured.' });
  }

  try {
    const { google } = require('googleapis');
    const { getAuth } = require('../lib/sheets/client');
    const auth   = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'sheets.properties.title',
    });
    const existing = (meta.data.sheets || []).map(s => s.properties.title);

    // Auto-create any missing tabs
    const missing = REQUIRED_TABS.filter(t => !existing.includes(t));
    if (missing.length > 0) {
      const requests = missing.map(title => ({ addSheet: { properties: { title } } }));
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests } });
    }

    const tabs = REQUIRED_TABS.map(t => ({
      name: t,
      status: existing.includes(t) ? 'ok' : 'created',
    }));

    return res.json({ ok: true, tabs });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Shared: add first client ─────────────────────────────────────────────────

/**
 * POST /api/onboarding/add-first-client
 * Body: { sheetId, name, email? }
 */
router.post('/add-first-client', async (req, res) => {
  const { sheetId, name, email } = req.body || {};
  if (!sheetId) return res.status(400).json({ ok: false, error: 'Missing sheetId.' });
  if (!name || !name.trim()) return res.status(400).json({ ok: false, error: 'Client name is required.' });

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    if (process.env.NODE_ENV !== 'production') {
      const base = `${req.protocol}://${req.get('host')}`;
      return res.json({ ok: true, name: name.trim(), pwaUrl: `${base}/workouts`, devMode: true });
    }
    return res.status(500).json({ ok: false, error: 'Sheets not configured.' });
  }

  try {
    await addClient(sheetId, { name: name.trim(), email: email || '' });
    const base = `${req.protocol}://${req.get('host')}`;
    return res.json({ ok: true, name: name.trim(), pwaUrl: `${base}/workouts` });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Failed to add client.', detail: err.message });
  }
});

module.exports = router;
