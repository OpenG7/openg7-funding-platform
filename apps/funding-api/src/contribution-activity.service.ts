import { isDeepStrictEqual } from 'node:util';

import type { Pool, PoolClient } from 'pg';
import type {
  ContributionActivityItem,
  ContributionActivityResponse,
  ContributionPreparation,
  ContributionPreparationFacts
} from '@openg7/funding-core';

import { prepareContributionWebsite } from '../../../packages/funding-core/src/contribution-activity.js';

import { queueAdminContributionReceived } from './email-notification.service.js';

export interface ContributionNotificationConfig {
  email: string | null;
  smsUrl: string | null;
  publicBaseUrl: string;
  workerDefault: boolean;
}
export function contributionNotificationConfig(
  env: NodeJS.ProcessEnv
): ContributionNotificationConfig {
  const emailEnabled = env.FUNDING_CONTRIBUTION_EMAIL_ENABLED ?? 'false';
  if (!['true', 'false'].includes(emailEnabled))
    throw new Error('Invalid FUNDING_CONTRIBUTION_EMAIL_ENABLED.');
  const email =
    emailEnabled === 'true'
      ? env.FUNDING_ADMIN_NOTIFICATION_EMAIL?.trim()
      : null;
  if (
    emailEnabled === 'true' &&
    (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    throw new Error('Contribution notifications require an admin email.');
  const mode = env.FUNDING_CONTRIBUTION_SMS_MODE ?? 'disabled';
  if (!['disabled', 'mock'].includes(mode))
    throw new Error('Invalid FUNDING_CONTRIBUTION_SMS_MODE.');
  let smsUrl: string | null = null;
  if (mode === 'mock') {
    const url = new URL(env.FUNDING_CONTRIBUTION_SMS_MOCK_URL ?? '');
    if (
      !['development', 'test'].includes(
        (env.FUNDING_PLATFORM_ENV ?? env.NODE_ENV ?? '').trim().toLowerCase()
      ) ||
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]', 'stripe-stub'].includes(
        url.hostname
      ) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('SMS simulation requires an isolated local receiver.');
    smsUrl = url.toString();
  }
  const publicBaseUrl = new URL(
    env.FUNDING_PUBLIC_BASE_URL ?? 'http://localhost:4200'
  ).origin;
  return {
    email: email ?? null,
    smsUrl,
    publicBaseUrl,
    workerDefault: env.SOCIAL_PUBLICATION_WORKER_ENABLED === 'true'
  };
}
interface SourceRow {
  id: string;
  contribution_id: string;
  amount_minor: number;
  currency: string;
  confirmed_at: Date;
  email_id: string | null;
  revision: number;
  snapshot: ContributionPreparation | null;
  public_reference: string | null;
  sponsor_company_name: string | null;
  status: string;
  contribution_type: string;
  public_display_consent: boolean;
  sponsor_public_summary: string | null;
  sponsor_review_status: string | null;
  sponsor_feed_status: string;
  sponsorship_refund_status: string;
  media_approved: boolean;
  source_version: string;
}
export class ContributionActivityService {
  private preparing = false;
  private delivering = false;
  constructor(
    private readonly pool: Pool,
    private readonly config: ContributionNotificationConfig
  ) {}

  async tick(): Promise<void> {
    // A slow SMS receiver must not stop subsequent payment/email/preparation passes.
    if (!this.preparing) {
      this.preparing = true;
      try {
        await this.prepareAndQueue();
      } finally {
        this.preparing = false;
      }
    }
    if (!this.delivering) {
      this.delivering = true;
      try {
        await this.deliverSms();
      } finally {
        this.delivering = false;
      }
    }
  }

  private async prepareAndQueue(): Promise<void> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      // Same lock as the existing switch: an OFF decision cannot race a new preparation.
      const setting = await db.query<{ enabled: boolean | null }>(
        'SELECT enabled FROM publication_worker_settings WHERE id=TRUE FOR SHARE'
      );
      if (!setting.rows[0])
        throw new Error('Missing publication worker settings.');
      const enabled = setting.rows[0].enabled ?? this.config.workerDefault;
      const sources = await db.query<SourceRow>(
        `SELECT e.*,c.public_reference,c.sponsor_company_name,c.status,c.contribution_type,c.public_display_consent,
          c.sponsor_public_summary,c.sponsor_review_status,c.sponsor_feed_status,c.sponsorship_refund_status,
          COALESCE(m.approved,FALSE) AS media_approved,
          concat(c.updated_at::text,'|',m.version,'|',$1::text) AS source_version
         FROM contribution_activity e JOIN fund_contributions c ON c.id=e.contribution_id
         LEFT JOIN LATERAL (SELECT max(updated_at)::text AS version,
           bool_or(kind='supporting_image' AND review_status='approved' AND deleted_at IS NULL) AS approved
           FROM sponsor_media_assets WHERE contribution_id=c.id) m ON TRUE
         WHERE e.source_version IS DISTINCT FROM concat(c.updated_at::text,'|',m.version,'|',$1::text)
           OR (e.email_id IS NULL AND $2::boolean)
           OR ($3::boolean AND NOT EXISTS(SELECT 1 FROM contribution_sms_deliveries s WHERE s.activity_id=e.id))
         ORDER BY e.id LIMIT 100 FOR UPDATE OF e SKIP LOCKED`,
        [enabled, !!this.config.email, !!this.config.smsUrl]
      );
      for (const row of sources.rows) {
        const facts: ContributionPreparationFacts = {
          amountMinor: row.amount_minor,
          currency: row.currency,
          paymentStatus: row.status,
          contributionType: row.contribution_type,
          publicConsent: row.public_display_consent,
          companyName: row.sponsor_company_name,
          summary: row.sponsor_public_summary,
          reviewStatus: row.sponsor_review_status,
          hidden: row.sponsor_feed_status === 'hidden',
          refundPending: ['requested', 'processing', 'completed'].includes(
            row.sponsorship_refund_status
          ),
          mediaApproved: row.media_approved,
          workerEnabled: enabled
        };
        const snapshot = prepareContributionWebsite(facts);
        const changed = !isDeepStrictEqual(snapshot, row.snapshot);
        const revision = row.revision + (changed ? 1 : 0);
        let emailId = row.email_id;
        if (!emailId && this.config.email) {
          const result = await queueAdminContributionReceived(db, {
            activityId: row.id,
            contributionId: row.contribution_id,
            to: this.config.email,
            reference: row.public_reference ?? row.contribution_id,
            amountMinor: row.amount_minor,
            currency: row.currency,
            adminUrl:
              this.config.publicBaseUrl + this.adminUrl(row.contribution_id)
          });
          if (!result.messageId)
            throw new Error('Contribution email could not be queued.');
          emailId = result.messageId;
        }
        if (this.config.smsUrl)
          await db.query(
            'INSERT INTO contribution_sms_deliveries(activity_id) VALUES($1) ON CONFLICT DO NOTHING',
            [row.id]
          );
        await db.query(
          `UPDATE contribution_activity SET snapshot=$2::jsonb,revision=$3,source_version=$4,email_id=$5,updated_at=NOW() WHERE id=$1`,
          [
            row.id,
            JSON.stringify(snapshot),
            revision,
            row.source_version,
            emailId
          ]
        );
        if (changed) await this.recordPreparation(db, row, revision, snapshot);
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  private async recordPreparation(
    db: PoolClient,
    row: SourceRow,
    revision: number,
    snapshot: ContributionPreparation
  ): Promise<void> {
    await db.query(
      `INSERT INTO contribution_activity_history(activity_id,revision,state,reasons) VALUES($1,$2,$3,$4::jsonb)`,
      [row.id, revision, snapshot.state, JSON.stringify(snapshot.reasons)]
    );
    await db.query(
      `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,metadata)
      VALUES('contribution-worker','contribution.preparation','contribution',$1,$2::jsonb)`,
      [
        row.contribution_id,
        JSON.stringify({
          activityId: row.id,
          revision,
          state: snapshot.state,
          reasons: snapshot.reasons
        })
      ]
    );
  }

  private adminUrl(id: string): string {
    return `/admin/fundraiser/sponsors?sponsorshipId=${id}&tab=overview`;
  }

  private async deliverSms(): Promise<void> {
    if (!this.config.smsUrl) return;
    // A lost response can be reconciled through the mock's idempotent receipt lookup.
    await this.pool
      .query(`UPDATE contribution_sms_deliveries SET status='uncertain',error_code='LEASE_EXPIRED'
      WHERE status='sending' AND lease_until<NOW()`);
    for (let n = 0; n < 10; n++) {
      const claim = await this.pool.query<{
        activity_id: string;
        attempts: number;
        previous_status: string;
      }>(
        `WITH candidate AS (SELECT activity_id,status FROM contribution_sms_deliveries
          WHERE status IN ('queued','uncertain') AND attempts<5 AND next_attempt_at<=NOW()
          ORDER BY activity_id LIMIT 1 FOR UPDATE SKIP LOCKED)
         UPDATE contribution_sms_deliveries s SET status='sending',attempts=s.attempts+1,lease_until=NOW()+INTERVAL '30 seconds'
         FROM candidate c WHERE s.activity_id=c.activity_id RETURNING s.activity_id,s.attempts,c.status AS previous_status`
      );
      const row = claim.rows[0];
      if (!row) break;
      const key = `contribution:${row.activity_id}:admin-sms`;
      try {
        const lookup = await fetch(
          `${this.config.smsUrl}/${encodeURIComponent(key)}`,
          { signal: AbortSignal.timeout(3000), redirect: 'error' }
        );
        if (lookup.ok) {
          const receipt = (await lookup.json()) as { id?: unknown };
          if (typeof receipt.id !== 'string')
            throw new Error('INVALID_RECEIPT');
          await this.smsResult(row.activity_id, 'captured', receipt.id);
          continue;
        }
        if (lookup.status !== 404) throw new Error('LOOKUP_UNAVAILABLE');
        const event = (
          await this.pool.query<{
            amount_minor: number;
            currency: string;
            public_reference: string | null;
          }>(
            'SELECT e.amount_minor,e.currency,c.public_reference FROM contribution_activity e JOIN fund_contributions c ON c.id=e.contribution_id WHERE e.id=$1',
            [row.activity_id]
          )
        ).rows[0];
        const response = await fetch(this.config.smsUrl, {
          method: 'POST',
          signal: AbortSignal.timeout(3000),
          redirect: 'error',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            idempotencyKey: key,
            recipient: 'simulation-admin',
            text: `OpenG7 : contribution ${event.public_reference ?? row.activity_id}, ${(event.amount_minor / 100).toFixed(2)} ${event.currency.toUpperCase()} confirmée. Consultez l’administration.`
          })
        });
        if (!response.ok) throw new Error('SMS_UNAVAILABLE');
        const receipt = (await response.json()) as { id?: unknown };
        if (typeof receipt.id !== 'string') throw new Error('INVALID_RECEIPT');
        await this.smsResult(row.activity_id, 'captured', receipt.id);
      } catch {
        await this.pool.query(
          `UPDATE contribution_sms_deliveries SET status='uncertain',error_code='RECEIPT_UNCONFIRMED',
          next_attempt_at=NOW()+INTERVAL '30 seconds',lease_until=NULL,updated_at=NOW() WHERE activity_id=$1`,
          [row.activity_id]
        );
      }
    }
  }
  private async smsResult(
    id: string,
    status: 'captured',
    receipt: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE contribution_sms_deliveries SET status=$2,receipt_id=$3,error_code=NULL,lease_until=NULL,updated_at=NOW() WHERE activity_id=$1`,
      [id, status, receipt.slice(0, 120)]
    );
  }

  async list(
    query: { before?: string; after?: string; id?: string } = {}
  ): Promise<ContributionActivityResponse> {
    for (const value of Object.values(query))
      if (!/^[1-9]\d{0,17}$/.test(value))
        throw new RangeError('Invalid activity cursor.');
    if (query.before && query.after)
      throw new RangeError('Conflicting cursors.');
    const result = await this.pool.query<{
      id: string;
      contribution_id: string;
      public_reference: string | null;
      sponsor_company_name: string | null;
      amount_minor: number;
      currency: string;
      confirmed_at: Date;
      revision: number;
      snapshot: ContributionPreparation | null;
      email: ContributionActivityItem['email'];
      sms: ContributionActivityItem['sms'];
      history: ContributionActivityItem['history'];
    }>(
      `SELECT e.*,c.public_reference,c.sponsor_company_name,
        CASE WHEN e.source_version=concat(c.updated_at::text,'|',media.version,'|',COALESCE(w.enabled,$4::boolean)::text)
          THEN e.snapshot ELSE NULL END AS snapshot,
        COALESCE(m.status,'not_configured') AS email,COALESCE(s.status,'disabled') AS sms,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('revision',h.revision,'state',h.state,'reasons',h.reasons,'at',h.created_at) ORDER BY h.revision)
          FROM (SELECT * FROM contribution_activity_history WHERE activity_id=e.id ORDER BY revision DESC LIMIT 30) h),'[]'::jsonb) AS history
      FROM contribution_activity e JOIN fund_contributions c ON c.id=e.contribution_id
      CROSS JOIN publication_worker_settings w
      LEFT JOIN LATERAL (SELECT max(updated_at)::text AS version FROM sponsor_media_assets WHERE contribution_id=c.id) media ON TRUE
      LEFT JOIN email_messages m ON m.id=e.email_id LEFT JOIN contribution_sms_deliveries s ON s.activity_id=e.id
      WHERE ($1::bigint IS NULL OR e.id<$1) AND ($2::bigint IS NULL OR e.id>$2) AND ($3::bigint IS NULL OR e.id=$3)
      ORDER BY ${query.after ? 'e.id ASC' : 'e.id DESC'} LIMIT 51`,
      [
        query.before ?? null,
        query.after ?? null,
        query.id ?? null,
        this.config.workerDefault
      ]
    );
    return {
      hasMore: result.rows.length > 50,
      items: result.rows.slice(0, 50).map((r) => ({
        id: r.id,
        contributionId: r.contribution_id,
        reference: r.public_reference ?? r.contribution_id,
        companyName: r.sponsor_company_name,
        amountMinor: r.amount_minor,
        currency: r.currency.toUpperCase(),
        confirmedAt: r.confirmed_at.toISOString(),
        revision: r.revision,
        preparation: r.snapshot,
        email: r.email,
        sms: r.sms,
        simulatedSms: r.sms !== 'disabled',
        adminUrl: this.adminUrl(r.contribution_id),
        history: r.history
      }))
    };
  }

  async claimPresentation(
    ids: unknown,
    actor: string
  ): Promise<{ ids: string[] }> {
    if (
      !Array.isArray(ids) ||
      ids.length > 50 ||
      ids.some((id) => typeof id !== 'string' || !/^[1-9]\d{0,17}$/.test(id))
    )
      throw new RangeError('Invalid activity IDs.');
    const result = await this.pool.query<{ activity_id: string }>(
      `INSERT INTO contribution_activity_presentations(activity_id,actor)
       SELECT id,$2 FROM contribution_activity WHERE id=ANY($1::bigint[])
       ON CONFLICT DO NOTHING RETURNING activity_id`,
      [ids, actor]
    );
    return { ids: result.rows.map((r) => r.activity_id) };
  }
}
