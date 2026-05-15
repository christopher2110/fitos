// routes/agents.js
// Owns: /settings/agents page, Anthropic key save/test, skill list, skill run endpoint
// Does NOT own: Sheet auth, skill execution logic (those live in lib/skills/)

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const { scanSkills, loadSkill }                             = require('../lib/skills/scanner');
const { runSkill, testAnthropicKey }                        = require('../lib/skills/runner');
const { getAnthropicKey, saveAnthropicKey,
        getEnabledSkills, saveEnabledSkills }               = require('../lib/skills/keystore');

const router = express.Router();

// Sheets active guard — key operations require a connected Sheet
// Uses req.sheetId (set by resolveSheetMiddleware) instead of env var for multi-tenant support
const sheetsEnabled = (req) => !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
const sheetId       = (req) => req.sheetId;

// ── HTML PAGE ────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'agents.html');
  if (!fs.existsSync(htmlPath)) return res.status(404).send('Agents page not found');
  res.sendFile(htmlPath);
});

// ── KEY MANAGEMENT ──────────────────────────────────────────────────────────

/**
 * GET /settings/agents/api/key-status
 * Returns whether a key is saved (does NOT return the key itself).
 */
router.get('/api/key-status', async (req, res) => {
  if (!sheetsEnabled(req)) return res.json({ ok: true, hasKey: false, demo: true });
  try {
    const key = await getAnthropicKey(sheetId(req));
    res.json({ ok: true, hasKey: !!key });
  } catch (err) {
    res.json({ ok: false, hasKey: false, error: err.message });
  }
});

/**
 * POST /settings/agents/api/save-key
 * Body: { key: "sk-ant-..." }
 * Saves the encrypted key into the Profile tab of the Sheet.
 */
router.post('/api/save-key', async (req, res) => {
  const { key } = req.body || {};
  if (!key || typeof key !== 'string' || !key.trim()) {
    return res.status(400).json({ ok: false, error: 'key is required' });
  }
  if (!sheetsEnabled(req)) {
    return res.status(400).json({ ok: false, error: 'Sheet not connected — connect your Google Sheet via /setup first' });
  }
  try {
    await saveAnthropicKey(sheetId(req), key.trim());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /settings/agents/api/test-key
 * Body: { key: "sk-ant-..." }
 * Sends a 1-token ping to Anthropic to verify the key is valid.
 */
router.post('/api/test-key', async (req, res) => {
  const { key } = req.body || {};
  if (!key || typeof key !== 'string' || !key.trim()) {
    return res.status(400).json({ ok: false, error: 'key is required' });
  }
  try {
    await testAnthropicKey(key.trim());
    res.json({ ok: true });
  } catch (err) {
    // Distinguish auth failure from network error
    const msg = err.message || '';
    const authFailed = msg.includes('401') || msg.includes('invalid') || msg.includes('authentication');
    res.status(authFailed ? 401 : 500).json({ ok: false, error: msg });
  }
});

// ── SKILLS ──────────────────────────────────────────────────────────────────

/**
 * GET /settings/agents/api/skills
 * Returns all skills + enabled state for this coach.
 */
router.get('/api/skills', async (req, res) => {
  const skills = scanSkills().map(({ _dir, ...rest }) => rest); // strip internal _dir field

  if (!sheetsEnabled(req)) {
    return res.json({ ok: true, demo: true, skills, enabled: {} });
  }

  try {
    const enabled = await getEnabledSkills(sheetId(req));
    res.json({ ok: true, skills, enabled });
  } catch (err) {
    res.json({ ok: true, skills, enabled: {}, error: err.message });
  }
});

/**
 * POST /settings/agents/api/skills/toggle
 * Body: { skillId, enabled: true|false }
 */
router.post('/api/skills/toggle', async (req, res) => {
  const { skillId, enabled } = req.body || {};
  if (!skillId) return res.status(400).json({ ok: false, error: 'skillId required' });
  if (!sheetsEnabled(req)) return res.status(400).json({ ok: false, error: 'Sheet not connected' });

  try {
    const current = await getEnabledSkills(sheetId(req));
    if (enabled) {
      current[skillId] = true;
    } else {
      delete current[skillId];
    }
    await saveEnabledSkills(sheetId(req), current);
    res.json({ ok: true, enabled: current });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /settings/agents/api/skills/run
 * Body: { skillId, dryRun?: boolean }
 * Pulls the coach's key from the Sheet, runs the skill, returns result.
 * Pass dryRun: true to call Claude and preview output without writing to the Sheet.
 */
router.post('/api/skills/run', async (req, res) => {
  const { skillId, dryRun = false } = req.body || {};
  if (!skillId) return res.status(400).json({ ok: false, error: 'skillId required' });

  if (!sheetsEnabled(req)) {
    return res.status(400).json({ ok: false, error: 'Sheet not connected — connect your Google Sheet via /setup first' });
  }

  const skill = loadSkill(skillId);
  if (!skill) return res.status(404).json({ ok: false, error: `Skill "${skillId}" not found` });

  let anthropicKey = null;
  try {
    anthropicKey = await getAnthropicKey(sheetId(req));
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Failed to retrieve API key: ${err.message}` });
  }

  if (!anthropicKey) {
    return res.status(400).json({ ok: false, error: 'No Anthropic API key saved. Add your key in the Agents settings first.' });
  }

  try {
    const result = await runSkill({
      skillId,
      manifest:     skill.manifest,
      systemPrompt: skill.systemPrompt,
      tools:        skill.tools,
      sheetId:      sheetId(req),
      anthropicKey,
      dryRun:       !!dryRun,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    // Surface Anthropic errors clearly
    const msg = err.message || 'Unknown error';
    const authFailed = msg.includes('401') || msg.includes('invalid') || msg.includes('authentication');
    res.status(authFailed ? 401 : 500).json({ ok: false, error: msg });
  }
});

module.exports = router;
