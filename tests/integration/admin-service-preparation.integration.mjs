import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { AdminPreparationService } from '../../dist/apps/funding-api/src/admin-preparation.service.js';
import { prepareContributionWebsite } from '../../dist/packages/funding-core/src/contribution-activity.js';
import { PreflightDeskService } from '../../dist/apps/funding-api/src/preflight/desk.js';
import { createAdminDossierPreparationHttpHandler } from '../../dist/apps/funding-api/src/admin-dossier-preparation.http.js';
import {
  createHttpTransport,
  readBody
} from '../../dist/apps/funding-api/src/http-transport.js';
import { adminRoleAllows } from '../../dist/apps/funding-api/src/admin-identity.js';
import { createAdminPublicationDraftOnConnection } from '../../dist/apps/funding-api/src/fund-publication-drafts.repository.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';
import {
  buildMigrationSql,
  readMigrations
} from '../../scripts/lib/database-migrations.mjs';

const actor = 'synthetic-service-reviewer';
const command = (receipt, decision = 'approved', reason) => ({
  contributionId: receipt.contributionId,
  obligationId: receipt.service.id,
  expectedVersion: receipt.version,
  requestId: randomUUID(),
  confirmed: true,
  decision,
  ...(reason ? { reason } : {})
});

test(
  'exact private preparation decisions are durable, versioned, audited, scoped and grant no publication authority',
  { timeout: 240000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    t.after(stop);
    const database = (await pool.query('SELECT current_database() AS name'))
      .rows[0].name;
    const migrations = readMigrations('apps/funding-api/migrations');
    await pool.query(
      buildMigrationSql(
        migrations.filter((migration) => migration.version <= 63),
        { database }
      )
    );
    const service = new AdminPreparationService(pool);
    const id = (
      await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
    sponsor_company_name,sponsor_public_summary,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
    VALUES('sponsorship_interest',50000,'CAD','paid',NOW(),'Synthetic exact workshop',
    'A prepared description for exact human review',TRUE,'approved',TRUE) RETURNING id`)
    ).rows[0].id;
    await recordFixtureSponsorshipAgreement(pool, id, {
      channels: ['facebook', 'linkedin']
    });
    await approveFixtureSubject(pool, { type: 'sponsorship', id });
    for (const channel of ['facebook', 'linkedin'])
      await withPostgresTransaction(pool, (db) =>
        createAdminPublicationDraftOnConnection(
          db,
          { contributionId: id, feedTarget: 'openg7', channel },
          actor
        )
      );
    const obligations = (
      await pool.query(
        'SELECT id,channel FROM sponsorship_obligations WHERE contribution_id=$1 ORDER BY channel',
        [id]
      )
    ).rows;
    const facebook = obligations.find((x) => x.channel === 'facebook').id;
    const linkedin = obligations.find((x) => x.channel === 'linkedin').id;
    const facts = async () =>
      Object.fromEntries(
        await Promise.all(
          [
            'fund_contributions',
            'sponsorship_obligations',
            'sponsor_publication_drafts',
            'publication_deliveries',
            'email_messages'
          ].map(async (table) => [
            table,
            (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows
          ])
        )
      );
    const before = await facts();
    await assert.rejects(service.servicePreparation(id, facebook), {
      code: 'PREPARATION_SCHEMA_INCOMPATIBLE'
    });
    await pool.query(buildMigrationSql(migrations, { database }));
    await pool.query(buildMigrationSql(migrations, { database }));
    assert.deepEqual(await facts(), before);
    const receipt = await service.servicePreparation(id, facebook);
    assert.equal(receipt.context, 'service');
    assert.equal(receipt.service.id, facebook);
    assert.equal(receipt.siblings.length, 2);
    assert.equal(receipt.canApprove, true, JSON.stringify(receipt.blockers));
    assert.equal(receipt.draft.channel, 'facebook');
    assert.equal(receipt.provenance.preflightLink, 'unverified');
    assert.equal(receipt.history.length, 0);
    assert.equal(
      (await service.servicePreparation(id, facebook)).version,
      receipt.version
    );
    await assert.rejects(service.servicePreparation(id, randomUUID()), {
      code: 'PREPARATION_NOT_FOUND',
      status: 404
    });

    const request = command(receipt);
    const concurrent = await Promise.all([
      service.decideServicePreparation(request, actor),
      service.decideServicePreparation(
        { ...request, requestId: randomUUID() },
        'synthetic-other-session'
      )
    ]);
    for (const approved of concurrent) {
      assert.equal(approved.status, 'approved');
      assert.equal(approved.history.length, 1);
      assert.equal(approved.canDecide, false);
    }
    assert.equal(
      (await service.decideServicePreparation(request, actor)).history.length,
      1
    );
    await assert.rejects(
      service.decideServicePreparation(
        { ...request, reason: 'A conflicting reuse of the request key.' },
        actor
      ),
      { code: 'PREPARATION_REQUEST_CONFLICT' }
    );
    await assert.rejects(
      service.decideServicePreparation(
        command(
          concurrent[0],
          'rejected',
          'Reject this specific prepared text.'
        ),
        actor
      ),
      { code: 'PREPARATION_ALREADY_DECIDED' }
    );
    assert.equal(
      (await service.servicePreparation(id, linkedin)).decision,
      null
    );
    assert.deepEqual(await facts(), before);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) FROM admin_audit_log WHERE action='preparation.service_decided'"
        )
      ).rows[0].count,
      '1'
    );

    const second = await service.servicePreparation(id, linkedin);
    const correction = await service.decideServicePreparation(
      command(
        second,
        'correction_requested',
        'Please clarify this exact prepared paragraph.'
      ),
      actor
    );
    assert.equal(correction.status, 'correction_requested');
    assert.equal(
      correction.history[0].reason,
      'Please clarify this exact prepared paragraph.'
    );
    assert.equal(
      (await service.servicePreparation(id, facebook)).status,
      'approved'
    );
    const desk = await new PreflightDeskService(pool).list({
      page: 1,
      pageSize: 20,
      stage: 'all'
    });
    assert.equal(desk.summary.toDeliver, 1);
    assert.equal(desk.summary.toPrepare, 1);
    assert.equal(desk.summary.delivered, 0);
    assert.deepEqual(await facts(), before);

    await pool.query(
      "UPDATE sponsor_publication_drafts SET body=body||' Human revision.',updated_at=clock_timestamp() WHERE contribution_id=$1 AND channel='linkedin'",
      [id]
    );
    const revised = await service.servicePreparation(id, linkedin);
    assert.equal(revised.decision, null);
    assert.equal(revised.history.length, 1);
    assert.equal(revised.canDecide, true);
    assert.notEqual(revised.version, second.version);
    const facebookRetained = await service.servicePreparation(id, facebook);
    assert.equal(facebookRetained.status, 'approved');
    assert.equal(facebookRetained.contentVersion, concurrent[0].contentVersion);
    assert.equal(facebookRetained.version, concurrent[0].version);
    assert.equal(facebookRetained.history.length, 1);
    await assert.rejects(
      service.decideServicePreparation(
        { ...command(second), decision: 'approved' },
        actor
      ),
      { code: 'PREPARATION_VERSION_CONFLICT' }
    );
    const rejected = await service.decideServicePreparation(
      command(
        revised,
        'rejected',
        'This revised content needs a new proposal.'
      ),
      actor
    );
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.history.length, 2);
    assert.equal(
      (
        await pool.query(
          'SELECT state FROM sponsorship_obligations WHERE id=$1',
          [linkedin]
        )
      ).rows[0].state,
      'pending'
    );
    for (const sql of [
      'UPDATE admin_service_preparation_decisions SET actor=actor',
      'DELETE FROM admin_service_preparation_decisions'
    ])
      await assert.rejects(pool.query(sql), { code: '23514' });

    await t.test(
      'a Web proposal has its own exact review and never publishes the profile or covers a later passage',
      async () => {
        const webId = (
          await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
        sponsor_company_name,sponsor_public_summary,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
        VALUES('sponsorship_interest',50000,'CAD','paid',NOW(),'Synthetic Web workshop',
        'Exact private Web presentation',TRUE,'approved',TRUE) RETURNING id`)
        ).rows[0].id;
        await recordFixtureSponsorshipAgreement(pool, webId, {
          benefits: [
            { channel: 'website', target: 'openg7', quantity: 2 },
            {
              channel: 'linkedin',
              target: 'openg7',
              quantity: 1,
              format: 'individual_portrait'
            }
          ]
        });
        await pool.query(
          "UPDATE sponsorship_obligations SET state='blocked',blocked_reason='MEDIA_MISSING',version=version+1 WHERE contribution_id=$1 AND channel='linkedin'",
          [webId]
        );
        await approveFixtureSubject(pool, { type: 'sponsorship', id: webId });
        const snapshot = prepareContributionWebsite({
          amountMinor: 50000,
          currency: 'CAD',
          paymentStatus: 'paid',
          contributionType: 'sponsorship_interest',
          publicConsent: true,
          companyName: 'Synthetic Web workshop',
          summary: 'Exact private Web presentation',
          reviewStatus: 'approved',
          hidden: false,
          refundPending: false,
          mediaApproved: false,
          workerEnabled: true
        });
        await pool.query(
          `INSERT INTO contribution_activity(contribution_id,amount_minor,currency,confirmed_at,snapshot,source_version,revision)
        SELECT id,amount_cents,currency,paid_at,$2::jsonb,concat(updated_at::text,'||true'),1 FROM fund_contributions WHERE id=$1`,
          [webId, JSON.stringify(snapshot)]
        );
        const webObligations = (
          await pool.query(
            "SELECT id FROM sponsorship_obligations WHERE contribution_id=$1 AND channel='website' ORDER BY ordinal",
            [webId]
          )
        ).rows;
        const webReceipt = await service.servicePreparation(
          webId,
          webObligations[0].id
        );
        assert.ok(
          webReceipt.dossier.blockers.some(
            (blocker) => blocker.code === 'obligation_blocked'
          )
        );
        assert.ok(
          webReceipt.dossier.blockers.some(
            (blocker) => blocker.code === 'required_media_missing'
          )
        );
        assert.equal(webReceipt.blockers.includes('obligation_blocked'), false);
        assert.equal(
          webReceipt.blockers.includes('required_media_missing'),
          false
        );
        assert.equal(
          webReceipt.canApprove,
          true,
          JSON.stringify(webReceipt.blockers)
        );
        assert.equal(webReceipt.draft.kind, 'website');
        assert.equal(webReceipt.draft.body, 'Exact private Web presentation');
        const webApproved = await service.decideServicePreparation(
          command(webReceipt),
          actor
        );
        assert.equal(webApproved.status, 'approved');
        const later = await service.servicePreparation(
          webId,
          webObligations[1].id
        );
        assert.equal(later.draft, null);
        assert.equal(later.canDecide, false);
        assert.equal(later.status, 'not_ready');
        await assert.rejects(
          service.decideServicePreparation(command(later), actor),
          { code: 'PREPARATION_DRAFT_UNAVAILABLE' }
        );
        const persisted = (
          await pool.query(
            'SELECT sponsor_site_visibility_held FROM fund_contributions WHERE id=$1',
            [webId]
          )
        ).rows[0];
        assert.equal(persisted.sponsor_site_visibility_held, true);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*) FROM sponsorship_obligations WHERE contribution_id=$1 AND state='fulfilled'",
              [webId]
            )
          ).rows[0].count,
          '0'
        );
      }
    );

    const transport = createHttpTransport({
      isProduction: true,
      allowedOrigins: ['https://synthetic-workshop.invalid']
    });
    const handler = createAdminDossierPreparationHttpHandler({
      publicBaseOrigin: 'https://synthetic-workshop.invalid',
      preparations: service,
      readBody,
      writeJson: transport.writeJson,
      getAdminAuditActor: () => actor,
      ensureAdminAccess(request, response) {
        const role = request.headers['x-synthetic-role'] ?? 'reader';
        if (
          adminRoleAllows(
            role,
            request.method,
            new URL(request.url, 'https://synthetic-workshop.invalid').pathname
          )
        )
          return true;
        transport.writeJson(request, response, 403, {
          code: 'ADMIN_FORBIDDEN'
        });
        return false;
      }
    });
    const server = createServer(async (req, res) => {
      if (!(await handler(req, res))) res.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/api/admin/sponsorships/preparation/service`;
    const read = await fetch(
      url + `?sponsorshipId=${id}&obligationId=${facebook}`
    );
    assert.equal(read.status, 200);
    assert.match(read.headers.get('cache-control'), /no-store/);
    const denied = await fetch(url + '/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    });
    assert.equal(denied.status, 403);
    const invalid = await fetch(
      url +
        `?sponsorshipId=${id}&obligationId=${facebook}&obligationId=${linkedin}`
    );
    assert.equal(invalid.status, 400);
    await pool.query(
      'UPDATE fund_contributions SET public_display_consent=FALSE,updated_at=clock_timestamp() WHERE id=$1',
      [id]
    );
    const consentRevoked = await service.servicePreparation(id, facebook);
    assert.equal(consentRevoked.decision, null);
    assert.equal(consentRevoked.canApprove, false);
    assert.ok(consentRevoked.blockers.includes('public_consent_missing'));
    assert.notEqual(
      consentRevoked.contentVersion,
      facebookRetained.contentVersion
    );
    assert.equal(consentRevoked.history.length, 1);
  }
);
