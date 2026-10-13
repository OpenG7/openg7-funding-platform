import { createHash } from 'node:crypto';

import { acceptanceSql } from './acceptance-database.js';

/** Hold only this new operation after preparation so its exact provider ID can be faulted. */
export async function prepareCheckoutGate(idempotencyKey: string) {
  // The HTTP contract scopes browser keys to the acceptance project's ID.
  const keyHash = createHash('sha256')
    .update(JSON.stringify(['openg7', idempotencyKey]))
    .digest('hex');
  const cleanup = () =>
    acceptanceSql(`DROP TRIGGER IF EXISTS acceptance_checkout_submission ON checkout_operations;
    DROP FUNCTION IF EXISTS acceptance_pause_checkout(); DROP TABLE IF EXISTS acceptance_checkout_gate;`);
  try {
    await acceptanceSql(`
    BEGIN;
    CREATE TABLE acceptance_checkout_gate(key_hash text PRIMARY KEY,released boolean NOT NULL DEFAULT FALSE);
    CREATE FUNCTION acceptance_pause_checkout() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE deadline timestamptz := clock_timestamp()+INTERVAL '20 seconds';
    BEGIN
      WHILE NEW.state='submitting' AND EXISTS(
        SELECT 1 FROM acceptance_checkout_gate WHERE key_hash=NEW.key_hash AND NOT released
      ) LOOP
        IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'SYNTHETIC_CHECKOUT_GATE_TIMEOUT'; END IF;
        PERFORM pg_sleep(0.05);
      END LOOP;
      RETURN NEW;
    END $$;
    CREATE TRIGGER acceptance_checkout_submission BEFORE UPDATE OF state ON checkout_operations
      FOR EACH ROW EXECUTE FUNCTION acceptance_pause_checkout();
    COMMIT;
  `);
    await acceptanceSql(
      'INSERT INTO acceptance_checkout_gate(key_hash) VALUES($1)',
      [keyHash]
    );
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Checkout gate setup and cleanup failed.'
      );
    }
    throw error;
  }
  return {
    keyHash,
    async release() {
      await acceptanceSql(
        'UPDATE acceptance_checkout_gate SET released=TRUE WHERE key_hash=$1',
        [keyHash]
      );
    },
    async close() {
      try {
        await this.release();
      } finally {
        await cleanup();
      }
    }
  };
}
