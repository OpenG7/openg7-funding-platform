import { createHash } from 'node:crypto';

import type {
  AdminPreparationCheck,
  AdminPreparationDraft,
  AdminPreparationReceiptData,
  ContributionPreparation,
  ResponsibilityBalance,
  SponsorshipOfferSnapshot
} from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import { moderationApprovedSql } from './moderation/policy.js';
import { loadResponsibilityBalanceOnClient } from './admin-responsibility-balance.service.js';

export const preparationDigest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Preserve integrity gates without describing every historical delivery issue as an unknown offer. */
export function preparationBalanceBlockers(
  balance: Pick<ResponsibilityBalance, 'unknown' | 'reasons'>
): readonly string[] {
  if (!balance.unknown) return [];
  const blockers = new Set<string>();
  for (const reason of balance.reasons) {
    if (
      reason.startsWith('fulfilment_') ||
      reason === 'orphan_fulfilment_evidence' ||
      reason === 'duration_attestation_missing'
    )
      blockers.add('fulfilment_unverified');
    else if (
      reason.startsWith('obligation_') ||
      reason === 'promised_obligation_missing' ||
      reason === 'deadline_origin_unknown'
    )
      blockers.add('obligation_unverified');
    else if (
      reason.startsWith('offer_') ||
      reason === 'commitment_needs_confirmation' ||
      reason === 'contribution_type_unknown' ||
      reason === 'payment_confirmation_unknown' ||
      reason === 'personal_payment_has_sponsorship_records'
    )
      blockers.add('offer_unverified');
  }
  // Forward-compatible unknowns remain blocking until explicitly classified.
  return blockers.size ? [...blockers] : ['offer_unverified'];
}

export interface PreparationSource {
  contribution_id: string;
  reference: string;
  amount_minor: string;
  currency: string;
  /** Batch workflow prerequisite; absent for an ordinary dossier read. */
  examined?: boolean;
}

export interface PreparationManifest extends PreparationSource {
  run_id: string;
  position: string;
  payment_status: string;
  last_pass: number | null;
  pass: number;
  total_count: string;
  processed_count: string;
}

interface Source {
  amount_minor: number;
  currency: string;
  status: string;
  paid_at: Date | null;
  contribution_type: string;
  sponsor_company_name: string | null;
  sponsor_public_summary: string | null;
  public_display_consent: boolean;
  sponsor_review_status: string | null;
  sponsor_feed_status: string;
  sponsorship_refund_status: string;
  moderation_approved: boolean;
  content_version: string;
  media_version: string;
}

/** One snapshot of private preparation, separate from fulfilled benefits and delivery consent. */
export async function projectPreparation(
  db: PoolClient,
  manifest: PreparationSource
): Promise<Omit<AdminPreparationReceiptData, 'approval' | 'approvalHistory'>> {
  const id = manifest.contribution_id;
  const adminUrl = `/admin/fundraiser/sponsors?sponsorshipId=${id}`;
  const blockers: { code: string; adminUrl: string | null }[] = [];
  const block = (code: string) => {
    if (!blockers.some((entry) => entry.code === code))
      blockers.push({ code, adminUrl });
  };
  const source = (
    await db.query<Source>(
      `SELECT c.amount_cents AS amount_minor,upper(c.currency) AS currency,c.status,c.paid_at,
       c.contribution_type,c.sponsor_company_name,c.sponsor_public_summary,c.public_display_consent,
       c.sponsor_review_status,c.sponsor_feed_status,c.sponsorship_refund_status,
       c.updated_at::text AS content_version,
       COALESCE((SELECT max(updated_at)::text FROM sponsor_media_assets WHERE contribution_id=c.id),'') AS media_version,
       ${moderationApprovedSql('sponsorship', 'c.id')} AS moderation_approved
     FROM fund_contributions c WHERE c.id=$1::uuid`,
      [id]
    )
  ).rows[0];
  let balance: ResponsibilityBalance | null = null;
  let acceptedOffer: SponsorshipOfferSnapshot | null = null;
  const checks: AdminPreparationCheck[] = [];
  const authorizations: AdminPreparationCheck[] = [];
  const drafts: AdminPreparationDraft[] = [];
  if (manifest.examined !== undefined) {
    if (!manifest.examined) block('dossier_not_examined');
    checks.push({
      code: 'dossier_examined',
      state: manifest.examined ? 'complete' : 'missing'
    });
  }
  if (!source) block('contribution_missing');
  const payment = {
    amountMinor: Number(source?.amount_minor ?? manifest.amount_minor),
    currency: source?.currency ?? manifest.currency,
    status: source?.status ?? 'unavailable',
    confirmedAt: source?.paid_at?.toISOString() ?? null
  };
  const confirmed = source?.status === 'paid' && source.paid_at !== null;
  checks.push({
    code: 'payment_confirmed',
    state: confirmed ? 'complete' : 'missing'
  });
  if (!confirmed && source)
    block(
      source.status === 'refunded'
        ? 'payment_refunded'
        : source.status === 'disputed'
          ? 'payment_disputed'
          : 'payment_unconfirmed'
    );
  let media: unknown[] = [];
  if (source) {
    balance = await loadResponsibilityBalanceOnClient(db, id);
    if (source.contribution_type === 'sponsorship_interest') {
      const offer = (
        await db.query<{ snapshot: SponsorshipOfferSnapshot }>(
          `SELECT o.snapshot FROM sponsorship_commitments c JOIN sponsorship_offers o ON o.id=c.offer_id
         WHERE c.contribution_id=$1::uuid`,
          [id]
        )
      ).rows[0];
      acceptedOffer = offer?.snapshot ?? null;
      const integrityBlockers = preparationBalanceBlockers(balance);
      checks.push({
        code: 'accepted_offer',
        state:
          acceptedOffer && !integrityBlockers.includes('offer_unverified')
            ? 'complete'
            : 'missing'
      });
      if (!acceptedOffer) block('commitment_needs_confirmation');
      else for (const code of integrityBlockers) block(code);
      const authorization = (
        code: string,
        available: boolean,
        blocker: string
      ) => {
        authorizations.push({
          code,
          state: available ? 'complete' : 'missing'
        });
        if (!available) block(blocker);
      };
      authorization(
        'public_consent',
        source.public_display_consent,
        'public_consent_missing'
      );
      authorization(
        'sponsor_review',
        source.sponsor_review_status === 'approved',
        'sponsor_review_required'
      );
      authorization(
        'moderation_review',
        source.moderation_approved,
        'moderation_review_required'
      );
      if (source.sponsorship_refund_status !== 'not_requested')
        block('refund_pending');
      if (source.sponsor_feed_status === 'hidden') block('recognition_hidden');
      if (!source.sponsor_company_name?.trim()) block('company_missing');
      if (!source.sponsor_public_summary?.trim()) block('presentation_missing');
      const assets = await db.query<{
        id: string;
        kind: string;
        review_status: string;
        usage_rights: { state?: string };
        moderation_approved: boolean;
      }>(
        `SELECT a.id,a.kind,a.review_status,sponsor_media_effective_usage(a.id) AS usage_rights,a.checksum_sha256,a.alt_text,
          a.width,a.height,a.updated_at::text,${moderationApprovedSql('media', 'a.id')} AS moderation_approved
         FROM sponsor_media_assets a WHERE a.contribution_id=$1::uuid AND a.deleted_at IS NULL ORDER BY a.id`,
        [id]
      );
      media = assets.rows;
      const open = balance.obligations.filter(
        (obligation) => !['fulfilled', 'adjusted'].includes(obligation.state)
      );
      if (open.some((obligation) => obligation.state === 'blocked'))
        block('obligation_blocked');
      const publicationDrafts = (
        await db.query<{
          id: string;
          obligation_id: string | null;
          feed_target: 'openg7' | 'openg20';
          channel: 'facebook' | 'linkedin';
          title: string;
          body: string;
          disclosure_text: string;
          status: string;
          updated_at: string;
        }>(
          `SELECT id,obligation_id,feed_target,channel,title,body,disclosure_text,status,updated_at::text
         FROM sponsor_publication_drafts WHERE contribution_id=$1::uuid ORDER BY feed_target,channel,id`,
          [id]
        )
      ).rows;
      // Only the next outstanding passage per destination can have a current source draft.
      const next = new Map<string, (typeof open)[number]>();
      for (const obligation of open.sort((a, b) => a.ordinal - b.ordinal)) {
        const key = obligation.target + ':' + obligation.channel;
        if (!next.has(key)) next.set(key, obligation);
      }
      for (const obligation of next.values()) {
        if (obligation.channel === 'website') {
          const activity = (
            await db.query<{
              id: string;
              revision: number;
              snapshot: ContributionPreparation | null;
              source_version: string;
            }>(
              'SELECT id::text,revision,snapshot,source_version FROM contribution_activity WHERE contribution_id=$1::uuid',
              [id]
            )
          ).rows[0];
          if (
            activity?.snapshot?.state !== 'prepared' ||
            !activity.snapshot.cartouche
          )
            block('website_draft_missing');
          else {
            const content = activity.snapshot.cartouche;
            if (
              !activity.source_version?.startsWith(
                source.content_version + '|' + source.media_version + '|'
              )
            )
              block('website_draft_outdated');
            drafts.unshift({
              id: activity.id,
              kind: 'website',
              version: String(activity.revision),
              title: content.title,
              body: content.body,
              disclosureText: '',
              channel: 'website',
              target: obligation.target,
              status: 'private',
              adminUrl: adminUrl + '&tab=publication'
            });
          }
        } else {
          const matching = publicationDrafts.filter(
            (item) =>
              item.obligation_id === obligation.id &&
              item.channel === obligation.channel &&
              item.feed_target === obligation.target
          );
          const draft =
            matching.find(
              (item) =>
                !['published', 'cancelled', 'rejected'].includes(item.status)
            ) ?? matching[0];
          if (!draft) block('publication_draft_missing');
          else {
            drafts.push({
              id: draft.id,
              kind: 'publication',
              version: preparationDigest(draft),
              title: draft.title,
              body: draft.body,
              disclosureText: draft.disclosure_text,
              channel: draft.channel,
              target: draft.feed_target,
              status: draft.status,
              adminUrl: `/admin/fundraiser/publications/drafts?sponsorshipId=${id}&draftId=${draft.id}`
            });
            if (
              ['published', 'cancelled', 'rejected'].includes(draft.status) ||
              !draft.title.trim() ||
              !draft.body.trim() ||
              !draft.disclosure_text.trim()
            )
              block('publication_draft_incomplete');
          }
        }
      }
      const required =
        acceptedOffer?.benefits.flatMap(
          (benefit) => benefit.requiredElements
        ) ?? [];
      if (
        required.includes('approved_logo') &&
        !assets.rows.some(
          (asset) =>
            asset.kind === 'logo' &&
            asset.review_status === 'approved' &&
            asset.moderation_approved
        )
      )
        block('required_media_missing');
      if (
        open.some(
          (obligation) =>
            obligation.format && obligation.format !== 'collective_text'
        ) &&
        !assets.rows.some(
          (asset) =>
            asset.kind === 'supporting_image' &&
            asset.review_status === 'approved' &&
            asset.moderation_approved &&
            asset.usage_rights.state === 'confirmed'
        )
      )
        block('required_media_missing');
    } else checks.push({ code: 'accepted_offer', state: 'not_required' });
  }
  const contentBlockers = blockers.filter(
    (blocker) => blocker.code !== 'dossier_not_examined'
  );
  checks.push({
    code: 'content_prepared',
    state: contentBlockers.length
      ? 'missing'
      : drafts.length
        ? 'complete'
        : 'not_required'
  });
  const version = preparationDigest({
    contributionId: id,
    payment,
    source,
    acceptedOffer,
    balanceVersion: balance?.version,
    // Keep the digest of an already examined 056 receipt stable. Examination is
    // a batch workflow gate, not a different version of the preparation content.
    checks: [
      { code: 'dossier_examined', state: 'complete' },
      ...checks.filter((check) => check.code !== 'dossier_examined')
    ],
    authorizations,
    drafts,
    blockers: contentBlockers,
    media,
    // Two decisions can both grant N0 while representing distinct reviewed
    // authorities. Keep their identity and exact policy in the approved version.
    moderationAuthority: (
      await db.query(
        `SELECT c.id,c.subject_type,c.subject_id,c.current_content_version,c.current_fingerprint,
         c.current_decision_id,c.state,c.updated_at::text,d.actor,d.policy_version,
         d.created_at::text AS decision_created_at,p.policy_fingerprint,p.editorial_status
       FROM moderation_cases c LEFT JOIN moderation_decisions d ON d.id=c.current_decision_id
       LEFT JOIN moderation_policies p ON p.version=d.policy_version
       WHERE c.contribution_id=$1::uuid ORDER BY c.subject_type,c.subject_id,c.id`,
        [id]
      )
    ).rows,
    moderationAppeals: (
      await db.query(
        `SELECT id,decision_id,state,resulting_decision_id,updated_at::text
       FROM moderation_appeals WHERE contribution_id=$1::uuid ORDER BY id`,
        [id]
      )
    ).rows
  });
  return {
    contributionId: id,
    reference: manifest.reference,
    version,
    status: blockers.length ? 'incomplete' : 'ready',
    payment,
    acceptedOffer,
    balance,
    checks,
    authorizations,
    drafts,
    blockers,
    canApprove: blockers.length === 0
  };
}
