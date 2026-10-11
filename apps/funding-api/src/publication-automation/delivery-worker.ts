import { claimNextDelivery, expireClaims } from './claims.js';
import type { PublicationDeliveryWorkerContext } from './context.js';
import { executeDelivery } from './delivery-execution.js';

export { complete } from './delivery-outcomes.js';

export class PublicationDeliveryWorker {
  private running = false;

  constructor(private readonly context: PublicationDeliveryWorkerContext) {}

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!(await this.context.workerSettings()).enabled) return;
      await this.context.guardEligibility();
      await expireClaims(this.context, now);
      const feeds = await this.context.feeds();
      for (const f of feeds.filter(
        (f) =>
          !f.paused &&
          f.configured &&
          (!f.checkedAt ||
            Date.parse(f.checkedAt) < now.getTime() - 6 * 3600000)
      )) {
        if (!(await this.context.workerSettings()).enabled) return;
        await this.context.command(
          { action: 'check', feedId: f.id },
          'publication-worker'
        );
      }
      for (const f of feeds.filter((f) => f.autoPrepare)) {
        if (!(await this.context.workerSettings()).enabled) return;
        // Private preparation continues while sending is paused or unconfigured.
        // The persisted claim also bounds concurrent planners/restarts.
        const claim = await this.context.pool.query(
          `UPDATE publication_feeds SET last_prepared_at=$2 WHERE id=$1 AND (last_prepared_at IS NULL OR last_prepared_at<$2::timestamptz-INTERVAL '5 minutes') RETURNING id`,
          [f.id, now]
        );
        if (claim.rowCount)
          await this.context.prepare(f.id, 'publication-worker', now);
      }
      for (let i = 0; i < 5; i++) {
        const row = await claimNextDelivery(this.context, now);
        if (!row) break;
        if ((await executeDelivery(this.context, row, now)) === 'stop') return;
      }
    } finally {
      this.running = false;
    }
  }
}
