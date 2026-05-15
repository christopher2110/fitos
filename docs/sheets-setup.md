# FitOS Google Sheets Setup

Connect a real client Sheet so /workouts reads live program data and writes completions back.

## What you need

- A **Google Cloud project** (free, takes 5 minutes)
- A **service account** with Sheets + Drive API access
- A **client Sheet** created by `fitos_sheet_builder.py`
- Two **Render environment variables**: `GOOGLE_SERVICE_ACCOUNT_KEY` and `COACH_SHEET_ID`

---

## Step 1 — Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in.
2. Click **Select a project → New Project**. Name it "FitOS".
3. Enable APIs: in the left menu go to **APIs & Services → Library**, search for and enable:
   - **Google Sheets API**
   - **Google Drive API**

## Step 2 — Create a service account

1. Go to **APIs & Services → Credentials → Create Credentials → Service account**.
2. Name: `fitos-sheets-reader`. Role: none (we only need spreadsheet-level access). Click Done.
3. Click the new service account → **Keys → Add Key → Create new key → JSON**. Download the file.

## Step 3 — Build the client Sheet

Install deps (one-time):
```bash
cd scripts
pip install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client
```

Run the builder (requires your own Google account OAuth on first run — browser will open):
```bash
python fitos_sheet_builder.py \
  --coach-email your@email.com \
  --client-name "Jane Doe"
```

The script prints a **Sheet ID** (the long string in the Sheet URL). Copy it.

Share the sheet with your service account email (from Step 2, looks like
`fitos-sheets-reader@your-project.iam.gserviceaccount.com`):
- In the Sheet, click **Share → Add people** → paste the service account email → Viewer.

## Step 4 — Set Render environment variables

In your Render dashboard for the FitOS service → **Environment**:

| Key | Value |
|-----|-------|
| `COACH_SHEET_ID` | Sheet ID from Step 3 (e.g. `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms`) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Paste the entire contents of the downloaded JSON key file |

Save → Render auto-deploys.

## Step 5 — Verify

Open `/workouts`. You should see your client's real program for today.
Toggle a checkbox → check the Sheet's **Workouts** tab — a new row should appear within ~2s.

---

## How it works

- **Reads**: Program + Profile tabs → rendered as today's workout on page load. Cached 30s.
- **Writes**: Every checkbox toggle, weight entry, or comment posts to `/api/completions` → appended to the Workouts tab (one row per set).
- **Fallback**: If `COACH_SHEET_ID` is unset or the Sheet is unreachable, the page falls back to demo data automatically. No crash.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Page shows demo data after setup | Check Render env vars are saved and re-deployed |
| "Sync failed" toast on checkbox | Check service account has access to the Sheet |
| Wrong workout showing | Verify Program Start Date in Profile tab; today's day must match a row in Program |
| Sheet write works but data looks wrong | Check the Workouts tab headers match the schema in `schemas/sheet_schema.json` |
