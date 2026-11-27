import type { Pool, PoolClient } from 'pg';
import type {
  SponsorshipProgressPublication,
  SponsorshipPublicationWorkflow
} from '@openg7/funding-core';

import type { SponsorshipAttentionRecord } from '../../fund-contributions.repository.js';
import { loadSponsorshipProgressPublications } from '../../sponsorship-progress.repository.js';
import {
  loadSponsorshipEvidenceFacts,
  qualifiedSponsorshipEvidenceIds
} from '../../sponsorship-progress-evidence.js';
import { projectSponsorshipPublicationWorkflow } from '../../sponsorship-progress-workflow.js';

export interface AttentionPublicationWorkflow {
  readonly contributionId: string;
  readonly workflow: SponsorshipPublicationWorkflow;
}

/** Same native projection as the contextual Assistant; observation never authorizes dispatch. */
export function attentionPublicationWorkflow(
  record: SponsorshipAttentionRecord,
  consent: boolean,
  publications: readonly SponsorshipProgressPublication[],
  qualifiedEvidenceIds: readonly string[],
  now: Date
): SponsorshipPublicationWorkflow {
  return projectSponsorshipPublicationWorkflow(
    record.commitment,
    publications,
    [
      ...(!consent ? ['consent'] : []),
      ...(record.reviewStatus !== 'approved' ? ['review'] : []),
      ...(record.paymentStatus !== 'paid' ? ['payment'] : []),
      ...(record.refundStatus !== 'not_requested' ? ['refund'] : []),
      ...(['hidden'].includes(record.feedStatus) ? ['hidden'] : [])
    ],
    now,
    qualifiedEvidenceIds
  );
}

/** Bulk owner reads, not one dossier/context request per item. Failures propagate. */
export async function loadAttentionPublicationWorkflows(
  db: Pool | PoolClient | null,
  records: readonly SponsorshipAttentionRecord[],
  now: Date
): Promise<readonly AttentionPublicationWorkflow[]> {
  if (!db || records.length === 0) return [];
  const ids = records.map((record) => record.contributionId);
  const consentRows = await db.query<{
    contributionId: string;
    consent: boolean;
  }>(
    'SELECT id::text AS "contributionId",public_display_consent AS consent FROM fund_contributions WHERE id=ANY($1::uuid[])',
    [ids]
  );
  const consent = new Map(
    consentRows.rows.map((row) => [row.contributionId, row.consent])
  );
  const publications = await loadSponsorshipProgressPublications(db, ids);
  const evidence = await loadSponsorshipEvidenceFacts(
    db,
    ids,
    now.toISOString()
  );
  const publicationsByDossier = new Map<
    string,
    SponsorshipProgressPublication[]
  >();
  for (const item of publications) {
    if (!item.contributionId) continue;
    const group = publicationsByDossier.get(item.contributionId) ?? [];
    group.push(item);
    publicationsByDossier.set(item.contributionId, group);
  }
  const evidenceByDossier = new Map<string, (typeof evidence)[number][]>();
  for (const item of evidence) {
    const group = evidenceByDossier.get(item.contributionId) ?? [];
    group.push(item);
    evidenceByDossier.set(item.contributionId, group);
  }
  return records.map((record) => ({
    contributionId: record.contributionId,
    workflow: attentionPublicationWorkflow(
      record,
      consent.get(record.contributionId) === true,
      publicationsByDossier.get(record.contributionId) ?? [],
      qualifiedSponsorshipEvidenceIds(
        record.commitment,
        evidenceByDossier.get(record.contributionId) ?? []
      ),
      now
    )
  }));
}
