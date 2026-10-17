import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { AdminAutomaticRunsService } from '../../dist/apps/funding-api/src/admin-automatic-runs.service.js';
import { AdminPreparationService } from '../../dist/apps/funding-api/src/admin-preparation.service.js';
import { projectPreparation } from '../../dist/apps/funding-api/src/admin-preparation.projection.js';
import { createAdminAutomaticRunsHttpHandler } from '../../dist/apps/funding-api/src/admin-automatic-runs.http.js';
import { createAdminAuthorization } from '../../dist/apps/funding-api/src/admin-authorization.js';
import { adminRoleAllows } from '../../dist/apps/funding-api/src/admin-identity.js';
import {
  createHttpTransport,
  readBody
} from '../../dist/apps/funding-api/src/http-transport.js';
import { createAdminPublicationDraftOnConnection } from '../../dist/apps/funding-api/src/fund-publication-drafts.repository.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  buildMigrationSql,
  readMigrations
} from '../../scripts/lib/database-migrations.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';

const origin = 'https://synthetic-preparation.invalid';
const actor = 'admin:synthetic-operator';
const directCommand = (receipt) => ({
  contributionId: receipt.contributionId,
  expectedVersion: receipt.version,
  requestId: randomUUID(),
  confirmed: true
});
const runCommand = (run) => ({
  runId: run.id,
  expectedVersion: run.version,
  requestId: randomUUID()
});

async function listen(pool) {
  const transport = createHttpTransport({
    isProduction: true,
    allowedOrigins: [origin]
  });
  const identity = (request) => {
    const role = request.headers['x-synthetic-role'];
    return ['reader', 'operator', 'owner'].includes(role)
      ? { id: 'synthetic-' + role, role }
      : null;
  };
  const authorization = createAdminAuthorization({
    adminIdentity: {
      identity,
      permits(request) {
        const account = identity(request);
        return Boolean(
          account &&
          (request.method === 'GET' || request.headers.origin === origin) &&
          adminRoleAllows(
            account.role,
            request.method,
            new URL(request.url, origin).pathname
          )
        );
      }
    },
    adminTokenConfigured: false,
    isProduction: true,
    hasDatabase: true,
    verifyAdminSession: () => null,
    adminTokenMatches: () => false,
    writeJson: transport.writeJson
  });
  const handler = createAdminAutomaticRunsHttpHandler({
    publicBaseOrigin: origin,
    ...authorization,
    readBody,
    writeJson: transport.writeJson,
    automaticRuns: new AdminAutomaticRunsService(pool),
    dossierPreparations: new AdminPreparationService(pool)
  });
  const server = createServer(async (request, response) => {
    if (!(await handler(request, response)))
      transport.writeJson(request, response, 404, { code: 'NOT_FOUND' });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    async request(
      suffix = '',
      { body, role = 'operator', prefix = '/api', requestOrigin = origin } = {}
    ) {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}${prefix}/admin/sponsorships/preparation${suffix}`,
        {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            origin: requestOrigin,
            ...(role ? { 'x-synthetic-role': role } : {}),
            ...(body === undefined
              ? {}
              : { 'content-type': 'application/json' })
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }
      );
      assert.match(response.headers.get('cache-control'), /no-store/);
      return { status: response.status, body: await response.json() };
    },
    stop: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  };
}

test(
  'dossier receipts use current facts without a batch and share versioned approvals across contexts',
  { timeout: 240000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    const http = await listen(pool);
    t.after(async () => {
      await http.stop();
      await stop();
    });
    const direct = new AdminPreparationService(pool);
    const automatic = new AdminAutomaticRunsService(pool);
    const unknownId = (
      await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
    sponsor_company_name,sponsor_public_summary,public_display_consent,sponsor_review_status)
    VALUES('sponsorship_interest',5000,'CAD','paid',NOW(),'Synthetic historical fifty',
      'Historical offer was never recorded',TRUE,'approved') RETURNING id`)
    ).rows[0].id;
    const knownId = (
      await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
    sponsor_company_name,sponsor_public_summary,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
    VALUES('sponsorship_interest',50000,'CAD','paid',NOW(),'Synthetic direct receipt',
      'Exact private source before review',TRUE,'approved',TRUE) RETURNING id`)
    ).rows[0].id;
    await recordFixtureSponsorshipAgreement(pool, knownId, {
      channel: 'facebook'
    });
    await approveFixtureSubject(pool, { type: 'sponsorship', id: knownId });
    await withPostgresTransaction(pool, (db) =>
      createAdminPublicationDraftOnConnection(
        db,
        { contributionId: knownId, feedTarget: 'openg7', channel: 'facebook' },
        actor
      )
    );
    const count = async (table) =>
      Number(
        (await pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n
      );
    const sources = async () =>
      Object.fromEntries(
        await Promise.all(
          [
            'fund_contributions',
            'sponsor_publication_drafts',
            'publication_deliveries',
            'email_messages',
            'sponsorship_commitments',
            'sponsorship_obligations',
            'moderation_cases'
          ].map(async (table) => [
            table,
            (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows
          ])
        )
      );
    const original = await sources();

    await t.test(
      'a local read exposes the actual 50 CAD unknown offer and creates no run, acknowledgment or approval',
      async () => {
        const auditCount = await count('admin_audit_log');
        const response = await http.request('?sponsorshipId=' + unknownId, {
          role: 'reader'
        });
        assert.equal(response.status, 200);
        assert.equal(response.body.context, 'dossier');
        assert.equal(response.body.payment.amountMinor, 5000);
        assert.equal(response.body.acceptedOffer, null);
        assert.equal(response.body.status, 'incomplete');
        assert.equal(response.body.canApprove, false);
        assert.ok(
          response.body.blockers.some(
            (blocker) => blocker.code === 'commitment_needs_confirmation'
          )
        );
        assert.ok(
          !response.body.blockers.some(
            (blocker) => blocker.code === 'dossier_not_examined'
          )
        );
        assert.ok(
          !response.body.checks.some(
            (check) => check.code === 'dossier_examined'
          )
        );
        for (const key of ['runId', 'position', 'totalCount', 'processedCount'])
          assert.ok(!(key in response.body));
        await http.request('?sponsorshipId=' + knownId);
        assert.equal(await count('admin_automatic_runs'), 0);
        assert.equal(await count('admin_automatic_run_entries'), 0);
        assert.equal(await count('admin_preparation_approvals'), 0);
        assert.equal(await count('admin_audit_log'), auditCount);
        assert.deepEqual(await sources(), original);
      }
    );

    let local;
    await t.test(
      'the API rejects reader mutations and records a confirmed local agreement without any batch or dispatch',
      async () => {
        const ready = (await http.request('?sponsorshipId=' + knownId)).body;
        assert.equal(ready.status, 'ready');
        const body = directCommand(ready);
        for (const options of [
          { role: 'reader' },
          { role: null },
          { requestOrigin: 'https://untrusted.invalid' }
        ]) {
          const response = await http.request('/approve', { ...options, body });
          assert.equal(response.status, options.role === null ? 401 : 403);
        }
        assert.equal(await count('admin_preparation_approvals'), 0);
        const response = await http.request('/approve', { body });
        assert.equal(response.status, 200);
        local = response.body;
        assert.equal(local.status, 'approved');
        assert.equal(local.approval.actor, actor);
        assert.equal(local.approval.runId, null);
        assert.equal(local.approvalHistory.length, 1);
        assert.equal(
          (await http.request('/approve', { body })).body.approval.id,
          local.approval.id
        );
        const saved = (
          await pool.query('SELECT * FROM admin_preparation_approvals')
        ).rows[0];
        assert.equal(saved.approval_generation, 2);
        assert.equal(saved.snapshot.context, 'dossier');
        assert.equal(saved.snapshot.drafts[0].body, ready.drafts[0].body);
        assert.equal(await count('admin_automatic_runs'), 0);
        assert.deepEqual(await sources(), original);
        const incomplete = await direct.dossierPreparation(unknownId);
        const refused = await http.request('/approve', {
          body: directCommand(incomplete)
        });
        assert.equal(refused.status, 409);
        assert.equal(refused.body.code, 'PREPARATION_INCOMPLETE');
        for (const suffix of [
          '',
          '?sponsorshipId=no',
          '?sponsorshipId=' + knownId + '&sponsorshipId=' + knownId,
          '?sponsorshipId=' + knownId + '&runId=' + randomUUID()
        ])
          assert.equal((await http.request(suffix)).status, 400);
        assert.equal(
          (await http.request('?sponsorshipId=' + knownId, { prefix: '' }))
            .status,
          200
        );
        assert.equal(
          (
            await http.request('/approve', {
              body: { ...body, runId: randomUUID() }
            })
          ).status,
          400
        );
      }
    );

    const started = await automatic.start({ requestId: randomUUID() }, actor);
    const manifest = (
      await pool.query(
        'SELECT position FROM admin_automatic_run_dossiers WHERE run_id=$1 AND contribution_id=$2',
        [started.run.id, knownId]
      )
    ).rows[0];
    const position = Number(manifest.position);
    await t.test(
      'local and batch share the same content version without attributing a batch examination to local approval',
      async () => {
        const unexamined = await automatic.preparation(
          actor,
          started.run.id,
          position
        );
        assert.equal(unexamined.version, local.version);
        assert.equal(unexamined.status, 'approved');
        assert.equal(unexamined.approval.id, local.approval.id);
        assert.equal(unexamined.canApprove, false);
        assert.ok(
          unexamined.checks.some(
            (check) =>
              check.code === 'dossier_examined' && check.state === 'missing'
          )
        );
        assert.ok(
          unexamined.blockers.some(
            (blocker) => blocker.code === 'dossier_not_examined'
          )
        );
        let state = started;
        while (state.run.nextContributionId)
          state = await automatic.advance(runCommand(state.run), actor);
        const examined = await automatic.preparation(
          actor,
          started.run.id,
          position
        );
        assert.equal(examined.version, local.version);
        assert.equal(examined.approval.id, local.approval.id);
        assert.ok(
          examined.checks.some(
            (check) =>
              check.code === 'dossier_examined' && check.state === 'complete'
          )
        );
      }
    );

    await t.test(
      'a new batch agreement is visible locally, and concurrent local/batch commands have one global effect',
      async () => {
        const beforeRun = await automatic.state(actor, started.run.id);
        await pool.query(
          "UPDATE sponsor_publication_drafts SET body=body || ' Updated',updated_at=clock_timestamp() WHERE contribution_id=$1",
          [knownId]
        );
        const batch = await automatic.preparation(
          actor,
          started.run.id,
          position
        );
        const changed = await direct.dossierPreparation(knownId);
        assert.equal(changed.status, 'review_required');
        assert.equal(changed.version, batch.version);
        const stale = await http.request('/approve', {
          body: directCommand(local)
        });
        assert.equal(stale.status, 409);
        assert.equal(stale.body.code, 'PREPARATION_VERSION_CONFLICT');
        const batchApproved = await automatic.approvePreparation(
          { ...directCommand(batch), runId: started.run.id },
          actor
        );
        const localAfter = await direct.dossierPreparation(knownId);
        assert.equal(localAfter.version, batchApproved.version);
        assert.equal(localAfter.status, 'approved');
        assert.equal(localAfter.approval.id, batchApproved.approval.id);
        assert.equal(localAfter.approval.runId, started.run.id);
        assert.equal(localAfter.approvalHistory.length, 2);
        await pool.query(
          "UPDATE sponsor_publication_drafts SET body=body || ' Concurrent',updated_at=clock_timestamp() WHERE contribution_id=$1",
          [knownId]
        );
        const next = await direct.dossierPreparation(knownId);
        const [directResult, batchResult] = await Promise.all([
          http.request('/approve', { body: directCommand(next) }),
          automatic.approvePreparation(
            { ...directCommand(next), runId: started.run.id },
            actor
          )
        ]);
        assert.equal(directResult.status, 200);
        assert.equal(directResult.body.approval.id, batchResult.approval.id);
        assert.equal(await count('admin_preparation_approvals'), 3);
        assert.equal(
          (await direct.dossierPreparation(knownId)).approvalHistory.length,
          3
        );
        assert.deepEqual(
          await automatic.state(actor, started.run.id),
          beforeRun
        );
        assert.equal(await count('publication_deliveries'), 0);
        assert.equal(await count('sponsorship_fulfilment_evidence'), 0);
      }
    );
  }
);

test(
  'migration 057 retains 056 agreement identity, snapshots and the already examined content version',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    t.after(stop);
    const database = (await pool.query('SELECT current_database() AS name'))
      .rows[0].name;
    const migrations = readMigrations('apps/funding-api/migrations');
    await pool.query(
      buildMigrationSql(
        migrations.filter((migration) => migration.version <= 56),
        { database }
      )
    );
    const id = (
      await pool.query(
        "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at) VALUES('personal_support',2500,'CAD','paid',NOW()) RETURNING id"
      )
    ).rows[0].id;
    const automatic = new AdminAutomaticRunsService(pool);
    const start = await automatic.start({ requestId: randomUUID() }, actor);
    const completed = await automatic.advance(runCommand(start.run), actor);
    // Reproduce a historical 056 receipt directly: the current service correctly
    // refuses to run until the required 057 schema is present.
    const manifest = (
      await pool.query(
        'SELECT * FROM admin_automatic_run_dossiers WHERE run_id=$1',
        [start.run.id]
      )
    ).rows[0];
    const receipt = {
      ...(await projectPreparation(pool, { ...manifest, examined: true })),
      approval: null,
      approvalHistory: [],
      runId: start.run.id,
      position: 1,
      totalCount: 1,
      processedCount: 1
    };
    const auditId = (
      await pool.query(
        "INSERT INTO admin_audit_log(actor,action,entity_type,entity_id) VALUES($1,'preparation.approved','contribution',$2) RETURNING id",
        [actor, id]
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO admin_preparation_approvals(run_id,contribution_id,preparation_version,actor,request_id,request_hash,audit_reference,snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        start.run.id,
        id,
        receipt.version,
        actor,
        randomUUID(),
        'a'.repeat(64),
        auditId,
        JSON.stringify(receipt)
      ]
    );
    const old = (await pool.query('SELECT * FROM admin_preparation_approvals'))
      .rows[0];
    const facts = (
      await pool.query('SELECT * FROM fund_contributions WHERE id=$1', [id])
    ).rows[0];
    await pool.query(buildMigrationSql(migrations, { database }));
    await pool.query(buildMigrationSql(migrations, { database }));
    const { approval_generation: generation, ...preserved } = (
      await pool.query('SELECT * FROM admin_preparation_approvals')
    ).rows[0];
    assert.equal(generation, 1);
    assert.deepEqual(preserved, old);
    const local = await new AdminPreparationService(pool).dossierPreparation(
      id
    );
    assert.equal(local.version, receipt.version);
    assert.equal(local.status, 'approved');
    assert.equal(local.approval.id, old.id);
    assert.equal(local.approval.runId, start.run.id);
    assert.ok(!local.checks.some((check) => check.code === 'dossier_examined'));
    assert.deepEqual(
      (await pool.query('SELECT * FROM fund_contributions WHERE id=$1', [id]))
        .rows[0],
      facts
    );
    assert.deepEqual(await automatic.state(actor, start.run.id), completed);
    assert.equal(
      (await pool.query('SELECT count(*) FROM admin_automatic_runs')).rows[0]
        .count,
      '1'
    );
    await assert.rejects(
      pool.query(
        'UPDATE admin_preparation_approvals SET approval_generation=2'
      ),
      { code: '23514' }
    );
  }
);
