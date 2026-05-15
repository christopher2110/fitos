// routes/checkins.js
// Owns: POST /api/checkins — validates payload, uploads photo to Drive, writes to Sheets
// Does NOT own: auth, Sheet schema, Drive folder structure (those are in lib/)

const express = require('express');
const { recordCheckIn } = require('../lib/sheets/checkins');
const { uploadPhoto } = require('../lib/drive/photos');
const demoStore = require('../lib/sheets/demo-store');

const router = express.Router();

// POST /api/checkins
// Body: { sleep, energy, soreness, stress, bodyweight, bwUnit, notes, date, photo?, measurements? }
// photo: { data: "data:image/jpeg;base64,...", filename: "..." }
// measurements: { waist, hip, chest, larm, rarm, lthigh, rthigh } — all in cm, all optional
router.post('/', async (req, res) => {
  // req.sheetId is set by resolveSheetMiddleware — per-coach or env fallback
  const SHEET_ID = req.sheetId;
  const HAS_SHEETS = !!SHEET_ID && !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  const { sleep, energy, soreness, stress, bodyweight, bwUnit, notes, date, photo, measurements } = req.body || {};

  // ── Validate numeric 1–10 fields ─────────────────────────────────────────
  const scoreFields = { sleep, energy, soreness, stress };
  for (const [field, val] of Object.entries(scoreFields)) {
    if (val !== null && val !== undefined) {
      const n = Number(val);
      if (isNaN(n) || n < 1 || n > 10) {
        return res.status(400).json({ error: `${field} must be 1–10 or null` });
      }
    }
  }

  if (bodyweight !== null && bodyweight !== undefined) {
    const bw = Number(bodyweight);
    if (isNaN(bw) || bw <= 0) {
      return res.status(400).json({ error: 'bodyweight must be a positive number' });
    }
  }

  // ── Normalise bodyweight to kg ────────────────────────────────────────────
  let bodweightKg = bodyweight !== null && bodyweight !== undefined
    ? Number(bodyweight)
    : null;
  if (bodweightKg !== null && bwUnit === 'lb') {
    bodweightKg = Math.round(bodweightKg * 0.453592 * 10) / 10;
  }

  // ── Demo mode — no Sheet credentials ────────────────────────────────────
  if (!HAS_SHEETS) {
    // Persist to in-memory store so the checkin is visible in results/history
    const result = demoStore.appendCheckIn({
      date, sleep, energy, soreness, stress,
      bodyweight: bodweightKg, notes, measurements,
    });
    return res.json({ persisted: true, rowId: result.rowId, demo: true });
  }

  try {
    // ── Drive photo upload ──────────────────────────────────────────────────
    let photoUrl = null;
    if (photo && photo.data) {
      // data is a data URL: "data:image/jpeg;base64,..."
      const match = photo.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: 'photo.data must be a base64 data URL' });
      }
      const mimeType = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      const filename = photo.filename || `checkin-${date || 'photo'}.jpg`;
      // clientId defaults to 'client' when not multi-tenant
      const clientId = req.body.clientId || 'client';
      photoUrl = await uploadPhoto(buffer, mimeType, filename, clientId);
    }

    // ── Sheets write ────────────────────────────────────────────────────────
    await recordCheckIn(SHEET_ID, {
      date: date || new Date().toISOString().split('T')[0],
      sleep:        sleep  !== undefined ? Number(sleep)  : null,
      energy:       energy !== undefined ? Number(energy) : null,
      soreness:     soreness !== undefined ? Number(soreness) : null,
      stress:       stress !== undefined ? Number(stress) : null,
      bodyweight:   bodweightKg,
      notes:        notes || '',
      photoUrl,
      measurements: measurements || {},
    });

    return res.json({ persisted: true, rowId: null });
  } catch (err) {
    console.error('[checkins] write failed:', err.message);
    return res.status(500).json({ error: 'Sheet write failed' });
  }
});

module.exports = router;
