# FitOS — Open-Source Coaching OS

> **Run your coaching business from a Google Sheet you own. Deploys in one click. MIT licensed. Yours forever.**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Polsia-Inc/fitos)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**[Live Demo](https://fitos-zc11.polsia.app/demo)** · **[Pricing](https://fitos-zc11.polsia.app/pricing)** · **[Self-Hosting Guide](docs/self-hosting.md)**

---

## Why coaches switch to FitOS

| | Trainerize | FitOS |
|---|---|---|
| **5-year cost** | ~$14,940 | $497 one-time |
| **Data ownership** | Vendor-locked | Your Google Sheet |
| **License** | Proprietary | MIT — fork it, own it |
| **AI agents** | Add-on fees | BYOK Anthropic, zero platform tax |
| **Self-host option** | No | Yes — one-click deploy |

---

## What's in the box

A full coaching OS — not a CRM, not just a workout app.

- **Coach dashboard** — KPI board, 20-event activity feed, sortable client table
- **Client PWA** — installable on iPhone/Android, works offline, no App Store needed
- **Workout delivery** — program builder, daily workout view with video demos, per-set logging
- **Weekly check-ins** — bodyweight, wellness score (1–10), 7 circumferences, progress photos
- **Results trends** — 90-day bodyweight, 30-day wellness, 12-week lift progression charts
- **AI agent skills** — drop a folder into `/skills/`, it hot-loads. BYOK Anthropic key, no platform cut
- **Google Sheets sync** — completions, check-ins, messages write back to your Sheet in ~2s

---

## Deploy in 4 steps

**Step 1 — Click Deploy to Render**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Polsia-Inc/fitos)

This forks the repo into your GitHub and sets up a free Render web service. Required env vars:

| Env Var | What it is |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string — [free at neon.tech](https://neon.tech) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Full JSON from your GCP service account (single line — see ⚠️ below) |
| `COACH_SHEET_ID` | Google Sheet ID from the Sheet URL |
| `FITOS_KEY_SECRET` | Any 32+ char random string for AES-256-GCM encryption |

Optional (add later, app works without them):

| Env Var | What it unlocks |
|---|---|
| `ANTHROPIC_API_KEY` | BYOK fallback for AI skills (stored per-coach in Sheet, this is a server default) |
| `YOUTUBE_API_KEY` | Exercise Video Finder — searches trusted channels for demo videos |
| `POSTMARK_TOKEN` | Transactional email (trial drip, magic links) |

**Step 2 — Create a Google Sheet**

Run the provisioner script once — it creates all 9 tabs with demo data:

```bash
node scripts/provision-demo-sheet.js
# Prints: SHEET_ID=1BxiMV...
```

Or use the guided wizard at `/onboarding` after deploy.

**Step 3 — Import your clients**

Go to `/dashboard/import` → upload a CSV from Trainerize, TrueCoach, or any generic export. The importer maps your columns to FitOS Sheets format automatically.

**Step 4 — Invite clients to the PWA**

Each client gets a magic-link URL (no password). Open it on their phone → Install to Home Screen → done. Your coaching app, your domain, zero App Store friction.

---

## ⚠️ GOOGLE_SERVICE_ACCOUNT_KEY — the #1 deploy issue

Paste the JSON as a **single-line string** in Render. The raw file has real newlines in `"private_key"` — those break JSON parsing.

```bash
# Mac / Linux — convert to single line before pasting
cat your-service-account-key.json | tr -d '\n'
```

Symptom when broken: dashboard shows demo data; logs show `SyntaxError: Unexpected token`.

Full setup walkthrough: **[docs/self-hosting.md](docs/self-hosting.md)**

---

## Run locally in 3 commands

```bash
git clone https://github.com/Polsia-Inc/fitos && cd fitos
npm install
DATABASE_URL="postgresql://..." npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Demo mode works without any env vars — just open it.

See **[.env.example](.env.example)** for all available env vars.

---

## Screenshots

| Coach Dashboard | Client Workout View |
|---|---|
| ![Coach dashboard](https://fitos-zc11.polsia.app/public/screenshots/dashboard.png) | ![Client PWA workout screen](https://fitos-zc11.polsia.app/public/screenshots/workout.png) |

| AI Program Builder | Results & Trends |
|---|---|
| ![AI Program Builder](https://fitos-zc11.polsia.app/public/screenshots/builder.png) | ![Results charts](https://fitos-zc11.polsia.app/public/screenshots/results.png) |

> Live app: **https://fitos-zc11.polsia.app** — hit Demo to explore without a Sheet.

---

## Adding an AI Skill

Drop a folder into `/skills/` — no code changes needed:

```
skills/
└── deload-detector/
    ├── manifest.json   ← metadata, model, inputs, outputs
    └── system.md       ← instructions the AI follows
```

Scan and enable in settings:
```bash
npm run skills:scan
# Then: /settings/agents → toggle Enabled
```

Full authoring guide: [docs/agents](https://fitos-zc11.polsia.app/docs/agents)

---

## Architecture

```
Browser (PWA — installable, offline-first)
    │
    ▼
Node.js / Express  (server.js — wiring only, ≤300 lines)
    ├── routes/         — one Router per feature group
    ├── db/             — pg queries, Pool singleton in db/index.js
    ├── lib/sheets/     — Google Sheets API layer (multi-tenant)
    ├── lib/skills/     — Anthropic BYOK agent runner
    └── services/       — cron (email drip, agent scheduler)
    │
    ├── Google Sheets   ← canonical client state (per coach)
    ├── Google Drive    ← progress photo storage
    ├── Neon / Postgres ← coach accounts, trial state, tenant routing
    └── Anthropic       ← BYOK — coach's encrypted key, used only at skill run time
```

---

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)**. Good first issues labeled in the repo.

## License

MIT — see [LICENSE](LICENSE). Use it, fork it, white-label it. You own the software.

---

*Built with Google Sheets, Express.js, and Anthropic. Hosted at https://fitos-zc11.polsia.app*
