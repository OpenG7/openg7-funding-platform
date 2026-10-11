import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

import { createDurableCheckoutService } from '../../dist/apps/funding-api/src/checkout-operations.service.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { revealPrivateText } from '../../dist/apps/funding-api/src/private-data-protection.js';
import { getModerationContent } from '../../dist/apps/funding-api/src/moderation/content.js';
import {
  recordModerationDecision,
  confirmModerationDecision
} from '../../dist/apps/funding-api/src/moderation/repository.js';
import {
  getPublicSponsorshipCharter,
  recordSponsorshipCharterAcceptance,
  sponsorshipCharterFingerprint
} from '../../dist/apps/funding-api/src/moderation/charter.js';
import {
  getSponsorshipModeration,
  requestSponsorshipReconsideration,
  submitSponsorshipCorrection
} from '../../dist/apps/funding-api/src/moderation/followup.js';
import { resolveModerationReconsideration } from '../../dist/apps/funding-api/src/moderation/reconsiderations.js';
import {
  recordRemoteRemovalRequirement,
  recordRemoteRemovalProviderResult,
  moderationAdoptionPreview,
  moderationMetrics
} from '../../dist/apps/funding-api/src/moderation/governance.js';
import { assignModerationCase } from '../../dist/apps/funding-api/src/moderation/assignment.js';
import {
  enqueueModerationNotification,
  enqueueModerationFollowupReceipt
} from '../../dist/apps/funding-api/src/moderation/notifications.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const actor = `admin:${randomUUID()}`;
const otherActor = `admin:${randomUUID()}`;
const hash = (value) => createHash('sha256').update(value).digest('hex');

test(
  'private moderation corrections, reconsideration and prepared charter use isolated PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(() => db.stop());
    const { pool } = db;
    const sponsor = async () => {
      const token = randomBytes(32).toString('base64url');
      const id = randomUUID();
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,paid_at,email_private,public_display_consent,non_charity_acknowledged,sponsor_company_name,sponsor_contact_name,sponsor_contact_email,sponsor_message,sponsor_details_submitted_at,sponsor_review_status,sponsorship_followup_token_hash,sponsorship_followup_token_created_at)
      VALUES($1,'sponsorship_interest',2500,'cad','paid',NOW(),'synthetic-sponsor@example.test',TRUE,TRUE,'Synthetic partner','Synthetic contact','synthetic-contact@example.test','Original proposed text',NOW(),'pending_review',$2,NOW())`,
        [id, hash(token)]
      );
      return { id, token };
    };
    const review = async (dossier, level = 'N1', reason = 'MISLEADING_CLAIM') =>
      withPostgresTransaction(pool, async (client) => {
        const subject = { type: 'sponsorship', id: dossier.id };
        const content = await getModerationContent(client, subject);
        return recordModerationDecision(client, {
          subject,
          actor,
          decision: {
            requestId: randomUUID(),
            policyVersion: '1.0',
            contentVersion: content.contentVersion,
            contentFingerprint: content.fingerprint,
            level,
            primaryReason: reason,
            internalReason: 'PRIVATE_INTERNAL_REVIEW_MARKER',
            sponsorExplanation:
              'Please clarify the proposed commercial statement.',
            confirmation: dossier.id,
            expectedDecisionId: content.currentDecisionId
          }
        });
      });
    const facts = async (id) =>
      (
        await pool.query(
          'SELECT status,amount_cents,currency,paid_at,sponsor_company_name,sponsor_review_status FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0];
    const correctedData = {
      companyName: 'Corrected synthetic partner',
      contactName: 'Synthetic contact',
      contactEmail: 'synthetic-contact@example.test',
      websiteUrl: '',
      logoUrl: '',
      message: 'Corrected proposed statement'
    };

    await t.test(
      'a missing policy fails closed instead of pretending the public charter is inactive',
      async () => {
        await assert.rejects(
          withPostgresTransaction(pool, async (client) => {
            await client.query(
              "DELETE FROM moderation_policies WHERE version='1.0'"
            );
            return getPublicSponsorshipCharter(client);
          }),
          { code: 'CHARTER_CONFIGURATION_INVALID', status: 503 }
        );
        assert.equal((await getPublicSponsorshipCharter(pool)).active, false);
      }
    );

    await t.test(
      'private projection contains explanation without internal rationale or reviewer identity',
      async () => {
        const dossier = await sponsor();
        const decision = await review(dossier);
        const result = await getSponsorshipModeration(pool, dossier.token, 30);
        assert.equal(result.items[0].decision.id, decision.id);
        assert.equal(result.items[0].canCorrect, true);
        assert.match(
          result.items[0].decision.sponsorExplanation,
          /Please clarify/
        );
        assert.doesNotMatch(
          JSON.stringify(result),
          /PRIVATE_INTERNAL_REVIEW_MARKER|internalReason|independentReviewer|"actor"/
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM email_messages'
            )
          ).rows[0].count,
          1
        );
      }
    );

    await t.test(
      'a pre-payment dossier never queues a moderation decision or submission receipt',
      async () => {
        const dossier = await sponsor();
        await pool.query(
          "UPDATE fund_contributions SET status='pending',paid_at=NULL WHERE id=$1",
          [dossier.id]
        );
        const decision = await review(dossier);
        await withPostgresTransaction(pool, async (client) => {
          assert.equal(
            await enqueueModerationNotification(client, decision),
            null
          );
          await enqueueModerationFollowupReceipt(client, {
            contributionId: dossier.id,
            eventId: decision.id,
            kind: 'reconsideration'
          });
        });
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM email_messages WHERE idempotency_key=$1 OR idempotency_key=$2',
              [
                `moderation-decision:${decision.id}:fr-CA`,
                `moderation-reconsideration:${decision.id}:receipt`
              ]
            )
          ).rows[0].count,
          0
        );
      }
    );

    await t.test(
      'another dossier cannot correct or reconsider a decision; no receipts, audits or financial changes',
      async () => {
        const a = await sponsor();
        const b = await sponsor();
        const decision = await review(a);
        const before = await facts(b.id);
        const counts = async () =>
          (
            await pool.query(
              `SELECT (SELECT count(*) FROM moderation_corrections) AS corrections,(SELECT count(*) FROM moderation_appeals) AS appeals,(SELECT count(*) FROM admin_audit_log) AS audits,(SELECT count(*) FROM email_messages) AS emails`
            )
          ).rows[0];
        const baseline = await counts();
        await assert.rejects(
          submitSponsorshipCorrection(pool, 30, {
            token: b.token,
            decisionId: decision.id,
            requestId: randomUUID(),
            expectedRevision: 0,
            data: correctedData
          }),
          { code: 'MODERATION_DECISION_NOT_FOUND', status: 404 }
        );
        await assert.rejects(
          requestSponsorshipReconsideration(pool, 30, {
            token: b.token,
            decisionId: decision.id,
            requestId: randomUUID(),
            explanation: 'Please reconsider this proposed statement.'
          }),
          { code: 'MODERATION_DECISION_NOT_FOUND', status: 404 }
        );
        assert.deepEqual(await counts(), baseline);
        assert.deepEqual(await facts(b.id), before);
      }
    );

    await t.test(
      'correction retains history, creates unreviewed content and one persistent receipt under replay',
      async () => {
        const dossier = await sponsor();
        const decision = await review(dossier);
        const before = await facts(dossier.id);
        const input = {
          token: dossier.token,
          decisionId: decision.id,
          requestId: randomUUID(),
          expectedRevision: 0,
          data: correctedData,
          locale: 'en'
        };
        const result = await submitSponsorshipCorrection(pool, 30, input);
        assert.ok(result.contentVersion > decision.contentVersion);
        assert.deepEqual(
          await submitSponsorshipCorrection(pool, 30, input),
          result
        );
        const current = (
          await pool.query(
            'SELECT state,current_content_version,current_decision_id FROM moderation_cases WHERE subject_id=$1',
            [dossier.id]
          )
        ).rows[0];
        assert.equal(current.state, 'unreviewed');
        assert.equal(current.current_decision_id, decision.id);
        const after = await facts(dossier.id);
        for (const key of ['status', 'amount_cents', 'currency', 'paid_at'])
          assert.deepEqual(after[key], before[key]);
        assert.equal(after.sponsor_review_status, 'pending_review');
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM moderation_corrections WHERE contribution_id=$1',
              [dossier.id]
            )
          ).rows[0].count,
          1
        );
        const receipt = (
          await pool.query(
            'SELECT id,text_body FROM email_messages WHERE idempotency_key=$1',
            [`moderation-correction:${input.requestId}:receipt`]
          )
        ).rows;
        assert.equal(receipt.length, 1);
        assert.match(
          revealPrivateText(
            receipt[0].text_body,
            `email:${receipt[0].id}:text`
          ),
          /has been received for human review/
        );
        await assert.rejects(
          submitSponsorshipCorrection(pool, 30, {
            ...input,
            data: { ...correctedData, message: 'Different correction' }
          }),
          { code: 'MODERATION_REQUEST_CONFLICT' }
        );
      }
    );

    await t.test(
      'receipt storage failure rolls back correction, snapshots, draft and audit together',
      async () => {
        const dossier = await sponsor();
        const decision = await review(dossier);
        const snapshot = async () => ({
          facts: await facts(dossier.id),
          cases: (
            await pool.query(
              'SELECT * FROM moderation_cases WHERE subject_id=$1',
              [dossier.id]
            )
          ).rows,
          versions: (
            await pool.query(
              'SELECT * FROM moderation_content_versions WHERE subject_id=$1 ORDER BY content_version',
              [dossier.id]
            )
          ).rows
        });
        const before = await snapshot();
        await pool.query(
          `CREATE FUNCTION reject_moderation_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.template_key='moderation_submission' THEN RAISE EXCEPTION 'synthetic receipt storage failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_moderation_receipt BEFORE INSERT ON email_messages FOR EACH ROW EXECUTE FUNCTION reject_moderation_receipt()`
        );
        try {
          await assert.rejects(
            submitSponsorshipCorrection(pool, 30, {
              token: dossier.token,
              decisionId: decision.id,
              requestId: randomUUID(),
              expectedRevision: 0,
              data: correctedData
            })
          );
          assert.deepEqual(await snapshot(), before);
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS count FROM moderation_corrections WHERE contribution_id=$1',
                [dossier.id]
              )
            ).rows[0].count,
            0
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS count FROM sponsorship_followup_drafts WHERE contribution_id=$1',
                [dossier.id]
              )
            ).rows[0].count,
            0
          );
        } finally {
          await pool.query(
            'DROP TRIGGER reject_moderation_receipt ON email_messages; DROP FUNCTION reject_moderation_receipt()'
          );
        }
      }
    );

    await t.test(
      'concurrent reconsideration is one request and stays blocked until authorized resolution',
      async () => {
        const dossier = await sponsor();
        const decision = await review(dossier, 'N2');
        const input = {
          token: dossier.token,
          decisionId: decision.id,
          requestId: randomUUID(),
          explanation: 'Please reconsider the context of this statement.',
          locale: 'en'
        };
        const [first, second] = await Promise.all([
          requestSponsorshipReconsideration(pool, 30, input),
          requestSponsorshipReconsideration(pool, 30, input)
        ]);
        assert.deepEqual(first, second);
        assert.equal(first.state, 'open');
        assert.equal(
          (
            await pool.query(
              'SELECT state FROM moderation_cases WHERE subject_id=$1',
              [dossier.id]
            )
          ).rows[0].state,
          'on_hold'
        );
        await assert.rejects(
          requestSponsorshipReconsideration(pool, 30, {
            ...input,
            requestId: randomUUID()
          }),
          { code: 'MODERATION_RECONSIDERATION_OPEN' }
        );
        const beforeEmpty = (
          await pool.query(
            `SELECT
          (SELECT count(*) FROM moderation_decisions) AS decisions,
          (SELECT count(*) FROM admin_audit_log) AS audits,
          (SELECT count(*) FROM email_messages) AS emails,
          (SELECT state FROM moderation_appeals WHERE id=$1) AS appeal_state`,
            [first.id]
          )
        ).rows[0];
        await assert.rejects(
          withPostgresTransaction(pool, (client) =>
            resolveModerationReconsideration(client, {
              appealId: first.id,
              subject: { type: 'sponsorship', id: dossier.id },
              actor: otherActor,
              decision: {
                requestId: randomUUID(),
                policyVersion: '1.0',
                contentVersion: decision.contentVersion,
                contentFingerprint: decision.contentFingerprint,
                level: 'N0',
                sponsorExplanation: '   ',
                confirmation: dossier.id,
                expectedDecisionId: decision.id
              }
            })
          ),
          { code: 'MODERATION_EXPLANATION_REQUIRED', status: 400 }
        );
        assert.deepEqual(
          (
            await pool.query(
              `SELECT
          (SELECT count(*) FROM moderation_decisions) AS decisions,
          (SELECT count(*) FROM admin_audit_log) AS audits,
          (SELECT count(*) FROM email_messages) AS emails,
          (SELECT state FROM moderation_appeals WHERE id=$1) AS appeal_state`,
              [first.id]
            )
          ).rows[0],
          beforeEmpty
        );
        const resolved = await withPostgresTransaction(pool, async (client) => {
          const subject = { type: 'sponsorship', id: dossier.id };
          const content = await getModerationContent(client, subject);
          return resolveModerationReconsideration(client, {
            appealId: first.id,
            subject,
            actor: otherActor,
            decision: {
              requestId: randomUUID(),
              policyVersion: '1.0',
              contentVersion: content.contentVersion,
              contentFingerprint: content.fingerprint,
              level: 'N0',
              sponsorExplanation:
                'Human reconsideration confirmed this statement is admissible.',
              confirmation: dossier.id,
              expectedDecisionId: decision.id
            }
          });
        });
        assert.equal(resolved.level, 'N0');
        assert.equal(resolved.primaryReason, null);
        assert.match(resolved.sponsorExplanation, /Human reconsideration/);
        assert.equal(
          (
            await pool.query(
              'SELECT state,resulting_decision_id FROM moderation_appeals WHERE id=$1',
              [first.id]
            )
          ).rows[0].state,
          'resolved'
        );
        assert.equal(
          (await requestSponsorshipReconsideration(pool, 30, input)).state,
          'resolved'
        );
        assert.equal(
          (await facts(dossier.id)).sponsor_review_status,
          'pending_review'
        );
      }
    );

    await t.test(
      'grave reconsideration remains open until independent confirmation and a pending replay adds no audit',
      async () => {
        const dossier = await sponsor();
        const initial = await review(dossier, 'N2');
        const appeal = await requestSponsorshipReconsideration(pool, 30, {
          token: dossier.token,
          decisionId: initial.id,
          requestId: randomUUID(),
          explanation:
            'Please review the original statement in its broader context.'
        });
        const subject = { type: 'sponsorship', id: dossier.id };
        const content = await withPostgresTransaction(pool, (client) =>
          getModerationContent(client, subject)
        );
        const input = {
          appealId: appeal.id,
          subject,
          actor: otherActor,
          decision: {
            requestId: randomUUID(),
            policyVersion: '1.0',
            contentVersion: content.contentVersion,
            contentFingerprint: content.fingerprint,
            level: 'N4',
            primaryReason: 'THREAT',
            internalReason: 'Private synthetic rationale',
            sponsorExplanation: 'The statement requires independent review.',
            confirmation: dossier.id,
            expectedDecisionId: initial.id
          }
        };
        const pending = await withPostgresTransaction(pool, (client) =>
          resolveModerationReconsideration(client, input)
        );
        assert.equal(pending.state, 'pending_independent_review');
        assert.deepEqual(
          await withPostgresTransaction(pool, (client) =>
            resolveModerationReconsideration(client, input)
          ),
          pending
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS count FROM admin_audit_log WHERE action='moderation.reconsideration_reviewed' AND entity_id=$1",
              [pending.id]
            )
          ).rows[0].count,
          1
        );
        assert.equal(
          (
            await pool.query(
              'SELECT state FROM moderation_appeals WHERE id=$1',
              [appeal.id]
            )
          ).rows[0].state,
          'open'
        );
        await assert.rejects(
          requestSponsorshipReconsideration(pool, 30, {
            token: dossier.token,
            decisionId: initial.id,
            requestId: randomUUID(),
            explanation:
              'A second request for the former decision must not reopen this case.'
          }),
          { code: 'MODERATION_DECISION_CHANGED' }
        );
        const active = await withPostgresTransaction(pool, (client) =>
          confirmModerationDecision(client, {
            decisionId: pending.id,
            actor,
            requestId: randomUUID(),
            confirmation: pending.id
          })
        );
        assert.equal(active.state, 'active');
        assert.equal(
          (
            await pool.query(
              'SELECT state,resulting_decision_id FROM moderation_appeals WHERE id=$1',
              [appeal.id]
            )
          ).rows[0].state,
          'resolved'
        );
      }
    );

    await t.test(
      'delivery explanations belong to immutable single-source owners and collective snapshots do not disclose them',
      async () => {
        const a = await sponsor();
        const b = await sponsor();
        await pool.query(
          `UPDATE fund_contributions SET email_private=CASE id WHEN $1 THEN 'synthetic-a@example.test' ELSE 'synthetic-b@example.test' END WHERE id IN ($1,$2)`,
          [a.id, b.id]
        );
        const batchId = randomUUID();
        const draftId = randomUUID();
        const deliveryId = randomUUID();
        await pool.query(
          `INSERT INTO sponsor_publication_batches(id,channel,capacity) VALUES($1,'facebook',5)`,
          [batchId]
        );
        const draft = async (id, contributionId) =>
          pool.query(
            `INSERT INTO sponsor_publication_drafts(id,contribution_id,batch_id,feed_target,channel,title,body,disclosure_text) VALUES($1,$2,$3,'openg7','facebook','Synthetic title','Synthetic proposed body','Synthetic disclosure')`,
            [id, contributionId, batchId]
          );
        await draft(draftId, a.id);
        await pool.query(
          `INSERT INTO publication_deliveries(id,feed_id,kind,batch_id,message,scheduled_at,account_id,mode) VALUES($1,'openg7:facebook','sponsorship',$2,'Synthetic proposed delivery',NOW(),'synthetic-account','mock')`,
          [deliveryId, batchId]
        );
        const subject = { type: 'publication_delivery', id: deliveryId };
        const decide = async (explanation) => {
          const content = await withPostgresTransaction(pool, (client) =>
            getModerationContent(client, subject)
          );
          return withPostgresTransaction(pool, (client) =>
            recordModerationDecision(client, {
              subject,
              actor,
              decision: {
                requestId: randomUUID(),
                policyVersion: '1.0',
                contentVersion: content.contentVersion,
                contentFingerprint: content.fingerprint,
                level: 'N2',
                primaryReason: 'MISLEADING_CLAIM',
                internalReason: 'Private synthetic editorial rationale',
                sponsorExplanation: explanation,
                confirmation: deliveryId,
                expectedDecisionId: content.currentDecisionId
              }
            })
          );
        };
        const first = await decide(
          'Explanation for the original sole sponsor A.'
        );
        assert.equal(first.contributionId, a.id);
        assert.equal(
          (
            await pool.query(
              'SELECT contribution_id FROM moderation_cases WHERE subject_type=$1 AND subject_id=$2',
              [subject.type, deliveryId]
            )
          ).rows[0].contribution_id,
          null
        );
        const aProjection = await getSponsorshipModeration(pool, a.token, 30);
        assert.equal(
          aProjection.items.find((item) => item.decision.id === first.id)
            ?.canRequestReconsideration,
          true
        );
        assert.equal(
          (await getSponsorshipModeration(pool, b.token, 30)).items.some(
            (item) => item.decision.id === first.id
          ),
          false
        );
        const queued = await pool.query(
          'SELECT recipient_email FROM email_messages WHERE idempotency_key=$1',
          [`moderation-decision:${first.id}:fr-CA`]
        );
        assert.deepEqual(queued.rows, [
          { recipient_email: 'synthetic-a@example.test' }
        ]);
        await assert.rejects(
          requestSponsorshipReconsideration(pool, 30, {
            token: b.token,
            decisionId: first.id,
            requestId: randomUUID(),
            explanation:
              'An unrelated sponsor must not reconsider this decision.'
          }),
          { code: 'MODERATION_DECISION_NOT_FOUND' }
        );
        const appeal = await requestSponsorshipReconsideration(pool, 30, {
          token: a.token,
          decisionId: first.id,
          requestId: randomUUID(),
          explanation: 'Please reconsider the explanation for sponsor A.'
        });
        assert.equal(appeal.state, 'open');
        await pool.query(
          'UPDATE sponsor_publication_drafts SET contribution_id=$2 WHERE id=$1',
          [draftId, b.id]
        );
        assert.equal(
          (await getSponsorshipModeration(pool, b.token, 30)).items.some(
            (item) => item.decision.id === first.id
          ),
          false
        );
        assert.equal(
          (await getSponsorshipModeration(pool, a.token, 30)).items.some(
            (item) => item.decision.id === first.id
          ),
          true
        );
        await assert.rejects(
          requestSponsorshipReconsideration(pool, 30, {
            token: a.token,
            decisionId: first.id,
            requestId: randomUUID(),
            explanation:
              'An obsolete decision does not authorize a new request.'
          }),
          { code: 'MODERATION_DECISION_CHANGED' }
        );
        const second = await decide('Explanation for the new sole sponsor B.');
        assert.equal(second.contributionId, b.id);
        assert.equal(
          (await getSponsorshipModeration(pool, b.token, 30)).items.find(
            (item) => item.decision.id === second.id
          )?.canRequestReconsideration,
          false
        );
        assert.equal(
          (await getSponsorshipModeration(pool, a.token, 30)).items.some(
            (item) => item.decision.id === second.id
          ),
          false
        );
        await draft(randomUUID(), a.id);
        const collective = await decide(
          'COLLECTIVE_EXTERNAL_EXPLANATION_PRIVATE_TO_MEMBERS'
        );
        assert.equal(collective.contributionId, null);
        for (const dossier of [a, b])
          assert.doesNotMatch(
            JSON.stringify(
              await getSponsorshipModeration(pool, dossier.token, 30)
            ),
            /COLLECTIVE_EXTERNAL_EXPLANATION_PRIVATE_TO_MEMBERS/
          );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM email_messages WHERE idempotency_key=$1',
              [`moderation-decision:${collective.id}:fr-CA`]
            )
          ).rows[0].count,
          0
        );
      }
    );

    await t.test(
      'owner case assignment validates active reviewers, preserves approval state and replays without another audit',
      async () => {
        const dossier = await sponsor();
        const assigneeId = randomUUID();
        const readerId = randomUUID();
        const disabledId = randomUUID();
        for (const [id, role, disabled] of [
          [assigneeId, 'operator', false],
          [readerId, 'reader', false],
          [disabledId, 'owner', true]
        ])
          await pool.query(
            `INSERT INTO admin_accounts(id,issuer,subject,display_name,role,disabled) VALUES($1,'https://identity.example.test',$4,'Synthetic reviewer',$2,$3)`,
            [id, role, disabled, id]
          );
        const subject = { type: 'sponsorship', id: dossier.id };
        const input = {
          subject,
          assignedTo: `admin:${assigneeId}`,
          expectedAssignedTo: null,
          confirmation: dossier.id
        };
        const run = (data) =>
          withPostgresTransaction(pool, (client) =>
            assignModerationCase(client, data, actor)
          );
        assert.deepEqual(await run(input), { assignedTo: input.assignedTo });
        assert.deepEqual(await run(input), { assignedTo: input.assignedTo });
        const current = (
          await pool.query(
            'SELECT id,state,current_decision_id FROM moderation_cases WHERE subject_id=$1',
            [dossier.id]
          )
        ).rows[0];
        assert.equal(current.state, 'unreviewed');
        assert.equal(current.current_decision_id, null);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS count FROM admin_audit_log WHERE entity_id=$1 AND action='moderation.assigned'",
              [current.id]
            )
          ).rows[0].count,
          1
        );
        await assert.rejects(run({ ...input, assignedTo: null }), {
          code: 'MODERATION_ASSIGNMENT_CONFLICT',
          status: 409
        });
        for (const id of [readerId, disabledId, randomUUID()])
          await assert.rejects(
            run({
              ...input,
              assignedTo: `admin:${id}`,
              expectedAssignedTo: input.assignedTo
            }),
            { code: 'MODERATION_ASSIGNEE_UNAVAILABLE', status: 403 }
          );
        await assert.rejects(
          run({ ...input, assignedTo: 'unverified-person' }),
          { code: 'INVALID_MODERATION_ASSIGNEE', status: 400 }
        );
        assert.deepEqual(
          await run({
            ...input,
            assignedTo: null,
            expectedAssignedTo: input.assignedTo
          }),
          { assignedTo: null }
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS count FROM admin_audit_log WHERE entity_id=$1 AND action='moderation.assigned'",
              [current.id]
            )
          ).rows[0].count,
          2
        );
      }
    );

    await t.test(
      'N5 tracks an in-flight remote publication before its post ID is known and later observations remain unverified',
      async () => {
        const deliveryId = randomUUID();
        const otherDeliveryId = randomUUID();
        for (const id of [deliveryId, otherDeliveryId]) {
          await pool.query(
            `INSERT INTO publication_deliveries(id,feed_id,kind,message,scheduled_at,account_id,mode,status) VALUES($1,'openg7:facebook','news','Synthetic editorial statement',NOW(),'synthetic-account','mock','publishing')`,
            [id]
          );
        }
        const subject = { type: 'publication_delivery', id: deliveryId };
        const decision = await withPostgresTransaction(pool, async (client) => {
          const content = await getModerationContent(client, subject);
          return recordModerationDecision(client, {
            subject,
            actor,
            decision: {
              requestId: randomUUID(),
              policyVersion: '1.0',
              contentVersion: content.contentVersion,
              contentFingerprint: content.fingerprint,
              level: 'N5',
              primaryReason: 'MISLEADING_CLAIM',
              internalReason: 'Synthetic review rationale',
              sponsorExplanation: 'This proposed statement must be removed.',
              confirmation: deliveryId,
              expectedDecisionId: content.currentDecisionId
            }
          });
        });
        const observation = async () =>
          (
            await pool.query(
              'SELECT delivery_id,external_post_id,status,evidence_url,verified_by,verified_at FROM moderation_remote_removals WHERE decision_id=$1',
              [decision.id]
            )
          ).rows;
        assert.deepEqual(await observation(), [
          {
            delivery_id: deliveryId,
            external_post_id: null,
            status: 'not_supported',
            evidence_url: null,
            verified_by: null,
            verified_at: null
          }
        ]);
        await withPostgresTransaction(pool, (client) =>
          recordRemoteRemovalRequirement(client, decision)
        );
        assert.equal((await observation()).length, 1);
        await withPostgresTransaction(pool, (client) =>
          recordRemoteRemovalProviderResult(client, {
            deliveryId: otherDeliveryId,
            externalPostId: 'synthetic-foreign-result'
          })
        );
        assert.equal((await observation())[0].external_post_id, null);
        for (let replay = 0; replay < 2; replay++) {
          await withPostgresTransaction(pool, (client) =>
            recordRemoteRemovalProviderResult(client, {
              deliveryId,
              externalPostId: 'synthetic-post-known-after-removal'
            })
          );
        }
        assert.deepEqual(await observation(), [
          {
            delivery_id: deliveryId,
            external_post_id: 'synthetic-post-known-after-removal',
            status: 'not_supported',
            evidence_url: null,
            verified_by: null,
            verified_at: null
          }
        ]);
        assert.equal(
          (
            await pool.query(
              'SELECT status,error_code FROM publication_deliveries WHERE id=$1',
              [deliveryId]
            )
          ).rows[0].status,
          'publishing'
        );
      }
    );

    await t.test(
      'moderation metrics expose only aggregate operational counts and delays',
      async () => {
        const metrics = await moderationMetrics(pool);
        assert.ok(metrics.correctionsReceived >= 1);
        assert.ok(metrics.reconsiderationsResolved >= 2);
        assert.ok(metrics.reconsiderationsOverturned >= 1);
        assert.ok(metrics.remoteRemovals.notSupported >= 1);
        assert.ok(metrics.oldestOpenAgeSeconds >= 0);
        assert.ok(metrics.averageReviewSeconds >= 0);
        assert.ok(metrics.averageReconsiderationSeconds >= 0);
        assert.doesNotMatch(
          JSON.stringify(metrics),
          /PRIVATE_|synthetic-.*@|internalReason|subjectId|reviewer|sponsorExplanation|reasonCode/
        );
      }
    );

    await t.test(
      'adoption preview counts unsent legacy refusal emails without returning private payloads or rewriting the queue',
      async () => {
        const ids = [];
        for (const [template, status] of [
          ['sponsorship_rejection', 'queued'],
          ['sponsorship_rejection', 'failed'],
          ['sponsorship_rejection', 'sending'],
          ['sponsorship_rejection', 'uncertain'],
          ['sponsorship_rejection', 'sent'],
          ['moderation_decision', 'queued']
        ]) {
          const id = randomUUID();
          ids.push(id);
          await pool.query(
            `INSERT INTO email_messages(id,template_key,status,recipient_email,from_email,subject,text_body,html_body)
          VALUES($1,$2,$3,'synthetic-private-legacy@example.test','no-reply@example.test','Synthetic subject','PRIVATE_LEGACY_REVIEW_REASON','PRIVATE_LEGACY_REVIEW_REASON')`,
            [id, template, status]
          );
        }
        const readRows = () =>
          pool.query(
            'SELECT * FROM email_messages WHERE id=ANY($1::uuid[]) ORDER BY id',
            [ids]
          );
        const before = (await readRows()).rows;
        const preview = await moderationAdoptionPreview(pool);
        assert.equal(preview.legacyRejectionNotificationsToReview, 4);
        assert.doesNotMatch(
          JSON.stringify(preview),
          /PRIVATE_LEGACY|recipient|text_body|html_body|synthetic-private/
        );
        assert.deepEqual((await readRows()).rows, before);
      }
    );

    await t.test(
      'public charter begins inactive and does not fabricate an acceptance',
      async () => {
        assert.deepEqual(await getPublicSponsorshipCharter(pool), {
          active: false,
          policyVersion: '1.0',
          fingerprint: null,
          text: null
        });
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM sponsorship_charter_acceptances'
            )
          ).rows[0].count,
          0
        );
      }
    );

    await t.test(
      'activated fixture terms are checked before Stripe and preserved during durable replay',
      async () => {
        // Only this fresh test database activates terms; no production configuration is consumed.
        await pool.query(
          `UPDATE moderation_policies SET public_active=TRUE,public_charter_hash=$1,public_validated_at=NOW(),effective_at=NOW() WHERE version='1.0'`,
          [sponsorshipCharterFingerprint]
        );
        let providerCalls = 0;
        const provider = {
          checkout: {
            sessions: {
              async create() {
                providerCalls++;
                assert.equal(
                  (
                    await pool.query(
                      'SELECT count(*)::int AS count FROM sponsorship_charter_acceptances'
                    )
                  ).rows[0].count,
                  1
                );
                return {
                  id: `cs_test_${randomUUID()}`,
                  url: 'https://checkout.example.test/isolated'
                };
              }
            }
          }
        };
        const run = createDurableCheckoutService(
          pool,
          provider,
          async () => true
        );
        const acceptance = {
          accepted: true,
          policyVersion: '1.0',
          fingerprint: sponsorshipCharterFingerprint,
          locale: 'en'
        };
        const attempt = (terms) => ({
          key: `synthetic-charter-${randomUUID()}`,
          requestHash: hash(JSON.stringify(terms ?? null)),
          prepare: () => ({ params: {}, record: {} }),
          afterPrepare: (client, operationId) =>
            recordSponsorshipCharterAcceptance(client, operationId, terms)
        });
        await assert.rejects(run(attempt(undefined)), {
          code: 'CHARTER_ACCEPTANCE_REQUIRED'
        });
        await assert.rejects(
          run(attempt({ ...acceptance, fingerprint: 'a'.repeat(64) })),
          { code: 'CHARTER_VERSION_CHANGED' }
        );
        assert.equal(providerCalls, 0);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM sponsorship_charter_acceptances'
            )
          ).rows[0].count,
          0
        );
        const input = attempt(acceptance);
        const first = await run(input);
        await pool.query(
          `UPDATE moderation_policies SET public_active=FALSE WHERE version='1.0'`
        );
        assert.deepEqual(await run(input), first);
        assert.equal(providerCalls, 1);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM sponsorship_charter_acceptances'
            )
          ).rows[0].count,
          1
        );
        await assert.rejects(
          run({ ...input, requestHash: hash('different terms') }),
          { code: 'CHECKOUT_IDEMPOTENCY_CONFLICT' }
        );
        assert.equal(providerCalls, 1);
      }
    );
  }
);
