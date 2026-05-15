/**
 * db/index.js — Database connection pool
 *
 * Owns: pg Pool construction. ONLY this module constructs new Pool().
 * Does NOT: contain query logic (use db/<entity>.js for that).
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = pool;
