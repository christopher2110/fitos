# Contributing to FitOS

FitOS is MIT licensed and actively welcoming contributors. The bar is simple: run it locally, build something real, open a PR.

---

## Running Locally

```bash
git clone https://github.com/Polsia-Inc/fitos && cd fitos
npm install
cp .env.example .env   # fill in DATABASE_URL at minimum
npm run dev
```

`http://localhost:3000` opens in demo mode — no Google Sheet needed to explore the UI.

For full Sheets integration, follow the setup in **[docs/self-hosting.md](docs/self-hosting.md)**.

---

## Project Structure

```
server.js          — wiring only (≤300 lines): middleware, route mounts, app.listen
routes/            — one Express Router per feature group
db/                — pg query functions; only place that constructs Pool
lib/sheets/        — Google Sheets API layer
lib/skills/        — Anthropic BYOK agent runner
skills/            — built-in agent skill folders (manifest.json + system.md)
services/          — cron jobs (email drip)
migrations/        — DDL only, timestamped SQL files
public/            — static PWA assets
```

**Where new code goes:**
- New route group → `routes/<name>.js` + mount in `server.js`
- New DB query → `db/<entity>.js`
- New scheduled work → `services/<name>.js`
- New agent skill → `skills/<name>/manifest.json` + `skills/<name>/system.md`

---

## Proposing a New Agent Skill

The fastest way to contribute. Skills require no Node.js:

1. Create `skills/<your-skill-name>/`
2. Write `manifest.json` (see README for schema)
3. Write `system.md` (the Claude prompt)
4. Open a PR — include a short description of what data the skill reads and what it writes

Good skill ideas: injury risk flagging, nutrition adherence summary, plateau detection, strength standard benchmarks, periodization planner.

---

## PR Conventions

- **One concern per PR.** A skill PR adds a skill. A bug fix fixes the bug. Don't bundle.
- **No new code in `server.js` beyond route mounts.** Hard limit: 300 lines.
- **DB queries live in `db/`.** No `pool.query()` in routes or anywhere else.
- **Schema changes via migration files.** Never DDL in runtime code.
- **Test locally before opening.** If you can't test it, say why in the PR description.

---

## Code of Conduct

Be direct, be constructive, don't be cruel. Feedback on the code is always fair. Feedback on the person is not. Issues and PRs that are hostile get closed.

---

## Good First Issues

Search for the `good first issue` label. Current candidates:
- **Spanish translation** — `/public/*.html`, nav labels, toast messages
- **New agent skill: PR prediction** — reads last 4 weeks of lifts, projects next 4
- **Mobile calendar UX** — swipe gesture for month navigation on the calendar view

Questions? Open an issue or ping in the live demo chat.
