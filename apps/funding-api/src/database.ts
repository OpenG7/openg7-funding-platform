import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

export const dbPool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl
    })
  : null;

export const hasDatabase = dbPool !== null;
