module.exports = {
  name: 'create_coaches',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS coaches (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255),
        name VARCHAR(255),
        access_token VARCHAR(255) UNIQUE NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'trial',
        trial_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
        trial_expired_at TIMESTAMPTZ,
        converted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS coaches_access_token_idx ON coaches (access_token)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS coaches_email_idx ON coaches (email)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS coaches_status_idx ON coaches (status)
    `);
  },
};
