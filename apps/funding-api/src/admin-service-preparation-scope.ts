import type {
  AdminCampaignItem,
  AdminPreparationDraft,
  AdminPreparationReceiptData,
  SponsorMediaPreparationAssignment
} from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import { preparationDigest } from './admin-preparation.projection.js';
import { moderationApprovedSql } from './moderation/policy.js';
import { readMediaPreparation } from './sponsor-media-workspace/preparation.js';

interface ServiceMediaFact {
  id: string;
  version: string;
  kind: string;
  review_status: string;
  checksum_sha256: string;
  alt_text: string | null;
  website_selected: boolean;
  usage_restrictions_reviewed: boolean;
  usage_rights: {
    state: string;
    channels: string[];
    targets: string[];
    [key: string]: unknown;
  };
  moderation_approved: boolean;
}
export interface ServicePreparationFacts {
  readonly source: Record<string, unknown> | null;
  readonly media: readonly ServiceMediaFact[];
  readonly authorities: readonly Record<string, unknown>[];
  readonly preparationAssignments?: readonly SponsorMediaPreparationAssignment[];
  readonly preparationRevision?: string;
  readonly preparationSourceVersions?: readonly {
    readonly assetId: string;
    readonly version: string | null;
  }[];
}

/** Only common dossier authority and the selected destination enter this review. */
export async function loadServicePreparationFacts(
  db: PoolClient,
  contributionId: string,
  service: AdminCampaignItem,
  draftId: string | null,
  readPreparation: typeof readMediaPreparation = readMediaPreparation
): Promise<ServicePreparationFacts> {
  const source =
    (
      await db.query<Record<string, unknown>>(
        `
    SELECT c.contribution_type,c.status,c.paid_at,c.sponsor_company_name,c.sponsor_public_summary,
      c.public_display_consent,c.sponsor_review_status,(c.sponsor_feed_status='hidden') AS recognition_hidden,c.sponsorship_refund_status,
      (SELECT id::text FROM admin_sponsorship_consent_records WHERE contribution_id=c.id ORDER BY recorded_at DESC,id DESC LIMIT 1) AS consent_proof_version,
      m.id AS commitment_id,m.state AS commitment_state,m.offer_id,
      ${moderationApprovedSql('sponsorship', 'c.id')} AS moderation_approved
    FROM fund_contributions c LEFT JOIN sponsorship_commitments m ON m.contribution_id=c.id WHERE c.id=$1::uuid`,
        [contributionId]
      )
    ).rows[0] ?? null;
  // Unrecorded dossiers retain their previous content hash without a new null key.
  if (source?.consent_proof_version === null)
    delete source.consent_proof_version;
  const assets = (
    await db.query<ServiceMediaFact>(
      `
    SELECT a.id,a.updated_at::text AS version,a.kind,a.review_status,a.checksum_sha256,a.alt_text,a.width,a.height,a.website_selected,
      a.usage_restrictions_reviewed,a.sort_order,a.created_at,
      sponsor_media_effective_usage(a.id) AS usage_rights,
      ${moderationApprovedSql('media', 'a.id')} AS moderation_approved
    FROM sponsor_media_assets a WHERE a.contribution_id=$1::uuid AND a.deleted_at IS NULL ORDER BY a.id`,
      [contributionId]
    )
  ).rows;
  const preparation = await readPreparation(db, contributionId);
  const preparationAssignments = preparation.preparationAssignments.filter(
    (assignment) => assignment.obligationId === service.id
  );
  // Removed associations remain tombstones: adding then removing a resource cannot
  // silently restore a former approval of an earlier preparation generation.
  const preparationRevision = (
    await db.query<{ revision: string }>(
      `SELECT count(*)::text || ':' || COALESCE(max(updated_at)::text,'') AS revision
       FROM sponsor_media_preparation_assignments WHERE contribution_id=$1::uuid AND obligation_id=$2::uuid`,
      [contributionId, service.id]
    )
  ).rows[0]!.revision;
  const preparationSourceVersions = preparationAssignments.map(
    (assignment) => ({
      assetId: assignment.assetId,
      version:
        assets.find((asset) => asset.id === assignment.assetId)?.version ?? null
    })
  );
  const media = assets
    .filter(
      (asset) =>
        asset.usage_rights.channels.includes(service.channel) &&
        asset.usage_rights.targets.includes(service.target) &&
        (preparationAssignments.length
          ? preparationAssignments.some(
              (assignment) =>
                !assignment.stale &&
                assignment.assetId === asset.id &&
                assignment.assetVersion === asset.version
            )
          : service.channel !== 'website' || asset.website_selected)
    )
    .map((asset) => ({
      ...asset,
      website_selected: service.channel === 'website' && asset.website_selected,
      usage_rights: {
        ...asset.usage_rights,
        channels: asset.usage_rights.channels.filter(
          (channel) => channel === service.channel
        ),
        targets: asset.usage_rights.targets.filter(
          (target) => target === service.target
        )
      }
    }));
  const authorities = (
    await db.query<Record<string, unknown>>(
      `
    SELECT c.id,c.subject_type,c.subject_id,c.current_content_version,c.current_fingerprint,
      c.current_decision_id,c.state,d.actor,d.policy_version,d.content_version AS decision_content_version,
      d.content_fingerprint AS decision_content_fingerprint,p.policy_fingerprint,p.editorial_status,
      EXISTS(SELECT 1 FROM moderation_appeals a JOIN moderation_decisions ad ON ad.id=a.decision_id
        WHERE ad.case_id=c.id AND a.state='open') AS open_appeal
    FROM moderation_cases c LEFT JOIN moderation_decisions d ON d.id=c.current_decision_id
      LEFT JOIN moderation_policies p ON p.version=d.policy_version
    WHERE (c.subject_type='sponsorship' AND c.subject_id=$1::uuid)
      OR (c.subject_type='publication_draft' AND c.subject_id=$2::uuid)
      OR (c.subject_type='media' AND c.subject_id=ANY($3::uuid[]))
    ORDER BY c.subject_type,c.subject_id,c.id`,
      [
        contributionId,
        service.channel === 'website' ? null : draftId,
        media.map((asset) => asset.id)
      ]
    )
  ).rows;
  return {
    source,
    media,
    authorities,
    preparationAssignments,
    preparationRevision,
    preparationSourceVersions
  };
}

/** Shared exact-content scope for the workshop and the existing operational projection. */
export function servicePreparationScope(
  dossier: Pick<
    AdminPreparationReceiptData,
    'payment' | 'acceptedOffer' | 'balance' | 'drafts'
  >,
  service: AdminCampaignItem,
  facts: ServicePreparationFacts
) {
  const candidates = dossier.drafts.filter(
    (draft) =>
      draft.channel === service.channel &&
      draft.target === service.target &&
      service.content?.title === draft.title &&
      service.content?.body === draft.body
  );
  const draft: AdminPreparationDraft | null =
    candidates.length === 1 ? candidates[0]! : null;
  const active =
    !['fulfilled', 'adjusted'].includes(service.obligationState) &&
    !['approved', 'scheduled', 'published', 'cancelled', 'rejected'].includes(
      draft?.status ?? ''
    );
  const obligation =
    dossier.balance?.obligations.find((item) => item.id === service.id) ?? null;
  const benefit = dossier.acceptedOffer?.benefits.find(
    (item) => item.id === obligation?.benefitId
  );
  const source = facts.source;
  const preparationAssignments = (facts.preparationAssignments ?? []).filter(
    (assignment) => assignment.obligationId === service.id
  );
  const commonBlockers: string[] = [];
  if (!source) commonBlockers.push('contribution_missing');
  if (dossier.payment.status !== 'paid' || !dossier.payment.confirmedAt)
    commonBlockers.push(
      dossier.payment.status === 'refunded'
        ? 'payment_refunded'
        : dossier.payment.status === 'disputed'
          ? 'payment_disputed'
          : 'payment_unconfirmed'
    );
  if (
    !dossier.acceptedOffer ||
    source?.commitment_state !== 'active' ||
    !source.offer_id
  )
    commonBlockers.push('commitment_needs_confirmation');
  if (
    dossier.acceptedOffer &&
    (dossier.acceptedOffer.amountMinor !== dossier.payment.amountMinor ||
      dossier.acceptedOffer.currency.toUpperCase() !==
        dossier.payment.currency.toUpperCase())
  )
    commonBlockers.push('offer_unverified');
  if (!source?.public_display_consent)
    commonBlockers.push('public_consent_missing');
  if (source?.sponsor_review_status !== 'approved')
    commonBlockers.push('sponsor_review_required');
  if (!source?.moderation_approved)
    commonBlockers.push('moderation_review_required');
  if (source?.sponsorship_refund_status !== 'not_requested')
    commonBlockers.push('refund_pending');
  if (source?.recognition_hidden === true)
    commonBlockers.push('recognition_hidden');
  if (
    typeof source?.sponsor_company_name !== 'string' ||
    !source.sponsor_company_name.trim()
  )
    commonBlockers.push('company_missing');
  if (
    typeof source?.sponsor_public_summary !== 'string' ||
    !source.sponsor_public_summary.trim()
  )
    commonBlockers.push('presentation_missing');
  const eligible = (asset: ServiceMediaFact) =>
    (service.channel !== 'website' ||
      preparationAssignments.length > 0 ||
      asset.website_selected) &&
    asset.review_status === 'approved' &&
    asset.moderation_approved &&
    asset.usage_rights.state === 'confirmed' &&
    asset.usage_rights.channels.includes(service.channel) &&
    asset.usage_rights.targets.includes(service.target) &&
    Array.isArray(asset.usage_rights.transformations) &&
    asset.usage_rights.transformations.includes('technical') &&
    (!asset.usage_rights.restrictions || asset.usage_restrictions_reviewed);
  const usable = (kind: string) =>
    facts.media.some((asset) => asset.kind === kind && eligible(asset));
  if (preparationAssignments.some((assignment) => assignment.stale))
    commonBlockers.push('prepared_media_stale');
  if (
    preparationAssignments.some(
      (assignment) =>
        !assignment.stale &&
        !facts.media.some(
          (asset) =>
            asset.id === assignment.assetId &&
            asset.version === assignment.assetVersion &&
            eligible(asset)
        )
    )
  )
    commonBlockers.push('prepared_media_unavailable');
  if (benefit?.requiredElements.includes('approved_logo') && !usable('logo'))
    commonBlockers.push('required_media_missing');
  if (
    (benefit?.requiredElements.includes('approved_presentation') ||
      (service.format && service.format !== 'collective_text')) &&
    !usable('supporting_image')
  )
    commonBlockers.push('required_media_missing');
  const draftAuthority = facts.authorities.find(
    (authority) =>
      authority.subject_type === 'publication_draft' &&
      authority.subject_id === draft?.id
  );
  const draftAuthorityApproved =
    !!draftAuthority?.current_decision_id &&
    draftAuthority.state === 'approved' &&
    draftAuthority.open_appeal !== true &&
    draftAuthority.editorial_status === 'approved' &&
    draftAuthority.decision_content_version ===
      draftAuthority.current_content_version &&
    draftAuthority.decision_content_fingerprint ===
      draftAuthority.current_fingerprint;
  if (draftAuthority?.current_decision_id && !draftAuthorityApproved)
    commonBlockers.push('moderation_review_required');
  if (
    draft?.kind === 'website' &&
    (draft.title !==
      (typeof source?.sponsor_company_name === 'string'
        ? source.sponsor_company_name.trim()
        : null) ||
      draft.body !==
        (typeof source?.sponsor_public_summary === 'string'
          ? source.sponsor_public_summary.trim()
          : null))
  )
    commonBlockers.push('website_draft_outdated');
  const blockers = [
    ...new Set([
      ...commonBlockers,
      ...(!draft
        ? [
            candidates.length > 1
              ? 'service_draft_ambiguous'
              : 'service_draft_missing'
          ]
        : []),
      ...(!active ? ['service_closed'] : []),
      ...(service.obligationState === 'blocked' ? ['obligation_blocked'] : []),
      ...(!benefit || !obligation ? ['obligation_unverified'] : []),
      ...(draft &&
      (!draft.title.trim() ||
        !draft.body.trim() ||
        (draft.kind === 'publication' && !draft.disclosureText.trim()))
        ? ['publication_draft_incomplete']
        : [])
    ])
  ];
  const checks = [
    {
      code: 'payment_confirmed',
      state: !commonBlockers.some((code) => code.startsWith('payment_'))
        ? ('complete' as const)
        : ('missing' as const)
    },
    {
      code: 'accepted_offer',
      state:
        !commonBlockers.includes('commitment_needs_confirmation') &&
        !commonBlockers.includes('offer_unverified')
          ? ('complete' as const)
          : ('missing' as const)
    },
    {
      code: 'public_consent',
      state: source?.public_display_consent
        ? ('complete' as const)
        : ('missing' as const)
    },
    {
      code: 'sponsor_review',
      state:
        source?.sponsor_review_status === 'approved'
          ? ('complete' as const)
          : ('missing' as const)
    },
    {
      code: 'moderation_review',
      state: source?.moderation_approved
        ? ('complete' as const)
        : ('missing' as const)
    },
    {
      code: 'draft_moderation_review',
      state: draftAuthorityApproved
        ? ('complete' as const)
        : ('missing' as const)
    },
    {
      code: 'service_draft_identified',
      state: draft ? ('complete' as const) : ('missing' as const)
    }
  ];
  const contentVersion = preparationDigest({
    payment: dossier.payment,
    acceptedOffer: dossier.acceptedOffer,
    source: facts.source,
    media: facts.media,
    preparationAssignments,
    preparationRevision: facts.preparationRevision,
    preparationSourceVersions: facts.preparationSourceVersions,
    authorities: facts.authorities,
    obligation,
    service: {
      id: service.id,
      channel: service.channel,
      target: service.target,
      ordinal: service.ordinal,
      obligationState: service.obligationState
    },
    draft,
    checks,
    blockers
  });
  return { draft, active, blockers, checks, contentVersion };
}
