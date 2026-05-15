// routes/history.js
// Owns: /history page serve + demo data config injection
// Does NOT own: Sheet API integration (Phase 5), auth, chart rendering

const express = require('express');
const path = require('path');
const fs = require('fs');
const { generateDemoHistory } = require('../lib/demo-history');

const router = express.Router();
const DEMO_MODE = process.env.DEMO_MODE !== 'false';

router.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'history.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const history = DEMO_MODE ? generateDemoHistory() : null;
  const config = JSON.stringify({ demoMode: DEMO_MODE, history });
  html = html.replace('__FITOS_CONFIG__', config);
  res.type('html').send(html);
});

module.exports = router;
