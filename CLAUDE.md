# FitOS

## What this app does
FitOS is a coaching management system for personal trainers. A Google Sheet acts as canonical state for each client (workouts, check-ins, wellness, KPIs). A PWA lets coaches and clients interact with their Sheet on any device.

## Stack
Express.js + PostgreSQL (Render/Neon) for app server. Python + Google Sheets API for Sheet provisioning scripts. Vanilla JS PWA served from /public.

## Directory map
- `server.js` — Express entry point, health check, route mounts, static file serving
- `migrate.js` — Migration runner (executes migrations/ at startup)
- `migrations/` — DDL migrations (node-pg-migrate style, timestamped)
- `db/` — pg query functions, one file per entity; only place that constructs Pool
- `lib/` — Shared utilities: demo-history.js, mockCoachData.js, sheets/, drive/, skills/, trial.js, email/
- `lib/email/` — Email proxy wrapper (sender.js) and drip HTML templates (templates.js)
- `services/` — Background services: email-drip.js (trial drip cron, unsubscribe tokens)
- `lib/trial.js` — Trial middleware: expiry check, banner injection (≤3 days), status transitions
- `lib/sheets/` — Google Sheets API layer: client.js (auth + cache), middleware.js (multi-tenant sheetId resolution), clients.js (Clients tab CRUD), workouts.js, checkins.js, messages.js, programs.js (Program tab CRUD), video-finder.js (Exercise Video Finder runner), provision.js (one-shot demo sheet creation — all 9 tabs + demo data)
- `lib/drive/` — Google Drive API layer: photos.js (upload progress photos)
- `lib/skills/` — Claude skill layer: scanner.js (skill discovery), runner.js (Anthropic call + Sheet write), keystore.js (AES-256-GCM key storage in Profile tab); `lib/youtube.js` — YouTube Data API v3 search helper (no deps)
- `lib/sheets/exercises.js` — Exercises tab CRUD: list, add, update, delete exercises; trusted YouTube channels read/write (stored in Profile tab)
- `lib/openai-runner.js` — OpenAI Assistants BYOK runner: key encrypt/decrypt, scope builder, Assistants API calls, Sheet write-back
- `skills/` — Skill folders (manifest.json + system.md each); drop new folders to add skills
- `data/` — Static JSON data files; `data/templates/` holds 10 coaching program templates (531-bbb, push-pull-legs, starting-strength, phul, greyskull-lp, nsuns-531, rp-hypertrophy-male, full-body-3x, bodyweight-home, glute-hypertrophy) — each with full week-by-week structure, exercises, sets/reps/RPE
- `routes/` — Express Router modules, one file per route group (workouts, history, checkin, messages, dashboard, clients, completions, checkins, agents, custom-agents, exercises, trial, payment, setup, onboarding, programs, builder, demo, referral, admin-diagnostics, stats, templates)
- `db/agents.js` — imported_agents + agent_runs query functions
- `db/referrals.js` — referrals table CRUD + stats aggregation
- `lib/demo-fixture.js` — Static in-memory fixture data for /demo (3 clients, workouts, check-ins, AI outputs, program)
- `lib/sheets/demo-store.js` — In-memory write store for QA mode (no GCP); seeded from demo-fixture.js; supports list/add clients, send messages, submit check-ins
- `schemas/` — JSON schema definitions (declarative, no code changes needed for new tabs/columns)
- `scripts/` — Standalone Node.js + Python utilities; provision-demo-sheet.js creates demo Sheet with all tabs + data
- `docs/` — Setup guides: sheets-setup.md (service account creation, sharing model, env vars)
- `public/` — Static PWA assets (HTML, CSS, JS, manifest, service worker)

## Database
- `coaches` — trial accounts: access_token, email, name, password_hash (PBKDF2 for self-signup), referral_code (unique 8-char, generated at signup), sheet_id (connected Google Sheet, set via /setup or /onboarding/sheet), byok_creds_enc (AES-256-GCM encrypted BYOK service-account JSON), onboarding_path (polsia/byok), onboarding_completed_at, status (trial/expired/converted), trial_expires_at, trial_expired_at, converted_at, purchased_at (set on Stripe payment verification), trial_email_sent_at (JSONB tracking which drip steps fired)
- `referrals` — coach-to-coach referral records: referrer_coach_id, referred_coach_id, referral_code, status (pending/converted/paid), reward_amount ($197), created_at, converted_at, paid_at
- `imported_agents` — OpenAI assistants imported by coaches: assistant_id, openai_key_enc (AES-256-GCM), granted_scopes (JSONB), run_mode, schedule, archived
- `agent_runs` — audit log of every agent run: status, trigger, inputs_json, output_text, tools_called, usage_json, started_at, finished_at
- `deploy_events` — self-hosted deploy counter for landing page social proof: event_type (deploy_started), metadata JSONB, occurred_at
- `site_events` — traffic + conversion tracker: event (page_view/cta_click/checkout_start), page, source, session_id, created_at
- `email_suppressions` — email bounce/spam suppression list: email, reason (bounce/spam_complaint/inactive/manual), source (postmark_webhook/seed/admin), suppressed_at

## External integrations
- Google Sheets API — multi-tenant: each coach's `sheet_id` is stored in `coaches` table (set via /setup wizard); `lib/sheets/middleware.js` resolves per-request; falls back to `COACH_SHEET_ID` env (legacy) or demo mode
- Google Drive API — (1) Sheet creation via fitos_sheet_builder.py; (2) progress photo upload via lib/drive/photos.js using same service account (`DRIVE_PHOTOS_PARENT_FOLDER_ID` optional — uploads to Drive root if unset)
- Anthropic API — BYOK; coach's key stored AES-256-GCM encrypted in Profile tab; accessed only at skill run time; never logged; `FITOS_KEY_SECRET` env var sets the encryption secret (falls back to dev default if unset)
- OpenAI Assistants API — BYOK (separate per coach); key stored AES-256-GCM in `imported_agents.openai_key_enc` (same FITOS_KEY_SECRET encryption); executed via lib/openai-runner.js
- Stripe — $497 lifetime license payment link (https://buy.stripe.com/eVq9ATbHdeUz6AA4v6fAc01); verified via Polsia API at /payment/success; success_url redirects to /payment/success?checkout_session_id={CHECKOUT_SESSION_ID}
- YouTube Data API v3 — `YOUTUBE_API_KEY` env var (server-side); used by Exercise Video Finder skill to search trusted channels for exercise demo videos; 10,000 quota units/day (100 units/search)

## Recent changes
- 2026-05-14: Task #1532940 — SEO meta + OG cards: complete title/description/canonical/og/twitter tags on /, /trial, /vs, /vs/truecoach, /vs/trainerize, /vs/everfit, /programs/*; 6 branded SVG OG cards in public/og/ (home, trial, vs-hub, vs-truecoach, vs-trainerize, vs-everfit, programs).
- 2026-05-14: Task #1532938 — Email suppression list: email_suppressions table (migration); db/email-suppressions.js (isSuppressed/suppress); sender.js checks suppression before every send; routes/email-webhook.js handles Postmark bounce+spam_complaint events at POST /api/email/webhook; 5 known-inactive addresses seeded.
- 2026-05-14: Task #1577465 — Traffic + conversion tracker: site_events table (page_view/cta_click/checkout_start); POST /api/track pixel; GET /dashboard/analytics (unique sessions, top pages, CTA clicks, checkout starts, 7-day sparkline); tracking snippet on homepage/pricing/vs/trial-signup pages; routes/analytics.js + db/site-events.js.
- 2026-05-14: Task #1553430 — Stripe checkout wired: /pricing page (public/pricing.html) with $497 lifetime CTA → buy.stripe.com; /payment/success verifies via Polsia API + flips coaches.status='converted' + sets purchased_at; dashboard sidebar "Upgrade — $497 →" nav link added; trial banner CTA unified to /pricing.
- 2026-05-13: Task #1532895 — /dashboard/connect-sheet wizard: public/dashboard-connect-sheet.html (4-step: create from template → share with service account → paste URL → verify); GET /dashboard/connect-sheet added to routes/dashboard.js (redirects to /dashboard if sheet_id already set); GET /api/setup/template-info added to routes/setup.js (returns template copy URL from FITOS_TEMPLATE_SHEET_ID env); dashboard auto-redirect changed from /onboarding/sheet to /dashboard/connect-sheet; setup-banner CTA updated to point to /dashboard/connect-sheet.
