import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

/** Disposable fixtures wait for the real clock; they never rewrite account spacing. */
export async function waitForFixtureAccountCooldown(pool, deliveryId) {
  const deadline = Date.now() + 65000;
  while (true) {
    const account = (
      await pool.query(
        `SELECT lease.next_dispatch_at<=clock_timestamp() AS ready,lease.uncertain,lease.delivery_id
        FROM publication_account_reservations r JOIN publication_account_leases lease USING(provider,account_id,mode)
        WHERE r.delivery_id=$1`,
        [deliveryId]
      )
    ).rows[0];
    assert(
      account,
      'The approved fixture must retain its account reservation.'
    );
    assert.equal(account.uncertain, false);
    assert.equal(account.delivery_id, null);
    if (account.ready) return;
    assert(
      Date.now() < deadline,
      'The real account cooldown did not end within its technical bound.'
    );
    await delay(1000);
  }
}
