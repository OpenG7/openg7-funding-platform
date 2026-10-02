import type { Pool, PoolClient } from 'pg';

interface PostgresTransactionOptions<T> {
  /** Roll back a declined result, including any writes made before the decision. */
  readonly shouldCommit?: (result: T) => boolean;
  /** Keep the operation failure if its rollback also fails. */
  readonly preserveOriginalError?: boolean;
}

/** Own one transaction and release its client before resolving the result. */
export const withPostgresTransaction = async <T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
  options: PostgresTransactionOptions<T> = {}
): Promise<T> => {
  const client = await pool.connect();
  let rollbackAttempted = false;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    if (options.shouldCommit?.(result) === false) {
      rollbackAttempted = true;
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }
    return result;
  } catch (error) {
    if (!rollbackAttempted) {
      if (options.preserveOriginalError) {
        await client.query('ROLLBACK').catch(() => undefined);
      } else {
        await client.query('ROLLBACK');
      }
    }
    throw error;
  } finally {
    client.release();
  }
};
