import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { AdminPilotageService } from '../../dist/apps/funding-api/src/admin-pilotage.service.js';

test(
  'editorial programme uses real PostgreSQL facts and atomic, receipted commands',
  { timeout: 180000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const pool = db.pool;
    const service = new PublicationAutomationService(
      pool,
      { readPrivateObject: async () => null },
      {
        SOCIAL_PUBLICATION_MODE: 'mock',
        SOCIAL_PUBLICATION_WORKER_ENABLED: 'true'
      }
    );
    const pilot = new AdminPilotageService(pool, service),
      editorial = pilot.editorial,
      feedId = 'openg7:facebook';
    const command = (action, targetId, version, payload) => ({
      requestId: randomUUID(),
      action,
      targetId,
      version: String(version),
      confirmation: targetId,
      ...(payload ? { payload } : {})
    });
    const later = (days, hour = 13) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + days);
      d.setUTCHours(hour, 0, 0, 0);
      return d.toISOString();
    };
    async function reset() {
      await pool.query(
        'TRUNCATE fund_contributions,publication_deliveries,publication_recurrences,sponsor_publication_drafts,sponsor_publication_batches,publication_slots,admin_audit_log,admin_command_receipts CASCADE'
      );
      await pool.query(
        'UPDATE publication_feeds SET auto_prepare=FALSE,paused=TRUE,capacity=5,weekdays=ARRAY[1,2,3,4,5,6,0],horizon_days=14'
      );
      await pool.query(
        "UPDATE publication_editorial_profiles SET version=1,preferences='[]'"
      );
      await service.command({ action: 'check', feedId }, 'fixture');
    }
    async function compose(
      message = 'Merci à Atelier Boréal',
      date = later(1)
    ) {
      return (
        await service.command(
          {
            action: 'compose',
            kind: 'news',
            feedId,
            message,
            scheduledAt: date
          },
          'fixture'
        )
      ).id;
    }
    async function record(id) {
      return (await service.state()).deliveries.find((d) => d.id === id);
    }
    async function sponsor(name) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,status,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_public_summary,sponsor_feed_target,sponsor_feed_channels) VALUES($1,'sponsorship_interest',25000,'paid',TRUE,'approved',$2,'Le projet avance. Ensemble, nous avançons.','openg7','["facebook"]')`,
        [id, name]
      );
      return id;
    }
    await t.test(
      '025 can upgrade an existing database without modifying publications',
      async () => {
        await reset();
        const id = await compose();
        await pool.query(
          'DROP TABLE publication_editorial_observations,publication_editorial_profiles'
        );
        assert.equal((await editorial.state()).writable, false);
        await assert.rejects(
          pilot.command(
            command('editorial.preferences', feedId, 1, { preferences: [] }),
            'fixture'
          ),
          { code: 'PROGRAMME_UNAVAILABLE', status: 503 }
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM admin_command_receipts'
            )
          ).rows[0].n,
          0
        );
        await pool.query(
          await readFile(
            new URL(
              '../../apps/funding-api/migrations/025_create_publication_editorial_profiles.sql',
              import.meta.url
            ),
            'utf8'
          )
        );
        assert.equal((await editorial.state()).writable, true);
        assert.equal((await record(id)).version, 1);
        await assert.rejects(
          pilot.command(
            command('publication.reject', id, 1, { moves: 'malformed' }),
            'fixture'
          ),
          { code: 'INVALID_COMMAND', status: 400 }
        );
      }
    );
    await t.test(
      'preview is read-only; applying a programme revokes approvals atomically and a lost response is not replayed',
      async () => {
        await reset();
        const a = await compose('A', later(1)),
          b = await compose('B', later(2));
        await service.command(
          { action: 'approve', id: a, version: 1, confirmation: a },
          'fixture'
        );
        const before = await editorial.state();
        const proposal = await editorial.propose({
          feedId,
          cadence: 2,
          includeApproved: true
        });
        assert.equal(proposal.version, before.version);
        assert.equal(proposal.plan.moves.length, 2);
        assert.equal((await record(a)).status, 'approved');
        const moves = [
          { id: a, version: 2, scheduledAt: later(3) },
          { id: b, version: 1, scheduledAt: later(4) }
        ];
        const c = command('programme.apply', feedId, before.version, { moves });
        const outcomes = await Promise.all([
          pilot.command(c, 'fixture'),
          pilot.command(c, 'fixture')
        ]);
        assert.ok(outcomes.some((r) => r.status === 'completed'));
        assert.equal((await pilot.command(c, 'fixture')).status, 'completed');
        assert.equal((await record(a)).version, 3);
        assert.equal((await record(a)).status, 'draft');
        assert.equal((await record(a)).approvedAt, null);
        assert.equal((await record(b)).version, 2);
        assert.equal(
          (
            await pilot.command(
              command('programme.apply', feedId, before.version, { moves }),
              'fixture'
            )
          ).code,
          'VERSION_CONFLICT'
        );
        await assert.rejects(
          pilot.command(
            command('programme.apply', feedId, before.version, { moves }),
            'reader',
            false
          ),
          { code: 'READ_ONLY' }
        );
      }
    );
    await t.test(
      'failed multi-edit rolls back every change; collisions and stale versions are rejected',
      async () => {
        await reset();
        const a = await compose('A', later(1)),
          b = await compose('B', later(2));
        const before = await editorial.state();
        const invalid = command('programme.apply', feedId, before.version, {
          moves: [
            { id: a, version: 1, scheduledAt: later(3) },
            { id: b, version: 99, scheduledAt: later(4) }
          ]
        });
        assert.equal(
          (await pilot.command(invalid, 'fixture')).status,
          'failed'
        );
        assert.equal((await record(a)).version, 1);
        const collision = command('programme.apply', feedId, before.version, {
          moves: [{ id: a, version: 1, scheduledAt: later(2) }]
        });
        assert.equal(
          (await pilot.command(collision, 'fixture')).code,
          'PROGRAMME_COLLISION'
        );
      }
    );
    await t.test(
      'accepted variants count distinct publications; preferences are explicit and preserve human edits',
      async () => {
        await reset();
        for (let i = 0; i < 3; i++) {
          const id = await compose('Merci à Atelier ' + i, later(i + 1));
          const v = await editorial
            .variant({ id, version: 1, instruction: 'Ton neutre' })
            .catch(() =>
              editorial.variant({ id, version: 1, instruction: 'neutral' })
            );
          const c = command('publication.edit', id, 1, {
            message: v.after,
            scheduledAt: later(i + 1),
            mediaId: null,
            editorialIntent: v.intent
          });
          assert.equal((await pilot.command(c, 'fixture')).status, 'completed');
          await pilot.command(c, 'fixture');
        }
        let state = await editorial.state();
        assert.equal(
          state.profiles.find((p) => p.feedId === feedId).observations.neutral,
          3
        );
        assert.deepEqual(
          state.profiles.find((p) => p.feedId === feedId).preferences,
          []
        );
        const pref = command('editorial.preferences', feedId, 1, {
          preferences: ['neutral']
        });
        assert.equal(
          (await pilot.command(pref, 'fixture')).status,
          'completed'
        );
        await sponsor('Atelier des projets');
        await service.prepare(feedId, 'worker');
        const automatic = (await service.state()).deliveries.find(
          (d) => d.autoManaged
        );
        assert.ok(automatic.message.startsWith('Partenaire :'));
        await service.command(
          {
            action: 'edit',
            id: automatic.id,
            version: automatic.version,
            message: 'Texte humain conservé',
            scheduledAt: automatic.scheduledAt,
            mediaId: null
          },
          'fixture'
        );
        await pilot.command(
          command('editorial.preferences', feedId, 2, { preferences: [] }),
          'fixture'
        );
        await service.prepare(feedId, 'worker');
        assert.equal(
          (await record(automatic.id)).message,
          'Texte humain conservé'
        );
        await assert.rejects(
          editorial.variant({
            id: automatic.id,
            version: (await record(automatic.id)).version,
            instruction: 'publie et rembourse'
          }),
          { code: 'INTENT_NOT_SUPPORTED' }
        );
      }
    );
    await t.test(
      'withdrawal invalidates a future approval and recomposes only eligible sources without sending',
      async () => {
        await reset();
        const removed = await sponsor('Retiré'),
          retained = await sponsor('Conservé');
        await service.prepare(feedId, 'worker');
        let job = (await service.state()).deliveries[0];
        await service.command(
          {
            action: 'approve',
            id: job.id,
            version: job.version,
            confirmation: job.id
          },
          'fixture'
        );
        await pool.query(
          'UPDATE fund_contributions SET public_display_consent=FALSE,updated_at=NOW() WHERE id=$1',
          [removed]
        );
        const live = await editorial.state();
        const issue = live.issues.find((i) => i.deliveryId === job.id);
        assert.ok(issue.codes.includes('CONSENT_WITHDRAWN'));
        assert.deepEqual(
          issue.repair.sponsors.map((s) => s.id),
          [retained]
        );
        await service.tick();
        job = await record(job.id);
        assert.equal(job.status, 'blocked');
        assert.equal(job.approvedAt, null);
        assert.equal(job.attempts, 0);
        // The automatic invalidation changed the version: an older repair must fail.
        assert.equal(
          (
            await pilot.command(
              command('publication.repair', job.id, issue.repair.version),
              'fixture'
            )
          ).code,
          'VERSION_CONFLICT'
        );
        const fresh = (await editorial.state()).issues.find(
          (i) => i.deliveryId === job.id
        );
        const c = command('publication.repair', job.id, fresh.repair.version);
        assert.equal((await pilot.command(c, 'fixture')).status, 'completed');
        assert.equal((await pilot.command(c, 'fixture')).status, 'completed');
        job = await record(job.id);
        assert.equal(job.status, 'draft');
        assert.ok(!job.message.includes('Retiré'));
        assert.ok(job.message.includes('Conservé'));
        assert.equal(job.externalPostId, null);
        assert.equal(job.approvedAt, null);
        assert.deepEqual(
          job.sponsors.map((s) => s.id),
          [retained]
        );
        assert.equal(
          (
            await pool.query(
              'SELECT public_display_consent FROM fund_contributions WHERE id=$1',
              [removed]
            )
          ).rows[0].public_display_consent,
          false
        );
      }
    );
    await t.test(
      'uncertain sends have no repair and projection limits cannot pretend full coverage',
      async () => {
        await reset();
        const id = await compose();
        await pool.query(
          "UPDATE publication_deliveries SET status='uncertain' WHERE id=$1",
          [id]
        );
        assert.equal((await editorial.state()).issues[0].repair, null);
        await pool.query(
          "INSERT INTO publication_deliveries(feed_id,kind,message,scheduled_at,account_id,mode) SELECT 'openg7:facebook','news','Fixture '||i,NOW()+INTERVAL '1 day','fixture','mock' FROM generate_series(1,201) i"
        );
        const state = await editorial.state();
        assert.equal(state.complete, false);
        assert.equal(state.writable, false);
      }
    );
  }
);
