// lib/openai-runner.js
// Owns: Executing an imported OpenAI assistant against Sheet data, key encryption/decryption
// Does NOT own: DB persistence of run records (that's db/agents.js), HTTP handling

const https   = require('https');
const crypto  = require('crypto');

const { getTabValues, appendRows } = require('./sheets/client');

const ALGO = 'aes-256-gcm';

// ── Key encryption (same scheme as lib/skills/keystore.js) ───────────────────

function getSecret() {
  const raw = process.env.FITOS_KEY_SECRET || 'fitos-dev-secret-key-do-not-ship';
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptKey(plaintext) {
  const iv     = crypto.randomBytes(12);
  const key    = getSecret();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptKey(b64) {
  const buf    = Buffer.from(b64, 'base64');
  const iv     = buf.subarray(0, 12);
  const tag    = buf.subarray(12, 28);
  const enc    = buf.subarray(28);
  const key    = getSecret();
  const d      = crypto.createDecipheriv(ALGO, key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ── Available tool scopes ─────────────────────────────────────────────────────

const SCOPE_DEFS = [
  {
    id:          'read:workouts',
    label:       'Read Workouts',
    description: 'See workout history, exercises, sets, reps and RPE logs',
    tab:         'Workouts',
    range:       'Workouts!A1:Z200',
  },
  {
    id:          'read:checkins',
    label:       'Read Check-ins',
    description: 'See weekly check-in data: weight, sleep, stress, notes',
    tab:         'CheckIns',
    range:       'CheckIns!A1:J200',
  },
  {
    id:          'read:messages',
    label:       'Read Message History',
    description: 'See past coach ↔ client messages',
    tab:         'Messages',
    range:       'Messages!A1:F200',
  },
  {
    id:          'read:results',
    label:       'Read Results / KPIs',
    description: 'See client KPI metrics and progress markers from the Results tab',
    tab:         'Results',
    range:       'Results!A1:Z100',
  },
  {
    id:          'read:profile',
    label:       'Read Client Profile',
    description: 'See client name, goals, notes from the Profile tab',
    tab:         'Profile',
    range:       'Profile!A1:B100',
  },
  {
    id:          'write:activity',
    label:       'Post to Activity Feed',
    description: 'Write analysis summaries to the client\'s Activity tab (visible to coach)',
    tab:         'Activity',
    action:      'append',
  },
  {
    id:          'write:message',
    label:       'Draft Message to Client',
    description: 'Draft a message for coach review before the client sees it',
    tab:         'Messages',
    action:      'append',
    requiresApproval: true,
  },
];

/**
 * Returns the full list of scope definitions for the UI.
 */
function listScopes() {
  return SCOPE_DEFS;
}

// ── Sheet context builder ─────────────────────────────────────────────────────

/**
 * Fetch sheet data for all READ scopes the agent has been granted.
 * Returns an array of { tab, data } objects.
 */
async function buildContext(sheetId, grantedScopes) {
  const readScopes = SCOPE_DEFS.filter(s =>
    s.id.startsWith('read:') && grantedScopes.includes(s.id) && s.range
  );

  const parts = [];
  for (const scope of readScopes) {
    try {
      const rows = await getTabValues(sheetId, scope.range);
      const tsv  = rows.map(r => r.join('\t')).join('\n');
      parts.push({ tab: scope.tab, data: tsv || '(empty)' });
    } catch (err) {
      parts.push({ tab: scope.tab, data: `(unavailable: ${err.message})` });
    }
  }
  return parts;
}

// ── OpenAI Assistants API (BYOK) ──────────────────────────────────────────────

/**
 * Call the OpenAI Assistants API with a thread run.
 * Uses the coach's own API key (BYOK).
 *
 * Returns { outputText, toolsCalled, usage }
 */
async function runOpenAIAssistant({ apiKey, assistantId, userMessage, timeoutMs = 60000 }) {
  // 1. Create a thread
  const thread = await openaiPost(apiKey, '/v1/threads', {});
  const threadId = thread.id;

  // 2. Add user message to thread
  await openaiPost(apiKey, `/v1/threads/${threadId}/messages`, {
    role: 'user',
    content: userMessage,
  });

  // 3. Run the assistant
  const run = await openaiPost(apiKey, `/v1/threads/${threadId}/runs`, {
    assistant_id: assistantId,
  });
  const runId = run.id;

  // 4. Poll until terminal state
  const deadline = Date.now() + timeoutMs;
  let currentRun = run;
  let toolsCalled = [];

  while (Date.now() < deadline) {
    if (['completed', 'failed', 'cancelled', 'expired'].includes(currentRun.status)) {
      break;
    }

    if (currentRun.status === 'requires_action') {
      // Handle tool calls — record them but submit empty outputs (no actual tool execution)
      // Tool scoping is enforced by what data we injected in the prompt, not by OpenAI tools.
      const toolOutputs = [];
      const toolCallsThisRound = [];

      const requiredAction = currentRun.required_action;
      if (requiredAction && requiredAction.type === 'submit_tool_outputs') {
        for (const tc of requiredAction.submit_tool_outputs.tool_calls) {
          toolCallsThisRound.push({ id: tc.id, function: tc.function.name, args: tc.function.arguments });
          // Return empty/null result — actual data is in the message context, not via function calls
          toolOutputs.push({ tool_call_id: tc.id, output: 'Data provided in context.' });
        }
      }
      toolsCalled = [...toolsCalled, ...toolCallsThisRound];

      // Submit tool outputs
      currentRun = await openaiPost(apiKey, `/v1/threads/${threadId}/runs/${runId}/submit_tool_outputs`, {
        tool_outputs: toolOutputs,
      });
      await sleep(1000);
      continue;
    }

    // Poll
    await sleep(1500);
    currentRun = await openaiGet(apiKey, `/v1/threads/${threadId}/runs/${runId}`);
  }

  if (currentRun.status !== 'completed') {
    throw new Error(`OpenAI run ended with status: ${currentRun.status} — ${currentRun.last_error?.message || ''}`);
  }

  // 5. Retrieve the last assistant message
  const messages = await openaiGet(apiKey, `/v1/threads/${threadId}/messages?order=desc&limit=10`);
  const assistantMsg = (messages.data || []).find(m => m.role === 'assistant');
  const outputText = assistantMsg
    ? (assistantMsg.content || []).filter(b => b.type === 'text').map(b => b.text.value).join('\n')
    : '';

  const usage = currentRun.usage || {};

  // Optionally clean up thread (fire-and-forget)
  openaiDelete(apiKey, `/v1/threads/${threadId}`).catch(() => {});

  return { outputText, toolsCalled, usage };
}

/**
 * Validate an OpenAI API key by listing models.
 * Throws on auth failure.
 */
async function testOpenAIKey(apiKey) {
  const result = await openaiGet(apiKey, '/v1/models?limit=1');
  if (!result.data) throw new Error('Invalid response from OpenAI');
  return { ok: true };
}

/**
 * Validate that an assistant ID exists and is accessible with the given key.
 * Returns { id, name, model } or throws.
 */
async function fetchAssistant(apiKey, assistantId) {
  const result = await openaiGet(apiKey, `/v1/assistants/${assistantId}`, {
    'OpenAI-Beta': 'assistants=v2',
  });
  if (!result.id) throw new Error('Assistant not found');
  return {
    id:    result.id,
    name:  result.name || assistantId,
    model: result.model,
    instructions: result.instructions,
  };
}

// ── Full run orchestrator ─────────────────────────────────────────────────────

/**
 * Run an imported agent against real Sheet data.
 *
 * @param {object} opts
 *   agentRecord   — row from imported_agents (with openai_key_enc)
 *   sheetId       — coach's Google Sheet ID
 *   trigger       — 'manual' | 'scheduled' | 'on_checkin'
 *   contextNote   — optional extra context from the coach
 *
 * @returns {{ outputText, toolsCalled, usage }}
 */
async function runAgent({ agentRecord, sheetId, trigger = 'manual', contextNote = '' }) {
  const apiKey = decryptKey(agentRecord.openai_key_enc);
  const grantedScopes = agentRecord.granted_scopes || [];

  // Build context from granted READ scopes
  const contextParts = await buildContext(sheetId, grantedScopes);

  // Compose the message to send to the assistant
  let userMessage = 'You are analyzing a personal training client\'s data. ';
  if (contextParts.length === 0) {
    userMessage += 'No data access has been granted for this run. Please note that no client data is available.';
  } else {
    userMessage += 'Here is the current client data you have access to:\n\n';
    for (const { tab, data } of contextParts) {
      userMessage += `--- ${tab} ---\n${data}\n\n`;
    }
  }

  if (contextNote) {
    userMessage += `\nAdditional context from coach: ${contextNote}`;
  }

  userMessage += '\nPlease provide your analysis and recommendations.';

  const { outputText, toolsCalled, usage } = await runOpenAIAssistant({
    apiKey,
    assistantId: agentRecord.assistant_id,
    userMessage,
  });

  // Write output back to granted WRITE scopes
  const writeScopes = SCOPE_DEFS.filter(s =>
    s.id.startsWith('write:') && grantedScopes.includes(s.id)
  );

  if (sheetId && outputText && writeScopes.length > 0) {
    const now = new Date().toISOString();
    for (const ws of writeScopes) {
      try {
        if (ws.tab === 'Activity') {
          await appendRows(sheetId, 'Activity!A:F', [[
            now,
            'agent_summary',
            `imported:${agentRecord.id}`,
            outputText.slice(0, 2000), // cap at 2000 chars for Sheet cell
            '',
            JSON.stringify({ agentId: agentRecord.id, agentName: agentRecord.display_name }),
          ]]);
        } else if (ws.tab === 'Messages' && ws.requiresApproval) {
          // Draft pending coach approval (approved col empty)
          await appendRows(sheetId, 'Messages!A:F', [[
            now,
            'coach_agent',
            outputText.slice(0, 2000),
            'FALSE',
            `agent:${agentRecord.id}`,
            '',  // approved — blank until coach reviews
          ]]);
        }
      } catch (err) {
        // Non-fatal — return output even if Sheet write fails
        console.error(`[openai-runner] sheet write failed (${ws.tab}):`, err.message);
      }
    }
  }

  return { outputText, toolsCalled, usage };
}

// ── HTTP helpers (native https, no SDK) ──────────────────────────────────────

function openaiPost(apiKey, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.openai.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(bodyStr),
        'OpenAI-Beta': 'assistants=v2',
        ...extraHeaders,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            const msg = parsed.error?.message || `HTTP ${res.statusCode}`;
            reject(new Error(msg));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Invalid JSON from OpenAI: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function openaiGet(apiKey, path, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2',
        ...extraHeaders,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            const msg = parsed.error?.message || `HTTP ${res.statusCode}`;
            reject(new Error(msg));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Invalid JSON from OpenAI: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function openaiDelete(apiKey, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path,
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  encryptKey, decryptKey,
  listScopes,
  testOpenAIKey, fetchAssistant,
  runAgent,
};
