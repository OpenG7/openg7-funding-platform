import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AdminAutomaticRunsService } from '../../dist/apps/funding-api/src/admin-automatic-runs.service.js';
import { createAdminPublicationDraft } from '../../dist/apps/funding-api/src/fund-publication-drafts.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';

test(
  'selected native portfolio freezes only missing dossiers, replays safely and preserves late human edits',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const service = new AdminAutomaticRunsService(pool),
      actor = 'synthetic-plan-owner';
    const create = async () => {
      const id = (
        await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,sponsor_company_name,
      sponsor_public_summary,sponsor_contact_email,sponsor_review_status,sponsor_details_submitted_at,public_display_consent,sponsor_site_visibility_held)
      VALUES('sponsorship_interest',1500,'CAD','paid',NOW(),'Synthetic plan','Synthetic public summary','synthetic@example.invalid','approved',NOW(),TRUE,TRUE) RETURNING id`)
      ).rows[0].id;
      await recordFixtureSponsorshipAgreement(pool, id, {
        channel: 'facebook',
        quantity: 2
      });
      await approveFixtureSubject(pool, { type: 'sponsorship', id });
      return id;
    };
    const missing = await create(),
      edited = await create(),
      secondMissing = await create();
    const existing = await createAdminPublicationDraft(
      pool,
      { contributionId: edited, feedTarget: 'openg7', channel: 'facebook' },
      actor
    );
    await pool.query(
      "UPDATE sponsor_publication_drafts SET body='Human text must survive' WHERE id=$1",
      [existing.draft.id]
    );
    const before = (
      await pool.query('SELECT count(*)::int n FROM admin_audit_log')
    ).rows[0].n;
    const plan = await service.preparationPlan();
    assert.equal(plan.candidateDossiers, 2);
    assert.equal(plan.missingPassages, 2);
    assert.equal(plan.preservedPassages, 1);
    assert.ok(plan.items.some((item) => item.contributionId === missing));
    assert.ok(plan.items.every((item) => item.drafts[0].ordinal === 1));
    assert.equal(
      (await pool.query('SELECT count(*)::int n FROM admin_automatic_runs'))
        .rows[0].n,
      0
    );
    assert.equal(
      (await pool.query('SELECT count(*)::int n FROM admin_audit_log')).rows[0]
        .n,
      before
    );
    const selection = plan.items.map(({ contributionId, version }) => ({
      contributionId,
      version
    }));
    const request = {
      requestId: randomUUID(),
      preparationSelection: selection
    };
    const started = await service.start(request, actor);
    assert.equal(started.run.dossierCount, 2);
    assert.equal(started.run.newPaymentCount, 1);
    assert.deepEqual(started.run.currencyTotals, [
      { currency: 'CAD', amountMinor: 3000 }
    ]);
    const manifest = (
      await pool.query(
        'SELECT contribution_id FROM admin_automatic_run_dossiers WHERE run_id=$1',
        [started.run.id]
      )
    ).rows;
    assert.deepEqual(
      manifest.map((r) => r.contribution_id).sort(),
      [missing, secondMissing].sort()
    );
    // A native editor can create and retouch the draft after the advisory preview.
    const late = await createAdminPublicationDraft(
      pool,
      { contributionId: missing, feedTarget: 'openg7', channel: 'facebook' },
      actor
    );
    await pool.query(
      "UPDATE sponsor_publication_drafts SET body='Late human edit' WHERE id=$1",
      [late.draft.id]
    );
    const command = {
      runId: started.run.id,
      expectedVersion: started.run.version,
      requestId: randomUUID()
    };
    const first = await service.advance(command, actor);
    assert.equal(first.run.status, 'running');
    assert.equal(first.run.latestEntry.actions.length, 1);
    assert.ok(first.run.latestEntry.actions.every((a) => a.created === false));
    const completed = await service.advance(
      {
        runId: first.run.id,
        expectedVersion: first.run.version,
        requestId: randomUUID()
      },
      actor
    );
    assert.equal(completed.run.status, 'completed');
    assert.equal(completed.run.latestEntry.actions.length, 1);
    assert.equal(completed.run.latestEntry.actions[0].created, true);
    assert.equal(completed.run.globalBalanced, false);
    const native = (
      await pool.query(
        'SELECT title,body,disclosure_text,obligation_id FROM sponsor_publication_drafts WHERE contribution_id=$1',
        [secondMissing]
      )
    ).rows[0];
    const proposed = plan.items.find(
      (item) => item.contributionId === secondMissing
    ).drafts[0];
    assert.deepEqual(native, {
      title: proposed.title,
      body: proposed.body,
      disclosure_text: proposed.disclosureText,
      obligation_id: proposed.obligationId
    });
    assert.equal(
      (
        await pool.query(
          'SELECT body FROM sponsor_publication_drafts WHERE id=$1',
          [late.draft.id]
        )
      ).rows[0].body,
      'Late human edit'
    );
    assert.equal(
      (
        await pool.query(
          'SELECT body FROM sponsor_publication_drafts WHERE id=$1',
          [existing.draft.id]
        )
      ).rows[0].body,
      'Human text must survive'
    );
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int n FROM sponsor_publication_drafts'
        )
      ).rows[0].n,
      3
    );
    assert.deepEqual(await service.advance(command, actor), first);
    assert.deepEqual(await service.start(request, actor), started);
    await assert.rejects(
      service.start(
        {
          ...request,
          preparationSelection: [{ ...selection[0], version: 'f'.repeat(64) }]
        },
        actor
      ),
      { code: 'RUN_REQUEST_CONFLICT' }
    );
    const after = await service.preparationPlan();
    assert.equal(after.candidateDossiers, 0);
    assert.equal(after.preservedPassages, 3);
    assert.equal(
      (await pool.query('SELECT count(*)::int n FROM publication_deliveries'))
        .rows[0].n,
      0
    );
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int n FROM sponsorship_fulfilment_evidence'
        )
      ).rows[0].n,
      0
    );
    // Changed source cannot launch the previously observed selection.
    const changed = await create();
    const stale = (await service.preparationPlan()).items.find(
      (item) => item.contributionId === changed
    );
    await pool.query(
      "UPDATE fund_contributions SET sponsor_public_summary='New source',updated_at=clock_timestamp() WHERE id=$1",
      [changed]
    );
    await assert.rejects(
      service.start(
        {
          requestId: randomUUID(),
          preparationSelection: [
            { contributionId: changed, version: stale.version }
          ]
        },
        actor
      ),
      { code: 'RUN_VERSION_STALE' }
    );
    await assert.rejects(
      service.start(
        {
          requestId: randomUUID(),
          preparationSelection: [
            { contributionId: edited, version: selection[0].version }
          ]
        },
        actor
      ),
      { code: 'RUN_VERSION_STALE' }
    );
  }
);
