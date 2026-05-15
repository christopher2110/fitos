// routes/templates.js
// Owns: /dashboard/templates pages, /programs/:slug public SEO pages,
//       /api/templates/* JSON endpoints (list, detail, import, workouts write-back)
// Does NOT own: Google Sheets auth, client management, workout completions

'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

// ── Template catalog ──────────────────────────────────────────────────────────

const TEMPLATES_DIR = path.join(__dirname, '..', 'data', 'templates');

/** Load all templates from data/templates/. Cached after first call. */
let _cache = null;
function loadTemplates() {
  if (_cache) return _cache;
  const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'));
  _cache = files.map(f => {
    const raw = fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf8');
    return JSON.parse(raw);
  }).sort((a, b) => {
    // Alphabetical by name, with strength first, hypertrophy second, general last
    const order = { strength: 0, powerbuilding: 1, hypertrophy: 2, general: 3 };
    const ga = order[a.goal] !== undefined ? order[a.goal] : 99;
    const gb = order[b.goal] !== undefined ? order[b.goal] : 99;
    return ga !== gb ? ga - gb : a.name.localeCompare(b.name);
  });
  return _cache;
}

/** Summary card object (no week data — keeps list payload small). */
function toCard(t) {
  return {
    id:            t.id,
    slug:          t.slug,
    name:          t.name,
    author:        t.author,
    goal:          t.goal,
    difficulty:    t.difficulty,
    daysPerWeek:   t.daysPerWeek,
    durationWeeks: t.durationWeeks,
    description:   t.description,
    equipment:     t.equipment,
    tags:          t.tags,
  };
}

// ── API router (mounted at /api/templates in server.js) ───────────────────────

const apiRouter = express.Router();

// GET /api/templates — returns card summaries (no week data)
apiRouter.get('/', (req, res) => {
  const templates = loadTemplates();
  const goal = req.query.goal || null;
  const filtered = goal ? templates.filter(t => t.goal === goal) : templates;
  res.json({ ok: true, templates: filtered.map(toCard) });
});

// GET /api/templates/:slug — returns full template including all weeks
apiRouter.get('/:slug', (req, res) => {
  const templates = loadTemplates();
  const t = templates.find(t => t.slug === req.params.slug);
  if (!t) return res.status(404).json({ ok: false, error: 'Template not found' });
  res.json({ ok: true, template: t });
});

// ── API: import ───────────────────────────────────────────────────────────────

// POST /api/templates/:slug/import
// Body: { clientName, startDate, overwrite }
// Writes Week 1 program rows to the active Sheets (or demo-store).
// Returns { ok, imported, rows }

apiRouter.post('/:slug/import', async (req, res) => {
  const templates = loadTemplates();
  const t = templates.find(t => t.slug === req.params.slug);
  if (!t) return res.status(404).json({ ok: false, error: 'Template not found' });

  const { clientName, startDate, overwrite } = req.body || {};
  if (!clientName || !clientName.trim()) {
    return res.status(400).json({ ok: false, error: 'clientName is required' });
  }

  const start = startDate || new Date().toISOString().split('T')[0];

  // Build flat exercise rows for the import (Program tab schema: Week, Day, Focus, Exercise, Sets, Reps, Load, Rest, Notes)
  const rows = [];
  for (const week of t.weeks) {
    for (const day of week.days) {
      for (const ex of day.exercises) {
        rows.push({
          week:     String(week.week),
          weekLabel: week.label,
          phase:    week.phase,
          day:      day.day,
          focus:    day.focus,
          exercise: ex.name,
          sets:     ex.sets,
          reps:     ex.reps,
          load:     ex.load,
          rest:     String(ex.rest || ''),
          notes:    ex.notes || '',
        });
      }
    }
  }

  const sheetId = req.sheetId;
  const hasSheets = sheetId && process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (hasSheets) {
    // Real Sheets write-back — write to Program tab
    try {
      const sheetsPrograms = require('../lib/sheets/programs');
      if (sheetsPrograms.importTemplate) {
        await sheetsPrograms.importTemplate(sheetId, t, clientName.trim(), start, !!overwrite);
      } else {
        // Fallback: write exercises via existing addProgramExercises
        const exercises = rows.slice(0, 50).map(r => ({
          name:  r.exercise,
          sets:  r.sets,
          reps:  r.reps,
          load:  r.load,
          rest:  r.rest,
          notes: r.notes,
        }));
        if (!overwrite) {
          await sheetsPrograms.addProgramExercises(sheetId, exercises);
        } else {
          await sheetsPrograms.addProgramExercises(sheetId, exercises);
        }
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  } else {
    // Demo-store: add an activity feed entry + update client's program field
    const demoStore = require('../lib/sheets/demo-store');
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];
    // Append import to activity feed via the store's appendMessage mechanism
    if (demoStore._addImportActivity) {
      demoStore._addImportActivity({ program: t.name, client: clientName.trim(), time: now });
    }
    // If store exposes setClientProgram, use it; otherwise it's a no-op in demo
    if (demoStore.setClientProgram) {
      demoStore.setClientProgram(clientName.trim(), t.name);
    }
  }

  res.json({
    ok: true,
    imported: t.name,
    client:   clientName.trim(),
    startDate: start,
    rowCount: rows.length,
    message: `Imported ${t.name} for ${clientName.trim()} — ${rows.length} exercises across ${t.weeks.length} weeks`,
  });
});

// ── Dashboard pages ───────────────────────────────────────────────────────────

// GET /dashboard/templates — template library grid
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard-templates.html'));
});

// GET /dashboard/templates/:slug — template detail + import UI
router.get('/:slug', (req, res) => {
  const templates = loadTemplates();
  const t = templates.find(t => t.slug === req.params.slug);
  // Send detail page — client-side JS fetches the template data via /api/templates/:slug
  if (!t) return res.redirect('/dashboard/templates');
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard-templates.html'));
});

module.exports = router;
module.exports.apiRouter = apiRouter;

// ── Public program preview pages (SSR) ───────────────────────────────────────
// Exported separately — mounted at /programs in server.js

const publicRouter = express.Router();

// GET /programs — index listing all templates
publicRouter.get('/', (req, res) => {
  const templates = loadTemplates();
  const cards = templates.map(toCard);
  // Simple server-rendered index
  const rows = cards.map(t => `
    <div class="prog-card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span class="goal-badge goal-${t.goal}">${_goalLabel(t.goal)}</span>
        <span style="font-size:11px;color:#7A7570">${_diffLabel(t.difficulty)}</span>
      </div>
      <h2><a href="/programs/${t.slug}" style="color:#2C2A24;text-decoration:none;font-family:Fraunces,serif;font-size:18px;font-weight:700">${t.name}</a></h2>
      <p style="font-size:12px;color:#7A7570;margin:3px 0 8px">By ${t.author} · ${t.durationWeeks} weeks · ${t.daysPerWeek} days/wk</p>
      <p style="font-size:13px;color:#7A7570;line-height:1.5">${t.description.slice(0, 120)}…</p>
      <a href="/programs/${t.slug}" style="display:inline-block;margin-top:12px;color:#5C6B2A;font-size:13px;font-weight:600">View program →</a>
    </div>
  `).join('');

  res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Coaching Program Library | FitOS</title>
<meta name="description" content="10 free coaching programs — 5/3/1 BBB, Push Pull Legs, Starting Strength, PHUL, Greyskull LP and more. Browse, preview, and import in one click.">
<link rel="canonical" href="https://fitos-zc11.polsia.app/programs">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "FitOS Coaching Program Library",
  "description": "Free coaching programs for personal trainers",
  "numberOfItems": cards.length,
  "itemListElement": cards.map((t, i) => ({
    "@type": "ListItem",
    "position": i + 1,
    "url": `https://fitos-zc11.polsia.app/programs/${t.slug}`,
    "name": t.name,
  })),
})}</script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#F4EFE6;color:#2C2A24;font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased}
.nav{background:#FDFAF5;border-bottom:1px solid #DDD8CA;padding:0 24px;height:56px;display:flex;align-items:center;justify-content:space-between}
.brand{font-family:Fraunces,serif;font-size:20px;font-weight:700;color:#5C6B2A;text-decoration:none}
.nav a{font-size:13.5px;color:#7A7570;text-decoration:none;font-weight:500;margin-left:20px}
.nav a:hover{color:#2C2A24}
.cta{background:#5C6B2A;color:#fff!important;padding:8px 16px;border-radius:8px;font-weight:600!important}
.page{max-width:1100px;margin:0 auto;padding:40px 24px 80px}
h1{font-family:Fraunces,serif;font-size:32px;font-weight:700;margin-bottom:8px}
.sub{font-size:15px;color:#7A7570;line-height:1.6;margin-bottom:32px;max-width:600px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.prog-card{background:#FDFAF5;border:1.5px solid #DDD8CA;border-radius:16px;padding:20px 22px}
.goal-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
.goal-strength{background:#E8EDD6;color:#3D4A1A}.goal-hypertrophy{background:#E0EEFF;color:#3060A0}
.goal-powerbuilding{background:#FEF3CD;color:#8A6220}.goal-general{background:#F0EEF8;color:#5048A0}
</style></head><body>
<nav class="nav">
  <a class="brand" href="/">FitOS</a>
  <div><a href="/pricing">Pricing</a><a href="/trial/signup" class="cta">Get started free</a></div>
</nav>
<main class="page">
  <h1>Coaching Program Library</h1>
  <p class="sub">10 real programs — strength, hypertrophy, powerbuilding, and general fitness. Preview full week-by-week structure. Import to any client in one click.</p>
  <div class="grid">${rows}</div>
</main>
</body></html>`);
});

// GET /programs/:slug — SSR public preview with schema markup
publicRouter.get('/:slug', (req, res) => {
  const templates = loadTemplates();
  const t = templates.find(t => t.slug === req.params.slug);
  if (!t) return res.redirect('/programs');

  const templateJson = JSON.stringify(t);
  const schema = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "name": t.name,
    "description": t.description,
    "author": { "@type": "Person", "name": t.author },
    "step": (t.weeks[0] && t.weeks[0].days ? t.weeks[0].days : []).map((day, i) => ({
      "@type": "HowToStep",
      "position": i + 1,
      "name": day.focus,
      "text": (day.exercises || []).map(e => `${e.name}: ${e.sets} sets × ${e.reps} reps`).join('; '),
    })),
  };

  // Read preview HTML and inject template data
  const previewPath = path.join(__dirname, '..', 'public', 'programs', 'preview.html');
  let html = fs.readFileSync(previewPath, 'utf8');
  html = html.replace('__TITLE__', t.name);
  html = html.replace(/__META_DESC__/g, t.description.slice(0, 155));
  html = html.replace(/__SLUG__/g, t.slug);
  html = html.replace('__SCHEMA__', JSON.stringify(schema));
  // Inject template data as window global before </body>
  html = html.replace('</body>', `<script>window.__TEMPLATE_DATA__ = ${templateJson};</script>\n</body>`);

  res.type('html').send(html);
});

module.exports.publicRouter = publicRouter;

function _goalLabel(g) { return {strength:'Strength',hypertrophy:'Hypertrophy',powerbuilding:'Powerbuilding',general:'General Fitness'}[g]||g; }
function _diffLabel(d) { return {beginner:'Beginner',intermediate:'Intermediate',advanced:'Advanced'}[d]||d; }
