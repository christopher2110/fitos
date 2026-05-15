// lib/sheets/video-finder.js
// Owns: Exercise Video Finder skill execution — read exercises missing video URLs,
//       search YouTube trusted channels, write URLs back to Exercises tab, post Activity summary.
// Does NOT own: YouTube API key management, HTTP routing, Sheet authentication

const { appendRows } = require('./client');
const { listExercises, updateExercise, getTrustedChannels } = require('./exercises');
const { findVideoInTrustedChannels, findCandidatesInTrustedChannels, QuotaError } = require('../youtube');
const { saveCandidates, ensureCandidatesTab } = require('./video-candidates');

/**
 * Run the Exercise Video Finder for a given coach's Sheet.
 *
 * For each exercise with no video URL:
 *   1. Searches trusted YouTube channels (in order) for "{name} demo form"
 *   2. Writes the first matching URL back to the Exercises tab
 *   3. Stops early if YouTube quota is exhausted
 *
 * Posts a single Activity entry summarising the run.
 *
 * @param {object} opts
 *   sheetId     {string}  Google Sheet ID (required)
 *   apiKey      {string}  YouTube Data API v3 key (required)
 *   dryRun      {boolean} if true: search YouTube but skip Sheet writes (default false)
 *   maxSearches {number}  safety cap — stop after this many YouTube searches (default 50)
 *
 * @returns {object}
 *   {
 *     found:      number,   // exercises successfully matched to a video
 *     skipped:    number,   // exercises where no video was found
 *     alreadyHad: number,   // exercises that already had a URL (not touched)
 *     quotaHit:   boolean,  // true if we stopped early due to quota
 *     results:    Array<{ name, url, channel? }>,  // what was found
 *     summary:    string,   // human-readable activity feed message
 *     persisted:  boolean,  // whether writes happened (false on dryRun or Sheet error)
 *   }
 */
async function runVideoFinder({ sheetId, apiKey, dryRun = false, maxSearches = 50 }) {
  if (!sheetId)  throw new Error('sheetId is required');
  if (!apiKey)   throw new Error('YouTube API key is required');

  // 1. Load exercises and trusted channels in parallel
  const [exercises, channels] = await Promise.all([
    listExercises(sheetId),
    getTrustedChannels(sheetId),
  ]);

  const channelIds = channels.map(c => c.id).filter(Boolean);

  if (channelIds.length === 0) {
    return {
      found: 0, skipped: 0, alreadyHad: 0, quotaHit: false,
      results: [],
      summary: 'No trusted YouTube channels configured. Add channels at /dashboard/exercises/sources to enable video auto-fill.',
      persisted: false,
    };
  }

  const missing    = exercises.filter(ex => ex.name && !ex.video_url);
  const alreadyHad = exercises.length - missing.length;

  const results   = [];
  let found       = 0;
  let skipped     = 0;
  let quotaHit    = false;
  let searchCount = 0;

  // 2. Search YouTube for each exercise missing a video
  for (const ex of missing) {
    if (searchCount >= maxSearches) {
      skipped++;
      continue;
    }

    let videoUrl = null;
    try {
      videoUrl = await findVideoInTrustedChannels({
        apiKey,
        exerciseName: ex.name,
        channelIds,
      });
      searchCount++;
    } catch (err) {
      if (err instanceof QuotaError) {
        // Daily quota exhausted — stop immediately, don't burn more units
        quotaHit = true;
        skipped++;
        break;
      }
      // Other errors (network, parse) — skip this exercise, continue
      skipped++;
      continue;
    }

    if (!videoUrl) {
      skipped++;
      continue;
    }

    // 3. Write the URL back to the Exercises tab (unless dry run)
    if (!dryRun) {
      try {
        await updateExercise(sheetId, ex.id, { video_url: videoUrl });
      } catch (_) {
        // Write failed — count as skipped, don't halt the run
        skipped++;
        continue;
      }
    }

    found++;
    results.push({ name: ex.name, id: ex.id, url: videoUrl });
  }

  // 4. Build summary message
  let summary;
  if (found === 0 && skipped === 0) {
    summary = `Exercise Video Finder: all ${alreadyHad} exercises already have video links — nothing to do.`;
  } else if (found === 0) {
    summary = `Exercise Video Finder: searched ${searchCount} exercise${searchCount !== 1 ? 's' : ''} across your trusted channels — no matching demos found.${quotaHit ? ' (YouTube quota reached — try again tomorrow)' : ''}`;
  } else {
    const names = results.slice(0, 5).map(r => r.name).join(', ');
    const more  = results.length > 5 ? ` and ${results.length - 5} more` : '';
    summary = `Exercise Video Finder: auto-filled ${found} video demo${found !== 1 ? 's' : ''} from your trusted channels — ${names}${more}.${skipped > 0 ? ` (${skipped} exercise${skipped !== 1 ? 's' : ''} had no match)` : ''}${quotaHit ? ' (stopped early — YouTube quota reached)' : ''}`;
  }

  // 5. Write Activity entry (unless dry run)
  let persisted = false;
  if (!dryRun && sheetId) {
    try {
      const now = new Date().toISOString();
      await appendRows(sheetId, 'Activity!A:F', [[
        now,
        'agent_summary',
        'skill:exercise_video_finder',
        summary,
        '',
        JSON.stringify({ found, skipped, alreadyHad, quotaHit, total: exercises.length, dryRun }),
      ]]);
      persisted = found > 0; // persisted = true only when we actually changed data
    } catch (_) {
      // Non-fatal — result still returned
    }
  }

  return { found, skipped, alreadyHad, quotaHit, results, summary, persisted };
}

/**
 * Streaming batch runner — same logic as runVideoFinder but emits progress events
 * via a callback so callers can stream SSE to the browser.
 *
 * @param {object} opts
 *   sheetId      {string}
 *   apiKey       {string}
 *   onProgress   {function({ type, exerciseId, exerciseName, url, filled, skipped, failed, total, quotaHit })}
 *   maxSearches  {number}  default 200
 *
 * @returns {object}  same shape as runVideoFinder
 */
async function runVideoFinderStreaming({ sheetId, apiKey, onProgress, maxSearches = 200 }) {
  if (!sheetId) throw new Error('sheetId is required');
  if (!apiKey)  throw new Error('YouTube API key is required');

  const emit = onProgress || (() => {});

  // Ensure VideoCandidates tab exists (best-effort, non-blocking)
  ensureCandidatesTab(sheetId).catch(() => {});

  const [exercises, channels] = await Promise.all([
    listExercises(sheetId),
    getTrustedChannels(sheetId),
  ]);

  const channelObjects = channels.filter(c => c.id);

  if (channelObjects.length === 0) {
    emit({ type: 'no_channels' });
    return {
      found: 0, skipped: 0, alreadyHad: exercises.length, quotaHit: false,
      results: [], summary: 'No trusted YouTube channels configured.', persisted: false,
    };
  }

  const missing    = exercises.filter(ex => ex.name && !ex.video_url);
  const alreadyHad = exercises.length - missing.length;
  const total      = missing.length;

  emit({ type: 'start', total, alreadyHad });

  const results   = [];
  let filled      = 0;
  let skipped     = 0;
  let failed      = 0;
  let quotaHit    = false;
  let searchCount = 0;

  for (const ex of missing) {
    if (searchCount >= maxSearches) {
      skipped++;
      emit({ type: 'progress', exerciseId: ex.id, exerciseName: ex.name, result: 'skipped_cap',
             filled, skipped, failed, total });
      continue;
    }

    let candidates = [];
    try {
      candidates = await findCandidatesInTrustedChannels({
        apiKey,
        exerciseName: ex.name,
        channels: channelObjects,
        maxTotal: 3,
      });
      searchCount++;
    } catch (err) {
      if (err instanceof QuotaError) {
        quotaHit = true;
        skipped++;
        emit({ type: 'quota_exhausted', filled, skipped, failed, total });
        break;
      }
      failed++;
      emit({ type: 'progress', exerciseId: ex.id, exerciseName: ex.name, result: 'error',
             filled, skipped, failed, total });
      continue;
    }

    // Persist all candidates to the cache tab (best-effort)
    if (candidates.length > 0) {
      saveCandidates(sheetId, ex.id, ex.name, candidates).catch(() => {});
    }

    const bestUrl = candidates.length > 0 ? candidates[0].video_url : null;

    if (!bestUrl) {
      skipped++;
      emit({ type: 'progress', exerciseId: ex.id, exerciseName: ex.name, result: 'no_match',
             filled, skipped, failed, total });
      continue;
    }

    // Write URL to the Exercises tab
    try {
      await updateExercise(sheetId, ex.id, { video_url: bestUrl });
    } catch (_) {
      failed++;
      emit({ type: 'progress', exerciseId: ex.id, exerciseName: ex.name, result: 'write_error',
             filled, skipped, failed, total });
      continue;
    }

    filled++;
    results.push({ name: ex.name, id: ex.id, url: bestUrl });
    emit({ type: 'progress', exerciseId: ex.id, exerciseName: ex.name, result: 'filled',
           url: bestUrl, filled, skipped, failed, total });
  }

  // Activity feed entry
  let summary;
  if (filled === 0 && skipped === 0 && failed === 0) {
    summary = `Bulk Auto-fill: all ${alreadyHad} exercises already have video links.`;
  } else {
    summary = `Bulk Auto-fill: filled ${filled} video${filled !== 1 ? 's' : ''}, ${skipped} skipped, ${failed} failed.${quotaHit ? ' (quota reached — resuming tomorrow)' : ''}`;
  }

  if (sheetId) {
    appendRows(sheetId, 'Activity!A:F', [[
      new Date().toISOString(), 'agent_summary', 'skill:bulk_video_autofill',
      summary, '', JSON.stringify({ filled, skipped, failed, alreadyHad, total, quotaHit }),
    ]]).catch(() => {});
  }

  emit({ type: 'done', filled, skipped, failed, total, quotaHit, summary });

  return { found: filled, skipped, failed, alreadyHad, quotaHit, results, summary, persisted: filled > 0 };
}

/**
 * Fetch swap candidates for a single exercise.
 * Checks the VideoCandidates tab cache first; falls back to a live YouTube search.
 * Costs 1 YouTube API call (100 quota units) only when the cache misses.
 *
 * @returns {Array<{video_url, video_id, channel_name, title}>}
 */
async function getSwapCandidates({ sheetId, exerciseId, exerciseName, apiKey }) {
  const { getCandidates } = require('./video-candidates');

  // Try cache first
  const cached = await getCandidates(sheetId, exerciseId);
  if (cached && cached.length > 0) return cached;

  // Cache miss — fetch live
  if (!apiKey) return [];
  const [channels] = await Promise.all([ getTrustedChannels(sheetId) ]);
  const channelObjects = channels.filter(c => c.id);
  if (channelObjects.length === 0) return [];

  const candidates = await findCandidatesInTrustedChannels({
    apiKey,
    exerciseName,
    channels: channelObjects,
    maxTotal: 3,
  });

  if (candidates.length > 0) {
    saveCandidates(sheetId, exerciseId, exerciseName, candidates).catch(() => {});
  }

  return candidates;
}

module.exports = { runVideoFinder, runVideoFinderStreaming, getSwapCandidates };
