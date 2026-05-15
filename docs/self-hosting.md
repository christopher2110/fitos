# Self-Hosting FitOS

This guide gets you from zero to a running FitOS instance with your own Google Sheet. Plan for 30 minutes.

**Prerequisites:** A Google account, a GitHub account, and a credit card for Render (free tier works fine).

---

## Step 1 — Create a Neon Database (free)

1. Go to [neon.tech](https://neon.tech) and create a free account.
2. Create a new project → give it any name (e.g., "fitos").
3. Copy the connection string from the **Connection Details** panel. It looks like:
   ```
   postgresql://neondb_owner:abc123@ep-something.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   Save it — you'll need it for `DATABASE_URL`.

---

## Step 2 — Set Up a Google Service Account

FitOS reads and writes your Google Sheet using a service account (a bot with its own Google identity).

### 2a. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Click **Select a project → New Project**. Name it "FitOS". Click **Create**.
3. Enable APIs: go to **APIs & Services → Library** and enable:
   - **Google Sheets API**
   - **Google Drive API**

### 2b. Create the service account

1. Go to **APIs & Services → Credentials → Create Credentials → Service account**.
2. Name: `fitos-reader`. Description: "FitOS Sheets access". Click **Done** (no role needed).
3. Click the new service account in the list → **Keys → Add Key → Create new key → JSON**.
4. Download the JSON file. **Keep it safe — treat it like a password.**

### 2c. Note the service account email

Open the downloaded JSON file. Look for `"client_email"` — it looks like:
```
fitos-reader@your-project.iam.gserviceaccount.com
```
Save this email. You'll share each client Sheet with it.

---

## Step 3 — Create Your Google Sheet

FitOS ships with a Python script that creates a properly structured Sheet. If you already have a Sheet set up with the right tabs, skip to Step 4.

```bash
cd scripts
pip install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client
python fitos_sheet_builder.py \
  --coach-email your@email.com \
  --client-name "Jane Doe"
```

A browser window will open for Google auth. After auth, the script prints the **Sheet ID** — the long string in the Sheet URL. Copy it.

**Share the Sheet with your service account:**
1. Open the Sheet → **Share**.
2. Add the service account email from Step 2c as **Viewer**.
3. Uncheck "Notify people" (it's a bot) → **Share**.

---

## Step 4 — Deploy to Render

### Option A: One-click button (easiest)

Click this button — it forks the repo into your GitHub and sets up Render:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Polsia-Inc/fitos)

Render will prompt for env vars. Fill in:

| Var | Value |
|---|---|
| `DATABASE_URL` | Connection string from Step 1 |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Entire JSON file contents (see ⚠️ below) |
| `COACH_SHEET_ID` | Sheet ID from Step 3 |
| `FITOS_KEY_SECRET` | Any random 32+ character string |

### Option B: Manual Render setup

1. Fork [github.com/Polsia-Inc/fitos](https://github.com/Polsia-Inc/fitos).
2. Go to [render.com](https://render.com) → **New → Web Service → Connect Repository**.
3. Select your fork. Render detects the `render.yaml` and configures automatically.
4. Add env vars in **Environment** (same table as Option A above).
5. Click **Create Web Service**.

---

## ⚠️ GOOGLE_SERVICE_ACCOUNT_KEY Footgun

This is the #1 support issue. The key JSON needs to be pasted as a **single-line string** in Render's env var editor. The raw JSON file has newlines — specifically in `"private_key"`.

**How to convert it (Mac/Linux):**
```bash
cat your-service-account-key.json | tr -d '\n'
```

**Or in Python:**
```python
import json
with open('your-key.json') as f:
    print(json.dumps(json.load(f)))
```

Paste the output as the value of `GOOGLE_SERVICE_ACCOUNT_KEY`. If it still fails, check that the private key's `\n` sequences are literal `\n` (two chars) not real newlines.

**Symptom when broken:** Dashboard shows demo data. Logs show `SyntaxError: Unexpected token` when parsing the service account key.

---

## Step 5 — Point Your Domain (Optional)

1. In Render dashboard → your service → **Settings → Custom Domains**.
2. Add your domain (e.g., `app.yourcoachingbusiness.com`).
3. Add a CNAME record at your DNS provider pointing to the Render hostname Render provides.
4. Render provisions a TLS certificate automatically (~2 minutes).

---

## Step 6 — Verify

1. Open your Render URL (or custom domain).
2. Navigate to `/workouts`. It should show your program — not demo data.
3. Toggle a workout checkbox → check the **Workouts** tab in your Google Sheet. A new row should appear within ~2s.
4. Navigate to `/dashboard` (log in first — create a coach account at `/signup`).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Page shows demo data after setup | Check Render env vars are saved. Redeploy after adding vars. |
| "Sync failed" toast on checkbox toggle | Service account doesn't have access to the Sheet — re-share it. |
| `SyntaxError` in logs on startup | `GOOGLE_SERVICE_ACCOUNT_KEY` has literal newlines — see ⚠️ section above. |
| Wrong workout showing | Check Program Start Date in the Profile tab of the Sheet. Week 1 Day 1 = Start Date. |
| AI skills not working | Go to `/settings/agents` → enter your Anthropic API key → Save → test. |
| `/dashboard` redirects to login | Expected. Create a coach account at `/signup` first. |
| Build fails with "npm: not found" | Make sure Render is set to **Node** environment, not Docker. |

---

## Multi-Tenant (Multiple Coaches)

FitOS supports multiple coaches on one deployment. Each coach signs up at `/signup` and connects their own Google Sheet via the `/setup` wizard. The Sheet ID is stored per-coach in the database.

The legacy `COACH_SHEET_ID` env var is the fallback for single-coach deploys — you don't need it in multi-tenant mode.

---

## Updating FitOS

If you deployed via one-click button, Render auto-deploys when the upstream repo pushes. If you want to control updates:

1. In Render → **Settings → Auto-Deploy** → disable.
2. When you want to update: pull the latest from `Polsia-Inc/fitos`, push to your fork, then manually trigger deploy in Render.

---

## Questions

- Open an issue: [github.com/Polsia-Inc/fitos/issues](https://github.com/Polsia-Inc/fitos/issues)
- Read setup docs: [docs/sheets-setup.md](sheets-setup.md)
- See the live demo: [fitos-zc11.polsia.app/demo](https://fitos-zc11.polsia.app/demo)
