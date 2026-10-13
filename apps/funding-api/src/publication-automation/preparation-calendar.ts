import type {
  PublicationFeed,
  PublicationFeedId,
  PublicationRecognitionSource,
  SponsorshipPublicationFormat
} from '@openg7/funding-core';

import {
  LIVE_ACCOUNT_INTERVAL_MS,
  canonicalPublicationAccount
} from './account-reservations.js';
import {
  preparationEligibilitySql,
  preparationModerationSql,
  preparationModerationSubjectSql
} from './preparation-sources.js';
import type { Db } from './sources.js';

type Account = ReturnType<typeof canonicalPublicationAccount>;
interface Window {
  account: Account;
  at: number;
  batchId: string | null;
  deliveryId: string | null;
}
interface Lease extends Account {
  uncertain: boolean;
  delivery_id: string | null;
  next_dispatch_at: Date;
}
export interface PreparationCalendarBatch {
  feed_id: PublicationFeedId;
  batch_id: string;
  starts_at: Date;
  capacity: number;
  publication_format: SponsorshipPublicationFormat | null;
  has_delivery: boolean;
  delivery_id: string | null;
  delivery_feed_id: PublicationFeedId | null;
  delivery_account_id: string | null;
  delivery_mode: PublicationFeed['mode'] | null;
  delivery_scheduled_at: Date | null;
  mutable: boolean;
  sources: PublicationRecognitionSource[];
}
const sameAccount = (a: Account, b: Account) =>
  a.provider === b.provider && a.accountId === b.accountId && a.mode === b.mode;
export const preparationFeedAccount = (feed: PublicationFeed): Account =>
  canonicalPublicationAccount({
    feed_id: feed.id,
    account_id: feed.accountId ?? '',
    mode: feed.mode
  });

/** Separate from dispatch leases. Only prepare acquires this mutex, before feed/delivery locks.
 * Approvals and workers never acquire it, so their delivery -> account order is unchanged.
 * The caller must use a transaction client for the complete preparation admission. */
export async function lockPreparationAccount(
  db: Db,
  feed: PublicationFeed
): Promise<void> {
  const account = preparationFeedAccount(feed);
  const key = account.accountId
    ? [account.provider, account.accountId, account.mode]
    : ['unconfigured', feed.id];
  await db.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1,0)) /* preparation_account_mutex */',
    [JSON.stringify(['publication-private-preparation-v1', ...key])]
  );
}

/** Private calendar facts loaded once. This neither locks dispatch authority nor reserves dates. */
export async function preparationCalendar(
  db: Db,
  feeds: readonly PublicationFeed[],
  now: Date,
  until: Date
) {
  const windows: Window[] = [];
  const unresolved: Account[] = [];
  const deliveries = (
    await db.query<{
      id: string;
      feed_id: PublicationFeedId;
      account_id: string;
      mode: PublicationFeed['mode'];
      scheduled_at: Date;
      batch_id: string | null;
      status: string;
    }>(
      `SELECT d.id,d.feed_id,d.account_id,d.mode,d.scheduled_at,d.batch_id,d.status FROM publication_deliveries d
     WHERE (d.scheduled_at >= $1 AND d.scheduled_at <= $2 AND d.status IN ('draft','blocked','approved','publishing','uncertain'))
       OR d.status IN ('publishing','uncertain') /* preparation_calendar_deliveries */`,
      [new Date(now.getTime() - LIVE_ACCOUNT_INTERVAL_MS), until]
    )
  ).rows;
  for (const row of deliveries) {
    const account = canonicalPublicationAccount(row);
    if (!account.accountId) continue;
    windows.push({
      account,
      at: row.scheduled_at.getTime(),
      batchId: row.batch_id,
      deliveryId: row.id
    });
    if (row.status === 'uncertain' || row.status === 'publishing')
      unresolved.push(account);
  }
  const leases = (
    await db.query<Lease>(
      `SELECT provider,account_id AS "accountId",mode,uncertain,delivery_id,next_dispatch_at FROM publication_account_leases
    WHERE uncertain OR delivery_id IS NOT NULL OR next_dispatch_at>$1 /* preparation_calendar_leases */`,
      [now]
    )
  ).rows;
  for (const lease of leases)
    if (lease.uncertain || lease.delivery_id) unresolved.push(lease);
  const reservations = (
    await db.query<{
      provider: Account['provider'];
      accountId: string;
      mode: Account['mode'];
      scheduled_at: Date;
      delivery_id: string;
      batch_id: string | null;
    }>(
      `SELECT r.provider,r.account_id AS "accountId",r.mode,r.scheduled_at,r.delivery_id,d.batch_id
     FROM publication_account_reservations r LEFT JOIN publication_deliveries d ON d.id=r.delivery_id
     WHERE r.status IN ('reserved','publishing','uncertain') AND r.scheduled_at >= $1 AND r.scheduled_at <= $2
     /* preparation_calendar_reservations */`,
      [new Date(now.getTime() - LIVE_ACCOUNT_INTERVAL_MS), until]
    )
  ).rows;
  for (const row of reservations)
    windows.push({
      account: row,
      at: row.scheduled_at.getTime(),
      batchId: row.batch_id,
      deliveryId: row.delivery_id
    });
  const batches = (
    await db.query<PreparationCalendarBatch>(
      `SELECT DISTINCT COALESCE(r.feed_id,route.feed_id) AS feed_id,b.id AS batch_id,COALESCE(s.starts_at,b.scheduled_at) AS starts_at,
       LEAST(b.capacity,COALESCE(s.capacity,b.capacity)) AS capacity,b.publication_format,(job.id IS NOT NULL) AS has_delivery,
       job.id AS delivery_id,job.feed_id AS delivery_feed_id,job.account_id AS delivery_account_id,job.mode AS delivery_mode,job.scheduled_at AS delivery_scheduled_at,
       (b.status='open' AND (s.id IS NULL OR s.status='open') AND (job.id IS NULL OR (job.status='draft' AND job.auto_managed))
        AND (job.id IS NULL OR ${preparationModerationSubjectSql('publication_delivery', 'job.id')})
        AND NOT EXISTS(SELECT 1 FROM sponsor_publication_drafts member JOIN fund_contributions identity ON identity.id=member.contribution_id
          WHERE member.batch_id=b.id AND ((${preparationEligibilitySql('member', 'identity', "split_part(COALESCE(r.feed_id,route.feed_id),':',1)", "split_part(COALESCE(r.feed_id,route.feed_id),':',2)")}) AND (${preparationModerationSql('member', 'identity')})) IS NOT TRUE)) AS mutable,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('id',member.id,'contributionId',member.contribution_id,'name',COALESCE(identity.sponsor_company_name,''),'title',member.title,'body',member.body,'disclosureText',member.disclosure_text) ORDER BY member.id)
         FROM sponsor_publication_drafts member JOIN fund_contributions identity ON identity.id=member.contribution_id WHERE member.batch_id=b.id),'[]'::jsonb) AS sources
     FROM sponsor_publication_batches b LEFT JOIN publication_slots s ON s.id=b.slot_id
     LEFT JOIN publication_recurrences r ON r.batch_id=b.id
     LEFT JOIN LATERAL(SELECT DISTINCT member.feed_target || ':' || member.channel AS feed_id FROM sponsor_publication_drafts member WHERE member.batch_id=b.id) route ON TRUE
     LEFT JOIN publication_deliveries job ON job.batch_id=b.id AND job.status<>'cancelled'
     WHERE COALESCE(s.starts_at,b.scheduled_at)>$1 AND COALESCE(s.starts_at,b.scheduled_at)<=$2
       AND b.status NOT IN ('cancelled','published') /* preparation_calendar_batches */`,
      [now, until]
    )
  ).rows;
  for (const batch of batches) {
    if (!batch.sources.length && batch.mutable) continue;
    const feed = feeds.find((f) => f.id === batch.feed_id);
    if (!feed) continue;
    // READ COMMITTED preparation can observe compose's commit between the
    // delivery and batch reads. Include that newly visible immutable account,
    // rather than dropping its batch and accidentally admitting the same time.
    const account = batch.has_delivery
      ? canonicalPublicationAccount({
          feed_id: batch.delivery_feed_id!,
          account_id: batch.delivery_account_id!,
          mode: batch.delivery_mode!
        })
      : preparationFeedAccount(feed);
    if (account.accountId)
      windows.push({
        account,
        at: (batch.delivery_scheduled_at ?? batch.starts_at).getTime(),
        batchId: batch.batch_id,
        deliveryId: batch.delivery_id
      });
  }
  const manual = (
    await db.query<{ feed_id: PublicationFeedId; starts_at: Date }>(
      `SELECT DISTINCT s.feed_target || ':' || s.channel AS feed_id,s.starts_at FROM publication_slots s
     WHERE s.starts_at>$1 AND s.starts_at<=$2 AND s.status IN ('open','scheduled')
       AND (s.status='scheduled' OR EXISTS(SELECT 1 FROM sponsor_publication_drafts member WHERE member.slot_id=s.id AND member.batch_id IS NULL AND member.status NOT IN ('published','cancelled','rejected')))
     UNION SELECT DISTINCT member.feed_target || ':' || member.channel,member.scheduled_at FROM sponsor_publication_drafts member
       WHERE member.batch_id IS NULL AND member.slot_id IS NULL AND member.status='scheduled' AND member.scheduled_at>$1 AND member.scheduled_at<=$2
     /* preparation_calendar_manual */`,
      [now, until]
    )
  ).rows;
  for (const row of manual) {
    const feed = feeds.find((f) => f.id === row.feed_id);
    if (feed)
      windows.push({
        account: preparationFeedAccount(feed),
        at: row.starts_at.getTime(),
        batchId: null,
        deliveryId: null
      });
  }
  return {
    batches,
    unresolved(feed: PublicationFeed) {
      return unresolved.some((a) =>
        sameAccount(a, preparationFeedAccount(feed))
      );
    },
    compatible(
      feed: PublicationFeed,
      date: string,
      excludeBatchId: string | null = null,
      excludeDeliveryId: string | null = null
    ) {
      const account = preparationFeedAccount(feed);
      if (!account.accountId) return true; // Private preparation may precede connection setup.
      const at = Date.parse(date);
      const interval = account.mode === 'live' ? LIVE_ACCOUNT_INTERVAL_MS : 0;
      if (unresolved.some((a) => sameAccount(a, account))) return false;
      if (
        leases.some(
          (a) => sameAccount(a, account) && at < a.next_dispatch_at.getTime()
        )
      )
        return false;
      return !windows.some(
        (w) =>
          sameAccount(w.account, account) &&
          !(excludeBatchId && w.batchId === excludeBatchId) &&
          !(excludeDeliveryId && w.deliveryId === excludeDeliveryId) &&
          (at === w.at || Math.abs(at - w.at) < interval)
      );
    },
    admit(feed: PublicationFeed, date: string, batchId: string) {
      windows.push({
        account: preparationFeedAccount(feed),
        at: Date.parse(date),
        batchId,
        deliveryId: null
      });
    }
  };
}
