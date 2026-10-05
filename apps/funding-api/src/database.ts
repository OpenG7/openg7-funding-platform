import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

export const dbPool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 10000
    })
  : null;

export const hasDatabase = dbPool !== null;
