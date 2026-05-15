/**
 * routes/admin-diagnostics.js — Live integration health diagnostics
 *
 * Owns: /admin/diagnostics page + /api/admin/diagnostics JSON endpoint.
 *       Auth gate via ?key= or Authorization header matched to ADMIN_KEY env var.
 * Does NOT own: any persistent data, user auth, business logic.
 */

const express = require('express');
const path = require('path');
const { google } = require('googleapis');

const router = express.Router();

// ─── Auth middleware ────────────────────────────────────────────────────────

function requireAdminKey(req, res, next) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return res.status(503).json({ error: 'ADMIN_KEY env var not set — page disabled' });
  }
  const provided =
    req.query.key ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (provided.trim() !== adminKey.trim()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── Check helpers ──────────────────────────────────────────────────────────

async function checkSheets() {
  const start = Date.now();
  const sheetId = process.env.GOOGLE_SHEET_ID || process.env.COACH_SHEET_ID;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!keyJson) {
    return {
      name: 'Google Sheets API',
      status: 'error',
      message: 'GOOGLE_SERVICE_ACCOUNT_KEY not set',
      details: {},
      latency: null,
    };
  }
  if (!sheetId) {
    return {
      name: 'Google Sheets API',
      status: 'warn',
      message: 'No Sheet ID configured (GOOGLE_SHEET_ID / COACH_SHEET_ID)',
      details: {},
      latency: null,
    };
  }

  try {
    const credentials = JSON.parse(keyJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Read a known safe cell — Sheet metadata
    const readRes = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const title = readRes.data.properties?.title || '(unknown)';

    // Write heartbeat cell to a safe scratch range (Sheet1!Z1 or last profile tab)
    const heartbeatValue = `diag:${Date.now()}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Profile!Z1',
      valueInputOption: 'RAW',
      requestBody: { values: [[heartbeatValue]] },
    });

    // Read it back to confirm round-trip
    const verifyRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Profile!Z1',
    });
    const readBack = verifyRes.data.values?.[0]?.[0];
    const roundTrip = readBack === heartbeatValue;

    const latency = Date.now() - start;
    return {
      name: 'Google Sheets API',
      status: roundTrip ? 'ok' : 'warn',
      message: roundTrip
        ? `Read/write round-trip OK — "${title}"`
        : `Write succeeded but read-back mismatch (got: ${readBack})`,
      details: {
        serviceAccount: credentials.client_email || 'unknown',
        sheetId,
        sheetTitle: title,
      },
      latency,
    };
  } catch (err) {
    return {
      name: 'Google Sheets API',
      status: 'error',
      message: err.message,
      details: {},
      latency: Date.now() - start,
    };
  }
}

async function checkYouTube() {
  const start = Date.now();
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return {
      name: 'YouTube Data API v3',
      status: 'error',
      message: 'YOUTUBE_API_KEY not set',
      details: {},
      latency: null,
    };
  }
  try {
    // Cheap quota call: videos.list on a known stable video ID (1 unit)
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=jNQXAC9IVRw&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const latency = Date.now() - start;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        name: 'YouTube Data API v3',
        status: 'error',
        message: `HTTP ${res.status}: ${body.slice(0, 200)}`,
        details: {},
        latency,
      };
    }
    const data = await res.json();
    const videoTitle = data.items?.[0]?.snippet?.title || '(none)';
    return {
      name: 'YouTube Data API v3',
      status: 'ok',
      message: `API reachable — quota cost: 1 unit`,
      details: { testVideo: videoTitle, quotaCost: 1 },
      latency,
    };
  } catch (err) {
    return {
      name: 'YouTube Data API v3',
      status: 'error',
      message: err.message,
      details: {},
      latency: Date.now() - start,
    };
  }
}

async function checkPostmark() {
  const start = Date.now();
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) {
    return {
      name: 'Postmark',
      status: 'error',
      message: 'POSTMARK_SERVER_TOKEN not set',
      details: {},
      latency: null,
    };
  }
  try {
    const res = await fetch('https://api.postmarkapp.com/server', {
      headers: {
        'X-Postmark-Server-Token': token,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    const latency = Date.now() - start;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        name: 'Postmark',
        status: 'error',
        message: `HTTP ${res.status}: ${body.slice(0, 200)}`,
        details: {},
        latency,
      };
    }
    const data = await res.json();
    return {
      name: 'Postmark',
      status: 'ok',
      message: `Server "${data.Name}" — token valid`,
      details: {
        serverName: data.Name,
        serverColor: data.Color,
        deliveryType: data.DeliveryType,
      },
      latency,
    };
  } catch (err) {
    return {
      name: 'Postmark',
      status: 'error',
      message: err.message,
      details: {},
      latency: Date.now() - start,
    };
  }
}

async function checkAnthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      name: 'Anthropic',
      status: 'warn',
      message: 'BYOK — coaches provide their own key via the skill runner',
      details: { mode: 'byok' },
      latency: null,
    };
  }
  const start = Date.now();
  try {
    // Minimal ping: list models endpoint
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(8000),
    });
    const latency = Date.now() - start;
    if (!res.ok) {
      return {
        name: 'Anthropic',
        status: 'error',
        message: `HTTP ${res.status}`,
        details: {},
        latency,
      };
    }
    const data = await res.json();
    const modelCount = data.data?.length || 0;
    return {
      name: 'Anthropic',
      status: 'ok',
      message: `Server-side key active — ${modelCount} models available`,
      details: { keySource: 'server', modelCount },
      latency,
    };
  } catch (err) {
    return {
      name: 'Anthropic',
      status: 'error',
      message: err.message,
      details: {},
      latency: Date.now() - start,
    };
  }
}

async function checkDatabase() {
  const start = Date.now();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return {
      name: 'Database (Neon/PostgreSQL)',
      status: 'error',
      message: 'DATABASE_URL not set',
      details: {},
      latency: null,
    };
  }
  try {
    const { pingDatabase } = require('../db/diagnostics');
    const row = await pingDatabase();
    const latency = Date.now() - start;
    return {
      name: 'Database (Neon/PostgreSQL)',
      status: 'ok',
      message: `SELECT 1 OK — server time: ${row.server_time}`,
      details: { serverTime: row.server_time },
      latency,
    };
  } catch (err) {
    return {
      name: 'Database (Neon/PostgreSQL)',
      status: 'error',
      message: err.message,
      details: {},
      latency: Date.now() - start,
    };
  }
}

function checkRenderMetadata() {
  return {
    name: 'Render Deployment',
    status: 'ok',
    message: 'Deployment metadata from env vars',
    details: {
      commitSha: process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || '(not set)',
      deployTime: process.env.RENDER_DEPLOY_TIME || '(not set)',
      region: process.env.RENDER_REGION || '(not set)',
      serviceName: process.env.RENDER_SERVICE_NAME || '(not set)',
    },
    latency: 0,
  };
}

// ─── Env-var presence checklist ─────────────────────────────────────────────

const ENV_VARS = [
  {
    key: 'GOOGLE_SERVICE_ACCOUNT_KEY',
    label: 'Google Service Account JSON',
    fixUrl: 'https://dashboard.render.com/web/srv-*/env',
    docsUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
  },
  {
    key: 'GOOGLE_SHEET_ID',
    label: 'Google Sheet ID (coach default)',
    fixUrl: 'https://dashboard.render.com/web/srv-*/env',
    docsUrl: null,
  },
  {
    key: 'YOUTUBE_API_KEY',
    label: 'YouTube Data API v3 Key',
    fixUrl: 'https://dashboard.render.com/web/srv-*/env',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  {
    key: 'POSTMARK_SERVER_TOKEN',
    label: 'Postmark Server Token',
    fixUrl: 'https://dashboard.render.com/web/srv-*/env',
    docsUrl: 'https://account.postmarkapp.com/servers',
  },
  {
    key: 'POSTMARK_FROM_EMAIL',
    label: 'Postmark From Email',
    fixUrl: 'https://dashboard.render.com/web/srv-*/env',
    docsUrl: null,
  },
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Anthropic API Key (optional — BYOK fallback)',
    fixUrl: 'https://dashboard.render.com/web/srv-*/env',
    docsUrl: 'https://console.anthropic.com/keys',
    optional: true,
  },
  {
    key: 'STRIPE_SECRET_KEY',
    label: 'Stripe Secret Key',
    fixUrl: 'https://dashboard.render.com/web/srv-*/env',
    docsUrl: 'https://dashboard.stripe.com/apikeys',
  },
  {
    key: 'NEXT_PUBLIC_APP_URL',
    label: 'App URL (NEXT_PUBLIC_APP_URL)',
    fixUrl: 'https://dashboard.render.com/web/srv-*/env',
    docsUrl: null,
  },
  {
    key: 'HMAC_SECRET',
    label: 'HMAC Secret',
    fixUrl: 'https://dashboard.render.com/web/srv-*/env',
    docsUrl: null,
  },
  {
    key: 'ADMIN_KEY',
    label: 'Admin Key (this page)',
    fixUrl: 'https://dashboard.render.com/web/srv-*/env',
    docsUrl: null,
  },
  {
    key: 'FITOS_KEY_SECRET',
    label: 'FitOS Encryption Secret (BYOK AES)',
    fixUrl: 'https://dashboard.render.com/web/srv-*/env',
    docsUrl: null,
    optional: true,
  },
  {
    key: 'DATABASE_URL',
    label: 'Database URL (Neon)',
    fixUrl: 'https://dashboard.render.com/web/srv-*/env',
    docsUrl: 'https://console.neon.tech',
  },
];

function buildEnvChecklist() {
  return ENV_VARS.map(v => ({
    key: v.key,
    label: v.label,
    present: !!process.env[v.key],
    optional: !!v.optional,
    fixUrl: v.fixUrl,
    docsUrl: v.docsUrl || null,
  }));
}

// ─── Main diagnostic runner ──────────────────────────────────────────────────

async function runDiagnostics() {
  const [sheets, youtube, postmark, anthropic, database] = await Promise.all([
    checkSheets(),
    checkYouTube(),
    checkPostmark(),
    checkAnthropic(),
    checkDatabase(),
  ]);
  const render = checkRenderMetadata();

  return {
    checkedAt: new Date().toISOString(),
    integrations: [sheets, youtube, postmark, anthropic, render, database],
    envVars: buildEnvChecklist(),
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// HTML page
router.get('/', requireAdminKey, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-diagnostics.html'));
});

// JSON API
router.get('/api', requireAdminKey, async (req, res) => {
  try {
    const data = await runDiagnostics();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
