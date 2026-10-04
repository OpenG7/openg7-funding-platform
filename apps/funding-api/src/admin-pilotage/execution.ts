import type { Pool } from 'pg';

import type {
  PilotCommand,
  PublicationFeedId
} from '../../../../packages/funding-core/src/index.js';
import { pilotageVersion as hash } from '../admin-pilotage-version.js';
import {
  listAdminExpenses,
  updateAdminExpense
} from '../fund-admin.repository.js';
import { updateSponsorshipReview } from '../fund-contributions.repository.js';
import { withPostgresTransaction } from '../postgres-transaction.js';

import { audit } from './audit.js';
import type { PilotExecutionPorts } from './contracts.js';
import { requireValue } from './errors.js';

export class AdminPilotageExecution {
  constructor(
    private readonly pool: Pool,
    private readonly ports: PilotExecutionPorts
  ) {}

  async execute(c: PilotCommand, actor: string): Promise<string> {
    if (c.action === 'programme.apply') {
      await this.ports.editorial.apply(
        c.targetId as PublicationFeedId,
        c.version,
        c.payload!.moves!,
        actor
      );
      return 'REVIEW_REQUIRED';
    }
    if (c.action === 'editorial.preferences') {
      await this.ports.editorial.preferences(
        c.targetId as PublicationFeedId,
        c.version,
        c.payload!.preferences!,
        actor
      );
      return 'SAVED';
    }
    if (c.action === 'publication.repair') {
      await this.ports.publications.repair(c.targetId, c.version, actor);
      return 'REVIEW_REQUIRED';
    }
    if (c.action === 'publication.edit' && c.payload?.editorialIntent) {
      await this.ports.editorial.editWithIntent(c, actor);
      return 'REVIEW_REQUIRED';
    }
    if (c.action.startsWith('publication.')) {
      const version = Number(c.version);
      requireValue(
        Number.isSafeInteger(version) && version > 0,
        'INVALID_COMMAND',
        400
      );
      if (c.action === 'publication.edit')
        await this.ports.publications.command(
          {
            action: 'edit',
            id: c.targetId,
            version,
            message: c.payload!.message!,
            scheduledAt: c.payload!.scheduledAt!,
            mediaId: c.payload!.mediaId!
          },
          actor
        );
      else if (c.action === 'publication.approve')
        await this.ports.publications.command(
          {
            action: 'approve',
            id: c.targetId,
            version,
            confirmation: c.targetId,
            approveSponsors: c.payload?.approveSponsors
          },
          actor
        );
      else
        await this.ports.publications.command(
          {
            action: 'reject',
            id: c.targetId,
            version,
            confirmation: c.targetId
          },
          actor
        );
      return c.action === 'publication.approve'
        ? 'SCHEDULED'
        : c.action === 'publication.reject'
          ? 'REJECTED'
          : 'SAVED';
    }
    if (c.action.startsWith('feed.')) {
      const current = (await this.ports.publications.state()).feeds.find(
        (f) => f.id === c.targetId
      );
      requireValue(current && hash(current) === c.version, 'VERSION_CONFLICT');
      await withPostgresTransaction(this.pool, async (db) => {
        const feed = (
          await db.query(
            'SELECT * FROM publication_feeds WHERE id=$1 FOR UPDATE',
            [c.targetId]
          )
        ).rows[0];
        requireValue(
          feed &&
            feed.paused === current.paused &&
            feed.auto_prepare === current.autoPrepare &&
            feed.timezone === current.timezone &&
            JSON.stringify(feed.weekdays) ===
              JSON.stringify(current.weekdays) &&
            String(feed.local_time).slice(0, 5) === current.localTime &&
            feed.capacity === current.capacity &&
            feed.horizon_days === current.horizonDays &&
            feed.connection === current.connection &&
            (feed.checked_at?.toISOString() ?? null) === current.checkedAt,
          'VERSION_CONFLICT'
        );
        await db.query(
          'UPDATE publication_feeds SET paused=$2,updated_at=NOW() WHERE id=$1',
          [c.targetId, c.action === 'feed.pause']
        );
        await audit(db, actor, c.action, c.targetId);
      });
      return 'SAVED';
    }
    if (c.action.startsWith('sponsor.')) {
      await withPostgresTransaction(this.pool, async (db) => {
        const row = (
          await db.query(
            'SELECT sponsor_review_status FROM fund_contributions WHERE id=$1 FOR UPDATE',
            [c.targetId]
          )
        ).rows[0];
        requireValue(
          row?.sponsor_review_status === 'pending_review',
          'REVIEW_UNAVAILABLE'
        );
        const r = await updateSponsorshipReview(db as unknown as Pool, {
          contributionId: c.targetId,
          expectedVersion: c.version,
          reviewStatus:
            c.action === 'sponsor.approve' ? 'approved' : 'rejected',
          reviewNote: c.payload?.reason ?? null
        });
        requireValue(
          r.updated,
          r.status === 'media_required'
            ? 'SPONSOR_MEDIA_REQUIRED'
            : r.status === 'payment_not_eligible'
              ? 'PAYMENT_REQUIRED'
              : 'VERSION_CONFLICT'
        );
        if (c.action === 'sponsor.approve')
          await db.query(
            'UPDATE fund_contributions SET sponsor_site_visibility_held=TRUE WHERE id=$1',
            [c.targetId]
          );
        await audit(db, actor, c.action, c.targetId);
      });
      return c.action === 'sponsor.approve' ? 'APPROVED' : 'REJECTED';
    }
    if (c.action === 'email.retry') {
      await withPostgresTransaction(this.pool, async (db) => {
        const r = await db.query(
          `UPDATE email_messages SET status='queued',attempts=LEAST(attempts,GREATEST(max_attempts-1,0)),next_attempt_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='failed' AND updated_at::text=$2 RETURNING id`,
          [c.targetId, c.version]
        );
        requireValue(r.rowCount, 'VERSION_CONFLICT');
        await audit(db, actor, 'email.retry_queued', c.targetId);
      });
      return 'EMAIL_QUEUED';
    }
    const p = (await listAdminExpenses(this.pool)).expenses.find(
      (p) => p.id === c.targetId
    );
    requireValue(p && p.updated_at === c.version, 'VERSION_CONFLICT');
    requireValue(
      c.action !== 'project.publish' || p.public_description.trim(),
      'CONTENT_REQUIRED'
    );
    const r = await updateAdminExpense(
      this.pool,
      {
        expenseId: c.targetId,
        expectedVersion: c.version,
        confirmation: c.confirmation,
        status: c.action === 'project.publish' ? 'published' : 'private'
      },
      {
        actor,
        action:
          c.action === 'project.publish'
            ? 'achievement.published'
            : 'achievement.hidden'
      }
    );
    requireValue(r.updated, 'VERSION_CONFLICT');
    return 'SAVED';
  }
}
