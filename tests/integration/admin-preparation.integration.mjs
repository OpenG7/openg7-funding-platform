import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  buildMigrationSql,
  readMigrations
} from '../../scripts/lib/database-migrations.mjs';

import { AdminAutomaticRunsService } from '../../dist/apps/funding-api/src/admin-automatic-runs.service.js';
import { adminRoleAllows } from '../../dist/apps/funding-api/src/admin-identity.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';

const actor = 'synthetic-preparation-operator';
const command = (run) => ({
  runId: run.id,
  expectedVersion: run.version,
  requestId: randomUUID()
});
const approval = (receipt) => ({
  runId: receipt.runId,
  contributionId: receipt.contributionId,
  expectedVersion: receipt.version,
  requestId: randomUUID(),
  confirmed: true
});

test(
  'migration 056 upgrades an existing frozen run without changing confirmed facts or replaying work',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    t.after(stop);
    const database = (await pool.query('SELECT current_database() AS name'))
      .rows[0].name;
    const migrations = readMigrations('apps/funding-api/migrations');
    await pool.query(
      buildMigrationSql(
        migrations.filter((migration) => migration.version <= 55),
        { database }
      )
    );
    const contributionId = (
      await pool.query(`INSERT INTO fund_contributions
    (contribution_type,amount_cents,currency,status,paid_at)
    VALUES('personal_support',4200,'CAD','paid',NOW()) RETURNING id`)
    ).rows[0].id;
    const service = new AdminAutomaticRunsService(pool);
    const started = await service.start({ requestId: randomUUID() }, actor);
    const processed = await service.advance(command(started.run), actor);
    const facts = (
      await pool.query('SELECT * FROM fund_contributions WHERE id=$1', [
        contributionId
      ])
    ).rows[0];
    const manifest = (
      await pool.query(
        'SELECT * FROM admin_automatic_run_dossiers WHERE run_id=$1',
        [started.run.id]
      )
    ).rows;
    const report = await service.report(actor, started.run.id);
    assert.equal(
      (
        await pool.query(
          "SELECT to_regclass('admin_preparation_approvals') AS relation"
        )
      ).rows[0].relation,
      null
    );
    await pool.query(buildMigrationSql(migrations, { database }));
    await pool.query(buildMigrationSql(migrations, { database }));
    assert.deepEqual(
      (
        await pool.query('SELECT * FROM fund_contributions WHERE id=$1', [
          contributionId
        ])
      ).rows[0],
      facts
    );
    assert.deepEqual(
      (
        await pool.query(
          'SELECT * FROM admin_automatic_run_dossiers WHERE run_id=$1',
          [started.run.id]
        )
      ).rows,
      manifest
    );
    assert.deepEqual(await service.state(actor, started.run.id), processed);
    assert.deepEqual(await service.report(actor, started.run.id), report);
    assert.equal(
      (await pool.query('SELECT count(*) FROM admin_preparation_approvals'))
        .rows[0].count,
      '0'
    );
    const receipt = await service.preparation(actor, started.run.id, 1);
    const approved = await service.approvePreparation(approval(receipt), actor);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.payment.amountMinor, 4200);
    assert.equal(approved.approvalHistory.length, 1);
    for (const sql of [
      'UPDATE admin_preparation_approvals SET actor=actor',
      'DELETE FROM admin_preparation_approvals'
    ])
      await assert.rejects(pool.query(sql), { code: '23514' });
    assert.deepEqual(
      (
        await pool.query('SELECT * FROM fund_contributions WHERE id=$1', [
          contributionId
        ])
      ).rows[0],
      facts
    );
    assert.deepEqual(await service.state(actor, started.run.id), processed);
  }
);

test(
  'versioned preparation approval preserves the frozen carousel, exact content and audit',
  { timeout: 240000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const service = new AdminAutomaticRunsService(pool);
    const id = (
      await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
    sponsor_company_name,sponsor_public_summary,sponsor_review_status,sponsor_details_submitted_at,
    public_display_consent,sponsor_site_visibility_held)
    VALUES('sponsorship_interest',50000,'CAD','paid',NOW(),'Synthetic receipt company',
      'Exact synthetic preparation text','approved',NOW(),TRUE,TRUE) RETURNING id`)
    ).rows[0].id;
    await recordFixtureSponsorshipAgreement(pool, id, {
      benefits: [
        {
          channel: 'facebook',
          target: 'openg7',
          quantity: 1,
          format: 'collective_text'
        }
      ]
    });
    await approveFixtureSubject(pool, { type: 'sponsorship', id });
    await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at)
    VALUES('personal_support',2500,'CAD','paid',NOW())`);
    const started = await service.start({ requestId: randomUUID() }, actor);

    await t.test(
      'navigation cannot process, prepare, acknowledge or approve even an unprocessed position',
      async () => {
        const before = await service.state(actor, started.run.id);
        const receipt = await service.preparation(actor, started.run.id, 1);
        assert.equal(receipt.totalCount, 2);
        assert.equal(receipt.position, 1);
        assert.equal(receipt.processedCount, 0);
        assert.equal(receipt.contributionId, id);
        assert.equal(receipt.canApprove, false);
        assert.ok(
          receipt.blockers.some(
            (blocker) => blocker.code === 'dossier_not_examined'
          )
        );
        assert.ok(
          receipt.blockers.some(
            (blocker) => blocker.code === 'publication_draft_missing'
          )
        );
        await service.preparation(actor, started.run.id, 2);
        assert.deepEqual(await service.state(actor, started.run.id), before);
        assert.equal(
          (await pool.query('SELECT count(*) FROM admin_preparation_approvals'))
            .rows[0].count,
          '0'
        );
        await assert.rejects(
          service.approvePreparation(approval(receipt), actor),
          { code: 'PREPARATION_INCOMPLETE' }
        );
        await assert.rejects(
          service.preparation('other-synthetic-operator', started.run.id, 1),
          { code: 'PREPARATION_NOT_FOUND', status: 404 }
        );
      }
    );

    const prepared = await service.advance(command(started.run), actor);
    const ready = await service.preparation(actor, started.run.id, 1);
    await t.test(
      'successful approval commits one immutable actor/version/time/audit record and no external effect',
      async () => {
        assert.equal(ready.status, 'ready');
        assert.equal(ready.canApprove, true);
        assert.equal(ready.balance.fulfilled, 0);
        assert.equal(
          ready.acceptedOffer.benefits.length,
          1,
          "the historical offer is preserved, not inferred from today's amount"
        );
        assert.match(ready.drafts[0].body, /Exact synthetic preparation text/);
        const input = approval(ready);
        const [approved, simultaneous] = await Promise.all([
          service.approvePreparation(input, actor),
          service.approvePreparation(input, actor)
        ]);
        assert.equal(simultaneous.approval.id, approved.approval.id);
        assert.equal(
          (await pool.query('SELECT count(*) FROM admin_preparation_approvals'))
            .rows[0].count,
          '1'
        );
        assert.equal(approved.status, 'approved');
        assert.equal(approved.position, ready.position);
        assert.equal(approved.approval.actor, actor);
        assert.equal(approved.approval.version, ready.version);
        assert.ok(Number.isFinite(Date.parse(approved.approval.approvedAt)));
        assert.ok(approved.approval.auditReference);
        assert.equal(approved.balance.fulfilled, 0);
        assert.equal(
          (await service.approvePreparation(input, actor)).approval.id,
          approved.approval.id
        );
        assert.equal(
          (await service.approvePreparation(approval(ready), actor)).approval
            .id,
          approved.approval.id
        );
        const saved = (
          await pool.query('SELECT snapshot FROM admin_preparation_approvals')
        ).rows[0].snapshot;
        assert.equal(saved.drafts[0].body, ready.drafts[0].body);
        const audit = (
          await pool.query('SELECT * FROM admin_audit_log WHERE id=$1', [
            approved.approval.auditReference
          ])
        ).rows[0];
        assert.equal(audit.action, 'preparation.approved');
        assert.equal(audit.metadata.requestId, input.requestId);
        assert.deepEqual(
          await service.state(actor, started.run.id),
          prepared,
          'approval never advances or resumes the run'
        );
        for (const table of [
          'publication_deliveries',
          'sponsorship_fulfilment_evidence'
        ])
          assert.equal(
            (await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,
            '0'
          );
        await assert.rejects(
          service.approvePreparation(
            { ...input, contributionId: randomUUID() },
            actor
          ),
          { code: 'PREPARATION_NOT_FOUND' }
        );
        await assert.rejects(
          pool.query('UPDATE admin_preparation_approvals SET actor=$1', [
            'forged'
          ]),
          /immutable/
        );
      }
    );

    await t.test(
      'an edited exact draft requires fresh review and retains all prior approvals',
      async () => {
        await pool.query(
          "UPDATE sponsor_publication_drafts SET body=body || ' Changed exact content',updated_at=clock_timestamp() WHERE contribution_id=$1",
          [id]
        );
        const changed = await service.preparation(actor, started.run.id, 1);
        assert.equal(changed.status, 'review_required');
        assert.equal(changed.approval, null);
        assert.equal(changed.approvalHistory.length, 1);
        assert.notEqual(changed.version, ready.version);
        assert.equal(changed.canApprove, true);
        await assert.rejects(
          service.approvePreparation(approval(ready), actor),
          { code: 'PREPARATION_VERSION_CONFLICT' }
        );
        const reapproved = await service.approvePreparation(
          approval(changed),
          actor
        );
        assert.equal(reapproved.status, 'approved');
        assert.equal(reapproved.approvalHistory.length, 2);
      }
    );

    await t.test(
      'a replacement N0 authority requires review even when the content and authorization booleans stay identical',
      async () => {
        const before = await service.preparation(actor, started.run.id, 1);
        assert.equal(before.status, 'approved');
        const contentBefore = (
          await pool.query(
            'SELECT updated_at FROM fund_contributions WHERE id=$1',
            [id]
          )
        ).rows[0].updated_at;
        await approveFixtureSubject(pool, { type: 'sponsorship', id });
        const contentAfter = (
          await pool.query(
            'SELECT updated_at FROM fund_contributions WHERE id=$1',
            [id]
          )
        ).rows[0].updated_at;
        assert.deepEqual(contentAfter, contentBefore);
        const changed = await service.preparation(actor, started.run.id, 1);
        assert.deepEqual(changed.authorizations, before.authorizations);
        assert.deepEqual(changed.drafts, before.drafts);
        assert.notEqual(changed.version, before.version);
        assert.equal(changed.status, 'review_required');
        assert.equal(changed.approvalHistory.length, 2);
        await assert.rejects(
          service.approvePreparation(approval(before), actor),
          { code: 'PREPARATION_VERSION_CONFLICT' }
        );
        const [approved, simultaneous] = await Promise.all([
          service.approvePreparation(approval(changed), actor),
          service.approvePreparation(approval(changed), actor)
        ]);
        assert.equal(simultaneous.approval.id, approved.approval.id);
        assert.equal(approved.status, 'approved');
        assert.equal(approved.approvalHistory.length, 3);
      }
    );

    await t.test(
      'current prerequisites are checked again on the server and opening is not approval',
      async () => {
        const previous = await service.preparation(actor, started.run.id, 1);
        await pool.query(
          'UPDATE fund_contributions SET public_display_consent=FALSE,updated_at=clock_timestamp() WHERE id=$1',
          [id]
        );
        const incomplete = await service.preparation(actor, started.run.id, 1);
        assert.equal(incomplete.status, 'review_required');
        assert.equal(incomplete.canApprove, false);
        assert.ok(
          incomplete.blockers.some(
            (blocker) => blocker.code === 'public_consent_missing'
          )
        );
        assert.equal(incomplete.approvalHistory.length, 3);
        await assert.rejects(
          service.approvePreparation(approval(previous), actor),
          { code: 'PREPARATION_VERSION_CONFLICT' }
        );
        await assert.rejects(
          service.approvePreparation(approval(incomplete), actor),
          { code: 'PREPARATION_INCOMPLETE' }
        );
        assert.equal(
          (await pool.query('SELECT count(*) FROM admin_preparation_approvals'))
            .rows[0].count,
          '3'
        );
        await service.preparation(actor, started.run.id, 2);
        assert.deepEqual(await service.state(actor, started.run.id), prepared);
      }
    );

    for (const prefix of ['/admin', '/api/admin']) {
      const path = prefix + '/automatic-runs/preparation/approve';
      assert.equal(adminRoleAllows('reader', 'POST', path), false);
      assert.equal(adminRoleAllows('operator', 'POST', path), true);
      assert.equal(adminRoleAllows('owner', 'POST', path), true);
    }
  }
);
