import { isDeepStrictEqual } from 'node:util';

import type {
  WorkshopProposal,
  SponsorFeedChannel,
  SponsorFeedStatus,
  SponsorFeedTarget
} from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import { createDefaultDraftText } from '../fund-publication-content.js';
import {
  createAdminPublicationDraftOnConnection,
  updateAdminPublicationDraftOnConnection
} from '../fund-publication-drafts.repository.js';
import { updateSponsorshipPublication } from '../sponsorship-decisions.repository.js';

import {
  requireWorkshop,
  workshopDigest,
  type WorkshopSourceSnapshot
} from './workshop-source.js';

/** Adopt into Funding's existing private editorial owners; no decision or delivery is produced. */
export async function adoptWorkshopContent(
  db: PoolClient,
  source: WorkshopSourceSnapshot,
  proposal: WorkshopProposal,
  baseline: WorkshopSourceSnapshot['draftBaseline'],
  actor: string,
  tenantId: string
): Promise<unknown[]> {
  requireWorkshop(
    source.publicConsent && source.displayName && source.reviewed,
    'PUBLICATION_WORKSHOP_PREREQUISITES_REQUIRED'
  );
  const current = (
    await db.query<{
      version: string;
      sponsor_company_name: string;
      sponsor_website_url: string | null;
      sponsor_logo_url: string | null;
      sponsor_public_summary: string | null;
      sponsor_message: string | null;
      sponsor_public_slug: string | null;
      sponsor_feed_target: SponsorFeedTarget | null;
      sponsor_feed_channels: SponsorFeedChannel[];
      sponsor_feed_status: SponsorFeedStatus;
      sponsor_feed_public_url: string | null;
      sponsor_feed_notes: string | null;
      sponsor_site_visibility_held: boolean;
    }>(
      `SELECT updated_at::text AS version,sponsor_company_name,sponsor_website_url,sponsor_logo_url,sponsor_public_summary,
    sponsor_message,sponsor_public_slug,sponsor_feed_target,sponsor_feed_channels,sponsor_feed_status,sponsor_feed_public_url,sponsor_feed_notes,
    sponsor_site_visibility_held FROM fund_contributions WHERE id=$1::uuid FOR UPDATE`,
      [source.contributionId]
    )
  ).rows[0];
  const existing = (
    await db.query<{
      id: string;
      title: string;
      body: string;
      disclosureText: string;
      obligationId: string;
      status: string;
    }>(
      `SELECT id,title,body,disclosure_text AS "disclosureText",obligation_id AS "obligationId",status FROM sponsor_publication_drafts
     WHERE contribution_id=$1::uuid AND status NOT IN ('published','cancelled','rejected') ORDER BY id FOR UPDATE`,
      [source.contributionId]
    )
  ).rows;
  requireWorkshop(
    isDeepStrictEqual(existing, baseline),
    'PUBLICATION_WORKSHOP_MANUAL_CHANGES_PRESERVED'
  );
  const past = (
    await db.query<{ drafts: { id?: string; fingerprint?: string }[] }>(
      `SELECT a.drafts FROM preflight_workshop_adoptions a
    JOIN preflight_workshop_proposals p ON p.id=a.proposal_id WHERE p.tenant_id=$1 AND p.contribution_id=$2::uuid
    ORDER BY a.created_at DESC`,
      [tenantId, source.contributionId]
    )
  ).rows.flatMap((row) => row.drafts);
  const adopted: unknown[] = [];
  const visited = new Set<string>();
  // Only the next promised passage per destination can own a native current draft.
  for (const variant of proposal.editorialPreparation.variants) {
    const obligation = source.destinations.find(
      (d) =>
        d.obligationId === variant.obligationId &&
        d.obligationVersion === variant.obligationVersion
    );
    requireWorkshop(obligation, 'PUBLICATION_WORKSHOP_VERSION_CONFLICT');
    const key = obligation.destination + ':' + obligation.target;
    if (visited.has(key)) continue;
    visited.add(key);
    if (variant.destination === 'website') {
      // The existing public profile is the Web owner. It must already be held private.
      requireWorkshop(
        current.sponsor_site_visibility_held,
        'PUBLICATION_WORKSHOP_PUBLIC_CONTENT_LOCKED'
      );
      const summary = variant.summary.trim();
      requireWorkshop(
        summary.length > 0 && summary.length <= 500,
        'PUBLICATION_WORKSHOP_RESPONSE_INVALID'
      );
      if (summary !== (current.sponsor_public_summary ?? '').trim()) {
        const result = await updateSponsorshipPublication(db, {
          contributionId: source.contributionId,
          expectedVersion: current.version,
          publicSlug: current.sponsor_public_slug ?? undefined,
          publicSummary: summary,
          feedTarget: current.sponsor_feed_target,
          feedChannels: current.sponsor_feed_channels,
          feedStatus: current.sponsor_feed_status,
          feedPublicUrl: current.sponsor_feed_public_url ?? undefined,
          feedNotes: current.sponsor_feed_notes ?? undefined
        });
        requireWorkshop(
          result.updated,
          'PUBLICATION_WORKSHOP_VERSION_CONFLICT'
        );
      }
      adopted.push({
        obligationId: variant.obligationId,
        destination: 'website',
        owner: 'sponsorship_public_profile',
        contentVersion: workshopDigest(summary)
      });
      continue;
    }
    let draft = existing.find((d) => d.obligationId === variant.obligationId);
    if (draft) {
      requireWorkshop(
        ['draft', 'pending_review'].includes(draft.status),
        'PUBLICATION_WORKSHOP_DRAFT_NOT_EDITABLE'
      );
      const defaults = createDefaultDraftText(
        { id: source.contributionId, ...current },
        obligation.target,
        'facebook'
      );
      const fingerprint = workshopDigest({
        title: draft.title,
        body: draft.body,
        disclosureText: draft.disclosureText
      });
      const isOriginal =
        draft.title === defaults.title &&
        draft.body === defaults.body &&
        draft.disclosureText === defaults.disclosureText;
      requireWorkshop(
        isOriginal ||
          past.some((p) => p.id === draft!.id && p.fingerprint === fingerprint),
        'PUBLICATION_WORKSHOP_MANUAL_CHANGES_PRESERVED'
      );
    } else {
      const created = await createAdminPublicationDraftOnConnection(
        db,
        {
          contributionId: source.contributionId,
          feedTarget: obligation.target,
          channel: 'facebook'
        },
        actor,
        {
          requestId: proposal.id,
          runId: proposal.missionId,
          expectedObligationId: variant.obligationId,
          preserveExistingDeliveries: true
        }
      );
      requireWorkshop(
        created.updated && created.draft && created.created,
        'PUBLICATION_WORKSHOP_DRAFT_NOT_EDITABLE'
      );
      draft = {
        id: created.draft.id,
        title: created.draft.title,
        body: created.draft.body,
        disclosureText: created.draft.disclosure_text,
        obligationId: variant.obligationId,
        status: created.draft.status
      };
    }
    requireWorkshop(
      variant.body.trim().length > 0 &&
        variant.body.length <= 2500 &&
        variant.title.trim().length > 0 &&
        variant.title.length <= 160,
      'PUBLICATION_WORKSHOP_RESPONSE_INVALID'
    );
    const disclosureText = draft.disclosureText;
    const result = await updateAdminPublicationDraftOnConnection(
      db,
      {
        draftId: draft.id,
        title: variant.title,
        body: variant.body,
        disclosureText
      },
      actor
    );
    requireWorkshop(result.updated, 'PUBLICATION_WORKSHOP_DRAFT_NOT_EDITABLE');
    adopted.push({
      id: draft.id,
      obligationId: variant.obligationId,
      destination: 'facebook',
      fingerprint: workshopDigest({
        title: variant.title.trim(),
        body: variant.body.trim(),
        disclosureText: disclosureText.trim()
      })
    });
  }
  return adopted;
}
