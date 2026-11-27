import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AdminAutomaticRunsService } from '../../dist/apps/funding-api/src/admin-automatic-runs.service.js';
import { createAdminPublicationDraft } from '../../dist/apps/funding-api/src/fund-publication-drafts.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';
import {
  readMigrations,
  buildMigrationSql
} from '../../scripts/lib/database-migrations.mjs';

test(
  'policy migration upgrades an existing manual run without granting autonomy',
  { timeout: 60000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    t.after(stop);
    const migrations = readMigrations('apps/funding-api/migrations');
    const database = (await pool.query('SELECT current_database() AS name'))
      .rows[0].name;
    await pool.query(
      buildMigrationSql(
        migrations.filter((migration) => migration.version < 73),
        { database }
      )
    );
    const id = randomUUID();
    const before = (
      await pool.query(
        "INSERT INTO admin_automatic_runs(id,actor,status,version,pass) VALUES($1,'synthetic-existing-manual','completed',7,2) RETURNING *",
        [id]
      )
    ).rows[0];
    await pool.query(buildMigrationSql(migrations, { database }));
    await pool.query(buildMigrationSql(migrations, { database }));
    const { preparation_policy, ...after } = (
      await pool.query('SELECT * FROM admin_automatic_runs WHERE id=$1', [id])
    ).rows[0];
    assert.equal(preparation_policy, null);
    assert.deepEqual(after, before);
    assert.equal(
      (
        await new AdminAutomaticRunsService(pool).state(
          'synthetic-existing-manual',
          id
        )
      ).run.preparationPolicy,
      undefined
    );
  }
);

test(
  'one-dossier private preparation policy uses native durable commands and fails closed',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const service = new AdminAutomaticRunsService(pool);
    const create = async (channels = ['facebook']) => {
      const id = (
        await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,sponsor_company_name,
      sponsor_public_summary,sponsor_contact_email,sponsor_review_status,sponsor_details_submitted_at,public_display_consent,sponsor_site_visibility_held)
      VALUES('sponsorship_interest',1500,'CAD','paid',NOW(),'Synthetic bounded preparation','Synthetic public summary','synthetic@example.invalid','approved',NOW(),TRUE,TRUE) RETURNING id`)
      ).rows[0].id;
      await recordFixtureSponsorshipAgreement(pool, id, {
        channels,
        quantity: 2
      });
      await approveFixtureSubject(pool, { type: 'sponsorship', id });
      return id;
    };
    const input = async (id, changes = {}) => {
      const item = (await service.preparationPlan()).items.find(
        (candidate) => candidate.contributionId === id
      );
      assert.ok(item);
      return {
        requestId: randomUUID(),
        preparationSelection: [
          { contributionId: item.contributionId, version: item.version }
        ],
        preparationPolicy: {
          capability: 'private_preparation',
          confirmed: true,
          maxDossiers: 1,
          maxDrafts: 4,
          maxProviderCalls: 0,
          maxCostMinor: 0,
          costCurrency: 'CAD',
          expiresAt: new Date(Date.now() + 5 * 60000).toISOString(),
          ...changes
        }
      };
    };
    const count = async (table) =>
      Number((await pool.query(`SELECT count(*) n FROM ${table}`)).rows[0].n);
    const command = (run, action) => ({
      requestId: randomUUID(),
      runId: run.id,
      expectedVersion: run.version,
      action
    });

    await t.test(
      'prepares only the selected next passage and reconciles lost response without another draft',
      async () => {
        const selected = await create(),
          excluded = await create();
        const request = await input(selected);
        const before = (
          await pool.query(
            'SELECT status,amount_cents,currency,public_display_consent,sponsor_site_visibility_held FROM fund_contributions WHERE id=$1',
            [selected]
          )
        ).rows[0];
        const completed = await service.prepareBounded(
          request,
          'synthetic-bounded-success'
        );
        assert.equal(completed.run.status, 'completed');
        assert.equal(completed.run.dossierCount, 1);
        assert.equal(completed.run.processedCount, 1);
        assert.equal(completed.run.globalBalanced, false);
        assert.deepEqual(
          completed.run.preparationPolicy,
          request.preparationPolicy
        );
        const drafts = (
          await pool.query(
            'SELECT contribution_id,status FROM sponsor_publication_drafts WHERE contribution_id=ANY($1::uuid[])',
            [[selected, excluded]]
          )
        ).rows;
        assert.deepEqual(drafts, [
          { contribution_id: selected, status: 'draft' }
        ]);
        assert.equal(
          (await service.report('synthetic-bounded-success', completed.run.id))
            .entries.length,
          1
        );
        const auditCount = await count('admin_audit_log');
        assert.deepEqual(
          await new AdminAutomaticRunsService(pool).prepareBounded(
            request,
            'synthetic-bounded-success'
          ),
          completed
        );
        assert.equal(await count('admin_audit_log'), auditCount);
        await assert.rejects(
          service.prepareBounded(
            {
              ...request,
              preparationPolicy: { ...request.preparationPolicy, maxDrafts: 2 }
            },
            'synthetic-bounded-success'
          ),
          { code: 'RUN_REQUEST_CONFLICT' }
        );
        await assert.rejects(
          service.prepareBounded(request, 'synthetic-other-actor'),
          { code: 'RUN_REQUEST_CONFLICT' }
        );
        assert.deepEqual(
          (
            await pool.query(
              'SELECT status,amount_cents,currency,public_display_consent,sponsor_site_visibility_held FROM fund_contributions WHERE id=$1',
              [selected]
            )
          ).rows[0],
          before
        );
        for (const table of [
          'publication_deliveries',
          'fund_transactions',
          'sponsorship_fulfilment_evidence',
          'admin_preparation_approvals'
        ])
          assert.equal(await count(table), 0);
        const audit = (
          await pool.query(
            "SELECT metadata FROM admin_audit_log WHERE entity_id=$1 AND action='automatic_run.dossier_checked'",
            [completed.run.id]
          )
        ).rows[0].metadata;
        assert.equal(audit.execution, 'bounded-private-preparation');
        assert.deepEqual(audit.preparationPolicy, request.preparationPolicy);
      }
    );

    await t.test(
      'refuses expired, excessive duration, widened scope and stale source before accepting a run',
      async () => {
        const id = await create(),
          other = await create();
        const request = await input(id);
        const before = await count('admin_automatic_runs');
        for (const expiresAt of [
          new Date(Date.now() - 1000).toISOString(),
          new Date(Date.now() + 16 * 60000).toISOString()
        ])
          await assert.rejects(
            service.prepareBounded(
              {
                ...request,
                preparationPolicy: { ...request.preparationPolicy, expiresAt }
              },
              'synthetic-invalid'
            ),
            { code: 'RUN_POLICY_EXPIRED_OR_TOO_LONG' }
          );
        const otherItem = (await input(other)).preparationSelection[0];
        await assert.rejects(
          service.prepareBounded(
            {
              ...request,
              preparationSelection: [...request.preparationSelection, otherItem]
            },
            'synthetic-invalid'
          ),
          { code: 'RUN_POLICY_SCOPE_REQUIRED' }
        );
        await pool.query(
          "UPDATE fund_contributions SET sponsor_public_summary='Changed source' WHERE id=$1",
          [id]
        );
        await assert.rejects(
          service.prepareBounded(request, 'synthetic-invalid'),
          { code: 'RUN_VERSION_STALE' }
        );
        assert.equal(await count('admin_automatic_runs'), before);
      }
    );

    await t.test(
      'late human edits survive a previously captured policy and manual pause fences delegated continuation',
      async () => {
        const id = await create();
        const request = await input(id);
        const started = await service.start(request, 'synthetic-preserved');
        const draft = await createAdminPublicationDraft(
          pool,
          { contributionId: id, feedTarget: 'openg7', channel: 'facebook' },
          'synthetic-editor'
        );
        await pool.query(
          "UPDATE sponsor_publication_drafts SET body='Human text preserved' WHERE id=$1",
          [draft.draft.id]
        );
        const result = await service.prepareBounded(
          request,
          'synthetic-preserved'
        );
        assert.equal(result.run.latestEntry.actions[0].created, false);
        assert.equal(
          (
            await pool.query(
              'SELECT body FROM sponsor_publication_drafts WHERE id=$1',
              [draft.draft.id]
            )
          ).rows[0].body,
          'Human text preserved'
        );
        await assert.rejects(
          pool.query(
            'UPDATE admin_automatic_runs SET preparation_policy=NULL WHERE id=$1',
            [started.run.id]
          ),
          /immutable/
        );

        const pausedId = await create();
        const pausedRequest = await input(pausedId);
        const captured = await service.start(pausedRequest, 'synthetic-paused');
        const paused = await service.control(
          command(captured.run, 'pause'),
          'synthetic-paused'
        );
        await assert.rejects(
          service.prepareBounded(pausedRequest, 'synthetic-paused'),
          { code: 'RUN_VERSION_CONFLICT' }
        );
        await service.control(
          command(paused.run, 'resume'),
          'synthetic-paused'
        );
        await assert.rejects(
          service.prepareBounded(pausedRequest, 'synthetic-paused'),
          { code: 'RUN_VERSION_CONFLICT' }
        );
        assert.equal(
          Number(
            (
              await pool.query(
                'SELECT count(*) n FROM sponsor_publication_drafts WHERE contribution_id=$1',
                [pausedId]
              )
            ).rows[0].n
          ),
          0
        );
      }
    );

    await t.test(
      'draft budget rolls back the entire private action and requires native human reconciliation',
      async () => {
        const id = await create(['facebook', 'linkedin']);
        const request = await input(id, { maxDrafts: 1 });
        await assert.rejects(
          service.prepareBounded(request, 'synthetic-budget'),
          { code: 'RUN_POLICY_DRAFT_BUDGET' }
        );
        let state = await service.state('synthetic-budget', request.requestId);
        assert.equal(state.run.status, 'uncertain');
        assert.equal(
          Number(
            (
              await pool.query(
                'SELECT count(*) n FROM sponsor_publication_drafts WHERE contribution_id=$1',
                [id]
              )
            ).rows[0].n
          ),
          0
        );
        assert.equal(
          (await service.report('synthetic-budget', request.requestId)).entries
            .length,
          0
        );
        await assert.rejects(
          service.prepareBounded(request, 'synthetic-budget'),
          { code: 'RUN_UNCERTAIN' }
        );
        state = await service.control(
          command(state.run, 'reconcile'),
          'synthetic-budget'
        );
        assert.equal(state.run.status, 'paused');
        await assert.rejects(
          service.prepareBounded(request, 'synthetic-budget'),
          { code: 'RUN_UNCERTAIN' }
        );
        // Manual recovery is a new human command under ordinary operator rights, not a renewed grant.
        state = await service.control(
          command(state.run, 'resume'),
          'synthetic-budget'
        );
        state = await service.advance(
          {
            runId: state.run.id,
            expectedVersion: state.run.version,
            requestId: randomUUID()
          },
          'synthetic-budget'
        );
        assert.equal(state.run.status, 'completed');
        assert.equal(
          state.run.latestEntry.actions.filter((a) => a.created).length,
          2
        );
      }
    );

    await t.test(
      'current consent is revalidated even after a policy was captured',
      async () => {
        const id = await create();
        const request = await input(id);
        await service.start(request, 'synthetic-consent-changed');
        await pool.query(
          'UPDATE fund_contributions SET public_display_consent=FALSE WHERE id=$1',
          [id]
        );
        const result = await service.prepareBounded(
          request,
          'synthetic-consent-changed'
        );
        assert.equal(result.run.status, 'completed');
        assert.deepEqual(result.run.latestEntry.actions, []);
        assert.equal(result.run.globalBalanced, false);
        assert.equal(
          Number(
            (
              await pool.query(
                'SELECT count(*) n FROM sponsor_publication_drafts WHERE contribution_id=$1',
                [id]
              )
            ).rows[0].n
          ),
          0
        );
      }
    );

    await t.test(
      'completed receipt remains readable after policy expiry without renewing its authority',
      async () => {
        const id = await create();
        const request = await input(id, {
          expiresAt: new Date(Date.now() + 1500).toISOString()
        });
        const completed = await service.prepareBounded(
          request,
          'synthetic-expired-receipt'
        );
        const before = await count('admin_audit_log');
        await pool.query('SELECT pg_sleep(1.6)');
        assert.deepEqual(
          await new AdminAutomaticRunsService(pool).prepareBounded(
            request,
            'synthetic-expired-receipt'
          ),
          completed
        );
        assert.equal(await count('admin_audit_log'), before);
      }
    );

    await t.test(
      'concurrent same-key submissions have one native effect and stable completed replay',
      async () => {
        const id = await create();
        const request = await input(id);
        const attempts = await Promise.allSettled([
          service.prepareBounded(request, 'synthetic-race'),
          service.prepareBounded(request, 'synthetic-race')
        ]);
        assert.ok(attempts.some((a) => a.status === 'fulfilled'));
        for (const attempt of attempts)
          if (attempt.status === 'rejected')
            assert.equal(attempt.reason.code, 'RUN_IN_PROGRESS');
        const completed = await service.prepareBounded(
          request,
          'synthetic-race'
        );
        assert.equal(completed.run.status, 'completed');
        assert.equal(
          (await service.report('synthetic-race', request.requestId)).entries
            .length,
          1
        );
        assert.equal(
          Number(
            (
              await pool.query(
                'SELECT count(*) n FROM sponsor_publication_drafts WHERE contribution_id=$1',
                [id]
              )
            ).rows[0].n
          ),
          1
        );
      }
    );

    await t.test(
      'expiry immediately before commit rolls back drafts, reports and their audit together',
      async () => {
        const id = await create();
        const request = await input(id, {
          expiresAt: new Date(Date.now() + 1500).toISOString()
        });
        await pool.query(`CREATE FUNCTION delay_synthetic_bounded_report() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        PERFORM pg_sleep(2); RETURN NEW; END; $$;
        CREATE TRIGGER delay_synthetic_bounded_report BEFORE INSERT ON admin_automatic_run_entries FOR EACH ROW EXECUTE FUNCTION delay_synthetic_bounded_report();`);
        try {
          await assert.rejects(
            service.prepareBounded(request, 'synthetic-expiry-commit'),
            { code: 'RUN_POLICY_EXPIRED' }
          );
        } finally {
          await pool.query(
            'DROP TRIGGER delay_synthetic_bounded_report ON admin_automatic_run_entries; DROP FUNCTION delay_synthetic_bounded_report()'
          );
        }
        assert.equal(
          (await service.state('synthetic-expiry-commit', request.requestId))
            .run.status,
          'uncertain'
        );
        assert.equal(
          (await service.report('synthetic-expiry-commit', request.requestId))
            .entries.length,
          0
        );
        assert.equal(
          Number(
            (
              await pool.query(
                'SELECT count(*) n FROM sponsor_publication_drafts WHERE contribution_id=$1',
                [id]
              )
            ).rows[0].n
          ),
          0
        );
        assert.equal(
          Number(
            (
              await pool.query(
                "SELECT count(*) n FROM admin_audit_log WHERE action='publication_draft.create' AND metadata->>'runId'=$1",
                [request.requestId]
              )
            ).rows[0].n
          ),
          0
        );
      }
    );

    await t.test(
      'expiry while acquiring the execution intent prevents preparation and leaves an uncertain native receipt',
      async () => {
        const id = await create();
        const request = await input(id, {
          expiresAt: new Date(Date.now() + 1500).toISOString()
        });
        await pool.query(`CREATE FUNCTION delay_synthetic_bounded_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.kind='advance' THEN PERFORM pg_sleep(2); END IF; RETURN NEW; END; $$;
      CREATE TRIGGER delay_synthetic_bounded_intent BEFORE INSERT ON admin_automatic_run_commands FOR EACH ROW EXECUTE FUNCTION delay_synthetic_bounded_intent();`);
        try {
          await assert.rejects(
            service.prepareBounded(request, 'synthetic-expiry'),
            { code: 'RUN_POLICY_EXPIRED' }
          );
        } finally {
          await pool.query(
            'DROP TRIGGER delay_synthetic_bounded_intent ON admin_automatic_run_commands; DROP FUNCTION delay_synthetic_bounded_intent()'
          );
        }
        assert.equal(
          (await service.state('synthetic-expiry', request.requestId)).run
            .status,
          'uncertain'
        );
        assert.equal(
          Number(
            (
              await pool.query(
                'SELECT count(*) n FROM sponsor_publication_drafts WHERE contribution_id=$1',
                [id]
              )
            ).rows[0].n
          ),
          0
        );
        await assert.rejects(
          service.prepareBounded(request, 'synthetic-expiry'),
          { code: 'RUN_UNCERTAIN' }
        );
      }
    );
  }
);
