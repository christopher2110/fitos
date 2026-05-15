/**
 * lib/sheets/middleware.js — Multi-tenant Sheet ID resolution
 *
 * Owns: resolving the correct Google Sheet ID for the current request.
 * Does NOT own: session auth (lib/trial.js), Sheet API calls (lib/sheets/client.js).
 *
 * Resolution order (first match wins):
 *   1. req.coach.sheet_id  — self-signup coach with a connected Sheet (from trial middleware)
 *   2. COACH_SHEET_ID env  — single-tenant / legacy provisioned coaches
 *   3. null                — demo mode, no Sheet available
 *
 * Attaches req.sheetId (string|null) to every request.
 * Routes check req.sheetId; null means demo mode.
 */

function resolveSheetMiddleware(req, _res, next) {
  // Coach attached by trialMiddleware takes priority — per-coach sheet_id
  if (req.coach && req.coach.sheet_id) {
    req.sheetId = req.coach.sheet_id;
    return next();
  }

  // Fall back to environment variable (legacy provisioned or single-tenant)
  if (process.env.COACH_SHEET_ID) {
    req.sheetId = process.env.COACH_SHEET_ID;
    return next();
  }

  // No Sheet — demo mode
  req.sheetId = null;
  return next();
}

module.exports = { resolveSheetMiddleware };
