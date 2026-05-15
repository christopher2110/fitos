module.exports = {
  name: 'add_email_suppressions',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_suppressions (
        id            SERIAL PRIMARY KEY,
        email         VARCHAR(255) NOT NULL,
        reason        VARCHAR(50)  NOT NULL DEFAULT 'manual',
        source        VARCHAR(50)  NOT NULL DEFAULT 'seed',
        suppressed_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_email_unique_idx
        ON email_suppressions (LOWER(email))
    `);

    // Seed the 5 known-inactive addresses that produce Postmark 422 errors
    await client.query(`
      INSERT INTO email_suppressions (email, reason, source) VALUES
        ('christophercampbell@me.com', 'inactive', 'seed'),
        ('test@test.com',             'inactive', 'seed'),
        ('candykins3411@gmail.com',   'inactive', 'seed'),
        ('paulfeebs@gmail.com',       'inactive', 'seed'),
        ('benjaminxie@gmail.com',     'inactive', 'seed')
      ON CONFLICT DO NOTHING
    `);
  },
};
