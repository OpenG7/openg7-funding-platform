import type { PoolClient } from 'pg';

interface PostgresConnectionSource {
  connect(): Promise<PoolClient>;
}

interface PostgresTransactionOptions<T> {
  /** Read all projections from one stable snapshot and reject database writes. */
  readonly readOnlySnapshot?: boolean;
  /** Roll back a declined result, including any writes made before the decision. */
  readonly shouldCommit?: (result: T) => boolean;
  /** Keep the operation failure if its rollback also fails. */
  readonly preserveOriginalError?: boolean;
  /** Notify only after the server has acknowledged rollback on this connection. */
  readonly onRollbackConfirmed?: () => void;
}

/** Own one transaction and release its client before resolving the result. */
export const withPostgresTransaction = async <T>(
  pool: PostgresConnectionSource,
  operation: (client: PoolClient) => Promise<T>,
  options: PostgresTransactionOptions<T> = {}
): Promise<T> => {
  const client = await pool.connect();
  let rollbackAttempted = false;
  try {
    await client.query(
      options.readOnlySnapshot
        ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
        : 'BEGIN'
    );
    const result = await operation(client);
    if (options.shouldCommit?.(result) === false) {
      rollbackAttempted = true;
      await client.query('ROLLBACK');
      options.onRollbackConfirmed?.();
    } else {
      await client.query('COMMIT');
    }
    return result;
  } catch (error) {
    if (!rollbackAttempted) {
      if (options.preserveOriginalError) {
        await client
          .query('ROLLBACK')
          .then(() => options.onRollbackConfirmed?.())
          .catch(() => undefined);
      } else {
        await client.query('ROLLBACK');
        options.onRollbackConfirmed?.();
      }
    }
    throw error;
  } finally {
    client.release();
  }
};
