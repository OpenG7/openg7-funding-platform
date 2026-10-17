import type {
  PublicationFeed,
  PublicationFeedId,
  PublicationPreparationCandidate,
  SponsorshipPublicationFormat
} from '@openg7/funding-core';

import {
  composePublicationRecognition,
  PUBLICATION_MESSAGE_MAX_CODE_UNITS,
  selectPublicationRecognitionSources
} from '../../../../packages/funding-core/src/index.js';

import { preparationMaterializationSql } from './preparation-materialization.js';
import type { PreparationOpportunityPlanner } from './preparation-opportunity.js';
import {
  preparationModerationSubjectSql,
  recognitionSource
} from './preparation-sources.js';
import type { Db, Source } from './sources.js';

interface CandidateRow extends Omit<Source, 'id'> {
  obligation_id: string;
  name: string;
  publication_format: SponsorshipPublicationFormat;
  moderation_allowed: boolean;
}

/** Read-only, bounded to one dossier and its first pending passage per destination. */
export async function preparationCandidateOpportunities(
  db: Db,
  feeds: readonly PublicationFeed[],
  sponsorshipId: string,
  planner: PreparationOpportunityPlanner
): Promise<readonly PublicationPreparationCandidate[]> {
  const result: PublicationPreparationCandidate[] = [];
  for (const feed of feeds) {
    const [target, channel] = feed.id.split(':');
    const rows = (
      await db.query<CandidateRow>(
        `SELECT candidate.*,(${preparationModerationSubjectSql('sponsorship', 'candidate.contribution_id')}) AS moderation_allowed
         FROM (${preparationMaterializationSql('$1', '$2', 'c.id=$3::uuid')}) candidate`,
        [target, channel, sponsorshipId]
      )
    ).rows;
    for (const row of rows) {
      // Recognition policy needs a distinct block key; the recorded obligation
      // identifies this possibility. It is never presented as a persisted draft.
      const source = recognitionSource({ ...row, id: row.obligation_id });
      const message = composePublicationRecognition([source]);
      const issue = selectPublicationRecognitionSources({
        existingSources: [],
        candidates: [source],
        capacity: 1
      }).needsCorrection[0];
      const status =
        row.moderation_allowed && issue ? 'needs_correction' : 'deferred';
      const reason = !row.moderation_allowed
        ? 'MODERATION_REVIEW_REQUIRED'
        : issue?.reason === 'SOURCE_TEXT_TOO_LONG'
          ? 'INDIVIDUAL_TEXT_TOO_LONG'
          : issue
            ? 'INVALID_SOURCE_CONTENT'
            : 'AWAITING_PREPARATION';
      const facts = {
        feedId: `${row.feed_target}:${row.channel}` as PublicationFeedId,
        publicationFormat: row.publication_format,
        status,
        reason
      } as const;
      result.push({
        obligationId: row.obligation_id,
        sponsorshipId: row.contribution_id,
        name: row.name,
        ...facts,
        renderedLength: message.length,
        budget: PUBLICATION_MESSAGE_MAX_CODE_UNITS,
        nextOpportunity: planner.project(facts, source)
      });
    }
  }
  return result;
}
