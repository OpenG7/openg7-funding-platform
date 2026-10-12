import { createHash } from 'node:crypto';

import type {
  SponsorshipCorrectionRequest,
  SponsorshipModerationResponse,
  SponsorshipReconsiderationRequest
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import {
  isSafeSponsorshipText,
  isSponsorshipEmail
} from '../../../../packages/funding-core/src/index.js';
import { isValidOptionalHttpsUrl } from '../business-helpers/request-validation.js';
import { insertAdminAuditLog } from '../fund-admin.repository.js';
import { recordSponsorshipDetailsForContribution } from '../fund-contributions.repository.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import {
  authorizedSponsorshipDossier,
  validateSponsorshipDraft
} from '../sponsorship-access.service.js';

import { getModerationContent } from './content.js';
import { ModerationError } from './policy.js';
import { enqueueModerationFollowupReceipt } from './notifications.js';
import { listPublicModerationDecisions } from './repository.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validRequest = (input: { requestId: string; decisionId: string }) => {
  if (!uuid.test(input.requestId ?? '') || !uuid.test(input.decisionId ?? ''))
    throw new ModerationError('INVALID_MODERATION_REQUEST', 400);
};

interface CurrentDecision {
  id: string;
  case_id: string;
  subject_type: string;
  subject_id: string;
  level: string;
  case_state: string;
  current_decision_id: string;
  effective: boolean;
}
async function currentDecision(
  db: PoolClient,
  id: string,
  contributionId: string
): Promise<CurrentDecision> {
  const decision = (
    await db.query<CurrentDecision>(
      `SELECT d.id,d.case_id,d.subject_type,d.subject_id,d.level,c.state AS case_state,c.current_decision_id,
      (NOT d.requires_independent_review OR EXISTS (SELECT 1 FROM moderation_independent_reviews r WHERE r.decision_id=d.id)) AS effective
     FROM moderation_decisions d JOIN moderation_cases c ON c.id=d.case_id
     WHERE d.id=$1 AND d.contribution_id=$2 FOR UPDATE OF c`,
      [id, contributionId]
    )
  ).rows[0];
  if (!decision)
    throw new ModerationError('MODERATION_DECISION_NOT_FOUND', 404);
  if (
    decision.current_decision_id !== id ||
    decision.case_state === 'unreviewed'
  )
    throw new ModerationError('MODERATION_DECISION_CHANGED', 409);
  return decision;
}

export async function getSponsorshipModeration(
  pool: Pool,
  token: string,
  ttlDays: number
): Promise<SponsorshipModerationResponse> {
  return withPostgresTransaction(pool, async (db) => {
    const dossier = await authorizedSponsorshipDossier(db, token, ttlDays);
    const decisions = await listPublicModerationDecisions(db, dossier.id);
    const current = (
      await db.query<{
        current_decision_id: string;
        state: string;
        has_open_appeal: boolean;
      }>(
        `SELECT c.current_decision_id,c.state,
         EXISTS(SELECT 1 FROM moderation_appeals a JOIN moderation_decisions d ON d.id=a.decision_id WHERE d.case_id=c.id AND a.state='open') AS has_open_appeal
         FROM moderation_cases c WHERE c.contribution_id=$1
         OR EXISTS(SELECT 1 FROM moderation_decisions d WHERE d.id=c.current_decision_id AND d.contribution_id=$1)`,
        [dossier.id]
      )
    ).rows;
    const reconsiderations = (
      await db.query<{
        id: string;
        decisionId: string;
        state: 'open' | 'resolved';
        createdAt: string;
        subject_type: string;
        subject_id: string;
      }>(
        `SELECT a.id,a.decision_id AS "decisionId",a.state,a.created_at::text AS "createdAt",d.subject_type,d.subject_id
       FROM moderation_appeals a JOIN moderation_decisions d ON d.id=a.decision_id
       WHERE a.contribution_id=$1 ORDER BY a.created_at DESC,a.id LIMIT 100`,
        [dossier.id]
      )
    ).rows;
    return {
      items: decisions.map((decision) => {
        const currentCase = current.find(
          (item) => item.current_decision_id === decision.id
        );
        const state = currentCase?.state;
        const effective =
          decision.state === 'active' && state && state !== 'unreviewed';
        return {
          decision,
          canCorrect: Boolean(
            effective &&
            decision.level === 'N1' &&
            decision.subject.type === 'sponsorship' &&
            ['paid', 'refunded', 'disputed'].includes(dossier.status)
          ),
          canRequestReconsideration: Boolean(
            effective &&
            decision.level !== 'N0' &&
            !currentCase?.has_open_appeal &&
            !reconsiderations.some(
              (item) =>
                item.subject_type === decision.subject.type &&
                item.subject_id === decision.subject.id &&
                item.state === 'open'
            )
          )
        };
      }),
      reconsiderations: reconsiderations.map(
        ({ id, decisionId, state, createdAt }) => ({
          id,
          decisionId,
          state,
          createdAt
        })
      )
    };
  });
}

export async function requestSponsorshipReconsideration(
  pool: Pool,
  ttlDays: number,
  input: SponsorshipReconsiderationRequest
) {
  validRequest(input);
  if (
    !isSafeSponsorshipText(input.explanation, true) ||
    input.explanation.trim().length < 10 ||
    input.explanation.length > 2000
  )
    throw new ModerationError(
      'MODERATION_RECONSIDERATION_EXPLANATION_REQUIRED',
      400
    );
  const message = input.explanation.trim();
  const requestFingerprint = fingerprint({
    decisionId: input.decisionId,
    message,
    locale: input.locale ?? 'fr-CA'
  });
  return withPostgresTransaction(pool, async (db) => {
    const dossier = await authorizedSponsorshipDossier(
      db,
      input.token,
      ttlDays
    );
    const prior = (
      await db.query<{
        id: string;
        state: string;
        contribution_id: string;
        request_fingerprint: string;
      }>(
        'SELECT id,state,contribution_id,request_fingerprint FROM moderation_appeals WHERE request_id=$1',
        [input.requestId]
      )
    ).rows[0];
    if (prior) {
      if (
        prior.contribution_id !== dossier.id ||
        prior.request_fingerprint !== requestFingerprint
      )
        throw new ModerationError('MODERATION_REQUEST_CONFLICT', 409);
      return { id: prior.id, state: prior.state };
    }
    const decision = await currentDecision(db, input.decisionId, dossier.id);
    if (!decision.effective || decision.level === 'N0')
      throw new ModerationError('MODERATION_RECONSIDERATION_UNAVAILABLE', 409);
    if (
      ((
        await db.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM moderation_appeals WHERE contribution_id=$1 AND created_at>NOW()-INTERVAL '30 days'`,
          [dossier.id]
        )
      ).rows[0]?.count ?? 0) >= 10
    )
      throw new ModerationError('MODERATION_RECONSIDERATION_RATE_LIMIT', 429);
    if (
      (
        await db.query(
          `SELECT a.id FROM moderation_appeals a JOIN moderation_decisions d ON d.id=a.decision_id WHERE d.case_id=$1 AND a.state='open'`,
          [decision.case_id]
        )
      ).rows.length
    )
      throw new ModerationError('MODERATION_RECONSIDERATION_OPEN', 409);
    const result = (
      await db.query<{ id: string; state: string }>(
        `INSERT INTO moderation_appeals(decision_id,contribution_id,request_id,request_fingerprint,message,requester,state)
       VALUES($1,$2,$3,$4,$5,$6,'open') ON CONFLICT(request_id) DO NOTHING RETURNING id,state`,
        [
          input.decisionId,
          dossier.id,
          input.requestId,
          requestFingerprint,
          message,
          `sponsor:${dossier.id}`
        ]
      )
    ).rows[0];
    if (!result) throw new ModerationError('MODERATION_REQUEST_CONFLICT', 409);
    if (
      !(await insertAdminAuditLog(db, {
        actor: `sponsor:${dossier.id}`,
        action: 'moderation.reconsideration_requested',
        entityType: 'sponsorship',
        entityId: dossier.id,
        summary: 'Sponsor requested human reconsideration.',
        metadata: { decisionId: input.decisionId, appealId: result.id }
      }))
    )
      throw new ModerationError('MODERATION_AUDIT_UNAVAILABLE', 503);
    await enqueueModerationFollowupReceipt(db, {
      contributionId: dossier.id,
      eventId: result.id,
      kind: 'reconsideration',
      locale: input.locale
    });
    return result;
  });
}

export async function submitSponsorshipCorrection(
  pool: Pool,
  ttlDays: number,
  input: SponsorshipCorrectionRequest
) {
  validRequest(input);
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  )
    throw new ModerationError('INVALID_MODERATION_REQUEST', 400);
  const data = validateSponsorshipDraft(input.data);
  if (
    !data ||
    !data.companyName.trim() ||
    !data.contactName.trim() ||
    !isSponsorshipEmail(data.contactEmail, 200) ||
    !isValidOptionalHttpsUrl(data.websiteUrl) ||
    !isValidOptionalHttpsUrl(data.logoUrl)
  )
    throw new ModerationError('INVALID_MODERATION_CORRECTION', 400);
  const requestFingerprint = fingerprint({
    decisionId: input.decisionId,
    expectedRevision: input.expectedRevision,
    data,
    locale: input.locale ?? 'fr-CA'
  });
  return withPostgresTransaction(pool, async (db) => {
    const dossier = await authorizedSponsorshipDossier(
      db,
      input.token,
      ttlDays
    );
    const prior = (
      await db.query<{
        contribution_id: string;
        request_fingerprint: string;
        submitted_content_version: number;
        draft_revision: number;
      }>(
        'SELECT contribution_id,request_fingerprint,submitted_content_version,draft_revision FROM moderation_corrections WHERE request_id=$1',
        [input.requestId]
      )
    ).rows[0];
    if (prior) {
      if (
        prior.contribution_id !== dossier.id ||
        prior.request_fingerprint !== requestFingerprint
      )
        throw new ModerationError('MODERATION_REQUEST_CONFLICT', 409);
      return {
        received: true as const,
        recorded: true,
        contentVersion: prior.submitted_content_version,
        revision: prior.draft_revision
      };
    }
    const decision = await currentDecision(db, input.decisionId, dossier.id);
    if (
      !decision.effective ||
      decision.level !== 'N1' ||
      decision.subject_type !== 'sponsorship' ||
      !['paid', 'refunded', 'disputed'].includes(dossier.status)
    )
      throw new ModerationError('MODERATION_CORRECTION_UNAVAILABLE', 409);
    const draft = (
      await db.query<{ revision: number }>(
        'SELECT revision FROM sponsorship_followup_drafts WHERE contribution_id=$1',
        [dossier.id]
      )
    ).rows[0];
    if ((draft?.revision ?? 0) !== input.expectedRevision)
      throw new ModerationError('MODERATION_CORRECTION_CONFLICT', 409);
    if (
      !(await recordSponsorshipDetailsForContribution(db, {
        contributionId: dossier.id,
        ...data,
        websiteUrl: data.websiteUrl || null,
        logoUrl: data.logoUrl || null,
        message: data.message || null
      }))
    )
      throw new ModerationError('MODERATION_CORRECTION_UNAVAILABLE', 409);
    const content = await getModerationContent(db, {
      type: 'sponsorship',
      id: dossier.id
    });
    await db.query(
      `UPDATE moderation_cases SET state='unreviewed',current_content_version=$2,current_fingerprint=$3,updated_at=NOW() WHERE id=$1`,
      [decision.case_id, content.contentVersion, content.fingerprint]
    );
    const updatedDraft = (
      await db.query<{ revision: number }>(
        `INSERT INTO sponsorship_followup_drafts(contribution_id,revision,data) VALUES($1,1,NULL)
       ON CONFLICT(contribution_id) DO UPDATE SET revision=sponsorship_followup_drafts.revision+1,data=NULL,updated_at=NOW() RETURNING revision`,
        [dossier.id]
      )
    ).rows[0]!;
    if (
      !(
        await db.query(
          `INSERT INTO moderation_corrections(decision_id,contribution_id,request_id,request_fingerprint,submitted_content_version,content_fingerprint,draft_revision) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(request_id) DO NOTHING RETURNING id`,
          [
            input.decisionId,
            dossier.id,
            input.requestId,
            requestFingerprint,
            content.contentVersion,
            content.fingerprint,
            updatedDraft.revision
          ]
        )
      ).rows.length
    )
      throw new ModerationError('MODERATION_REQUEST_CONFLICT', 409);
    if (
      !(await insertAdminAuditLog(db, {
        actor: `sponsor:${dossier.id}`,
        action: 'moderation.correction_submitted',
        entityType: 'sponsorship',
        entityId: dossier.id,
        summary: 'Sponsor submitted a correction for human review.',
        metadata: {
          decisionId: input.decisionId,
          contentVersion: content.contentVersion
        }
      }))
    )
      throw new ModerationError('MODERATION_AUDIT_UNAVAILABLE', 503);
    await enqueueModerationFollowupReceipt(db, {
      contributionId: dossier.id,
      eventId: input.requestId,
      kind: 'correction',
      locale: input.locale
    });
    return {
      received: true as const,
      recorded: true,
      contentVersion: content.contentVersion,
      revision: updatedDraft.revision
    };
  });
}
