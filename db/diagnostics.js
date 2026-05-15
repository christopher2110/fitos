/**
 * db/diagnostics.js — Database diagnostic queries
 *
 * Owns: health-check queries (SELECT 1 ping, server time).
 * Does NOT own: business data, migrations, or schema changes.
 */

const pool = require('./index');

/**
 * Perform a SELECT 1 ping and return server time.
 * Throws on connection failure.
 */
async function pingDatabase() {
  const result = await pool.query('SELECT 1 AS ping, now() AS server_time');
  return result.rows[0];
}

module.exports = { pingDatabase };
