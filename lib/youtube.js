// lib/youtube.js
// Owns: YouTube Data API v3 search — find exercise demo videos from trusted channels
// Does NOT own: Sheet access, exercise CRUD, HTTP routing, API key storage

const https = require('https');

const YT_API_HOST = 'www.googleapis.com';
const YT_SEARCH_PATH = '/youtube/v3/search';

/**
 * Search YouTube for an exercise demo video within a specific channel.
 *
 * Quota cost: 100 units per call. Free tier = 10,000 units/day (~100 calls).
 *
 * @param {object} opts
 *   apiKey      {string}   YouTube Data API v3 key
 *   exerciseName {string}  e.g. "Barbell Back Squat"
 *   channelId   {string}   YouTube channel ID to restrict search to
 *   maxResults  {number}   how many results to request (default 1)
 *
 * @returns {string|null}  YouTube watch URL (https://www.youtube.com/watch?v=...) or null
 */
async function searchExerciseVideo({ apiKey, exerciseName, channelId, maxResults = 1 }) {
  const query    = encodeURIComponent(`${exerciseName} demo form`);
  const params   = [
    `key=${apiKey}`,
    `q=${query}`,
    `channelId=${channelId}`,
    `type=video`,
    `part=snippet`,
    `maxResults=${maxResults}`,
    `order=relevance`,
    `videoEmbeddable=true`,
  ].join('&');

  const path = `${YT_SEARCH_PATH}?${params}`;

  try {
    const raw  = await httpsGet(YT_API_HOST, path);
    const data = JSON.parse(raw);

    if (data.error) {
      // Surface quota exceeded separately — callers can short-circuit on this
      if (data.error.code === 403) throw new QuotaError(data.error.message);
      throw new Error(`YouTube API error ${data.error.code}: ${data.error.message}`);
    }

    const items = (data.items || []).filter(i => i.id && i.id.videoId);
    if (items.length === 0) return null;

    return `https://www.youtube.com/watch?v=${items[0].id.videoId}`;
  } catch (err) {
    if (err instanceof QuotaError) throw err;
    // Network or parse errors — treat as not-found so caller can continue
    throw err;
  }
}

/**
 * Search a single channel and return up to maxResults candidates with metadata.
 * Each result: { video_url, video_id, channel_name, title }
 * Quota cost: 100 units per call.
 *
 * @param {object} opts
 *   apiKey        {string}
 *   exerciseName  {string}
 *   channelId     {string}
 *   channelName   {string}  display name for metadata
 *   maxResults    {number}  default 3
 *
 * @returns {Array<{video_url, video_id, channel_name, title}>}
 */
async function searchCandidates({ apiKey, exerciseName, channelId, channelName = '', maxResults = 3 }) {
  const query  = encodeURIComponent(`${exerciseName} demo form`);
  const params = [
    `key=${apiKey}`,
    `q=${query}`,
    `channelId=${channelId}`,
    `type=video`,
    `part=snippet`,
    `maxResults=${maxResults}`,
    `order=relevance`,
    `videoEmbeddable=true`,
  ].join('&');

  const path = `${YT_SEARCH_PATH}?${params}`;
  const raw  = await httpsGet(YT_API_HOST, path);
  const data = JSON.parse(raw);

  if (data.error) {
    if (data.error.code === 403) throw new QuotaError(data.error.message);
    throw new Error(`YouTube API error ${data.error.code}: ${data.error.message}`);
  }

  return (data.items || [])
    .filter(i => i.id && i.id.videoId)
    .map(i => ({
      video_id:     i.id.videoId,
      video_url:    `https://www.youtube.com/watch?v=${i.id.videoId}`,
      channel_name: channelName || (i.snippet && i.snippet.channelTitle) || '',
      title:        (i.snippet && i.snippet.title) || '',
    }));
}

/**
 * Gather top 3 candidates for an exercise across all trusted channels (one API call).
 * Tries channels in order, stopping as soon as 3 candidates are gathered or quota is hit.
 *
 * @param {object} opts
 *   apiKey       {string}
 *   exerciseName {string}
 *   channels     {Array<{id, name}>}  trusted channels
 *   maxTotal     {number}  max candidates to collect (default 3)
 *
 * @returns {Array<{video_url, video_id, channel_name, title}>}
 */
async function findCandidatesInTrustedChannels({ apiKey, exerciseName, channels, maxTotal = 3 }) {
  if (!channels || channels.length === 0) return [];
  const all = [];
  for (const ch of channels) {
    if (all.length >= maxTotal) break;
    try {
      const results = await searchCandidates({
        apiKey,
        exerciseName,
        channelId:   ch.id,
        channelName: ch.name,
        maxResults:  Math.min(maxTotal - all.length, 3),
      });
      all.push(...results);
    } catch (err) {
      if (err instanceof QuotaError) throw err;
      // Skip channel on error
    }
  }
  return all.slice(0, maxTotal);
}

/**
 * Search across multiple channels and return the first match.
 * Channels are tried in order; returns as soon as one yields a result.
 * Short-circuits on quota errors so we don't burn more quota.
 *
 * @param {object} opts
 *   apiKey       {string}    YouTube Data API v3 key
 *   exerciseName {string}    exercise to search for
 *   channelIds   {string[]}  ordered list of trusted channel IDs
 *
 * @returns {string|null}  first matching YouTube URL, or null if none found
 */
async function findVideoInTrustedChannels({ apiKey, exerciseName, channelIds }) {
  if (!channelIds || channelIds.length === 0) return null;

  for (const channelId of channelIds) {
    const url = await searchExerciseVideo({ apiKey, exerciseName, channelId });
    if (url) return url;
  }

  return null;
}

// ── Quota error class ─────────────────────────────────────────────────────────

class QuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotaError';
  }
}

// ── HTTPS GET helper ──────────────────────────────────────────────────────────

function httpsGet(hostname, path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET', headers: { 'Accept': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          // YouTube returns 200 for quota errors but 403 for invalid key
          if (res.statusCode >= 200 && res.statusCode < 500) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

module.exports = { searchExerciseVideo, findVideoInTrustedChannels, searchCandidates, findCandidatesInTrustedChannels, QuotaError };
