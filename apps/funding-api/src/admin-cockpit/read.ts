import type { Pool, PoolClient } from 'pg';

/** A late connection is returned to the pool, including after an acquisition timeout. */
export const connectForRead = (
  pool: Pool,
  timeoutMs = 2000
): Promise<PoolClient> =>
  new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error('Read connection timeout'));
    }, timeoutMs);
    pool.connect().then(
      (client) => {
        clearTimeout(timer);
        if (expired) client.release();
        else resolve(client);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

export const readSnapshot = async <T>(
  pool: Pool,
  read: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await connectForRead(pool);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const result = await read(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const localDay = (date: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);

export const shiftDay = (day: string, offset: number): string => {
  const value = new Date(day + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};

export const integer = (value: string | number): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('Unsafe monetary value');
  return parsed;
};
export const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => integer(total + value), 0);
