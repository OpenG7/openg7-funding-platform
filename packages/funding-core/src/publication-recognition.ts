/** Application budget, measured as JavaScript UTF-16 code units. */
export const PUBLICATION_MESSAGE_MAX_CODE_UNITS = 2900;
/** Changes when the protected rendering or its admissibility rules change. */
export const PUBLICATION_RECOGNITION_POLICY_VERSION = 'recognition-v1';

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

export interface PublicationRecognitionCorrection {
  readonly source: PublicationRecognitionSource;
  readonly codeUnits: number;
  readonly reason: 'SOURCE_TEXT_TOO_LONG' | 'SOURCE_CONTENT_MISSING';
}

export interface PublicationRecognitionSelection {
  readonly message: string;
  readonly codeUnits: number;
  /** Existing members are retained even when their combined content is invalid. */
  readonly retained: readonly PublicationRecognitionSource[];
  readonly deferred: readonly PublicationRecognitionSource[];
  readonly needsCorrection: readonly PublicationRecognitionCorrection[];
  readonly existingIssue:
    | 'EXISTING_CAPACITY_EXCEEDED'
    | 'EXISTING_MESSAGE_TOO_LONG'
    | 'SOURCE_CONTENT_MISSING'
    | null;
}

export interface PublicationRecognitionSelectionInput {
  readonly existingSources: readonly PublicationRecognitionSource[];
  /** The caller supplies its stable queue order; this policy never changes it. */
  readonly candidates: readonly PublicationRecognitionSource[];
  readonly capacity: number;
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

/**
 * Reserve only complete blocks within the application budget. A source that
 * cannot fit alone does not stop later sources. The first otherwise valid
 * source that needs the next batch also defers later valid sources, preserving
 * the supplied order. No source text, approval or existing membership changes.
 */
export function selectPublicationRecognitionSources({
  existingSources,
  candidates,
  capacity
}: PublicationRecognitionSelectionInput): PublicationRecognitionSelection {
  if (!Number.isSafeInteger(capacity) || capacity < 1)
    throw new RangeError('Publication capacity must be a positive integer.');

  const retained = [...existingSources];
  const deferred: PublicationRecognitionSource[] = [];
  const needsCorrection: PublicationRecognitionCorrection[] = [];
  let message = composePublicationRecognition(retained);
  const existingIssue =
    retained.length > capacity
      ? 'EXISTING_CAPACITY_EXCEEDED'
      : message.length > PUBLICATION_MESSAGE_MAX_CODE_UNITS
        ? 'EXISTING_MESSAGE_TOO_LONG'
        : retained.length &&
            missingPublicationRecognitionSources(message, retained).length
          ? 'SOURCE_CONTENT_MISSING'
          : null;
  let deferFollowing = existingIssue !== null;

  for (const source of candidates) {
    const individualMessage = composePublicationRecognition([source]);
    if (individualMessage.length > PUBLICATION_MESSAGE_MAX_CODE_UNITS) {
      needsCorrection.push({
        source,
        codeUnits: individualMessage.length,
        reason: 'SOURCE_TEXT_TOO_LONG'
      });
      continue;
    }
    if (
      missingPublicationRecognitionSources(individualMessage, [source]).length
    ) {
      needsCorrection.push({
        source,
        codeUnits: individualMessage.length,
        reason: 'SOURCE_CONTENT_MISSING'
      });
      continue;
    }
    if (deferFollowing || retained.length === capacity) {
      deferred.push(source);
      deferFollowing = true;
      continue;
    }
    const combinedSources = [...retained, source];
    const combinedMessage = composePublicationRecognition(combinedSources);
    if (
      combinedMessage.length > PUBLICATION_MESSAGE_MAX_CODE_UNITS ||
      missingPublicationRecognitionSources(combinedMessage, combinedSources)
        .length
    ) {
      deferred.push(source);
      deferFollowing = true;
      continue;
    }
    retained.push(source);
    message = combinedMessage;
  }

  return {
    message,
    codeUnits: message.length,
    retained,
    deferred,
    needsCorrection,
    existingIssue
  };
}
