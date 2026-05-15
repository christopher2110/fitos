// routes/custom-agents.js
// Owns: /dashboard/agents/* — list, import, run, history for custom OpenAI agents
// Does NOT own: built-in Claude skills (routes/agents.js), Sheet auth, builder chat

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const db          = require('../db/agents');
const runner      = require('../lib/openai-runner');

const router = express.Router();

// ── Auth guard ────────────────────────────────────────────────────────────────

function requireCoach(req, res, next) {
  if (!req.coach) return res.redirect('/trial');
  next();
}

// ── HTML page helpers ─────────────────────────────────────────────────────────

function sendPage(res, filename, injection = '') {
  const htmlPath = path.join(__dirname, '..', 'public', filename);
  if (!fs.existsSync(htmlPath)) return res.status(404).send(`Page not found: ${filename}`);
  let html = fs.readFileSync(htmlPath, 'utf8');
  if (injection) html = html.replace('</head>', `${injection}\n</head>`);
  res.type('html').send(html);
}

// ── HTML Pages ────────────────────────────────────────────────────────────────

/** GET /dashboard/agents — main agents list */
router.get('/', requireCoach, (req, res) => {
  const coachName = req.coach.name || 'Coach';
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const injection = `<script>
    window.__COACH_LIVE__ = ${JSON.stringify({ coachName, sheetsEnabled })};
  </script>`;
  sendPage(res, 'dashboard-agents.html', injection);
});

/** GET /dashboard/agents/new — import wizard */
router.get('/new', requireCoach, (req, res) => {
  const coachName = req.coach.name || 'Coach';
  const injection = `<script>
    window.__COACH_LIVE__ = ${JSON.stringify({ coachName })};
  </script>`;
  sendPage(res, 'dashboard-agents-new.html', injection);
});

/** GET /dashboard/agents/:id/history — audit log for one agent */
router.get('/:id/history', requireCoach, async (req, res) => {
  const agent = await db.getAgent(Number(req.params.id), req.coach.id).catch(() => null);
  if (!agent) return res.status(404).send('Agent not found');
  const coachName = req.coach.name || 'Coach';
  const injection = `<script>
    window.__COACH_LIVE__ = ${JSON.stringify({ coachName, agentId: agent.id, agentName: agent.display_name })};
  </script>`;
  sendPage(res, 'dashboard-agents-history.html', injection);
});

// ── JSON API ──────────────────────────────────────────────────────────────────

/** GET /api/custom-agents/scopes — list all available tool scopes */
router.get('/api/scopes', requireCoach, (req, res) => {
  res.json({ ok: true, scopes: runner.listScopes() });
});

/** GET /api/custom-agents/agents — list imported agents for this coach */
router.get('/api/agents', requireCoach, async (req, res) => {
  try {
    const agents = await db.listAgents(req.coach.id);
    res.json({ ok: true, agents });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/custom-agents/agents/:id — single agent */
router.get('/api/agents/:id', requireCoach, async (req, res) => {
  try {
    const agent = await db.getAgent(Number(req.params.id), req.coach.id);
    if (!agent) return res.status(404).json({ ok: false, error: 'Agent not found' });
    // Strip encrypted key before returning
    const { openai_key_enc, ...safe } = agent;
    res.json({ ok: true, agent: safe });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/custom-agents/agents/validate-key
 * Body: { openaiKey }
 * Tests that the key is valid against OpenAI before saving anything.
 */
router.post('/api/agents/validate-key', requireCoach, async (req, res) => {
  const { openaiKey } = req.body || {};
  if (!openaiKey) return res.status(400).json({ ok: false, error: 'openaiKey required' });
  try {
    await runner.testOpenAIKey(openaiKey);
    res.json({ ok: true });
  } catch (err) {
    const authFailed = /401|unauthorized|api.key/i.test(err.message);
    res.status(authFailed ? 401 : 500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/custom-agents/agents/fetch-assistant
 * Body: { openaiKey, assistantId }
 * Fetches assistant metadata from OpenAI to confirm it exists.
 */
router.post('/api/agents/fetch-assistant', requireCoach, async (req, res) => {
  const { openaiKey, assistantId } = req.body || {};
  if (!openaiKey || !assistantId) {
    return res.status(400).json({ ok: false, error: 'openaiKey and assistantId required' });
  }
  try {
    const assistant = await runner.fetchAssistant(openaiKey, assistantId);
    res.json({ ok: true, assistant });
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/custom-agents/agents
 * Create (import) a new agent.
 * Body: { openaiKey, assistantId, displayName, description, icon, grantedScopes, runMode, schedule }
 */
router.post('/api/agents', requireCoach, async (req, res) => {
  const {
    openaiKey, assistantId, displayName, description,
    icon, grantedScopes, runMode, schedule,
  } = req.body || {};

  if (!openaiKey)     return res.status(400).json({ ok: false, error: 'openaiKey required' });
  if (!assistantId)   return res.status(400).json({ ok: false, error: 'assistantId required' });
  if (!displayName)   return res.status(400).json({ ok: false, error: 'displayName required' });
  if (!Array.isArray(grantedScopes)) return res.status(400).json({ ok: false, error: 'grantedScopes must be an array' });

  // Validate scopes against known scope list
  const validIds = runner.listScopes().map(s => s.id);
  const invalid  = grantedScopes.filter(s => !validIds.includes(s));
  if (invalid.length > 0) {
    return res.status(400).json({ ok: false, error: `Unknown scopes: ${invalid.join(', ')}` });
  }

  try {
    // Encrypt the key before persisting
    const openai_key_enc = runner.encryptKey(openaiKey.trim());

    const agent = await db.createAgent({
      coach_id:       req.coach.id,
      display_name:   displayName.trim(),
      description:    description || '',
      icon:           icon || '🤖',
      assistant_id:   assistantId.trim(),
      openai_key_enc,
      granted_scopes: grantedScopes,
      run_mode:       runMode || 'on_demand',
      schedule:       schedule || null,
    });

    res.status(201).json({ ok: true, agent });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PATCH /api/custom-agents/agents/:id
 * Update agent metadata (not the key).
 */
router.patch('/api/agents/:id', requireCoach, async (req, res) => {
  const { displayName, description, icon, grantedScopes, runMode, schedule } = req.body || {};

  // Validate scopes if provided
  if (grantedScopes !== undefined) {
    const validIds = runner.listScopes().map(s => s.id);
    const invalid  = (grantedScopes || []).filter(s => !validIds.includes(s));
    if (invalid.length > 0) {
      return res.status(400).json({ ok: false, error: `Unknown scopes: ${invalid.join(', ')}` });
    }
  }

  try {
    const updated = await db.updateAgent(Number(req.params.id), req.coach.id, {
      display_name:   displayName,
      description,
      icon,
      granted_scopes: grantedScopes,
      run_mode:       runMode,
      schedule,
    });
    if (!updated) return res.status(404).json({ ok: false, error: 'Agent not found' });
    res.json({ ok: true, agent: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/custom-agents/agents/:id
 * Archive (soft-delete) an agent.
 */
router.delete('/api/agents/:id', requireCoach, async (req, res) => {
  try {
    const result = await db.archiveAgent(Number(req.params.id), req.coach.id);
    if (!result) return res.status(404).json({ ok: false, error: 'Agent not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/custom-agents/agents/:id/run
 * Run an imported agent on-demand.
 * Body: { contextNote? }
 */
router.post('/api/agents/:id/run', requireCoach, async (req, res) => {
  const { contextNote = '' } = req.body || {};

  // Sheets must be connected for context reads
  const sheetsEnabled = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

  try {
    const agentRecord = await db.getAgent(Number(req.params.id), req.coach.id);
    if (!agentRecord) return res.status(404).json({ ok: false, error: 'Agent not found' });

    // Create run record in DB
    const run = await db.createRun(agentRecord.id, req.coach.id, 'manual', {
      contextNote: contextNote || '',
      sheetsEnabled,
    });

    // Execute (async — respond with run id immediately, client polls)
    const runId = run.id;

    // Run synchronously for now (max ~60s per OpenAI run)
    try {
      const { outputText, toolsCalled, usage } = await runner.runAgent({
        agentRecord,
        sheetId: sheetsEnabled ? req.sheetId : null,
        trigger: 'manual',
        contextNote,
      });
      await db.completeRun(runId, { outputText, toolsCalled, usageJson: usage });
      res.json({ ok: true, runId, status: 'completed', outputText, toolsCalled, usage });
    } catch (err) {
      await db.failRun(runId, err.message);
      res.status(500).json({ ok: false, runId, error: err.message });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/custom-agents/agents/:id/runs — run history for one agent */
router.get('/api/agents/:id/runs', requireCoach, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const runs  = await db.listRuns(Number(req.params.id), req.coach.id, limit);
    res.json({ ok: true, runs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/custom-agents/agents/:agentId/runs/:runId — single run detail */
router.get('/api/agents/:agentId/runs/:runId', requireCoach, async (req, res) => {
  try {
    const run = await db.getRun(Number(req.params.runId), req.coach.id);
    if (!run) return res.status(404).json({ ok: false, error: 'Run not found' });
    res.json({ ok: true, run });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
