import {
  composePublicationRecognition,
  isValidPublicationMessage,
  missingPublicationRecognitionSources,
  type PublicationFeedId,
  type PublicationRecognitionSource
} from '../../../../packages/funding-core/src/index.js';

import { editorialMessage } from './editorial-profiles.js';
import { assert } from './policy.js';
import type { Db, Source } from './sources.js';

async function recognitionSources(
  db: Db,
  sources: readonly Source[]
): Promise<PublicationRecognitionSource[]> {
  const identities = (
    await db.query<{ id: string; sponsor_company_name: string }>(
      'SELECT id,sponsor_company_name FROM fund_contributions WHERE id=ANY($1::uuid[]) ORDER BY id',
      [sources.map((source) => source.contribution_id)]
    )
  ).rows;
  const names = new Map(
    identities.map((identity) => [identity.id, identity.sponsor_company_name])
  );
  return sources.map((source) => ({
    id: source.id,
    contributionId: source.contribution_id,
    name: names.get(source.contribution_id) ?? '',
    title: source.title,
    body: source.body,
    disclosureText: source.disclosure_text
  }));
}

export async function composeSponsorshipContent(
  db: Db,
  feedId: PublicationFeedId,
  sources: readonly Source[]
): Promise<string> {
  const recognition = await recognitionSources(db, sources);
  const message = composePublicationRecognition(recognition);
  assert(
    recognition.length > 0 &&
      !missingPublicationRecognitionSources(message, recognition).length,
    'SOURCE_CONTENT_MISSING'
  );
  const transformed = await editorialMessage(
    db,
    feedId,
    message,
    sources.map((source) => source.contribution_id)
  );
  // Editorial preferences must never replace protected source blocks.
  return isValidPublicationMessage(transformed) &&
    !missingPublicationRecognitionSources(transformed, recognition).length
    ? transformed
    : message;
}

/** Does not change historical snapshots or infer identity from an editable title. */
export async function assertSponsorshipContent(
  db: Db,
  row: { batch_id: string | null; message: string; source_snapshot: Source[] }
): Promise<void> {
  if (!row.batch_id) return;
  assert(isValidPublicationMessage(row.message), 'INVALID_MESSAGE', 400);
  const recognition = await recognitionSources(db, row.source_snapshot);
  assert(
    recognition.length > 0 &&
      !missingPublicationRecognitionSources(row.message, recognition).length,
    'SOURCE_CONTENT_MISSING'
  );
}
