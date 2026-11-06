import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import pg from 'pg';

import { AdminPreparationService } from '../../dist/apps/funding-api/src/admin-preparation.service.js';
import { AdminPreflightWorkSessionsService } from '../../dist/apps/funding-api/src/admin-preflight-work-sessions.service.js';
import { createAdminPreflightWorkSessionsHttpHandler } from '../../dist/apps/funding-api/src/admin-preflight-work-sessions.http.js';
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
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';
import {
  startDisposablePostgres,
  observePostgresTransactions
} from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';

const origin = 'https://synthetic-work-sessions.invalid';
const endpoint = '/api/admin/preflight/work-sessions';
const actor = 'admin:synthetic-work-session-operator';
const command = (session, action, extra = {}) => ({
  requestId: randomUUID(),
  expectedRevision: session.revision,
  action,
  ...extra
});

async function sponsor(pool) {
  const id = (
    await pool.query(
      `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
      sponsor_company_name,sponsor_public_summary,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
      VALUES('sponsorship_interest',50000,'CAD','paid',NOW(),'Synthetic persistent workshop',
      'Private prepared content for a synthetic persistent workshop',TRUE,'approved',TRUE) RETURNING id`
    )
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
  return { id, first: obligations[0].id, second: obligations[1].id };
}

async function start(service, fixture, owner = actor) {
  return service.start(
    {
      requestId: randomUUID(),
      contributionId: fixture.id,
      obligationId: fixture.first,
      filters: { deskStatus: 'to_review', deskSearch: 'SYNTHETIC', deskPage: 2 }
    },
    owner
  );
}

const save = (
  receipt,
  session,
  body = 'An exact private human revision retained after resuming.'
) => ({
  contributionId: receipt.contributionId,
  obligationId: receipt.service.id,
  expectedVersion: receipt.version,
  requestId: randomUUID(),
  title: 'Synthetic revised title',
  body,
  disclosureText: 'Synthetic sponsorship disclosure.',
  workSessionId: session.id,
  expectedSessionRevision: session.revision
});

async function effects(pool) {
  return (
    await pool.query(`SELECT
    (SELECT count(*)::int FROM publication_deliveries) AS deliveries,
    (SELECT count(*)::int FROM email_messages) AS emails,
    (SELECT count(*)::int FROM sponsorship_fulfilment_evidence) AS evidence,
    (SELECT count(*)::int FROM sponsorship_obligations WHERE state='fulfilled') AS fulfilled,
    (SELECT count(*)::int FROM admin_service_preparation_decisions) AS decisions`)
  ).rows[0];
}

async function listen(pool) {
  const durations = [];
  const transport = createHttpTransport({
    isProduction: true,
    allowedOrigins: [origin]
  });
  const identity = (request) => {
    const role = request.headers['x-synthetic-role'];
    return ['reader', 'operator', 'owner'].includes(role)
      ? { id: request.headers['x-synthetic-identity'] ?? 'http-reviewer', role }
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
  const handler = createAdminPreflightWorkSessionsHttpHandler({
    publicBaseOrigin: origin,
    ...authorization,
    readBody,
    writeJson: transport.writeJson,
    workSessions: new AdminPreflightWorkSessionsService(pool)
  });
  const server = createServer(async (request, response) => {
    if (!(await handler(request, response)))
      transport.writeJson(request, response, 404, { code: 'NOT_FOUND' });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    durations,
    async request(
      path = '',
      {
        body,
        role = 'operator',
        identity: account = 'http-reviewer',
        requestOrigin = origin
      } = {}
    ) {
      const started = performance.now();
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}${path.startsWith('/api/') ? path : endpoint + path}`,
        {
          signal: AbortSignal.timeout(20000),
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            origin: requestOrigin,
            ...(role ? { 'x-synthetic-role': role } : {}),
            'x-synthetic-identity': account,
            ...(body === undefined
              ? {}
              : { 'content-type': 'application/json' })
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }
      );
      assert.match(response.headers.get('cache-control'), /no-store/);
      const bodyResult = await response.json();
      durations.push(performance.now() - started);
      return { status: response.status, body: bodyResult };
    },
    stop: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  };
}

test(
  'personal examination sessions preserve real private drafts, reconcile commands and enforce actor and version boundaries',
  { timeout: 240000 },
  async (t) => {
    const database = await startDisposablePostgres({ migrate: false });
    let runtime;
    t.after(async () => {
      await runtime?.end();
      await database.stop();
    });
    const pool = database.pool;
    const name = (await pool.query('SELECT current_database() AS name')).rows[0]
      .name;
    const migrations = readMigrations('apps/funding-api/migrations');
    await pool.query(
      buildMigrationSql(
        migrations.filter((migration) => migration.version <= 64),
        { database: name }
      )
    );
    const existing = await sponsor(pool);
    const businessTables = [
      'fund_contributions',
      'sponsorship_obligations',
      'sponsor_publication_drafts'
    ];
    const snapshot = async () =>
      Promise.all(
        businessTables.map(async (table) => [
          table,
          (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows
        ])
      );
    const beforeMigration = await snapshot();
    await assert.rejects(
      new AdminPreflightWorkSessionsService(pool).state(actor),
      { code: 'WORK_SESSION_SCHEMA_REQUIRED' }
    );
    await pool.query(buildMigrationSql(migrations, { database: name }));
    await pool.query(buildMigrationSql(migrations, { database: name }));
    assert.deepEqual(
      await snapshot(),
      beforeMigration,
      'the additive upgrade does not rewrite business content'
    );
    const role = 'og7_work_session_runtime';
    const password = randomBytes(32).toString('hex');
    await pool.query(
      buildRuntimeRoleSql({ role, database: name, password }, { create: true })
    );
    runtime = new pg.Pool({ ...pool.options, user: role, password });
    const observed = observePostgresTransactions(runtime);
    const sessions = new AdminPreflightWorkSessionsService(observed.pool);
    const preparations = new AdminPreparationService(observed.pool);

    await t.test(
      'save, next, approve, finish and explicit resume survive service recreation without business delivery',
      async () => {
        const before = await effects(pool);
        let current = await start(sessions, existing);
        const receipt = await preparations.servicePreparation(
          existing.id,
          existing.first
        );
        const input = save(receipt, current);
        const saved = await sessions.saveDraft(input, actor);
        assert.equal(saved.receipt.draft.body, input.body);
        assert.notEqual(saved.receipt.version, receipt.version);
        current = saved.session;
        assert.equal(current.report.saved, 1);
        const second = await preparations.servicePreparation(
          existing.id,
          existing.second
        );
        current = await sessions.command(
          current.id,
          command(current, 'visit', {
            contributionId: existing.id,
            obligationId: existing.second,
            observedVersion: second.version
          }),
          actor
        );
        const decisionRequestId = randomUUID();
        current = await sessions.command(
          current.id,
          command(current, 'checkpoint', {
            checkpoint: {
              pendingDecision: 'approved',
              reason: '',
              decisionRequestId,
              expectedPreparationVersion: second.version
            }
          }),
          actor
        );
        const approved = await preparations.decideServicePreparation(
          {
            contributionId: existing.id,
            obligationId: existing.second,
            expectedVersion: second.version,
            requestId: decisionRequestId,
            confirmed: true,
            decision: 'approved'
          },
          actor
        );
        assert.equal(approved.status, 'approved');
        current = await sessions.command(
          current.id,
          command(current, 'finish'),
          actor
        );
        assert.equal(current.status, 'finished');
        assert.equal(current.report.saved, 2);
        assert.equal(current.report.toResume, 1);
        assert.equal(current.report.decisions.approved, 1);
        assert.equal(current.report.delivered, 0);
        const restarted = new AdminPreflightWorkSessionsService(runtime);
        const read = await restarted.state(actor, current.id);
        assert.equal(
          read.current.status,
          'finished',
          'a GET never resumes work'
        );
        assert.equal(read.current.lastPosition, current.lastPosition);
        current = await restarted.command(
          current.id,
          command(read.current, 'resume'),
          actor
        );
        assert.equal(current.status, 'active');
        assert.deepEqual(current.filters, {
          deskStatus: 'to_review',
          deskSearch: 'SYNTHETIC',
          deskPage: 2
        });
        assert.equal(
          (
            await new AdminPreparationService(runtime).servicePreparation(
              existing.id,
              existing.first
            )
          ).draft.body,
          input.body
        );
        assert.equal(
          (await preparations.servicePreparation(existing.id, existing.first))
            .decision,
          null
        );
        assert.deepEqual(await effects(pool), {
          ...before,
          decisions: before.decisions + 1
        });
        const newer = await restarted.saveDraft(
          save(
            approved,
            current,
            'A later private revision invalidates the old approval without erasing its historical activity.'
          ),
          actor
        );
        assert.equal(newer.receipt.decision, null);
        assert.equal(newer.session.report.decisions.approved, 1);
        assert.equal(newer.session.report.toResume, 2);
        await preparations.decideServicePreparation(
          {
            contributionId: existing.id,
            obligationId: existing.second,
            expectedVersion: newer.receipt.version,
            requestId: randomUUID(),
            confirmed: true,
            decision: 'correction_requested',
            reason: 'The later version requires a human correction.'
          },
          actor
        );
        const revisedReport = (await restarted.state(actor, current.id)).current
          .report;
        assert.equal(revisedReport.decisions.approved, 1);
        assert.equal(revisedReport.decisions.correctionRequested, 1);
        assert.equal(revisedReport.decisions.total, 2);
        assert.equal(revisedReport.toResume, 1);
        assert.deepEqual(await effects(pool), {
          ...before,
          decisions: before.decisions + 2
        });
        assert.equal(observed.openTransactions, 0);
      }
    );

    await t.test(
      'two actors are isolated and concurrent tabs cannot overwrite one session revision',
      async () => {
        const fixture = await sponsor(pool);
        const owner = 'admin:cas-reviewer';
        const current = await start(sessions, fixture, owner);
        await assert.rejects(
          sessions.state('admin:another-reviewer', current.id),
          { code: 'WORK_SESSION_NOT_FOUND', status: 404 }
        );
        const attempts = await Promise.allSettled([
          sessions.command(current.id, command(current, 'defer'), owner),
          new AdminPreflightWorkSessionsService(runtime).command(
            current.id,
            command(current, 'checkpoint', {
              checkpoint: {
                pendingDecision: 'correction_requested',
                reason: 'A private correction note from another tab.'
              }
            }),
            owner
          )
        ]);
        assert.equal(
          attempts.filter((result) => result.status === 'fulfilled').length,
          1
        );
        const rejected = attempts.find(
          (result) => result.status === 'rejected'
        );
        assert.equal(rejected.reason.code, 'WORK_SESSION_VERSION_CONFLICT');
        assert.equal(
          (await sessions.state(owner, current.id)).current.revision,
          current.revision + 1
        );
        const other = await start(sessions, fixture, 'admin:another-reviewer');
        assert.notEqual(other.id, current.id);
        assert.equal(other.report.saved, 0);
        assert.equal(observed.openTransactions, 0);
      }
    );

    await t.test(
      'a lost command response is reconciled and the same key cannot represent a different command',
      async () => {
        const owner = 'admin:ack-reviewer';
        const current = await start(sessions, await sponsor(pool), owner);
        let loseAck = true;
        const uncertainPool = {
          query: runtime.query.bind(runtime),
          async connect() {
            const client = await runtime.connect();
            return {
              async query(sql, ...args) {
                const result = await client.query(sql, ...args);
                if (/^COMMIT\s*;?$/i.test(sql) && loseAck) {
                  loseAck = false;
                  throw new Error(
                    'Synthetic acknowledgement lost after commit'
                  );
                }
                return result;
              },
              release: () => client.release()
            };
          }
        };
        const input = command(current, 'checkpoint', {
          checkpoint: {
            pendingDecision: 'correction_requested',
            reason: 'A persisted note despite a lost response.',
            view: 'text'
          }
        });
        await new AdminPreflightWorkSessionsService(uncertainPool)
          .command(current.id, input, owner)
          .catch(() => {});
        const reconciled = await sessions.state(
          owner,
          current.id,
          input.requestId
        );
        assert.equal(reconciled.command.status, 'applied');
        assert.equal(reconciled.current.revision, current.revision + 1);
        const replayed = await sessions.command(current.id, input, owner);
        assert.equal(replayed.revision, reconciled.current.revision);
        assert.equal(
          replayed.items.find((item) => item.position === replayed.lastPosition)
            .checkpoint.reason,
          input.checkpoint.reason
        );
        await assert.rejects(
          sessions.command(
            current.id,
            {
              ...input,
              checkpoint: {
                ...input.checkpoint,
                reason: 'Different note using the same request identifier.'
              }
            },
            owner
          ),
          { code: 'WORK_SESSION_REQUEST_CONFLICT' }
        );
        assert.equal(
          (await sessions.state(owner, current.id, randomUUID())).command
            .status,
          'not_found'
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM admin_preflight_work_session_commands WHERE request_id=$1',
              [input.requestId]
            )
          ).rows[0].count,
          1
        );
      }
    );

    await t.test(
      'audit failure rolls back the real draft, session progress and command receipt together',
      async () => {
        const owner = 'admin:rollback-reviewer';
        const fixture = await sponsor(pool);
        const current = await start(sessions, fixture, owner);
        const receipt = await preparations.servicePreparation(
          fixture.id,
          fixture.first
        );
        const input = save(
          receipt,
          current,
          'This synthetic private edit must be rolled back.'
        );
        await pool.query(`CREATE FUNCTION synthetic_reject_work_session_save() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='preparation.service_draft_saved' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER synthetic_work_session_save_failure BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_reject_work_session_save()`);
        try {
          await assert.rejects(sessions.saveDraft(input, owner));
          assert.equal(
            (await preparations.servicePreparation(fixture.id, fixture.first))
              .draft.body,
            receipt.draft.body
          );
          const read = await sessions.state(owner, current.id, input.requestId);
          assert.equal(read.current.revision, current.revision);
          assert.equal(read.current.report.saved, 0);
          assert.equal(read.command.status, 'not_found');
          assert.equal(observed.openTransactions, 0);
        } finally {
          await pool.query(
            'DROP TRIGGER synthetic_work_session_save_failure ON admin_audit_log; DROP FUNCTION synthetic_reject_work_session_save()'
          );
        }
      }
    );

    await t.test(
      'stale source and session versions preserve the newer draft without recording a save',
      async () => {
        const owner = 'admin:stale-reviewer';
        const fixture = await sponsor(pool);
        let current = await start(sessions, fixture, owner);
        const receipt = await preparations.servicePreparation(
          fixture.id,
          fixture.first
        );
        await pool.query(
          "UPDATE sponsor_publication_drafts SET body=body||' New source revision.',updated_at=clock_timestamp() WHERE contribution_id=$1 AND channel='facebook'",
          [fixture.id]
        );
        const staleSourceInput = save(receipt, current);
        await assert.rejects(sessions.saveDraft(staleSourceInput, owner), {
          code: 'PREPARATION_VERSION_CONFLICT'
        });
        const fresh = await preparations.servicePreparation(
          fixture.id,
          fixture.first
        );
        const staleSession = current;
        current = await sessions.command(
          current.id,
          command(current, 'checkpoint', {
            checkpoint: {
              pendingDecision: null,
              reason: 'A newer personal checkpoint.'
            }
          }),
          owner
        );
        const staleSessionInput = save(fresh, staleSession);
        await assert.rejects(sessions.saveDraft(staleSessionInput, owner), {
          code: 'WORK_SESSION_VERSION_CONFLICT'
        });
        assert.equal(
          (await preparations.servicePreparation(fixture.id, fixture.first))
            .draft.body,
          fresh.draft.body
        );
        assert.equal(
          (await sessions.state(owner, current.id)).current.report.saved,
          current.report.saved
        );
        for (const failed of [staleSourceInput, staleSessionInput])
          assert.equal(
            (await sessions.state(owner, current.id, failed.requestId)).command
              .status,
            'not_found'
          );
        assert.equal(observed.openTransactions, 0);
      }
    );

    await t.test(
      'HTTP refuses absent sessions, readers, foreign origins and another actor before mutation',
      async () => {
        const fixture = await sponsor(pool);
        const http = await listen(runtime);
        try {
          const body = {
            requestId: randomUUID(),
            contributionId: fixture.id,
            obligationId: fixture.first
          };
          const before = await effects(pool);
          for (const [role, requestOrigin, expected] of [
            [null, origin, 401],
            ['reader', origin, 403],
            ['operator', 'https://untrusted.invalid', 403]
          ])
            assert.equal(
              (await http.request('', { body, role, requestOrigin })).status,
              expected
            );
          let created = await http.request('', { body });
          assert.equal(created.status, 200);
          const id = created.body.id;
          assert.equal(
            (
              await http.request('?sessionId=' + id, {
                role: 'owner',
                identity: 'another-owner'
              })
            ).status,
            404
          );
          assert.equal(
            (
              await http.request('/' + id + '/commands', {
                role: 'owner',
                identity: 'another-owner',
                body: command(created.body, 'finish')
              })
            ).status,
            404
          );
          const receipt = await preparations.servicePreparation(
            fixture.id,
            fixture.first
          );
          const saveInput = save(receipt, created.body);
          assert.equal(
            (
              await http.request(
                '/api/admin/sponsorships/preparation/service/save-draft',
                {
                  role: 'owner',
                  identity: 'another-owner',
                  body: saveInput
                }
              )
            ).status,
            404
          );
          assert.equal(
            (
              await http.request(
                '/api/admin/sponsorships/preparation/service/save-draft',
                { role: 'reader', body: saveInput }
              )
            ).status,
            403
          );
          assert.equal(
            (
              await http.request('/' + id + '/commands', {
                role: 'reader',
                body: command(created.body, 'finish')
              })
            ).status,
            403
          );
          const savedOverHttp = await http.request(
            '/api/admin/sponsorships/preparation/service/save-draft',
            { body: saveInput }
          );
          assert.equal(savedOverHttp.status, 200);
          assert.equal(savedOverHttp.body.receipt.draft.body, saveInput.body);
          created = { status: 200, body: savedOverHttp.body.session };
          const finished = await http.request('/' + id + '/commands', {
            body: command(created.body, 'finish')
          });
          assert.equal(finished.status, 200);
          assert.equal(finished.body.status, 'finished');
          assert.equal(
            (await http.request('?sessionId=' + id)).body.current.status,
            'finished'
          );
          assert.deepEqual(await effects(pool), before);
          const maximum = Math.max(...http.durations);
          assert.ok(
            maximum < 20000,
            'every HTTP operation completes within the browser client deadline'
          );
          t.diagnostic(
            `HTTP maximum ${Math.round(maximum)} ms across ${http.durations.length} requests; 20000 ms client deadline.`
          );
          await assert.rejects(
            runtime.query(
              'UPDATE admin_preflight_work_session_commands SET actor=actor'
            ),
            { code: '42501' }
          );
        } finally {
          await http.stop();
        }
      }
    );
  }
);
