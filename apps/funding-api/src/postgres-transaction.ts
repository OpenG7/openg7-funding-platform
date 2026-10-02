import type { Pool, PoolClient } from 'pg';

/** Own one transaction and release its client before resolving the result. */
export const withPostgresTransaction = async <T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
