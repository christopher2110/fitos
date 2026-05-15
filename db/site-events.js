/**
 * db/site-events.js — Site traffic and conversion event storage
 *
 * Owns: site_events table. Records page_view, cta_click, checkout_start events.
 * Does NOT: handle coach auth, Sheets, or any billing logic.
 */
const pool = require('./index');

const VALID_EVENTS = ['page_view', 'cta_click', 'checkout_start'];

/**
 * Record a single site event.
 * @param {object} opts
 * @param {string} opts.event      — event type (must be in VALID_EVENTS)
 * @param {string} opts.page       — page path (e.g. '/', '/pricing')
 * @param {string} [opts.source]   — utm_source or referrer
 * @param {string} [opts.session_id] — client-generated anonymous session id
 */
async function recordSiteEvent({ event, page, source, session_id }) {
  if (!VALID_EVENTS.includes(event)) {
    throw new Error(`Invalid event type: ${event}`);
  }
  const result = await pool.query(
    `INSERT INTO site_events (event, page, source, session_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [event, page, source || null, session_id || null]
  );
  return result.rows[0];
}

/**
 * Unique sessions in the last 7 days.
 * A session is counted once even if it hit multiple pages.
 */
async function getUniqueSessionsLast7Days() {
  const result = await pool.query(`
    SELECT COUNT(DISTINCT session_id) AS count
    FROM site_events
    WHERE session_id IS NOT NULL
      AND created_at >= NOW() - INTERVAL '7 days'
  `);
  return parseInt(result.rows[0].count, 10);
}

/**
 * Top 5 pages by page_view count in the last 7 days.
 * @returns {Array<{page: string, views: number}>}
 */
async function getTopPagesByViews() {
  const result = await pool.query(`
    SELECT page, COUNT(*) AS views
    FROM site_events
    WHERE event = 'page_view'
      AND created_at >= NOW() - INTERVAL '7 days'
    GROUP BY page
    ORDER BY views DESC
    LIMIT 5
  `);
  return result.rows.map(r => ({ page: r.page, views: parseInt(r.views, 10) }));
}

/**
 * CTA click counts grouped by page, last 7 days.
 * @returns {Array<{page: string, clicks: number}>}
 */
async function getCtaClicksByPage() {
  const result = await pool.query(`
    SELECT page, COUNT(*) AS clicks
    FROM site_events
    WHERE event = 'cta_click'
      AND created_at >= NOW() - INTERVAL '7 days'
    GROUP BY page
    ORDER BY clicks DESC
  `);
  return result.rows.map(r => ({ page: r.page, clicks: parseInt(r.clicks, 10) }));
}

/**
 * Total checkout_start events in the last 7 days (proxy for purchase intent).
 */
async function getCheckoutStartCount() {
  const result = await pool.query(`
    SELECT COUNT(*) AS count
    FROM site_events
    WHERE event = 'checkout_start'
      AND created_at >= NOW() - INTERVAL '7 days'
  `);
  return parseInt(result.rows[0].count, 10);
}

/**
 * Daily page_view counts for the last 7 days (for sparkline / trend).
 * @returns {Array<{date: string, views: number}>}
 */
async function getDailyViews() {
  const result = await pool.query(`
    SELECT DATE(created_at AT TIME ZONE 'UTC') AS date,
           COUNT(*) AS views
    FROM site_events
    WHERE event = 'page_view'
      AND created_at >= NOW() - INTERVAL '7 days'
    GROUP BY date
    ORDER BY date ASC
  `);
  return result.rows.map(r => ({ date: r.date, views: parseInt(r.views, 10) }));
}

module.exports = {
  recordSiteEvent,
  getUniqueSessionsLast7Days,
  getTopPagesByViews,
  getCtaClicksByPage,
  getCheckoutStartCount,
  getDailyViews,
};
