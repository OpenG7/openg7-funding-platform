import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  assertModerationApproved,
  confirmModerationDecision,
  getModerationContent,
  listPublicModerationDecisions,
  recordModerationDecision
} from '../../dist/apps/funding-api/src/moderation/repository.js';
import { moderationApprovedSql } from '../../dist/apps/funding-api/src/moderation/policy.js';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';

const actor = 'admin:00000000-0000-4000-8000-000000000001';
const second = 'admin:00000000-0000-4000-8000-000000000002';
test(
  'moderation decisions, editorial versions and private notifications on PostgreSQL',
  { timeout: 180000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(() => database.stop());
    const { pool } = database;
    const transact = (operation) => withPostgresTransaction(pool, operation);
    const sponsor = async (email = null) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,sponsor_company_name,public_name,sponsor_review_status,public_display_consent,email_private) VALUES($1,'sponsorship_interest',100000,'cad','paid','Synthetic Workshop','Synthetic Public Name','pending_review',TRUE,$2)`,
        [id, email]
      );
      return { type: 'sponsorship', id };
    };
    const decision = async (subject, level = 'N0', extra = {}) => {
      const content = await transact((db) => getModerationContent(db, subject));
      return {
        requestId: randomUUID(),
        policyVersion: '1.0',
        contentVersion: content.contentVersion,
        contentFingerprint: content.fingerprint,
        confirmation: subject.id,
        expectedDecisionId: content.currentDecisionId,
        level,
        ...(level === 'N0'
          ? {}
          : {
              primaryReason: 'MISLEADING_CLAIM',
              internalReason: 'PRIVATE_SYNTHETIC_EVIDENCE',
              sponsorExplanation: 'Please provide support for the claim.'
            }),
        ...extra
      };
    };
    const record = (subject, input, reviewer = actor) =>
      transact((db) =>
        recordModerationDecision(db, {
          subject,
          decision: input,
          actor: reviewer
        })
      );

    await t.test(
      'historical technical approval never creates an editorial approval',
      async () => {
        const subject = await sponsor();
        await pool.query(
          "UPDATE fund_contributions SET sponsor_review_status='approved' WHERE id=$1",
          [subject.id]
        );
        await assert.rejects(
          transact((db) => assertModerationApproved(db, subject)),
          { code: 'MODERATION_DECISION_REQUIRED' }
        );
        assert.equal(
          (
            await pool.query(
              'SELECT COUNT(*)::int AS count FROM moderation_cases WHERE subject_id=$1',
              [subject.id]
            )
          ).rows[0].count,
          0
        );
      }
    );
    await t.test(
      'replays and simultaneous requests create one immutable decision and one audit',
      async () => {
        const subject = await sponsor();
        const input = await decision(subject);
        const results = await Promise.all([
          record(subject, input),
          record(subject, input)
        ]);
        assert.equal(results[0].id, results[1].id);
        assert.equal(
          (
            await pool.query(
              "SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE entity_id=$1 AND action='moderation.decision'",
              [results[0].id]
            )
          ).rows[0].count,
          1
        );
        await assert.rejects(
          record(subject, { ...input, internalReason: 'changed payload' }),
          { code: 'MODERATION_REQUEST_CONFLICT' }
        );
        await assert.rejects(
          pool.query(
            'UPDATE moderation_decisions SET internal_reason=$2 WHERE id=$1',
            [results[0].id, 'tamper']
          ),
          { code: '55000' }
        );
        await transact((db) => assertModerationApproved(db, subject));
      }
    );
    await t.test(
      'financial changes preserve editorial versions; actual edits and reversions invalidate',
      async () => {
        const subject = await sponsor();
        const first = await decision(subject);
        await record(subject, first);
        await pool.query(
          'UPDATE fund_contributions SET updated_at=NOW(),amount_cents=amount_cents+1 WHERE id=$1',
          [subject.id]
        );
        const unchanged = await transact((db) =>
          getModerationContent(db, subject)
        );
        assert.equal(unchanged.contentVersion, first.contentVersion);
        assert.equal(unchanged.fingerprint, first.contentFingerprint);
        await transact((db) => assertModerationApproved(db, subject));
        await pool.query(
          "UPDATE fund_contributions SET sponsor_company_name='Changed Workshop' WHERE id=$1",
          [subject.id]
        );
        await assert.rejects(
          transact((db) => assertModerationApproved(db, subject)),
          { code: 'MODERATION_RESTRICTED' }
        );
        await pool.query(
          "UPDATE fund_contributions SET sponsor_company_name='Synthetic Workshop' WHERE id=$1",
          [subject.id]
        );
        const reverted = await transact((db) =>
          getModerationContent(db, subject)
        );
        assert.equal(reverted.fingerprint, first.contentFingerprint);
        assert.ok(reverted.contentVersion > first.contentVersion);
        await assert.rejects(
          record(subject, {
            ...first,
            requestId: randomUUID(),
            expectedDecisionId: reverted.currentDecisionId
          }),
          { code: 'MODERATION_CONTENT_CHANGED' }
        );
        assert.equal(
          (
            await pool.query(
              'SELECT COUNT(*)::int AS count FROM moderation_content_versions WHERE subject_id=$1',
              [subject.id]
            )
          ).rows[0].count,
          3
        );
      }
    );
    await t.test(
      'published names are part of the content, and public SQL excludes unreviewed changes',
      async () => {
        const subject = await sponsor();
        await record(subject, await decision(subject));
        const eligible = () =>
          pool.query(
            `SELECT COUNT(*)::int AS count FROM fund_contributions c WHERE c.id=$1 AND ${moderationApprovedSql('sponsorship', 'c.id')}`,
            [subject.id]
          );
        assert.equal((await eligible()).rows[0].count, 1);
        await pool.query(
          "UPDATE fund_contributions SET public_name='Different public name' WHERE id=$1",
          [subject.id]
        );
        assert.equal((await eligible()).rows[0].count, 0);
      }
    );
    await t.test(
      'N4 waits for another stable person; confirmation is idempotent and finance stays intact',
      async () => {
        const subject = await sponsor('synthetic@example.test');
        const pending = await record(
          subject,
          await decision(subject, 'N4', { primaryReason: 'THREAT' })
        );
        assert.equal(pending.state, 'pending_independent_review');
        const before = (
          await pool.query(
            'SELECT status,amount_cents,sponsor_review_status,sponsor_site_visibility_held FROM fund_contributions WHERE id=$1',
            [subject.id]
          )
        ).rows[0];
        assert.equal(before.status, 'paid');
        assert.equal(before.sponsor_review_status, 'pending_review');
        assert.equal(before.sponsor_site_visibility_held, true);
        const confirmation = {
          decisionId: pending.id,
          requestId: randomUUID(),
          confirmation: pending.id
        };
        await assert.rejects(
          transact((db) =>
            confirmModerationDecision(db, { ...confirmation, actor })
          ),
          { code: 'MODERATION_INDEPENDENT_REVIEW_REQUIRED' }
        );
        await assert.rejects(
          transact((db) =>
            confirmModerationDecision(db, {
              ...confirmation,
              actor: actor.toUpperCase()
            })
          ),
          { code: 'MODERATION_INDEPENDENT_REVIEW_REQUIRED' }
        );
        await assert.rejects(
          transact((db) =>
            confirmModerationDecision(db, {
              ...confirmation,
              actor: 'funding-admin-session'
            })
          ),
          { code: 'MODERATION_INDEPENDENT_IDENTITY_REQUIRED' }
        );
        const confirmed = await transact((db) =>
          confirmModerationDecision(db, { ...confirmation, actor: second })
        );
        assert.equal(confirmed.state, 'active');
        assert.equal(
          (
            await transact((db) =>
              confirmModerationDecision(db, { ...confirmation, actor: second })
            )
          ).id,
          pending.id
        );
        const after = (
          await pool.query(
            'SELECT status,amount_cents,sponsor_review_status FROM fund_contributions WHERE id=$1',
            [subject.id]
          )
        ).rows[0];
        assert.equal(after.status, 'paid');
        assert.equal(after.amount_cents, before.amount_cents);
        assert.equal(after.sponsor_review_status, 'rejected');
        await assert.rejects(record(subject, await decision(subject)), {
          code: 'MODERATION_INDEPENDENT_REVIEW_REQUIRED'
        });
        const publicDecisions = await listPublicModerationDecisions(
          pool,
          subject.id
        );
        assert.ok(
          !JSON.stringify(publicDecisions).includes(
            'PRIVATE_SYNTHETIC_EVIDENCE'
          )
        );
        assert.equal(
          publicDecisions[0].sponsorExplanation,
          'Please provide support for the claim.'
        );
      }
    );
    await t.test(
      'a withdrawal blocks new decisions and old approval guards',
      async () => {
        const subject = await sponsor();
        await record(subject, await decision(subject));
        const next = await decision(subject);
        await pool.query(
          "UPDATE moderation_policies SET editorial_status='withdrawn' WHERE version='1.0'"
        );
        try {
          await assert.rejects(
            transact((db) => assertModerationApproved(db, subject)),
            { code: 'MODERATION_RESTRICTED' }
          );
          await assert.rejects(record(subject, next), {
            code: 'MODERATION_POLICY_UNAVAILABLE'
          });
        } finally {
          await pool.query(
            "UPDATE moderation_policies SET editorial_status='approved' WHERE version='1.0'"
          );
        }
      }
    );
    await t.test(
      'grave history cannot be bypassed through an intermediate hold',
      async () => {
        const subject = await sponsor();
        await record(
          subject,
          await decision(subject, 'N4', { primaryReason: 'THREAT' })
        );
        await record(subject, await decision(subject, 'N2'));
        for (const level of ['N0', 'N1']) {
          await assert.rejects(
            record(subject, await decision(subject, level)),
            {
              code: 'MODERATION_INDEPENDENT_REVIEW_REQUIRED'
            }
          );
        }
        const attenuated = await record(
          subject,
          await decision(subject),
          second
        );
        assert.equal(attenuated.state, 'active');
      }
    );
    await t.test(
      'confirmation replays remain historical after an edit; reused request IDs conflict',
      async () => {
        const subject = await sponsor();
        const pending = await record(
          subject,
          await decision(subject, 'N4', { primaryReason: 'THREAT' })
        );
        const confirmation = {
          decisionId: pending.id,
          requestId: randomUUID(),
          confirmation: pending.id,
          actor: second
        };
        await transact((db) => confirmModerationDecision(db, confirmation));
        await pool.query(
          "UPDATE fund_contributions SET sponsor_company_name='Later content' WHERE id=$1",
          [subject.id]
        );
        const beforeReplay = await transact((db) =>
          getModerationContent(db, subject)
        );
        const replay = await transact((db) =>
          confirmModerationDecision(db, confirmation)
        );
        assert.equal(replay.id, pending.id);
        const afterReplay = await transact((db) =>
          getModerationContent(db, subject)
        );
        assert.equal(afterReplay.contentVersion, beforeReplay.contentVersion);
        assert.equal(
          (
            await pool.query(
              'SELECT state FROM moderation_cases WHERE subject_id=$1',
              [subject.id]
            )
          ).rows[0].state,
          'unreviewed'
        );
        assert.equal(
          (
            await pool.query(
              "SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE entity_id=$1 AND action='moderation.independent_review'",
              [pending.id]
            )
          ).rows[0].count,
          1
        );
        const other = await sponsor();
        const otherPending = await record(
          other,
          await decision(other, 'N4', { primaryReason: 'THREAT' })
        );
        await assert.rejects(
          transact((db) =>
            confirmModerationDecision(db, {
              ...confirmation,
              decisionId: otherPending.id,
              confirmation: otherPending.id
            })
          ),
          { code: 'MODERATION_REQUEST_CONFLICT' }
        );
        await assert.rejects(
          transact((db) =>
            confirmModerationDecision(db, {
              ...confirmation,
              decisionId: '-'.repeat(36),
              confirmation: '-'.repeat(36)
            })
          ),
          { code: 'CONFIRMATION_REQUIRED' }
        );
      }
    );
    await t.test(
      'outbox failure rolls back the decision, restriction and audit together',
      async () => {
        const subject = await sponsor('rollback@example.test');
        const input = await decision(subject, 'N2');
        await assert.rejects(
          transact(async (db) => {
            const failing = {
              query: (sql, values) => {
                if (/INSERT INTO email_messages/i.test(sql))
                  throw new Error('Synthetic outbox unavailable');
                return db.query(sql, values);
              }
            };
            await recordModerationDecision(failing, {
              subject,
              decision: input,
              actor
            });
          }),
          /Synthetic outbox unavailable/
        );
        assert.equal(
          (
            await pool.query(
              'SELECT COUNT(*)::int AS count FROM moderation_decisions WHERE subject_id=$1',
              [subject.id]
            )
          ).rows[0].count,
          0
        );
        assert.equal(
          (
            await pool.query(
              'SELECT sponsor_site_visibility_held FROM fund_contributions WHERE id=$1',
              [subject.id]
            )
          ).rows[0].sponsor_site_visibility_held,
          false
        );
        assert.equal(
          (
            await pool.query(
              "SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE metadata->>'subjectId'=$1",
              [subject.id]
            )
          ).rows[0].count,
          0
        );
      }
    );
    await t.test(
      'public terms remain inactive and no historical acceptance is invented',
      async () => {
        const policy = (
          await pool.query(
            "SELECT public_active,public_charter_hash FROM moderation_policies WHERE version='1.0'"
          )
        ).rows[0];
        assert.equal(policy.public_active, false);
        assert.equal(policy.public_charter_hash, null);
      }
    );
    await t.test(
      'the dedicated API role can record decisions but cannot activate a policy',
      async () => {
        const databaseName = (
          await pool.query('SELECT current_database() AS name')
        ).rows[0].name;
        await pool.query(
          buildRuntimeRoleSql(
            {
              role: 'synthetic_moderation_runtime',
              database: databaseName,
              password: 'synthetic-test-password-not-used-externally'
            },
            { create: true }
          )
        );
        const subject = await sponsor();
        const input = await decision(subject);
        await transact(async (db) => {
          await db.query('SET LOCAL ROLE synthetic_moderation_runtime');
          const result = await recordModerationDecision(db, {
            subject,
            decision: input,
            actor
          });
          assert.equal(result.level, 'N0');
          await assertModerationApproved(db, subject);
        });
        await assert.rejects(
          transact(async (db) => {
            await db.query('SET LOCAL ROLE synthetic_moderation_runtime');
            await db.query(
              "UPDATE moderation_policies SET public_active=FALSE WHERE version='1.0'"
            );
          }),
          { code: '42501' }
        );
        await assert.rejects(
          transact(async (db) => {
            await db.query('SET LOCAL ROLE synthetic_moderation_runtime');
            await db.query(
              "UPDATE moderation_policies SET version='renamed' WHERE version='1.0'"
            );
          }),
          { code: '55000' }
        );
      }
    );
  }
);
