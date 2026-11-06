import type {
  AdminDossierPreparationReceipt,
  AdminCampaignsResponse,
  AdminServicePreparationDecision,
  AdminServicePreparationDecisionKind,
  AdminServicePreparationDecisionRequest,
  AdminServicePreparationReceipt
} from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import { AdminAutomaticRunError } from './admin-automatic-run-error.js';
import { loadAdminCampaignsOnClient } from './admin-campaigns.service.js';
import { preparationDigest } from './admin-preparation.projection.js';
import {
  loadServicePreparationFacts,
  servicePreparationScope
} from './admin-service-preparation-scope.js';
import { isValidUuid } from './business-helpers/request-validation.js';

export interface ServicePreparationDecisionRow {
  id: string;
  contribution_id: string;
  obligation_id: string;
  draft_id: string;
  draft_version: string;
  content_version: string;
  expected_version: string;
  decision: AdminServicePreparationDecisionKind;
  reason: string | null;
  actor: string;
  request_id: string;
  request_hash: string;
  audit_reference: string;
  created_at: Date;
}

export const servicePreparationDecision = (
  row: ServicePreparationDecisionRow
): AdminServicePreparationDecision => ({
  id: row.id,
  contributionId: row.contribution_id,
  obligationId: row.obligation_id,
  draftId: row.draft_id,
  draftVersion: row.draft_version,
  contentVersion: row.content_version,
  decision: row.decision,
  reason: row.reason,
  actor: row.actor,
  requestId: row.request_id,
  auditReference: row.audit_reference,
  createdAt: row.created_at.toISOString()
});

export function parseServicePreparationDecision(
  raw: unknown
): AdminServicePreparationDecisionRequest {
  const input = raw as AdminServicePreparationDecisionRequest;
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some(
      (key) =>
        ![
          'contributionId',
          'obligationId',
          'expectedVersion',
          'requestId',
          'confirmed',
          'decision',
          'reason'
        ].includes(key)
    ) ||
    !isValidUuid(input.contributionId) ||
    !isValidUuid(input.obligationId) ||
    !isValidUuid(input.requestId) ||
    input.confirmed !== true ||
    typeof input.expectedVersion !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.expectedVersion) ||
    !['approved', 'correction_requested', 'rejected'].includes(
      input.decision
    ) ||
    (input.reason !== undefined &&
      (typeof input.reason !== 'string' || input.reason.length > 2000)) ||
    (input.decision !== 'approved' && (input.reason?.trim().length ?? 0) < 10)
  )
    throw new AdminAutomaticRunError('RUN_INVALID_REQUEST', 400);
  return {
    ...input,
    contributionId: input.contributionId.toLowerCase(),
    obligationId: input.obligationId.toLowerCase(),
    ...(input.reason === undefined ? {} : { reason: input.reason.trim() })
  };
}

/** Extends the existing dossier receipt. It has no mutation or dispatch port. */
export async function projectServicePreparation(
  db: PoolClient,
  dossier: AdminDossierPreparationReceipt,
  obligationId: string,
  campaigns?: Pick<AdminCampaignsResponse, 'items' | 'generatedAt'>
): Promise<AdminServicePreparationReceipt> {
  const result =
    campaigns ??
    (await loadAdminCampaignsOnClient(
      db,
      {
        page: 1,
        pageSize: 100,
        sponsorshipId: dossier.contributionId,
        sort: 'paid_at',
        direction: 'desc'
      },
      new Date(),
      undefined,
      'snapshot'
    ));
  const service = result.items.find((item) => item.id === obligationId);
  if (!service) throw new AdminAutomaticRunError('PREPARATION_NOT_FOUND', 404);
  const matchingDraft = dossier.drafts.find(
    (draft) =>
      draft.channel === service.channel &&
      draft.target === service.target &&
      draft.title === service.content?.title &&
      draft.body === service.content?.body
  );
  const facts = await loadServicePreparationFacts(
    db,
    dossier.contributionId,
    service,
    matchingDraft?.id ?? null
  );
  const { draft, active, blockers, checks, contentVersion } =
    servicePreparationScope(dossier, service, facts);
  const rows = (
    await db.query<ServicePreparationDecisionRow>(
      'SELECT * FROM admin_service_preparation_decisions WHERE contribution_id=$1::uuid AND obligation_id=$2::uuid ORDER BY created_at DESC,id DESC',
      [dossier.contributionId, obligationId]
    )
  ).rows;
  const history = rows.map(servicePreparationDecision);
  const decision =
    history[0]?.contentVersion === contentVersion ? history[0] : null;
  const base = `/admin/fundraiser/sponsors?sponsorshipId=${dossier.contributionId}`;
  let preparedAt: string | null = null;
  if (draft) {
    const timestamp = (
      await db.query<{ prepared_at: Date }>(
        draft.kind === 'website'
          ? 'SELECT updated_at AS prepared_at FROM contribution_activity WHERE id::text=$1 AND contribution_id=$2::uuid'
          : 'SELECT updated_at AS prepared_at FROM sponsor_publication_drafts WHERE id::text=$1 AND contribution_id=$2::uuid',
        [draft.id, dossier.contributionId]
      )
    ).rows[0]?.prepared_at;
    preparedAt = timestamp?.toISOString() ?? null;
  }
  return {
    context: 'service',
    generatedAt: result.generatedAt,
    contributionId: dossier.contributionId,
    reference: dossier.reference,
    companyName: service.companyName,
    version: preparationDigest({
      contentVersion,
      latestDecisionId: history[0]?.id ?? null
    }),
    contentVersion,
    status:
      decision?.decision ??
      (!draft
        ? 'not_ready'
        : blockers.length
          ? 'blocked'
          : history.length
            ? 'review_required'
            : 'ready'),
    service,
    siblings: result.items,
    draft,
    dossier,
    checks,
    blockers,
    canApprove: !!draft && active && blockers.length === 0 && !decision,
    canDecide: !!draft && active && !decision,
    decision,
    history,
    provenance: { origin: 'funding', preflightLink: 'unverified', preparedAt },
    links: {
      dossier: base,
      media: base + '&tab=media',
      edit: draft?.adminUrl ?? null,
      delivery: service.workflow.deliveryId
        ? `/admin/fundraiser/publications/automation?sponsorshipId=${dossier.contributionId}&deliveryId=${service.workflow.deliveryId}`
        : base + '&tab=publication',
      evidence: `/admin/fundraiser/campaigns?sponsorshipId=${dossier.contributionId}&obligationId=${obligationId}`
    }
  };
}
