export interface PublicationWarningContext {
  readonly reviewPending?: boolean;
  readonly channel?: string;
  readonly hasIndependentDraft?: boolean;
}

const aliases: ReadonlyMap<string, string> = new Map([
  ['sponsor_review_required', 'review'],
  ['review_pending', 'review'],
  ['review_pending_review', 'review'],
  ['media_missing', 'media'],
  ['required_media_missing', 'media'],
  ['public_presentation', 'presentation_missing']
]);
const summaries = new Set(['obligation_blocked', 'publication_blocked']);

/** Local display only: keep source warnings and every independent requirement intact. */
export function publicationWarningCodes(
  codes: readonly string[],
  context: PublicationWarningContext = {}
): readonly string[] {
  let distinct = [
    ...new Set(codes.filter(Boolean).map((code) => aliases.get(code) ?? code))
  ];
  if (
    context.reviewPending === true &&
    (context.channel === 'website' || context.hasIndependentDraft === false) &&
    distinct.includes('review') &&
    distinct.includes('moderation_review_required')
  )
    distinct = distinct
      .map((code) => (code === 'review' ? 'review_and_moderation' : code))
      .filter((code) => code !== 'moderation_review_required');
  const specific = distinct.filter((code) => !summaries.has(code));
  return specific.length
    ? specific
    : distinct.includes('publication_blocked')
      ? ['publication_blocked']
      : distinct;
}
