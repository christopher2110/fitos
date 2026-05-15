# FitOS Sheet Builder

One command creates a fully-formed FitOS client sheet in a coach's Google Drive —
all 9 tabs, conditional formatting, data validation, named ranges, and example data.

---

## Prerequisites

- Python 3.8 +
- A Google account (coach's own account)
- A Google Cloud project with Sheets API + Drive API enabled

---

## 1 — Enable Google APIs

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `fitos-coach`).
3. Go to **APIs & Services → Library**.
4. Search for and **Enable** both:
   - **Google Sheets API**
   - **Google Drive API**

---

## 2 — Create OAuth Credentials

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Desktop app**.  Name it anything (e.g. `FitOS Builder`).
3. Click **Create**, then **Download JSON**.
4. Save the file as `~/fitos_credentials.json`
   (or remember the path — you'll pass it with `--credentials`).

> **Required scopes** (the builder requests these automatically):
> - `https://www.googleapis.com/auth/spreadsheets`
> - `https://www.googleapis.com/auth/drive.file`

If prompted to configure an OAuth consent screen:
- Set user type to **External** (or Internal if using Google Workspace).
- Add your coach email as a **Test user**.
- You do not need to publish the app.

---

## 3 — Install Dependencies

```bash
pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib
```

---

## 4 — Run the Builder

```bash
python fitos_sheet_builder.py --coach-email coach@example.com
```

Full options:

```bash
python fitos_sheet_builder.py \
  --coach-email coach@example.com \
  --client-name "Jane Doe" \
  --schema ../schemas/sheet_schema.json \
  --credentials ~/fitos_credentials.json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--coach-email` | *(required)* | Google email. Sheet is shared here with owner access. |
| `--client-name` | `New Client` | Used as the spreadsheet title. |
| `--schema` | `../schemas/sheet_schema.json` | Path to the declarative schema file. |
| `--credentials` | `~/fitos_credentials.json` | Google OAuth client credentials JSON. |

### First run

Your browser opens for a Google login + consent prompt.
Approve the `spreadsheets` + `drive.file` scopes.
The token is cached at `~/.fitos_token.json` — **subsequent runs are silent**.

### Output

```
============================================================
  ✓  Sheet created successfully!
  Sheet ID  : 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
  Share URL : https://docs.google.com/spreadsheets/d/1BxiMVs0XRA...
============================================================

Next steps:
  1. Open the URL above and verify each tab looks correct.
  2. Update the Profile tab with your client's real data.
  3. Paste the Sheet ID into your PWA / dashboard config.
  4. Token cached at ~/.fitos_token.json — runs silently from now on.
```

---

## What Gets Created

| Tab | Description |
|-----|-------------|
| **Profile** | Client bio, goals, baselines. 19 field rows. |
| **Program** | Week-by-week exercise prescription. 8 example rows. |
| **Workouts** | Session-by-session training log with RPE colour scale. |
| **CheckIns** | Weekly body measurements + wellness scores + compliance bar. |
| **History** | Best-set history per exercise with PR flag and estimated 1RM. |
| **Wellness** | Daily sleep, stress, energy, nutrition adherence log. |
| **Messages** | Async coach ↔ client messaging thread. |
| **Activity** | Non-strength activity log (cardio, NEAT, sport). |
| **KPIs** | Auto-computed weekly metrics for coach dashboard. |

All tabs include:
- Frozen header row (olive background, cream text, bold)
- Alternating row shading (cream palette)
- Column widths from schema
- Data validation (dropdowns, integer ranges, date checks)
- Conditional formatting (RPE colour scale, status badges, compliance bar)
- Named ranges for every data block

---

## Adding / Modifying Tabs

Edit `schemas/sheet_schema.json` — no Python changes required.

To add a column to an existing tab:

```json
{ "name": "My New Column", "type": "string", "width": 160 }
```

To add a new tab, append a tab object to the `"tabs"` array.

The builder reads the schema fresh each run — re-run for each new client.

---

## Running for Multiple Clients

Run once per client. Each invocation creates a **new, independent Sheet**.
The coach Drive accumulates one Sheet per client.

```bash
python fitos_sheet_builder.py --coach-email coach@example.com --client-name "Alex Smith"
python fitos_sheet_builder.py --coach-email coach@example.com --client-name "Maria Torres"
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `ModuleNotFoundError: google` | Run `pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib` |
| `FileNotFoundError: credentials` | Check `--credentials` path and ensure you downloaded the JSON from Google Cloud Console |
| Browser doesn't open | Run in a terminal with a graphical environment, or set `--no-browser` and paste the URL manually |
| `403 accessNotConfigured` | Sheets API or Drive API not enabled in the project — revisit Step 1 |
| `Token has been revoked` | Delete `~/.fitos_token.json` and re-run to trigger a new browser flow |
| Sheet created but empty | Check build logs for API quota errors; you may have hit the free-tier write limit |
