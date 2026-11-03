import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { activateSponsorshipCommitments } from '../../dist/apps/funding-api/src/sponsorship-commitments/repository.js';
import {
  quoteSponsorshipOffer,
  recordCheckoutSponsorshipOffer
} from '../../dist/apps/funding-api/src/sponsorship-commitments/offers.js';
import {
  preflightTransaction,
  enqueueActivatedPreflightMission,
  connectorStatus,
  listPreparations,
  persistPreflightPreparation,
  assertPreflightSchema
} from '../../dist/apps/funding-api/src/preflight/repository.js';
import { createPreflightConnectorWorker } from '../../dist/apps/funding-api/src/preflight/worker.js';
import { runPreflightWorker } from '../../dist/apps/funding-api/src/preflight-worker.js';
import { PreflightClientError } from '../../dist/apps/funding-api/src/preflight/client.js';
import { parseValidatedPreparation } from '../../dist/apps/funding-api/src/preflight/result-import.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';

const settings = {
  enabled: true,
  tenantId: 'synthetic-preflight',
  maxCostUsd: 0.5
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function readyDetail(mission, status = 'review_ready') {
  const kinds = ['completeness', 'preparation-policy', 'output-check', 'draft'];
  const results = kinds.map((kind) => ({
    id: randomUUID(),
    taskId: randomUUID(),
    kind,
    version: 1,
    obsolete: false,
    output:
      kind === 'draft'
        ? {
            title: 'Synthetic draft',
            summary: 'Prepared for review',
            body: 'Draft only, no business decision.',
            warnings: ['Simulation deterministic.']
          }
        : kind === 'output-check'
          ? { passed: true, sourceVersion: mission.source.version }
          : kind === 'preparation-policy'
            ? {
                businessDecisionAllowed: false,
                externalPublicationAllowed: false,
                humanReviewRequired: true
              }
            : { complete: true },
    provenance: {
      provider: 'mock',
      model: 'deterministic-v1',
      simulated: true,
      generatedAt: new Date().toISOString(),
      inputHash: createHash('sha256')
        .update(JSON.stringify(mission.input))
        .digest('hex'),
      estimatedCostUsd: 0,
      inputVersion: mission.source.version
    }
  }));
  const draft = results.find((item) => item.kind === 'draft');
  return {
    mission: { ...mission, id: mission.missionId, status, revision: 1 },
    results,
    proposals: [
      {
        id: randomUUID(),
        missionId: mission.missionId,
        tenantId: mission.tenantId,
        source: mission.source,
        status: 'prepared',
        version: 1,
        type: 'review',
        risk: 'normal',
        authority: 'source_application',
        businessDecisionExecuted: false,
        sourceVersion: mission.source.version,
        draftResultId: draft.id,
        resultIds: results.map((item) => item.id),
        checks: results
          .filter((item) => item.kind !== 'draft')
          .map((item) => ({
            kind: item.kind,
            resultId: item.id,
            passed: true
          })),
        anomalies: [],
        blockingConditions: ['Funding must authorize the next action.']
      }
    ]
  };
}

test(
  'Funding source outbox survives retries and imports only current private proposals',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    const oldEnv = {
      PREFLIGHT_ENABLED: process.env.PREFLIGHT_ENABLED,
      PREFLIGHT_TENANT_ID: process.env.PREFLIGHT_TENANT_ID,
      PREFLIGHT_MAX_COST_USD: process.env.PREFLIGHT_MAX_COST_USD
    };
    process.env.PREFLIGHT_ENABLED = 'true';
    process.env.PREFLIGHT_TENANT_ID = settings.tenantId;
    delete process.env.PREFLIGHT_MAX_COST_USD;
    try {
      async function fixture() {
        const operationId = randomUUID(),
          sessionId = `cs_synthetic_${randomUUID()}`,
          paymentId = `pi_synthetic_${randomUUID()}`,
          reference = `SYNTHETIC-${randomUUID()}`;
        await pool.query(
          "INSERT INTO checkout_operations(id,key_hash,request_hash,state,params,contribution_input) VALUES($1,$2,$3,'prepared','{}','{}')",
          [operationId, operationId, operationId]
        );
        const quote = quoteSponsorshipOffer(50000, 'CAD');
        await preflightTransaction(pool, (db) =>
          recordCheckoutSponsorshipOffer(db, operationId, {
            publicReference: reference,
            quote
          })
        );
        await pool.query(
          "INSERT INTO stripe_checkout_sessions(stripe_session_id,stripe_payment_intent_id,contribution_type,amount_cents,currency,metadata,status) VALUES($1,$2,'sponsorship_interest',50000,'cad',$3,'paid')",
          [sessionId, paymentId, { openg7CheckoutOperationId: operationId }]
        );
        const contribution = (
          await pool.query(
            "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,public_reference,stripe_session_id,stripe_payment_intent_id,public_display_consent,sponsor_company_name,email_private) VALUES('sponsorship_interest',50000,'cad','paid',NOW(),$1,$2,$3,TRUE,'Synthetic company','private-fixture@example.invalid') RETURNING id",
            [reference, sessionId, paymentId]
          )
        ).rows[0].id;
        const activation = {
          stripeSessionId: sessionId,
          stripePaymentIntentId: paymentId,
          trustedPaymentFacts: {
            amountCents: 50000,
            currency: 'CAD',
            publicReference: reference
          }
        };
        return { contribution, activation, sessionId };
      }
      const initial = await fixture();
      let commitmentId, mission;
      await t.test(
        'confirmed activation queues its mission inside the source transaction and payment replay deduplicates',
        async () => {
          await preflightTransaction(pool, (db) =>
            activateSponsorshipCommitments(db, initial.activation)
          );
          commitmentId = (
            await pool.query(
              'SELECT id FROM sponsorship_commitments WHERE contribution_id=$1',
              [initial.contribution]
            )
          ).rows[0].id;
          const event = (
            await pool.query(
              "SELECT * FROM preflight_outbox WHERE commitment_id=$1 AND event_type='mission.submitted'",
              [commitmentId]
            )
          ).rows[0];
          mission = event.payload;
          assert.equal(mission.source.subjectId, commitmentId);
          assert.equal(mission.source.version, 1);
          assert.equal(mission.tenantId, settings.tenantId);
          assert.equal(
            JSON.stringify(mission).includes('private-fixture'),
            false
          );
          assert.equal(mission.constraints.humanApprovalRequired, true);
          await preflightTransaction(pool, (db) =>
            activateSponsorshipCommitments(db, initial.activation)
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM preflight_outbox WHERE commitment_id=$1',
                [commitmentId]
              )
            ).rows[0].n,
            1
          );
          const rollback = await fixture();
          await assert.rejects(
            () =>
              preflightTransaction(pool, async (db) => {
                await activateSponsorshipCommitments(db, rollback.activation);
                throw new Error('synthetic rollback');
              }),
            /synthetic rollback/
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM sponsorship_commitments WHERE contribution_id=$1',
                [rollback.contribution]
              )
            ).rows[0].n,
            0
          );
        }
      );
      let calls = 0;
      const sent = [];
      let detail;
      const client = {
        submit: async (payload) => {
          calls++;
          sent.push(payload);
          if (calls === 1)
            throw new PreflightClientError('preflight_timeout', true);
          detail = readyDetail(payload);
          return { mission: detail.mission, duplicate: calls > 1 };
        },
        notifySourceUpdate: async () => ({ duplicate: false, invalidated: 1 }),
        getMission: async () => detail
      };
      const relay = createPreflightConnectorWorker({ pool, settings, client });
      await t.test(
        'uncertain HTTP receipt retries the same immutable event and then imports a private proposal',
        async () => {
          await relay.tick();
          let row = (
            await pool.query(
              'SELECT * FROM preflight_outbox WHERE mission_id=$1',
              [mission.missionId]
            )
          ).rows[0];
          assert.equal(row.status, 'pending');
          assert.equal(row.attempts, 1);
          assert.equal(row.error_code, 'preflight_timeout');
          await pool.query(
            'UPDATE preflight_outbox SET next_attempt_at=NOW() WHERE id=$1',
            [row.id]
          );
          await relay.tick();
          row = (
            await pool.query(
              'SELECT * FROM preflight_outbox WHERE mission_id=$1',
              [mission.missionId]
            )
          ).rows[0];
          assert.equal(row.status, 'delivered');
          assert.equal(row.attempts, 2);
          assert.deepEqual(sent[0], sent[1]);
          const imported = await listPreparations(
            pool,
            initial.contribution,
            settings.tenantId
          );
          assert.equal(imported.items.length, 1);
          assert.equal(imported.items[0].status, 'proposed');
          assert.equal(imported.items[0].businessDecisionExecuted, false);
          assert.equal(
            (
              await listPreparations(
                pool,
                initial.contribution,
                'different-tenant'
              )
            ).items.length,
            0
          );
          const source = (
            await pool.query(
              'SELECT * FROM preflight_sources WHERE commitment_id=$1',
              [commitmentId]
            )
          ).rows[0];
          await assert.rejects(
            () =>
              pool.query(
                "UPDATE preflight_outbox SET payload='{}' WHERE mission_id=$1",
                [mission.missionId]
              ),
            /immutable/
          );
          await assert.rejects(() =>
            pool.query(
              "UPDATE preflight_preparations SET preparation='{}' WHERE mission_id=$1",
              [mission.missionId]
            )
          );
          assert.equal(
            await persistPreflightPreparation(
              pool,
              parseValidatedPreparation(detail, {
                tenantId: settings.tenantId,
                subjectId: commitmentId,
                sourceVersion: 1,
                sourceHash: source.source_hash
              }),
              {
                tenantId: settings.tenantId,
                commitmentId,
                sourceVersion: 1,
                sourceHash: source.source_hash
              }
            ),
            true
          );
          const valid = parseValidatedPreparation(detail, {
            tenantId: settings.tenantId,
            subjectId: commitmentId,
            sourceVersion: 1,
            sourceHash: source.source_hash
          });
          const expected = {
            tenantId: settings.tenantId,
            commitmentId,
            sourceVersion: 1,
            sourceHash: source.source_hash
          };
          for (const override of [
            { tenantId: 'another-tenant' },
            { commitmentId: randomUUID() },
            { sourceVersion: 2 },
            { sourceHash: 'f'.repeat(64) },
            { businessDecisionExecuted: true }
          ]) {
            await assert.rejects(
              () =>
                persistPreflightPreparation(
                  pool,
                  { ...valid, ...override },
                  expected
                ),
              /preflight_import_source_mismatch/
            );
          }
          assert.equal(
            await persistPreflightPreparation(
              pool,
              { ...valid, missionId: randomUUID() },
              expected
            ),
            false
          );
        }
      );
      await t.test(
        'changed snapshot creates a new monotone source revision and blocks prior preparations',
        async () => {
          await pool.query(
            "UPDATE fund_contributions SET sponsor_company_name='Synthetic company revised' WHERE id=$1",
            [initial.contribution]
          );
          const updated = [];
          const nextRelay = createPreflightConnectorWorker({
            pool,
            settings,
            client: {
              ...client,
              notifySourceUpdate: async (event) => {
                updated.push(event);
                return { duplicate: false, invalidated: 1 };
              }
            }
          });
          await nextRelay.tick();
          const source = (
            await pool.query(
              'SELECT * FROM preflight_sources WHERE commitment_id=$1',
              [commitmentId]
            )
          ).rows[0];
          assert.equal(source.source_version, 2);
          assert.equal(updated[0].source.version, 2);
          const imports = await listPreparations(
            pool,
            initial.contribution,
            settings.tenantId
          );
          assert.equal(
            imports.items.some(
              (item) => item.sourceVersion === 1 && item.obsolete
            ),
            true
          );
          assert.equal(sent.at(-1).source.version, 2);
          await nextRelay.stop();
        }
      );
      await t.test(
        'withdrawn eligibility emits invalidation without preparing a new commercial action',
        async () => {
          await pool.query(
            "UPDATE fund_contributions SET status='refunded' WHERE id=$1",
            [initial.contribution]
          );
          const before = calls;
          await relay.tick();
          assert.equal(calls, before);
          assert.equal(
            (
              await pool.query(
                'SELECT eligible FROM preflight_sources WHERE commitment_id=$1',
                [commitmentId]
              )
            ).rows[0].eligible,
            false
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM preflight_preparations WHERE commitment_id=$1 AND obsolete=FALSE',
                [commitmentId]
              )
            ).rows[0].n,
            0
          );
          assert.ok(
            (await connectorStatus(pool, settings.tenantId)).lastWorkerSeenAt
          );
        }
      );
      await t.test(
        'an abandoned source delivery lease is reclaimed and a permanent failure is quarantined',
        async () => {
          const other = await fixture();
          await preflightTransaction(pool, (db) =>
            activateSponsorshipCommitments(db, other.activation)
          );
          const event = (
            await pool.query(
              "SELECT o.* FROM preflight_outbox o JOIN sponsorship_commitments m ON m.id=o.commitment_id WHERE m.contribution_id=$1 AND o.event_type='mission.submitted'",
              [other.contribution]
            )
          ).rows[0];
          await pool.query(
            "UPDATE preflight_outbox SET status='running',claim_token=$2,lease_until=NOW()-INTERVAL '1 second',attempts=1 WHERE id=$1",
            [event.id, randomUUID()]
          );
          const failed = createPreflightConnectorWorker({
            pool,
            settings,
            client: {
              ...client,
              submit: async () => {
                throw new PreflightClientError(
                  'preflight_http_error',
                  false,
                  403
                );
              }
            }
          });
          await failed.tick();
          const final = (
            await pool.query(
              'SELECT status,attempts,error_code FROM preflight_outbox WHERE id=$1',
              [event.id]
            )
          ).rows[0];
          assert.equal(final.status, 'quarantined');
          assert.equal(final.attempts, 2);
          assert.equal(final.error_code, 'preflight_http_error');
          assert.ok(
            (await connectorStatus(pool, settings.tenantId)).quarantined >= 1
          );
          await failed.stop();
        }
      );
      await t.test(
        'runtime-role grants permit the bridge while immutable payloads and history stay protected',
        async () => {
          const role = 'preflight_test_runtime';
          const context = (
            await pool.query(
              'SELECT current_database() AS database,current_user AS owner'
            )
          ).rows[0];
          await pool.query(
            `CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
          );
          await pool.query(
            buildRuntimeRoleSql({ ...context, role }, { create: false })
          );
          await preflightTransaction(pool, async (db) => {
            await db.query(`SET LOCAL ROLE ${role}`);
            await assertPreflightSchema(db);
            assert.equal(
              (
                await listPreparations(
                  db,
                  initial.contribution,
                  settings.tenantId
                )
              ).items.length >= 1,
              true
            );
          });
          for (const sql of [
            "UPDATE preflight_outbox SET payload='{}' WHERE mission_id=$1",
            'UPDATE preflight_preparations SET obsolete=FALSE WHERE mission_id=$1',
            'DELETE FROM preflight_outbox WHERE mission_id=$1'
          ])
            await assert.rejects(() =>
              preflightTransaction(pool, async (db) => {
                await db.query(`SET LOCAL ROLE ${role}`);
                await db.query(sql, [mission.missionId]);
              })
            );
        }
      );
      await t.test(
        'production relay rejects the database owner before any HTTP request',
        async (st) => {
          const connection = new URL('postgresql://127.0.0.1');
          connection.username = pool.options.user;
          connection.password = pool.options.password;
          connection.port = String(pool.options.port);
          connection.pathname = `/${pool.options.database}`;
          let requests = 0;
          st.mock.method(globalThis, 'fetch', async () => {
            requests++;
            throw new Error(
              'HTTP must not be reached with an unsafe database role'
            );
          });
          for (const environment of [
            { NODE_ENV: 'production' },
            { NODE_ENV: 'development', FUNDING_PLATFORM_ENV: 'production' }
          ]) {
            const watchdog = setTimeout(() => process.emit('SIGTERM'), 2000);
            watchdog.unref();
            try {
              await assert.rejects(
                () =>
                  runPreflightWorker({
                    ...environment,
                    DATABASE_URL: connection.toString(),
                    PREFLIGHT_ENABLED: 'true',
                    PREFLIGHT_TENANT_ID: settings.tenantId,
                    PREFLIGHT_URL: 'https://preflight.synthetic.invalid',
                    PREFLIGHT_TOKEN_URL:
                      'https://identity.synthetic.invalid/token',
                    PREFLIGHT_CLIENT_ID: 'synthetic-funding-service',
                    PREFLIGHT_CLIENT_SECRET: 'synthetic-client-secret-not-real'
                  }),
                /DATABASE_RUNTIME_PRIVILEGES_UNSAFE/
              );
            } finally {
              clearTimeout(watchdog);
            }
          }
          assert.equal(requests, 0);
        }
      );
      await t.test(
        'two relay workers do not deliver an actively leased source event concurrently',
        async () => {
          const other = await fixture();
          await preflightTransaction(pool, (db) =>
            activateSponsorshipCommitments(db, other.activation)
          );
          const commitment = (
            await pool.query(
              'SELECT id FROM sponsorship_commitments WHERE contribution_id=$1',
              [other.contribution]
            )
          ).rows[0].id;
          const scoped = { ...settings, tenantId: 'synthetic-parallel' };
          await preflightTransaction(pool, (db) =>
            enqueueActivatedPreflightMission(db, commitment, scoped)
          );
          let called = 0,
            release;
          const pending = new Promise((resolve) => {
            release = resolve;
          });
          const remote = new Map();
          const client = {
            submit: async (payload) => {
              called++;
              await pending;
              const detail = readyDetail(payload, 'ready');
              remote.set(payload.missionId, detail);
              return { mission: detail.mission, duplicate: false };
            },
            notifySourceUpdate: async () => ({
              duplicate: false,
              invalidated: 0
            }),
            getMission: async (id) => remote.get(id)
          };
          const a = createPreflightConnectorWorker({
            pool,
            settings: scoped,
            client
          });
          const b = createPreflightConnectorWorker({
            pool,
            settings: scoped,
            client
          });
          const first = a.tick();
          for (let i = 0; i < 100 && called === 0; i++) await wait(10);
          assert.equal(called, 1);
          assert.equal((await b.tick()).delivered, 0);
          assert.equal(called, 1);
          release();
          assert.equal((await first).delivered, 1);
          await Promise.all([a.stop(), b.stop()]);
        }
      );
      await relay.stop();
    } finally {
      for (const [key, value] of Object.entries(oldEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await stop();
    }
  }
);
