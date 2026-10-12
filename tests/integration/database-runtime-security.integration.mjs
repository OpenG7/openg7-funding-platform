import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

import pg from 'pg';

import { assertProductionDatabasePrivileges } from '../../dist/apps/funding-api/src/database-runtime-security.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  insertCheckoutSessionRecord,
  upsertCheckoutSessionFromWebhook
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import {
  quoteSponsorshipOffer,
  recordCheckoutSponsorshipOffer
} from '../../dist/apps/funding-api/src/sponsorship-commitments/offers.js';
import {
  loadSponsorshipCommitment,
  loadSponsorshipOfferForSession
} from '../../dist/apps/funding-api/src/sponsorship-commitments/repository.js';
import {
  qualifySponsorshipCommitment,
  adjustSponsorshipObligation
} from '../../dist/apps/funding-api/src/sponsorship-commitments/changes.js';
import { createSponsorshipOfferSnapshot } from '../../dist/packages/funding-core/src/index.js';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'The runtime role can persist application facts but cannot delete finance, alter schema or rewrite audit',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres();
    let runtime;
    t.after(async () => {
      await runtime?.end();
      await database.stop();
    });
    const role = 'og7_runtime_security_test';
    const password = randomBytes(32).toString('hex');
    const name = (
      await database.pool.query('SELECT current_database() AS name')
    ).rows[0].name;
    const config = { role, database: name, password };
    await database.pool.query(buildRuntimeRoleSql(config, { create: true }));
    await database.pool.query(buildRuntimeRoleSql(config)); // Safe, repeatable provisioning.
    runtime = new pg.Pool({ ...database.pool.options, user: role, password });

    await assertProductionDatabasePrivileges(runtime, true);
    await assert.rejects(
      assertProductionDatabasePrivileges(database.pool, true),
      {
        message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
      }
    );
    const privilegedConnection = await database.pool.connect();
    try {
      await privilegedConnection.query(`SET ROLE ${role}`);
      await assert.rejects(
        assertProductionDatabasePrivileges(privilegedConnection, true),
        { message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE' }
      );
    } finally {
      await privilegedConnection.query('RESET ROLE');
      privilegedConnection.release();
    }
    await runtime.query(
      "INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status) VALUES ('individual', 2500, 'cad', 'pending')"
    );
    await runtime.query(
      "UPDATE fund_contributions SET updated_at=now() WHERE status='pending'"
    );
    await runtime.query(
      "INSERT INTO admin_audit_log (actor, action, entity_type, entity_id, metadata) VALUES ('synthetic', 'security_test', 'test', 'synthetic', '{}'::jsonb)"
    );

    await t.test(
      'the dedicated API role captures and activates exact commercial terms, qualifies history and records immutable adjustments',
      async () => {
        const operationId = randomUUID();
        const publicReference = `OG7-RUNTIME-${randomUUID()}`;
        const quote = quoteSponsorshipOffer(50000, 'CAD');
        const { fingerprint: _fingerprint, ...snapshot } = quote;
        // Minimal durable-operation fixture; no Stripe/provider request is made.
        await withPostgresTransaction(runtime, async (db) => {
          await db.query(
            `INSERT INTO checkout_operations(id,key_hash,request_hash,state,params,contribution_input)
          VALUES($1,$2,$3,'prepared','{}'::jsonb,'{}'::jsonb)`,
            [
              operationId,
              randomBytes(32).toString('hex'),
              randomBytes(32).toString('hex')
            ]
          );
          await recordCheckoutSponsorshipOffer(db, operationId, {
            publicReference,
            quote
          });
        });
        const checkout = {
          stripeSessionId: `cs_runtime_${randomUUID()}`,
          stripePaymentIntentId: `pi_runtime_${randomUUID()}`,
          publicReference,
          contributionType: 'sponsorship_interest',
          amountCents: 50000,
          currency: 'CAD',
          metadata: { openg7CheckoutOperationId: operationId, publicReference },
          publicDisplayConsent: false,
          publicName: null,
          displayAmountConsent: false,
          nonCharityAcknowledged: true,
          sponsorshipFollowupTokenHash: null
        };
        await insertCheckoutSessionRecord(runtime, checkout);
        const contributionId = (
          await runtime.query(
            'SELECT id FROM fund_contributions WHERE stripe_session_id=$1',
            [checkout.stripeSessionId]
          )
        ).rows[0].id;
        const read = (id) =>
          withPostgresTransaction(
            runtime,
            (db) => loadSponsorshipCommitment(db, id),
            { readOnlySnapshot: true }
          );
        assert.equal(
          await read(contributionId),
          null,
          'capturing terms never confirms a payment'
        );
        const paid = {
          ...checkout,
          status: 'paid',
          paidAtIso: '2026-10-11T12:00:00.000Z',
          emailPrivate: null,
          notifyAdmin: false
        };
        await upsertCheckoutSessionFromWebhook(runtime, paid);
        const commitment = await read(contributionId);
        assert.equal(commitment.state, 'active');
        assert.equal(commitment.provenance, 'accepted_offer');
        assert.deepEqual(commitment.offer, snapshot);
        assert.equal(commitment.obligations.length, 3);
        assert.ok(
          commitment.obligations.every((o) => o.fulfilmentEvidenceId === null)
        );
        assert.deepEqual(
          await loadSponsorshipOfferForSession(
            runtime,
            checkout.stripeSessionId
          ),
          snapshot
        );
        await upsertCheckoutSessionFromWebhook(runtime, paid);
        assert.equal(
          (await read(contributionId)).version,
          1,
          'replay does not reactivate the commitment'
        );
        assert.equal(
          (
            await runtime.query(
              'SELECT count(*)::int AS count FROM sponsorship_obligations WHERE contribution_id=$1',
              [contributionId]
            )
          ).rows[0].count,
          3
        );

        const historical = {
          ...checkout,
          stripeSessionId: `cs_runtime_historical_${randomUUID()}`,
          stripePaymentIntentId: `pi_runtime_historical_${randomUUID()}`,
          publicReference: `OG7-HISTORY-${randomUUID()}`,
          amountCents: 25000,
          metadata: {}
        };
        await upsertCheckoutSessionFromWebhook(runtime, {
          ...paid,
          ...historical
        });
        const historicalId = (
          await runtime.query(
            'SELECT id FROM fund_contributions WHERE stripe_session_id=$1',
            [historical.stripeSessionId]
          )
        ).rows[0].id;
        assert.equal((await read(historicalId)).state, 'needs_confirmation');
        assert.deepEqual((await read(historicalId)).obligations, []);
        const actor = 'admin:00000000-0000-4000-8000-000000000041';
        const qualification = {
          requestId: randomUUID(),
          contributionId: historicalId,
          expectedVersion: 1,
          confirmation: historicalId,
          reason:
            'Synthetic agreement explicitly qualifies the historical promise',
          evidenceReference: 'synthetic://runtime-commercial-agreement',
          offer: {
            ...createSponsorshipOfferSnapshot(25000, 'CAD'),
            version: 'historical-qualification-v1'
          }
        };
        const qualified = await withPostgresTransaction(runtime, (db) =>
          qualifySponsorshipCommitment(db, qualification, actor)
        );
        assert.equal(qualified.provenance, 'qualified_historical');
        assert.deepEqual(qualified.offer, qualification.offer);
        assert.equal(qualified.obligations.length, 2);
        const facebook = qualified.obligations.find(
          (o) => o.channel === 'facebook'
        );
        const destination = {
          requestId: randomUUID(),
          obligationId: facebook.id,
          expectedVersion: facebook.version,
          confirmation: facebook.id,
          kind: 'destination',
          target: 'openg20',
          reason: 'Synthetic explicit destination correction'
        };
        const adjusted = await withPostgresTransaction(runtime, (db) =>
          adjustSponsorshipObligation(db, destination, actor)
        );
        const changed = adjusted.obligations.find((o) => o.id === facebook.id);
        assert.equal(changed.target, 'openg20');
        assert.equal(changed.fulfilmentEvidenceId, null);
        assert.notEqual(changed.state, 'fulfilled');
        assert.deepEqual(
          await withPostgresTransaction(runtime, (db) =>
            adjustSponsorshipObligation(db, destination, actor)
          ),
          adjusted,
          'replay preserves the exact commercial change'
        );
        const waiver = {
          requestId: randomUUID(),
          obligationId: facebook.id,
          expectedVersion: changed.version,
          confirmation: facebook.id,
          kind: 'waiver',
          reason: 'Synthetic explicitly documented waiver'
        };
        const waived = await withPostgresTransaction(runtime, (db) =>
          adjustSponsorshipObligation(db, waiver, actor)
        );
        assert.equal(
          waived.obligations.find((o) => o.id === facebook.id).state,
          'adjusted'
        );
        assert.equal(
          waived.obligations.find((o) => o.id === facebook.id)
            .fulfilmentEvidenceId,
          null
        );
        assert.deepEqual(
          waived.offer,
          qualification.offer,
          'adjusting an obligation never rewrites the recorded offer'
        );
        const facts = (
          await runtime.query(
            'SELECT status,amount_cents,currency,public_display_consent,sponsor_review_status,sponsor_feed_status FROM fund_contributions WHERE id=$1',
            [historicalId]
          )
        ).rows[0];
        assert.deepEqual(facts, {
          status: 'paid',
          amount_cents: 25000,
          currency: 'cad',
          public_display_consent: false,
          sponsor_review_status: null,
          sponsor_feed_status: 'not_planned'
        });
        assert.equal(
          (
            await runtime.query(
              'SELECT count(*)::int AS count FROM sponsorship_commitment_changes WHERE commitment_id=$1',
              [qualified.id]
            )
          ).rows[0].count,
          3
        );
        assert.equal(
          (
            await runtime.query(
              "SELECT count(*)::int AS count FROM admin_audit_log WHERE entity_id=$1 AND action LIKE 'sponsorship_commitment.%'",
              [historicalId]
            )
          ).rows[0].count,
          3
        );
        assert.equal(
          (
            await runtime.query(
              "SELECT count(*)::int AS count FROM sponsorship_obligations WHERE state='fulfilled'"
            )
          ).rows[0].count,
          0
        );
        assert.equal(
          (
            await runtime.query(
              'SELECT count(*)::int AS count FROM publication_deliveries'
            )
          ).rows[0].count,
          0
        );

        await assert.rejects(
          runtime.query(
            "UPDATE sponsorship_offers SET version='rewritten' WHERE id=$1",
            [commitment.offerId]
          ),
          { code: '23514' }
        );
        await assert.rejects(
          runtime.query('DELETE FROM sponsorship_offers WHERE id=$1', [
            commitment.offerId
          ]),
          { code: '42501' }
        );
        await assert.rejects(
          runtime.query(
            "UPDATE sponsorship_commitment_changes SET reason='rewritten' WHERE commitment_id=$1",
            [qualified.id]
          ),
          { code: '23514' }
        );
        await assert.rejects(
          runtime.query(
            'DELETE FROM sponsorship_commitment_changes WHERE commitment_id=$1',
            [qualified.id]
          ),
          { code: '42501' }
        );
        await assert.rejects(
          runtime.query(
            "UPDATE admin_audit_log SET actor='rewritten' WHERE entity_id=$1",
            [historicalId]
          ),
          { code: '42501' }
        );
        await assert.rejects(
          runtime.query('DELETE FROM admin_audit_log WHERE entity_id=$1', [
            historicalId
          ]),
          { code: '42501' }
        );
        assert.deepEqual(await read(contributionId), commitment);
      }
    );

    for (const sql of [
      'DELETE FROM fund_contributions',
      'TRUNCATE fund_contributions',
      'DROP TABLE fund_contributions',
      'ALTER TABLE fund_contributions ADD COLUMN compromised text',
      'CREATE TABLE security_unapproved_table (id integer)',
      'CREATE TEMP TABLE security_unapproved_temp (id integer)',
      "UPDATE admin_audit_log SET actor='modified'",
      'DELETE FROM admin_audit_log'
    ]) {
      await assert.rejects(runtime.query(sql), { code: '42501' });
    }
    await runtime.query(
      'DELETE FROM admin_login_challenges WHERE expires_at < now()'
    );

    // Effective PUBLIC grants and later privilege drift must also block startup.
    await database.pool.query(`GRANT DELETE ON fund_contributions TO ${role}`);
    await assert.rejects(assertProductionDatabasePrivileges(runtime, true), {
      message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
    });
    await database.pool.query(buildRuntimeRoleSql(config));
    await database.pool.query(`GRANT CREATE ON SCHEMA public TO ${role}`);
    await assert.rejects(assertProductionDatabasePrivileges(runtime, true), {
      message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
    });
    await database.pool.query(buildRuntimeRoleSql(config));
    await assertProductionDatabasePrivileges(runtime, true);

    await database.pool.query(`GRANT TEMP ON DATABASE ${name} TO PUBLIC`);
    await assert.rejects(assertProductionDatabasePrivileges(runtime, true), {
      message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
    });
    await database.pool.query(buildRuntimeRoleSql(config));
    await database.pool.query('CREATE ROLE og7_runtime_elevated NOLOGIN');
    await database.pool.query(`GRANT og7_runtime_elevated TO ${role}`);
    await assert.rejects(assertProductionDatabasePrivileges(runtime, true), {
      message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
    });
    await database.pool.query(`REVOKE og7_runtime_elevated FROM ${role}`);
    await assertProductionDatabasePrivileges(runtime, true);

    // An executable SECURITY DEFINER routine could bypass all table ACLs.
    await database.pool.query(
      "CREATE FUNCTION public.security_test_definer() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'"
    );
    await assert.rejects(assertProductionDatabasePrivileges(runtime, true), {
      message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
    });
    await database.pool.query('DROP FUNCTION public.security_test_definer()');
    await assertProductionDatabasePrivileges(runtime, true);
  }
);

test(
  'Production rejects column grants that allow audit or migration-history writes and references',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres({ migrate: false });
    let runtime;
    t.after(async () => {
      await runtime?.end();
      await database.stop();
    });
    await database.pool.query(`
      CREATE TABLE admin_audit_log(actor text);
      CREATE TABLE openg7_schema_migrations(name text);
      CREATE TABLE fund_contributions(id integer);
      INSERT INTO admin_audit_log VALUES ('synthetic');
      INSERT INTO openg7_schema_migrations VALUES ('synthetic');
    `);
    const role = 'og7_runtime_column_test';
    const password = randomBytes(32).toString('hex');
    const name = (
      await database.pool.query('SELECT current_database() AS name')
    ).rows[0].name;
    const config = { role, database: name, password };
    await database.pool.query(buildRuntimeRoleSql(config, { create: true }));
    runtime = new pg.Pool({ ...database.pool.options, user: role, password });
    await assertProductionDatabasePrivileges(runtime, true);

    for (const [table, column, privilege, grantee, mutation] of [
      [
        'admin_audit_log',
        'actor',
        'UPDATE',
        role,
        "UPDATE admin_audit_log SET actor='modified-synthetic'"
      ],
      [
        'openg7_schema_migrations',
        'name',
        'INSERT',
        'PUBLIC',
        "INSERT INTO openg7_schema_migrations(name) VALUES ('modified-synthetic')"
      ],
      [
        'openg7_schema_migrations',
        'name',
        'UPDATE',
        role,
        "UPDATE openg7_schema_migrations SET name='modified-synthetic'"
      ],
      ['fund_contributions', 'id', 'REFERENCES', role, null]
    ]) {
      await database.pool.query(
        `GRANT ${privilege} (${column}) ON ${table} TO ${grantee}`
      );
      const privileges = (
        await runtime.query(
          `SELECT has_table_privilege(current_user, $1, $2) AS table_grant,
            has_any_column_privilege(current_user, $1, $2) AS column_grant`,
          [table, privilege]
        )
      ).rows[0];
      assert.deepEqual(privileges, { table_grant: false, column_grant: true });
      if (mutation) assert.ok((await runtime.query(mutation)).rowCount > 0);
      await assert.rejects(assertProductionDatabasePrivileges(runtime, true), {
        message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
      });
      await database.pool.query(buildRuntimeRoleSql(config));
      await assertProductionDatabasePrivileges(runtime, true);
      if (mutation)
        await assert.rejects(runtime.query(mutation), { code: '42501' });
    }
  }
);
