/** Application budget, measured as JavaScript UTF-16 code units. */
export const PUBLICATION_MESSAGE_MAX_CODE_UNITS = 2900;

export interface PublicationRecognitionSource {
  readonly id: string;
  readonly contributionId: string;
  /** Authoritative public identity, supplied by the API's dossier facts. */
  readonly name: string;
  readonly title: string;
  readonly body: string;
  readonly disclosureText: string;
}

export interface PublicationRecognitionBlock {
  readonly sourceId: string;
  readonly contributionId: string;
  readonly text: string;
}

const canonicalText = (text: string): string =>
  text.replace(/\r\n?/g, '\n').normalize('NFC');

/** Source text stays protected; only authoritative, complete identity lines qualify. */
export function publicationRecognitionBlock(
  source: PublicationRecognitionSource
): PublicationRecognitionBlock {
  const name = canonicalText(source.name).trim();
  const title = canonicalText(source.title).trim();
  const identityTitles = [
    name,
    `Merci à ${name}`,
    `Un partenaire engagé : ${name}`,
    `Commandite de visibilite - ${name}`,
    `Partenaire : ${name}`
  ];
  const parts = [
    ...(name && identityTitles.includes(title) ? [] : [`Partenaire : ${name}`]),
    title,
    canonicalText(source.body).trim(),
    canonicalText(source.disclosureText).trim()
  ];
  return {
    sourceId: source.id,
    contributionId: source.contributionId,
    text: parts.filter(Boolean).join('\n\n')
  };
}

export function composePublicationRecognition(
  sources: readonly PublicationRecognitionSource[]
): string {
  return sources
    .map((source) => publicationRecognitionBlock(source).text)
    .join('\n\n');
}

export function isValidPublicationMessage(message: unknown): message is string {
  return (
    typeof message === 'string' &&
    message.trim().length > 0 &&
    message.length <= PUBLICATION_MESSAGE_MAX_CODE_UNITS
  );
}

/**
 * A complete paragraph-delimited source block recognizes one beneficiary.
 * Distinct sources cannot reuse overlapping text, including homonymous dossiers
 * or a second source mentioned incidentally inside another source's description.
 * Copy may be added around blocks, and complete blocks may be reordered.
 */
export function missingPublicationRecognitionSources(
  message: string,
  sources: readonly PublicationRecognitionSource[]
): string[] {
  const text = canonicalText(message);
  const occupied: { start: number; end: number }[] = [];
  const missing = new Set<string>();
  const ids = new Set<string>();
  const blocks = sources.map((source) => {
    if (
      !source.id ||
      !source.contributionId ||
      !source.name.trim() ||
      /[\r\n]/.test(source.name) ||
      ids.has(source.id)
    )
      missing.add(source.id);
    ids.add(source.id);
    return publicationRecognitionBlock(source);
  });
  // Match the most specific block first, so nested incidental text cannot win.
  for (const block of [...blocks].sort(
    (a, b) => b.text.length - a.text.length
  )) {
    if (missing.has(block.sourceId)) continue;
    let cursor = 0;
    let found = false;
    while (cursor <= text.length - block.text.length) {
      const start = text.indexOf(block.text, cursor);
      if (start < 0) break;
      const end = start + block.text.length;
      const startsParagraph =
        start === 0 || text.slice(start - 2, start) === '\n\n';
      const endsParagraph =
        end === text.length || text.slice(end, end + 2) === '\n\n';
      if (
        startsParagraph &&
        endsParagraph &&
        !occupied.some((span) => start < span.end && end > span.start)
      ) {
        occupied.push({ start, end });
        found = true;
        break;
      }
      cursor = start + 1;
    }
    if (!found) missing.add(block.sourceId);
  }
  return sources
    .filter((source) => missing.has(source.id))
    .map((source) => source.id);
}
