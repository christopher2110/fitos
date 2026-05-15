// lib/skills/runner.js
// Owns: Executing a skill — reading Sheet inputs, calling Anthropic, writing outputs
// Does NOT own: HTTP handling, key storage, skill discovery

const https = require('https');
const { getTabValues, appendRows } = require('../sheets/client');

// Activity tab columns (matches Phase 5c schema):
// Timestamp, Type, Actor, Summary, ClientId, Metadata

// Messages tab columns (matches Phase 5d schema):
// Timestamp, Sender, Message, Read, Thread

/**
 * Run a skill against a client's Sheet using the provided Anthropic API key.
 *
 * @param {object} opts
 *   skillId       {string}   skill id (from manifest)
 *   manifest      {object}   parsed manifest.json
 *   systemPrompt  {string}   contents of system.md
 *   tools         {array|null} parsed tools.json (or null)
 *   sheetId       {string}   Google Sheet ID
 *   anthropicKey  {string}   Anthropic API key (BYOK)
 *   dryRun        {boolean}  if true, call Claude but skip all Sheet writes
 *
 * @returns {{ summary: string, persisted: boolean }}
 */
async function runSkill({ skillId, manifest, systemPrompt, tools, sheetId, anthropicKey, dryRun = false }) {
  // 1. Read all inputs from the Sheet
  const inputParts = [];
  for (const input of (manifest.inputs || [])) {
    try {
      const rows = await getTabValues(sheetId, input.range);
      const tsv  = rows.map(r => r.join('\t')).join('\n');
      inputParts.push(`## ${input.tab}\n${tsv || '(empty)'}`);
    } catch (err) {
      inputParts.push(`## ${input.tab}\n(unavailable: ${err.message})`);
    }
  }

  const userContent = inputParts.join('\n\n');

  // 2. Call Anthropic /v1/messages
  const model   = manifest.model || 'claude-haiku-4-5';
  const summary = await callAnthropic({ anthropicKey, model, systemPrompt, userContent, tools });

  // Dry-run: return Claude's output without writing anything to the Sheet
  if (dryRun) {
    return { summary, persisted: false, dryRun: true };
  }

  // 3. Write result to the correct output tab based on manifest
  let persisted = false;
  const outputs = manifest.outputs || [{ tab: 'Activity', action: 'append' }];

  for (const output of outputs) {
    if (!sheetId || !summary) break;

    try {
      const now = new Date().toISOString();

      if (output.tab === 'Messages') {
        // Messages tab: Timestamp, Sender, Message, Read, Thread
        // Writes each cue from form-cue-generator as a separate coach_agent message
        // approved column (col F) is empty — coach reviews before client sees
        let cues = [];
        try {
          cues = JSON.parse(summary);
          if (!Array.isArray(cues)) cues = [];
        } catch (_) {
          // If Claude didn't return valid JSON, write the raw text as a single message
          cues = [{ exercise: 'General', cue: summary, rpe_signal: '' }];
        }

        for (const cue of cues) {
          const thread  = cue.exercise ? `form-cue:${cue.exercise}` : 'form-cue';
          const message = cue.rpe_signal
            ? `${cue.exercise}: ${cue.cue} [signal: ${cue.rpe_signal}]`
            : `${cue.exercise}: ${cue.cue}`;
          const row = [
            now,
            'coach_agent',  // Sender
            message,
            'FALSE',        // Read
            thread,         // Thread label
            '',             // approved — blank until coach reviews
          ];
          await appendRows(sheetId, 'Messages!A:F', [row]);
        }
        persisted = true;

      } else {
        // Default: Activity tab
        // Type from manifest output or default to agent_summary
        const type     = output.type || 'agent_summary';
        const severity = output.severity || '';
        const row = [
          now,
          type,
          `skill:${skillId}`,
          summary,
          '',  // ClientId — single-sheet model, not multi-client
          JSON.stringify({ skillId, skillName: manifest.name, model, severity: severity || undefined }),
        ];
        await appendRows(sheetId, 'Activity!A:F', [row]);
        persisted = true;
      }
    } catch (err) {
      // Non-fatal — return summary even if Sheet write fails
      console.error(`[skills/runner] ${output.tab} append failed:`, err.message);
    }
  }

  return { summary, persisted };
}

/**
 * Make the Anthropic /v1/messages API call.
 * Uses native https to avoid adding an Anthropic SDK dependency.
 * Handles basic tool-use loop (one round only — enough for current skills).
 *
 * @returns {string} The assistant's text response
 */
async function callAnthropic({ anthropicKey, model, systemPrompt, userContent, tools }) {
  const body = {
    model,
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  };
  if (tools && tools.length > 0) body.tools = tools;

  const responseText = await httpsPost('api.anthropic.com', '/v1/messages', {
    'Content-Type': 'application/json',
    'x-api-key': anthropicKey,
    'anthropic-version': '2023-06-01',
  }, JSON.stringify(body));

  const data = JSON.parse(responseText);
  if (data.error) throw new Error(`Anthropic error: ${data.error.message}`);

  // Extract text from content blocks
  const textBlock = (data.content || []).find(b => b.type === 'text');
  return textBlock ? textBlock.text.trim() : '';
}

/**
 * Simple HTTPS POST helper — avoids requiring axios/node-fetch.
 * Returns response body as string.
 */
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
          resolve(data);
        } else {
          // Include response body in the error for easier debugging
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Ping Anthropic with a 1-token message to validate the key.
 * Returns { ok: true } or throws with a descriptive error.
 */
async function testAnthropicKey(apiKey) {
  const body = JSON.stringify({
    model: 'claude-haiku-4-5',
    max_tokens: 1,
    messages: [{ role: 'user', content: 'hi' }],
  });
  const result = await httpsPost('api.anthropic.com', '/v1/messages', {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }, body);

  const data = JSON.parse(result);
  if (data.error) throw new Error(data.error.message);
  return { ok: true };
}

module.exports = { runSkill, testAnthropicKey };
