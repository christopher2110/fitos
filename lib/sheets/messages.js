// lib/sheets/messages.js
// Owns: Messages tab read/write — getMessages, appendMessage, markRead
// Does NOT own: HTTP handling, auth, raw Sheets API calls (those are in client.js)

const { getTabValues, appendRows } = require('./client');
const { google } = require('googleapis');
const { getAuth } = require('./client');

// Messages tab column indices (0-based)
// Timestamp | Sender | Message | Read | Thread
const COL = { TIMESTAMP: 0, SENDER: 1, BODY: 2, READ: 3, THREAD: 4 };

/**
 * Read all messages from the Messages tab, newest-first.
 * Optionally filter to messages since a given ISO timestamp.
 *
 * @param {string} sheetId   Google Sheet ID
 * @param {string} [since]   ISO timestamp — only return messages at or after this
 * @returns {Promise<Array<{id, timestamp, tsMs, sender, body, read, thread}>>}
 */
async function getMessages(sheetId, since) {
  const rows = await getTabValues(sheetId, 'Messages!A2:E1000');

  const sinceMs = since ? (new Date(since).getTime() || 0) : 0;

  const messages = rows
    .map((r, i) => {
      const ts = (r[COL.TIMESTAMP] || '').trim();
      if (!ts) return null;
      const tsMs = new Date(ts).getTime() || 0;
      if (sinceMs && tsMs < sinceMs) return null;
      return {
        id:        `msg-${i}`,
        timestamp: ts,
        tsMs,
        sender:    (r[COL.SENDER] || 'Coach').trim(),
        body:      (r[COL.BODY]   || '').trim(),
        read:      (r[COL.READ]   || '').trim().toUpperCase() === 'TRUE',
        thread:    (r[COL.THREAD] || '').trim(),
      };
    })
    .filter(Boolean);

  // Newest first
  return messages.sort((a, b) => b.tsMs - a.tsMs);
}

/**
 * Append a message to the Messages tab.
 * sender: 'Client' | 'Coach' | 'coach_agent'
 *
 * @param {string} sheetId
 * @param {string} body
 * @param {'Client'|'Coach'|'coach_agent'} [sender='Client']
 * @param {string} [thread]
 * @returns {Promise<void>}
 */
async function appendMessage(sheetId, body, sender = 'Client', thread = '') {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const row = [
    timestamp,  // 0 Timestamp
    sender,     // 1 Sender
    body,       // 2 Message
    'FALSE',    // 3 Read — new messages are unread
    thread,     // 4 Thread
  ];
  await appendRows(sheetId, 'Messages!A:E', [row]);
}

/**
 * Mark messages read on a given side ('client' marks read_by_client, 'coach' marks read).
 * Reads the full column, updates matching rows in-place.
 * Since the schema only has a single Read column, marking coach-read flips col 3 to TRUE
 * for all Coach-sent messages that the client has seen (side='client'),
 * or all Client-sent messages the coach has seen (side='coach').
 *
 * Simplified: marks ALL unread messages of the opposite sender as read.
 *
 * @param {string} sheetId
 * @param {'coach'|'client'} side  Which side just "read" the thread
 * @returns {Promise<void>}
 */
async function markRead(sheetId, side) {
  // Which sender's messages are we marking as read?
  // Coach opened thread → mark all Client messages as read
  // Client opened thread → mark all Coach messages as read
  const targetSender = side === 'coach' ? 'Client' : 'Coach';

  const rows = await getTabValues(sheetId, 'Messages!A2:E1000');
  if (!rows || rows.length === 0) return;

  const sheets = google.sheets({ version: 'v4', auth: getAuth() });

  // Build batch update requests for rows whose Read column is FALSE and sender matches
  const data = [];
  rows.forEach((r, i) => {
    const ts     = (r[COL.TIMESTAMP] || '').trim();
    const sender = (r[COL.SENDER]    || '').trim();
    const isRead = (r[COL.READ]      || '').trim().toUpperCase() === 'TRUE';
    if (!ts || isRead || sender !== targetSender) return;

    // Row index in sheet = i + 2 (header is row 1, data starts row 2)
    const sheetRow = i + 2;
    data.push({
      range: `Messages!D${sheetRow}`,
      values: [['TRUE']],
    });
  });

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data,
    },
  });

  // Purge cache so next read picks up the updates
  const { _cache } = require('./client');
  // _cache not exported — invalidation happens via appendRows cache purge
  // For markRead we can force a fresh read by bypassing cache on next call.
  // Since we can't access _cache directly, we use a workaround: call appendRows
  // with no rows (empty append harmlessly purges cache). Instead, just let TTL expire.
  // Acceptable: read cache is only 30s, marking read is best-effort.
}

/**
 * Count unread messages sent by a given sender.
 * Used for unread badge counts on coach dashboard.
 *
 * @param {string} sheetId
 * @param {'Client'|'Coach'} sender
 * @returns {Promise<number>}
 */
async function countUnread(sheetId, sender) {
  const rows = await getTabValues(sheetId, 'Messages!A2:E1000');
  if (!rows || rows.length === 0) return 0;
  return rows.filter(r => {
    const ts     = (r[COL.TIMESTAMP] || '').trim();
    const s      = (r[COL.SENDER]    || '').trim();
    const isRead = (r[COL.READ]      || '').trim().toUpperCase() === 'TRUE';
    return ts && s === sender && !isRead;
  }).length;
}

// Legacy compat — keeps existing calls working
async function sendMessage(sheetId, body, thread = '') {
  return appendMessage(sheetId, body, 'Client', thread);
}

module.exports = { getMessages, appendMessage, sendMessage, markRead, countUnread };
