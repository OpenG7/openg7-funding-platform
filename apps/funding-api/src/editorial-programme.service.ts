import type { Pool, PoolClient } from 'pg';

import {
  composeProgramme,
  EDITORIAL_INTENTS,
  editorialIntent,
  editorialVariant,
  programmeWarnings,
  type EditorialIntent,
  type ProgrammeMove,
  type ProgrammeState,
  type PublicationFeedId,
  type PilotCommand
} from '../../../packages/funding-core/src/index.js';

import { PublicationAutomationService } from './publication-automation/service.js';
import {
  assert,
  digest,
  isFeed,
  recurrenceTimes,
  validateContent,
  validId
} from './publication-automation/policy.js';
import { editorialProfiles } from './publication-automation/editorial-profiles.js';

const active = ['draft', 'approved', 'blocked', 'publishing', 'uncertain'];
export class EditorialProgrammeService {
  constructor(
    private readonly pool: Pool,
    private readonly publications: PublicationAutomationService
  ) {}
  async state(
    writable = true,
    db: Pool | PoolClient = this.pool
  ): Promise<ProgrammeState> {
    const state = await this.publications.state(db);
    const deliveries = state.deliveries.filter((d) =>
      active.includes(d.status)
    );
    const expected =
      state.summary.awaitingApproval +
      state.summary.scheduled +
      state.summary.exceptions;
    const available = (
      await db.query(
        "SELECT to_regclass('public.publication_editorial_profiles') AS profiles,to_regclass('public.admin_command_receipts') AS receipts"
      )
    ).rows[0];
    const complete = deliveries.length === expected;
    const profiles = available.profiles ? await editorialProfiles(db) : [];
    const issues: ProgrammeState['issues'] = [];
    for (const d of deliveries) {
      const facts = await this.publications.sourceIssues(d.id, db);
      const codes = [...facts.codes];
      if (d.errorCode && !codes.includes(d.errorCode)) codes.push(d.errorCode);
      if (d.status === 'uncertain' && !codes.includes('RESULT_UNKNOWN'))
        codes.push('RESULT_UNKNOWN');
      if (!codes.length) continue;
      issues.push({
        deliveryId: d.id,
        codes,
        excludedSponsorIds: facts.excludedSponsorIds,
        repair:
          complete && available.profiles
            ? await this.publications.repairPreview(d.id, db)
            : null
      });
    }
    const blocked = new Set(issues.map((i) => i.deliveryId));
    const scheduled = deliveries.filter(
      (d) => d.status === 'approved' && !blocked.has(d.id)
    );
    return {
      generatedAt: new Date().toISOString(),
      version: digest(
        JSON.stringify({ feeds: state.feeds, deliveries, profiles, issues })
      ),
      complete,
      writable:
        writable && complete && !!available.profiles && !!available.receipts,
      feeds: state.feeds,
      profiles,
      deliveries,
      issues,
      briefing: {
        ready: deliveries.filter(
          (d) =>
            d.status === 'draft' &&
            !blocked.has(d.id) &&
            Date.parse(d.scheduledAt) > Date.now()
        ).length,
        scheduled: scheduled.length,
        blocked: blocked.size,
        coveredUntil:
          scheduled
            .map((d) => d.scheduledAt)
            .sort()
            .at(-1) ?? null
      }
    };
  }
  async propose(value: unknown) {
    const q = value as {
      feedId: PublicationFeedId;
      cadence: number;
      includeApproved: boolean;
    };
    assert(
      q &&
        typeof q === 'object' &&
        Object.keys(q).every((k) =>
          ['feedId', 'cadence', 'includeApproved'].includes(k)
        ) &&
        isFeed(q.feedId) &&
        Number.isInteger(q.cadence) &&
        q.cadence >= 1 &&
        q.cadence <= 7 &&
        typeof q.includeApproved === 'boolean',
      'INVALID_PROGRAMME',
      400
    );
    const state = await this.state();
    const feed = state.feeds.find((f) => f.id === q.feedId)!;
    const availableSlots = recurrenceTimes(
      { ...feed, weekdays: [0, 1, 2, 3, 4, 5, 6], horizonDays: 7 },
      new Date()
    );
    // Distribute over the remaining local days, rather than choosing a weekday
    // that has already elapsed (e.g. Monday morning when reviewing on Monday evening).
    const count = Math.min(q.cadence, availableSlots.length);
    const slots = Array.from(
      { length: count },
      (_, index) =>
        availableSlots[Math.floor((index * availableSlots.length) / count)]!
    );
    return {
      version: state.version,
      plan: composeProgramme(
        state.deliveries.filter((d) => d.feedId === q.feedId),
        slots,
        state.issues.map((i) => i.deliveryId),
        q.includeApproved
      )
    };
  }
  async variant(value: unknown) {
    const q = value as { id: string; version: number; instruction: string };
    assert(
      q &&
        typeof q === 'object' &&
        Object.keys(q).every((k) =>
          ['id', 'version', 'instruction'].includes(k)
        ) &&
        validId(q.id) &&
        Number.isInteger(q.version) &&
        typeof q.instruction === 'string' &&
        q.instruction.length <= 300,
      'INVALID_INTENT',
      400
    );
    const intent = editorialIntent(q.instruction);
    assert(intent, 'INTENT_NOT_SUPPORTED', 400);
    const d = (await this.publications.state()).deliveries.find(
      (d) => d.id === q.id
    );
    assert(
      d &&
        d.version === q.version &&
        ['draft', 'approved', 'blocked'].includes(d.status),
      'VERSION_CONFLICT'
    );
    const issues = await this.publications.sourceIssues(d.id);
    assert(!issues.codes.length, 'SOURCE_NOT_ELIGIBLE');
    return {
      intent,
      before: d.message,
      after: editorialVariant(
        d.message,
        intent,
        d.sponsors.map((s) => s.name)
      ),
      deliveryId: d.id,
      version: d.version,
      feedId: d.feedId
    };
  }
  async apply(
    feedId: PublicationFeedId,
    version: string,
    moves: ProgrammeMove[],
    actor: string
  ): Promise<void> {
    await this.transaction(async (db) => {
      // Same order as preparation: feed, deliveries, sources. All edits commit together.
      await db.query('SELECT id FROM publication_feeds ORDER BY id FOR UPDATE');
      await db.query(
        "SELECT id FROM publication_deliveries WHERE status IN ('draft','approved','blocked','publishing','uncertain') ORDER BY id FOR UPDATE"
      );
      const state = await this.state(true, db);
      assert(state.writable && state.version === version, 'VERSION_CONFLICT');
      assert(
        moves.length > 0 &&
          moves.length <= 100 &&
          new Set(moves.map((m) => m.id)).size === moves.length,
        'INVALID_PROGRAMME',
        400
      );
      const warnings = programmeWarnings(state.deliveries, moves);
      assert(
        !warnings.some(
          (w) =>
            w.code === 'collision' &&
            w.ids.some((id) => moves.some((m) => m.id === id))
        ),
        'PROGRAMME_COLLISION'
      );
      for (const move of [...moves].sort((a, b) => a.id.localeCompare(b.id))) {
        const d = state.deliveries.find((d) => d.id === move.id);
        assert(
          d &&
            d.feedId === feedId &&
            d.version === move.version &&
            ['draft', 'approved'].includes(d.status) &&
            !state.issues.some((i) => i.deliveryId === d.id),
          'VERSION_CONFLICT'
        );
        validateContent(d.message, move.scheduledAt);
        assert(
          Date.parse(move.scheduledAt) > Date.now() &&
            Date.parse(move.scheduledAt) < Date.now() + 28 * 86400000,
          'INVALID_DATE',
          400
        );
        if (move.scheduledAt === d.scheduledAt) continue;
        await this.publications.command(
          {
            action: 'edit',
            id: d.id,
            version: d.version,
            message: d.message,
            scheduledAt: move.scheduledAt,
            mediaId: d.mediaId
          },
          actor,
          false,
          db
        );
      }
    });
  }
  async preferences(
    feedId: PublicationFeedId,
    version: string,
    preferences: EditorialIntent[],
    actor: string
  ): Promise<void> {
    assert(
      preferences.every((p) => EDITORIAL_INTENTS.includes(p)) &&
        new Set(preferences).size === preferences.length,
      'INVALID_INTENT',
      400
    );
    await this.transaction(async (db) => {
      const result = await db.query(
        'UPDATE publication_editorial_profiles SET preferences=$3::jsonb,version=version+1,updated_at=NOW() WHERE feed_id=$1 AND version=$2 RETURNING version',
        [feedId, Number(version), JSON.stringify(preferences)]
      );
      assert(result.rowCount, 'VERSION_CONFLICT');
      await db.query(
        "INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata) VALUES($1,'editorial.preferences','publication_feed',$2,'editorial.preferences',$3::jsonb)",
        [
          actor,
          feedId,
          JSON.stringify({ preferences, version: Number(version) })
        ]
      );
    });
  }
  async editWithIntent(c: PilotCommand, actor: string): Promise<void> {
    await this.transaction(async (db) => {
      const row = (
        await db.query(
          'SELECT * FROM publication_deliveries WHERE id=$1 FOR UPDATE',
          [c.targetId]
        )
      ).rows[0];
      assert(row && row.version === Number(c.version), 'VERSION_CONFLICT');
      const names = (
        await db.query(
          'SELECT c.sponsor_company_name FROM sponsor_publication_drafts d JOIN fund_contributions c ON c.id=d.contribution_id WHERE d.batch_id=$1',
          [row.batch_id]
        )
      ).rows.map((r) => r.sponsor_company_name as string);
      assert(
        c.payload?.editorialIntent &&
          c.payload.message ===
            editorialVariant(row.message, c.payload.editorialIntent, names) &&
          row.message !== c.payload.message,
        'VARIANT_CHANGED'
      );
      await this.publications.command(
        {
          action: 'edit',
          id: c.targetId,
          version: Number(c.version),
          message: c.payload.message,
          scheduledAt: c.payload.scheduledAt!,
          mediaId: c.payload.mediaId!
        },
        actor,
        false,
        db
      );
      await db.query(
        'INSERT INTO publication_editorial_observations(delivery_id,feed_id,intent) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [c.targetId, row.feed_id, c.payload.editorialIntent]
      );
    });
  }
  private async transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const result = await fn(db);
      await db.query('COMMIT');
      return result;
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  }
}
