// routes/messages.js
// Owns: /messages page + messages API (list, send, mark-read, unread-count)
// Does NOT own: Sheet auth, message threading logic (those are in lib/sheets/messages.js)

const express = require('express');
const path = require('path');
const fs = require('fs');
const { getMessages, appendMessage, sendMessage, markRead, countUnread } = require('../lib/sheets/messages');
const demoStore = require('../lib/sheets/demo-store');

const router = express.Router();


// ── Legacy client endpoints (kept for PWA backward-compat) ────────────────────

// GET /messages/api/list — returns messages array (newest first)
router.get('/api/list', async (req, res) => {
  // req.sheetId is set by resolveSheetMiddleware — per-coach or env fallback
  const SHEET_ID = req.sheetId;
  const HAS_SHEETS = !!SHEET_ID && !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!HAS_SHEETS) {
    // Demo mode — return fixture messages so the PWA is functional
    const since = req.query.since || null;
    return res.json({ messages: demoStore.getMessages(since), needsSetup: false, demo: true });
  }
  try {
    const since = req.query.since || null;
    const messages = await getMessages(SHEET_ID, since);
    return res.json({ messages, demo: false });
  } catch (err) {
    console.error('[messages] read failed:', err.message);
    return res.json({ messages: [], demo: false, error: 'sheet_read_failed' });
  }
});

// POST /messages/api/send — appends a client message to the Messages tab
// Body: { body: string, thread?: string }
router.post('/api/send', async (req, res) => {
  const { body, thread } = req.body || {};
  if (!body || typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ error: 'body is required' });
  }
  if (body.trim().length > 2000) {
    return res.status(400).json({ error: 'message too long (max 2000 chars)' });
  }

  const SHEET_ID = req.sheetId;
  const HAS_SHEETS = !!SHEET_ID && !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!HAS_SHEETS) {
    // Demo mode — persist to in-memory store
    demoStore.appendMessage(body.trim(), 'client');
    return res.json({ persisted: true, demo: true });
  }

  try {
    await sendMessage(SHEET_ID, body.trim(), thread || '');
    return res.json({ persisted: true });
  } catch (err) {
    console.error('[messages] write failed:', err.message);
    return res.status(500).json({ error: 'Sheet write failed' });
  }
});

// ── New unified API (used by coach dashboard) ─────────────────────────────────

// GET /messages/api/messages?since=<iso>  — thread list for dashboard
router.get('/api/messages', async (req, res) => {
  const SHEET_ID = req.sheetId;
  const HAS_SHEETS = !!SHEET_ID && !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!HAS_SHEETS) {
    // Demo mode — return fixture messages with realistic unread count
    const since = req.query.since || null;
    return res.json({ messages: demoStore.getMessages(since), needsSetup: false, demo: true, unreadCount: 2 });
  }
  try {
    const since = req.query.since || null;
    const [messages, unreadCount] = await Promise.all([
      getMessages(SHEET_ID, since),
      countUnread(SHEET_ID, 'Client'),
    ]);
    return res.json({ messages, demo: false, unreadCount });
  } catch (err) {
    console.error('[messages] api/messages read failed:', err.message);
    return res.json({ messages: [], demo: false, unreadCount: 0, error: 'sheet_read_failed' });
  }
});

// POST /messages/api/messages — append from either side
// Body: { body: string, sender?: 'Client'|'Coach', thread?: string }
router.post('/api/messages', async (req, res) => {
  const { body, sender, thread } = req.body || {};
  if (!body || typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ error: 'body is required' });
  }
  if (body.trim().length > 2000) {
    return res.status(400).json({ error: 'message too long (max 2000 chars)' });
  }

  const safeSender = (sender === 'Coach' || sender === 'Client') ? sender : 'Client';

  const SHEET_ID = req.sheetId;
  const HAS_SHEETS = !!SHEET_ID && !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!HAS_SHEETS) {
    // Demo mode — persist to in-memory store
    demoStore.appendMessage(body.trim(), safeSender === 'Coach' ? 'coach' : 'client');
    return res.json({ persisted: true, demo: true, sender: safeSender });
  }

  try {
    await appendMessage(SHEET_ID, body.trim(), safeSender, thread || '');
    return res.json({ persisted: true, sender: safeSender });
  } catch (err) {
    console.error('[messages] api/messages write failed:', err.message);
    return res.status(500).json({ error: 'Sheet write failed' });
  }
});

// POST /messages/api/mark-read — mark thread messages as read for a given side
// Body: { side: 'coach'|'client' }
router.post('/api/mark-read', async (req, res) => {
  const { side } = req.body || {};
  if (side !== 'coach' && side !== 'client') {
    return res.status(400).json({ error: 'side must be coach or client' });
  }

  const SHEET_ID = req.sheetId;
  const HAS_SHEETS = !!SHEET_ID && !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!HAS_SHEETS) {
    return res.json({ ok: true, demo: true });
  }
  try {
    await markRead(SHEET_ID, side);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[messages] mark-read failed:', err.message);
    // Non-fatal — don't 500, just report
    return res.json({ ok: false, error: err.message });
  }
});

// GET /messages/api/unread — count of unread client messages (for dashboard badge)
router.get('/api/unread', async (req, res) => {
  const SHEET_ID = req.sheetId;
  const HAS_SHEETS = !!SHEET_ID && !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!HAS_SHEETS) {
    // Demo mode — return realistic unread count
    return res.json({ count: 2, demo: true });
  }
  try {
    const count = await countUnread(SHEET_ID, 'Client');
    return res.json({ count, demo: false });
  } catch (err) {
    return res.json({ count: 0, error: err.message });
  }
});

// GET /messages — serve the client PWA page
router.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'messages.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  res.type('html').send(html);
});

module.exports = router;
