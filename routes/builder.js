// routes/builder.js
// Owns: AI Program Builder — chat endpoint, client list for assignment, program write
// Does NOT own: key storage (lib/skills/keystore), Sheet auth, program read UI

const express = require('express');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');

const { getAnthropicKey }  = require('../lib/skills/keystore');
const { getClientList }    = require('../lib/sheets/clients');
const { addProgramExercises } = require('../lib/sheets/programs');

const router = express.Router();

const sheetsEnabled = (req) => !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
const sheetId       = (req) => req.sheetId;

// ── HTML PAGE ─────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'builder.html');
  if (!fs.existsSync(htmlPath)) return res.status(404).send('Builder page not found');
  res.sendFile(htmlPath);
});

// ── CLIENT LIST ──────────────────────────────────────────────────────────────

/**
 * GET /api/agents/builder/clients
 * Returns the coach's client list so the assign dropdown can be populated.
 */
router.get('/clients', async (req, res) => {
  if (!sheetsEnabled(req)) {
    return res.json({ ok: true, demo: true, clients: [] });
  }
  try {
    const clients = await getClientList(sheetId(req));
    res.json({ ok: true, clients });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── CHAT ─────────────────────────────────────────────────────────────────────

const BUILDER_SYSTEM_PROMPT = `You are an expert strength and conditioning coach helping design training programs.

When asked to build a program, respond with EXACTLY this JSON structure (no markdown fences, no extra text):
{
  "summary": "Brief natural-language description of the program",
  "program": {
    "name": "Program name",
    "duration_weeks": 4,
    "days_per_week": 4,
    "goal": "hypertrophy",
    "weeks": [
      {
        "week": 1,
        "phase": "Accumulation",
        "days": [
          {
            "day": "Monday",
            "focus": "Upper Push",
            "exercises": [
              {
                "name": "Bench Press",
                "sets": "4",
                "reps": "8-10",
                "load": "70% 1RM",
                "rest": "90",
                "tempo": "3010",
                "notes": "Control the eccentric"
              }
            ]
          }
        ]
      }
    ]
  }
}

For conversational follow-ups, corrections, or questions that don't require a full program, respond with:
{
  "summary": "Your conversational response here",
  "program": null
}

Always respond with valid JSON only. No markdown, no explanations outside the JSON.`;

/**
 * POST /api/agents/builder/chat
 * Body: { message: string, history: [{role, content}] }
 * Calls Anthropic with BYOK key. Returns JSON with { summary, program }.
 */
router.post('/chat', async (req, res) => {
  const { message, history = [] } = req.body || {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ ok: false, error: 'message is required' });
  }

  // Key required — redirect hint if missing
  if (!sheetsEnabled(req)) {
    return res.status(400).json({
      ok: false,
      error: 'Sheet not connected. Connect your Google Sheet via /setup first.',
      redirect: '/setup',
    });
  }

  let anthropicKey = null;
  try {
    anthropicKey = await getAnthropicKey(sheetId(req));
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Failed to retrieve API key: ${err.message}` });
  }

  if (!anthropicKey) {
    return res.status(400).json({
      ok: false,
      error: 'No Anthropic API key saved. Add your key in Agent Settings first.',
      redirect: '/settings/agents',
    });
  }

  // Build message history for multi-turn
  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message.trim() },
  ];

  try {
    const result = await callAnthropic(anthropicKey, messages);

    // Parse the JSON response from Claude
    let parsed = null;
    try {
      parsed = JSON.parse(result);
    } catch (_) {
      // Claude returned non-JSON — wrap it
      parsed = { summary: result, program: null };
    }

    res.json({
      ok: true,
      summary: parsed.summary || '',
      program: parsed.program || null,
      raw: result,
    });
  } catch (err) {
    const msg = err.message || 'Unknown error';
    const authFailed = msg.includes('401') || msg.includes('invalid') || msg.includes('authentication');
    res.status(authFailed ? 401 : 500).json({ ok: false, error: msg });
  }
});

// ── ASSIGN TO CLIENT ─────────────────────────────────────────────────────────

/**
 * POST /api/agents/builder/assign
 * Body: { clientEmail: string, clientName: string, program: { name, weeks: [...] } }
 * Writes program rows to the coach's Sheet Program tab, tagged with client email.
 */
router.post('/assign', async (req, res) => {
  const { clientEmail, clientName, program } = req.body || {};

  if (!program || !Array.isArray(program.weeks) || program.weeks.length === 0) {
    return res.status(400).json({ ok: false, error: 'program with weeks is required' });
  }
  if (!clientEmail) {
    return res.status(400).json({ ok: false, error: 'clientEmail is required' });
  }

  if (!sheetsEnabled(req)) {
    return res.status(400).json({ ok: false, error: 'Sheet not connected' });
  }

  // Flatten program weeks → exercises into rows for Program tab
  const exercises = [];
  for (const week of program.weeks) {
    for (const day of (week.days || [])) {
      for (const ex of (day.exercises || [])) {
        exercises.push({
          week:   week.week || 1,
          phase:  week.phase || '',
          day:    day.day || '',
          focus:  day.focus || '',
          name:   ex.name || '',
          sets:   ex.sets || '',
          reps:   ex.reps || '',
          load:   ex.load || '',
          rest:   ex.rest || '',
          tempo:  ex.tempo || '',
          // Append client tag to notes so /dashboard/clients/:id/workouts can filter
          notes:  [ex.notes, `client:${clientEmail}`].filter(Boolean).join(' | '),
        });
      }
    }
  }

  if (exercises.length === 0) {
    return res.status(400).json({ ok: false, error: 'No exercises found in program' });
  }

  try {
    await addProgramExercises(sheetId(req), exercises);
    res.json({
      ok: true,
      assigned: exercises.length,
      client: clientName || clientEmail,
      programName: program.name || 'Assigned Program',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── HELPERS ──────────────────────────────────────────────────────────────────

async function callAnthropic(apiKey, messages) {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    system: BUILDER_SYSTEM_PROMPT,
    messages,
  });

  return httpsPost('api.anthropic.com', '/v1/messages', {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }, body);
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      path,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`Anthropic error: ${parsed.error.message}`));
              return;
            }
            const textBlock = (parsed.content || []).find(b => b.type === 'text');
            resolve(textBlock ? textBlock.text.trim() : '');
          } catch (e) {
            reject(new Error(`Failed to parse Anthropic response: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = router;
