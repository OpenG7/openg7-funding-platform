import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

import pg from 'pg';

import {
  composePublicationRecognition,
  selectPublicationRecognitionSources
} from '../../dist/packages/funding-core/src/index.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { getModerationContent } from '../../dist/apps/funding-api/src/moderation/repository.js';
import {
  preparationCandidates,
  preparationFingerprintSql,
  recognitionSource,
  recordBlockedSource
} from '../../dist/apps/funding-api/src/publication-automation/preparation-sources.js';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'source rendering cache advances and invalidates under append-only runtime permissions',
  { timeout: 180000 },
  async (t) => {
    const database = await startDisposablePostgres();
    let runtime;
    t.after(async () => {
      await runtime?.end();
      await database.stop();
    });
    const pool = database.pool;
    const role = 'og7_source_render_cache_test';
    const password = randomBytes(32).toString('hex');
    const databaseName = (await pool.query('SELECT current_database() AS name'))
      .rows[0].name;
    await pool.query(
      buildRuntimeRoleSql(
        { role, database: databaseName, password },
        { create: true }
      )
    );
    runtime = new pg.Pool({ ...pool.options, user: role, password });
    const service = new PublicationAutomationService(
      runtime,
      { readPrivateObject: async () => null },
      {
        SOCIAL_PUBLICATION_MODE: 'mock',
        SOCIAL_PUBLICATION_WORKER_ENABLED: 'false'
      }
    );
    const feedId = 'openg20:facebook';
    const now = new Date('2027-01-04T00:00:00Z');

    async function reset() {
      // The helper owns this fresh tmpfs database; no configured DB is consumed.
      await pool.query(
        'TRUNCATE fund_contributions,publication_deliveries,publication_recurrences,social_publication_jobs,sponsor_publication_drafts,sponsor_publication_batches,publication_slots,admin_audit_log CASCADE'
      );
      await pool.query(
        `UPDATE publication_feeds SET paused=TRUE,auto_prepare=FALSE,
          timezone='UTC',weekdays=ARRAY[0,1,2,3,4,5,6],local_time='12:00',
          capacity=8,horizon_days=2,updated_at=NOW()`
      );
    }

    async function seed(overrides = {}) {
      const contributionId = randomUUID();
      const draftId = randomUUID();
      const source = {
        contributionId,
        draftId,
        name: 'Café synthétique',
        title: 'Annonce complète',
        body: 'x'.repeat(3000),
        disclosure: 'Commandite rémunérée.',
        ...overrides
      };
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,
          public_display_consent,sponsor_review_status,sponsor_company_name,
          sponsor_feed_target,sponsor_feed_channels)
         VALUES($1,'sponsorship_interest',25000,'cad','paid',TRUE,'pending_review',$2,'openg20','["facebook"]')`,
        [contributionId, source.name]
      );
      await pool.query(
        `INSERT INTO sponsor_publication_drafts(id,contribution_id,feed_target,channel,title,body,disclosure_text,created_at)
         VALUES($1,$2,'openg20','facebook',$3,$4,$5,'2026-01-01T00:00:00.123456Z')`,
        [draftId, contributionId, source.title, source.body, source.disclosure]
      );
      return source;
    }

    async function fingerprint(draftId) {
      return (
        await runtime.query(
          `SELECT ${preparationFingerprintSql()} AS material,
            encode(digest(${preparationFingerprintSql()},'sha256'),'hex') AS fingerprint,
            d.created_at::text AS created_at
           FROM sponsor_publication_drafts d JOIN fund_contributions c ON c.id=d.contribution_id
           WHERE d.id=$1`,
          [draftId]
        )
      ).rows[0];
    }

    async function candidates() {
      return withPostgresTransaction(runtime, (client) =>
        preparationCandidates(client, 'openg20', 'facebook', 400)
      );
    }

    async function diagnose() {
      return withPostgresTransaction(runtime, async (client) => {
        const pending = await preparationCandidates(
          client,
          'openg20',
          'facebook',
          400
        );
        assert.equal(pending.length, 1);
        const source = pending[0];
        const selection = selectPublicationRecognitionSources({
          existingSources: [],
          candidates: [recognitionSource(source)],
          capacity: 8
        });
        assert.equal(selection.needsCorrection.length, 1);
        const correction = selection.needsCorrection[0];
        await recordBlockedSource(
          client,
          'synthetic-cache-test',
          source,
          correction.codeUnits,
          correction.reason
        );
        return composePublicationRecognition([recognitionSource(source)]);
      });
    }

    await t.test(
      'raw corrections invalidate exact hashes even when canonical rendering agrees',
      async (t) => {
        const cases = [
          {
            name: 'null to empty identity',
            field: 'name',
            before: null,
            after: ''
          },
          {
            name: 'NFD to NFC identity',
            field: 'name',
            before: 'Cafe\u0301 synthétique',
            after: 'Café synthétique'
          },
          {
            name: 'NFD to NFC title',
            field: 'title',
            before: 'Annonce Cafe\u0301',
            after: 'Annonce Café'
          },
          {
            name: 'CRLF to LF body',
            field: 'body',
            before: 'Ligne\r\n' + 'x'.repeat(3000),
            after: 'Ligne\n' + 'x'.repeat(3000)
          },
          {
            name: 'NFD to NFC disclosure',
            field: 'disclosure',
            before: 'Commandite re\u0301mune\u0301re\u0301e.',
            after: 'Commandite rémunérée.'
          }
        ];
        for (const scenario of cases) {
          await t.test(scenario.name, async () => {
            await reset();
            const source = await seed({ [scenario.field]: scenario.before });
            const before = await fingerprint(source.draftId);
            assert.equal(
              before.fingerprint,
              createHash('sha256').update(before.material, 'utf8').digest('hex')
            );
            const renderedBefore = await diagnose();
            assert.deepEqual(await candidates(), []);
            const columns = {
              title: 'title',
              body: 'body',
              disclosure: 'disclosure_text'
            };
            if (scenario.field === 'name')
              await pool.query(
                'UPDATE fund_contributions SET sponsor_company_name=$2,updated_at=clock_timestamp() WHERE id=$1',
                [source.contributionId, scenario.after]
              );
            else
              await pool.query(
                `UPDATE sponsor_publication_drafts SET ${columns[scenario.field]}=$2,updated_at=clock_timestamp() WHERE id=$1`,
                [source.draftId, scenario.after]
              );
            const after = await fingerprint(source.draftId);
            assert.notEqual(after.fingerprint, before.fingerprint);
            assert.equal(after.created_at, before.created_at);
            assert.equal(
              after.fingerprint,
              createHash('sha256').update(after.material, 'utf8').digest('hex')
            );
            assert.equal((await candidates())[0].id, source.draftId);
            assert.equal(await diagnose(), renderedBefore);
            assert.deepEqual(await candidates(), []);
            const audit = (
              await runtime.query(
                `SELECT metadata FROM admin_audit_log WHERE entity_id=$1
                 AND action='publication_automation.source_render_blocked'`,
                [source.draftId]
              )
            ).rows;
            assert.equal(audit.length, 2);
            assert.equal(
              new Set(audit.map((row) => row.metadata.fingerprint)).size,
              2
            );
          });
        }
      }
    );

    await t.test(
      'an authoritative name correction re-enters preparation without changing source age or approval',
      async () => {
        await reset();
        const source = await seed({
          name: 'Long'.repeat(30),
          body: 'x'.repeat(2820)
        });
        const before = await fingerprint(source.draftId);
        const subject = { type: 'publication_draft', id: source.draftId };
        const reviewBefore = await withPostgresTransaction(runtime, (client) =>
          getModerationContent(client, subject)
        );
        assert.equal(reviewBefore.currentDecisionId, null);
        await service.prepare(feedId, 'synthetic-planner', now);
        assert.equal(
          (
            await runtime.query(
              'SELECT count(*)::int AS n FROM publication_deliveries'
            )
          ).rows[0].n,
          0
        );
        await pool.query(
          'UPDATE fund_contributions SET sponsor_company_name=$2,updated_at=clock_timestamp() WHERE id=$1',
          [source.contributionId, 'Court']
        );
        const reviewAfter = await withPostgresTransaction(runtime, (client) =>
          getModerationContent(client, subject)
        );
        assert.equal(
          reviewAfter.contentVersion,
          reviewBefore.contentVersion + 1
        );
        assert.notEqual(reviewAfter.fingerprint, reviewBefore.fingerprint);
        assert.equal(reviewAfter.currentDecisionId, null);
        await service.prepare(feedId, 'synthetic-planner', now);
        const delivery = (
          await runtime.query('SELECT * FROM publication_deliveries')
        ).rows[0];
        assert.ok(delivery);
        assert.equal(delivery.status, 'draft');
        assert.equal(delivery.approved_at, null);
        assert.equal(delivery.attempts, 0);
        assert.ok(delivery.message.length <= 2900);
        assert.ok(delivery.message.includes('Partenaire : Court'));
        assert.ok(delivery.message.includes(source.title));
        assert.ok(delivery.message.includes(source.body));
        assert.ok(delivery.message.includes(source.disclosure));
        assert.equal(
          (await fingerprint(source.draftId)).created_at,
          before.created_at
        );
        const draft = (
          await runtime.query(
            'SELECT status,approved_at FROM sponsor_publication_drafts WHERE id=$1',
            [source.draftId]
          )
        ).rows[0];
        assert.deepEqual(draft, { status: 'draft', approved_at: null });
        assert.equal(
          (
            await runtime.query(
              'SELECT count(*)::int AS n FROM moderation_decisions WHERE subject_id=ANY($1::uuid[])',
              [[source.draftId, source.contributionId, delivery.id]]
            )
          ).rows[0].n,
          0
        );
      }
    );

    await t.test(
      '400 invalid identities are diagnosed once and source 401 advances on the next preparation',
      async () => {
        await reset();
        const fixtures = Array.from({ length: 401 }, (_, index) => ({
          contribution_id: randomUUID(),
          draft_id: randomUUID(),
          queue_position: index,
          name:
            index < 400 ? `Source ${index}\nà corriger` : 'Source valide 401'
        }));
        await pool.query(
          `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,
            public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_feed_target,sponsor_feed_channels)
           SELECT contribution_id,'sponsorship_interest',25000,'cad','paid',TRUE,'pending_review',name,'openg20','["facebook"]'::jsonb
           FROM jsonb_to_recordset($1::jsonb) AS fixture(contribution_id uuid,name text)`,
          [JSON.stringify(fixtures)]
        );
        await pool.query(
          `INSERT INTO sponsor_publication_drafts(id,contribution_id,feed_target,channel,title,body,disclosure_text,created_at)
           SELECT draft_id,contribution_id,'openg20','facebook','Annonce complète','Corps intégral.','Commandite rémunérée.',
             '2026-01-01T00:00:00Z'::timestamptz+queue_position*interval '1 microsecond'
           FROM jsonb_to_recordset($1::jsonb) AS fixture(draft_id uuid,contribution_id uuid,queue_position integer)`,
          [JSON.stringify(fixtures)]
        );
        const valid = fixtures[400];
        const age = await fingerprint(valid.draft_id);
        await service.prepare(feedId, 'synthetic-planner', now);
        let rows = (
          await runtime.query(
            `SELECT entity_id,metadata FROM admin_audit_log WHERE action='publication_automation.source_render_blocked'`
          )
        ).rows;
        assert.equal(rows.length, 400);
        assert.equal(new Set(rows.map((row) => row.entity_id)).size, 400);
        assert.ok(
          rows.every((row) => row.metadata.reason === 'SOURCE_CONTENT_MISSING')
        );
        assert.equal(
          (
            await runtime.query(
              'SELECT count(*)::int AS n FROM publication_deliveries'
            )
          ).rows[0].n,
          0
        );
        assert.equal((await candidates())[0].id, valid.draft_id);
        await service.prepare(feedId, 'synthetic-planner', now);
        await service.prepare(feedId, 'synthetic-planner', now);
        const deliveries = (
          await runtime.query(
            'SELECT status,approved_at,attempts,source_snapshot,message FROM publication_deliveries'
          )
        ).rows;
        assert.equal(deliveries.length, 1);
        assert.equal(deliveries[0].status, 'draft');
        assert.equal(deliveries[0].approved_at, null);
        assert.equal(deliveries[0].attempts, 0);
        assert.deepEqual(
          deliveries[0].source_snapshot.map((source) => source.id),
          [valid.draft_id]
        );
        assert.ok(deliveries[0].message.includes(valid.name));
        rows = (
          await runtime.query(
            `SELECT entity_id FROM admin_audit_log WHERE action='publication_automation.source_render_blocked'`
          )
        ).rows;
        assert.equal(rows.length, 400);
        assert.equal(
          (await fingerprint(valid.draft_id)).created_at,
          age.created_at
        );
      }
    );

    await t.test(
      'cache facts can be read and appended but never rewritten by runtime',
      async () => {
        await reset();
        await seed();
        await diagnose();
        const count = (
          await runtime.query('SELECT count(*)::int AS n FROM admin_audit_log')
        ).rows[0].n;
        assert.ok(count > 0);
        await assert.rejects(
          runtime.query(
            "UPDATE admin_audit_log SET actor='modified-synthetic'"
          ),
          { code: '42501' }
        );
        await assert.rejects(runtime.query('DELETE FROM admin_audit_log'), {
          code: '42501'
        });
        assert.equal(
          (
            await runtime.query(
              'SELECT count(*)::int AS n FROM admin_audit_log'
            )
          ).rows[0].n,
          count
        );
      }
    );
  }
);
