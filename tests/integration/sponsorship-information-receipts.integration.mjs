import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import pg from 'pg';

import { requestSponsorshipInformation } from '../../dist/apps/funding-api/src/sponsorship-information.service.js';
import { readSponsorshipInformationRequestReceipt } from '../../dist/apps/funding-api/src/sponsorship-information-receipts.repository.js';
import { prepareAdminAssistantDraft } from '../../dist/apps/funding-api/src/admin-assistant/preparation.service.js';
import { assertProductionDatabasePrivileges } from '../../dist/apps/funding-api/src/database-runtime-security.js';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const requestId = '10000000-0000-4000-8000-00000000000a';
const actor = 'admin:synthetic-information-operator';
const otherActor = 'admin:synthetic-other-operator';

test(
  'migration 062 preserves existing queue and audit facts without inventing historical UUID receipts',
  { timeout: 90000 },
  async (t) => {
    const database = await startDisposablePostgres({ migrate: false });
    t.after(() => database.stop());
    const { pool } = database;
    const migrations = new URL(
      '../../apps/funding-api/migrations/',
      import.meta.url
    );
    for (const file of (await readdir(migrations))
      .filter(
        (file) => /^\d{3}.*\.sql$/.test(file) && Number(file.slice(0, 3)) < 62
      )
      .sort())
      await pool.query(await readFile(new URL(file, migrations), 'utf8'));
    const contributionId = (
      await pool.query(`INSERT INTO fund_contributions
    (contribution_type,amount_cents,currency,status,stripe_session_id)
    VALUES ('sponsorship_interest',50000,'cad','paid','cs_test_historical_information') RETURNING id`)
    ).rows[0].id;
    const messageId = (
      await pool.query(
        `INSERT INTO email_messages
    (idempotency_key,template_key,recipient_email,from_email,subject,text_body,html_body,metadata,status,sent_at)
    VALUES ('sponsorship-information:synthetic-historical-key','sponsorship_information_request',
      'historical@example.test','from@example.test','Historical synthetic subject',
      'Historical synthetic body','<p>Historical synthetic body</p>',$1::jsonb,'sent','2026-10-18T12:00:00Z') RETURNING id`,
        [JSON.stringify({ contributionId })]
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,metadata)
    VALUES ($1,'sponsorship.request_information','sponsorship',$2,$3::jsonb)`,
      [actor, contributionId, JSON.stringify({ messageId })]
    );
    const lookup = { requestId, contributionId };
    await assert.rejects(
      readSponsorshipInformationRequestReceipt(pool, lookup, actor),
      { code: '42P01' }
    );
    const before = {};
    for (const table of [
      'fund_contributions',
      'email_messages',
      'admin_audit_log'
    ])
      before[table] = (
        await pool.query(`SELECT * FROM ${table} ORDER BY 1`)
      ).rows;
    await pool.query(
      await readFile(
        new URL(
          '062_create_sponsorship_information_request_receipts.sql',
          migrations
        ),
        'utf8'
      )
    );
    assert.equal(
      (
        await pool.query(
          'SELECT COUNT(*)::int AS count FROM sponsorship_information_request_receipts'
        )
      ).rows[0].count,
      0
    );
    assert.deepEqual(
      await readSponsorshipInformationRequestReceipt(pool, lookup, actor),
      { ...lookup, found: false }
    );
    for (const table of Object.keys(before))
      assert.deepEqual(
        (await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
        before[table]
      );
  }
);

// Only a fresh local database; no worker, SMTP, Stripe or model provider runs.
test(
  'information request receipts bind UUID, actor and payload without duplicating or replaying delivery',
  { timeout: 90000 },
  async (t) => {
    const database = await startDisposablePostgres();
    let runtime;
    t.after(async () => {
      await runtime?.end();
      await database.stop();
    });
    const owner = database.pool;
    const role = 'og7_information_receipts_runtime';
    const password = randomBytes(32).toString('hex');
    const databaseName = (
      await owner.query('SELECT current_database() AS name')
    ).rows[0].name;
    const roleConfig = { role, database: databaseName, password };
    await owner.query(buildRuntimeRoleSql(roleConfig, { create: true }));
    runtime = new pg.Pool({ ...owner.options, user: role, password });
    await assertProductionDatabasePrivileges(runtime, true);
    const contributionId = (
      await owner.query(
        `INSERT INTO fund_contributions
      (contribution_type, amount_cents, currency, status, paid_at,
        sponsor_contact_email, sponsor_company_name, stripe_session_id)
    VALUES ('sponsorship_interest', 50000, 'cad', 'paid', NOW(),
      'synthetic@example.test', 'Synthetic information fixture', 'cs_test_information_receipt') RETURNING id`
      )
    ).rows[0].id;
    const prepared = await prepareAdminAssistantDraft(runtime, {
      type: 'sponsorship_reminder',
      reference: contributionId,
      language: 'en'
    });
    const input = { ...prepared.delivery, requestId, confirmed: true };
    const lookup = { requestId, contributionId };
    const counts = async () =>
      (
        await owner.query(`SELECT
    (SELECT COUNT(*)::int FROM email_messages) AS messages,
    (SELECT COUNT(*)::int FROM admin_audit_log) AS audits,
    (SELECT COUNT(*)::int FROM sponsorship_information_request_receipts) AS receipts`)
      ).rows[0];
    const snapshot = async () => {
      const rows = {};
      for (const table of [
        'email_messages',
        'admin_audit_log',
        'fund_contributions',
        'sponsorship_information_request_receipts'
      ])
        rows[table] = (
          await owner.query(`SELECT * FROM ${table} ORDER BY 1`)
        ).rows;
      return rows;
    };
    assert.deepEqual(
      await readSponsorshipInformationRequestReceipt(runtime, lookup, actor),
      { ...lookup, found: false }
    );
    const results = await Promise.all([
      requestSponsorshipInformation(runtime, input, actor),
      requestSponsorshipInformation(runtime, input, actor)
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [
      'already_queued',
      'queued'
    ]);
    assert.equal(results[0].messageId, results[1].messageId);
    assert.equal(results[0].acceptedAt, results[1].acceptedAt);
    const messageId = results[0].messageId;
    assert.match(
      results[0].acceptedAt,
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
    );
    assert.deepEqual(await counts(), { messages: 1, audits: 1, receipts: 1 });
    const audit = (await owner.query('SELECT * FROM admin_audit_log')).rows[0];
    assert.equal(audit.actor, actor);
    assert.deepEqual(audit.metadata, { requestId, messageId });
    assert.doesNotMatch(
      JSON.stringify(audit),
      /synthetic@example|Complete your sponsorship/
    );

    await t.test(
      'UUID replays are canonical and incompatible payloads or actors conflict without writes',
      async () => {
        const before = await snapshot();
        const normalized = await requestSponsorshipInformation(
          runtime,
          {
            ...input,
            requestId: requestId.toUpperCase(),
            contributionId: contributionId.toUpperCase()
          },
          actor
        );
        assert.equal(normalized.requestId, requestId);
        assert.equal(normalized.messageId, messageId);
        for (const patch of [
          { contextVersion: 'a'.repeat(64) },
          { contributionId: '10000000-0000-4000-8000-000000000999' },
          { recipient: 'other@example.test' },
          { subject: 'Different subject' },
          { body: 'Different body' }
        ])
          await assert.rejects(
            requestSponsorshipInformation(
              runtime,
              { ...input, ...patch },
              actor
            ),
            {
              status: 409,
              code: 'INFORMATION_REQUEST_ID_CONFLICT'
            }
          );
        await assert.rejects(
          requestSponsorshipInformation(runtime, input, otherActor),
          {
            status: 409,
            code: 'INFORMATION_REQUEST_ID_CONFLICT'
          }
        );
        assert.deepEqual(await snapshot(), before);
      }
    );

    await t.test(
      'all five delivery states are observed by pure actor-bound reads, never delivery retries',
      async () => {
        const sentAt = '2026-10-19T12:34:56.000Z';
        for (const status of [
          'queued',
          'sending',
          'sent',
          'failed',
          'uncertain'
        ]) {
          await owner.query(
            `UPDATE email_messages SET status=$2, attempts=3,
        next_attempt_at='2026-10-20T12:00:00Z', delivery_attempt_id=$3::uuid,
        sent_at=CASE WHEN $2='sent' THEN $4::timestamptz ELSE NULL END WHERE id=$1`,
            [messageId, status, requestId, sentAt]
          );
          const before = await snapshot();
          const receipt = await readSponsorshipInformationRequestReceipt(
            runtime,
            {
              requestId: requestId.toUpperCase(),
              contributionId: contributionId.toUpperCase()
            },
            actor
          );
          assert.deepEqual(receipt, {
            ...lookup,
            found: true,
            messageId,
            acceptedAt: results[0].acceptedAt,
            deliveryStatus: status,
            sentAt: status === 'sent' ? sentAt : null
          });
          for (const [query, requestingActor] of [
            [lookup, otherActor],
            [
              { ...lookup, requestId: '10000000-0000-4000-8000-000000000999' },
              actor
            ],
            [
              {
                ...lookup,
                contributionId: '10000000-0000-4000-8000-000000000999'
              },
              actor
            ]
          ])
            assert.deepEqual(
              await readSponsorshipInformationRequestReceipt(
                runtime,
                query,
                requestingActor
              ),
              {
                ...query,
                found: false
              }
            );
          assert.deepEqual(await snapshot(), before);
          const replay = await requestSponsorshipInformation(
            runtime,
            input,
            actor
          );
          assert.equal(replay.messageId, messageId);
          assert.equal(replay.deliveryStatus, status);
          assert.deepEqual(await snapshot(), before);
        }
      }
    );

    await t.test(
      'an accepted UUID survives context changes, while a new UUID must revalidate before retaining content deduplication',
      async () => {
        await owner.query(
          'UPDATE fund_contributions SET updated_at=NOW() WHERE id=$1',
          [contributionId]
        );
        assert.equal(
          (await requestSponsorshipInformation(runtime, input, actor))
            .messageId,
          messageId
        );
        await assert.rejects(
          requestSponsorshipInformation(
            runtime,
            {
              ...input,
              requestId: '10000000-0000-4000-8000-00000000000b'
            },
            actor
          ),
          { status: 409, code: 'INFORMATION_REQUEST_CONFLICT' }
        );
        const fresh = await prepareAdminAssistantDraft(runtime, {
          type: 'sponsorship_reminder',
          reference: contributionId,
          language: 'en'
        });
        const duplicate = await requestSponsorshipInformation(
          runtime,
          {
            ...input,
            contextVersion: fresh.delivery.contextVersion,
            requestId: '10000000-0000-4000-8000-00000000000b'
          },
          actor
        );
        assert.equal(duplicate.messageId, messageId);
        assert.deepEqual(await counts(), {
          messages: 1,
          audits: 1,
          receipts: 2
        });
      }
    );

    await t.test(
      'receipt persistence failure rolls queue and audit back atomically',
      async () => {
        const fresh = await prepareAdminAssistantDraft(runtime, {
          type: 'sponsorship_reminder',
          reference: contributionId,
          language: 'en'
        });
        const rejectedId = '10000000-0000-4000-8000-00000000000c';
        await owner.query(`CREATE FUNCTION reject_information_receipt_test() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic receipt failure'; END; $$;
      CREATE TRIGGER reject_information_receipt_test BEFORE INSERT ON sponsorship_information_request_receipts
      FOR EACH ROW EXECUTE FUNCTION reject_information_receipt_test()`);
        const before = await snapshot();
        try {
          await assert.rejects(
            requestSponsorshipInformation(
              runtime,
              {
                ...fresh.delivery,
                requestId: rejectedId,
                confirmed: true,
                subject: 'New synthetic request, rolled back'
              },
              actor
            )
          );
        } finally {
          await owner.query(
            'DROP TRIGGER reject_information_receipt_test ON sponsorship_information_request_receipts; DROP FUNCTION reject_information_receipt_test()'
          );
        }
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(
          await readSponsorshipInformationRequestReceipt(
            runtime,
            { requestId: rejectedId, contributionId },
            actor
          ),
          {
            requestId: rejectedId,
            contributionId,
            found: false
          }
        );
      }
    );

    await t.test(
      'receipt facts are immutable and runtime privileges cannot rewrite their binding',
      async () => {
        for (const sql of [
          'UPDATE sponsorship_information_request_receipts SET actor=actor',
          'DELETE FROM sponsorship_information_request_receipts'
        ]) {
          await assert.rejects(runtime.query(sql), { code: '42501' });
          await assert.rejects(owner.query(sql), { code: 'P0001' });
        }
        await owner.query(
          `GRANT UPDATE ON sponsorship_information_request_receipts TO ${role}`
        );
        await assert.rejects(
          assertProductionDatabasePrivileges(runtime, true),
          { message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE' }
        );
        await owner.query(buildRuntimeRoleSql(roleConfig));
        await assertProductionDatabasePrivileges(runtime, true);
      }
    );
  }
);
