// routes/checkin.js
// Owns: /checkin page serve + config injection
// Does NOT own: Sheet write logic (checkins.js), auth, Drive upload (photos.js)

const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();

router.get('/', (req, res) => {
  // req.sheetId is set by resolveSheetMiddleware — per-coach or env fallback
  const HAS_SHEETS = !!(req.sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const htmlPath = path.join(__dirname, '..', 'public', 'checkin.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const config = JSON.stringify({ hasSheets: HAS_SHEETS });
  html = html.replace('__FITOS_CONFIG__', config);
  res.type('html').send(html);
});

module.exports = router;
