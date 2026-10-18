import type { SponsorshipBenefitId } from './sponsorship-benefits.js';
import {
  publicationFormatCapability,
  type SponsorshipPublicationFormat
} from './sponsorship-publication-formats.js';
import {
  normalizeSponsorshipOfferSnapshot,
  type SponsorshipObligationChannel,
  type SponsorshipOfferSnapshot
} from './sponsorship-offers.js';

export const PREPARATION_SOURCE_MAX_LENGTH = 16_000;
export const PREPARATION_SOURCE_MAX_ITEMS = 60;
export const PREPARATION_ASSISTANCE_ADAPTER = 'local_rules_v1' as const;
export const PREPARATION_ASSISTANCE_STRUCTURED_ADAPTER =
  'local_rules_v2' as const;
export type PreparationAssistanceAdapter =
  | typeof PREPARATION_ASSISTANCE_ADAPTER
  | typeof PREPARATION_ASSISTANCE_STRUCTURED_ADAPTER;

export interface PreparationAssistanceSource {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly fingerprint: string;
  readonly createdAt: string;
}

/** Offsets refer to the exact stored text, using JavaScript UTF-16 indices. */
export interface PreparationAssistanceCitation {
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly start: number;
  readonly end: number;
  readonly excerpt: string;
}

export interface PreparationAssistanceItem {
  readonly id: string;
  readonly citation: PreparationAssistanceCitation;
  readonly channels: readonly SponsorshipObligationChannel[];
  readonly attention: 'human_mapping_required' | 'unsupported_terms';
  /** Required for v2 only. Historical v1 results retain their original shape. */
  readonly structured?: PreparationAssistanceStructuredItem;
}

export type PreparationAssistanceGap =
  | 'ambiguous_context'
  | 'channel_missing'
  | 'channel_ambiguous'
  | 'quantity_missing'
  | 'quantity_ambiguous'
  | 'target_missing'
  | 'target_ambiguous'
  | 'format_missing'
  | 'format_ambiguous'
  | 'outside_offer_model';

/** Detected words are evidence for human review, never an accepted obligation. */
export interface PreparationAssistanceFact {
  readonly kind:
    | 'nature'
    | 'quantity'
    | 'target'
    | 'format'
    | 'word_count'
    | 'visual_count'
    | 'hashtag'
    | 'delivery_deadline'
    | 'unsupported_term';
  readonly citation: PreparationAssistanceCitation;
}

export interface PreparationAssistanceStructuredItem {
  readonly version: 1;
  readonly nature: 'publication' | 'proof' | 'other';
  readonly quantity: number | null;
  readonly target: 'openg7' | 'openg20' | null;
  readonly format: SponsorshipPublicationFormat | null;
  readonly facts: readonly PreparationAssistanceFact[];
  readonly gaps: readonly PreparationAssistanceGap[];
}

export interface PreparationAssistanceSuggestion {
  readonly adapter: PreparationAssistanceAdapter;
  readonly items: readonly PreparationAssistanceItem[];
  readonly limitations: readonly string[];
  readonly proposedOffer: SponsorshipOfferSnapshot | null;
}

export interface PreparationAssistanceResolution {
  readonly itemId: string;
  readonly disposition: 'unresolved' | 'included' | 'excluded' | 'unsupported';
  readonly benefitId: SponsorshipBenefitId | null;
  readonly note: string;
}

export interface PreparationAssistanceDraft {
  readonly offer: SponsorshipOfferSnapshot | null;
  readonly items: readonly PreparationAssistanceResolution[];
  readonly reason: string;
}

export interface PreparationAssistanceReview extends PreparationAssistanceDraft {
  readonly version: number;
  readonly decision: 'saved' | 'rejected' | 'accepted';
  readonly actor: string;
  readonly createdAt: string;
}

export interface PreparationAssistanceRun {
  readonly id: string;
  readonly sourceVersion: number;
  readonly commitmentVersion: number;
  readonly adapter: PreparationAssistanceAdapter;
  readonly state:
    'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  readonly phase: 'queued' | 'extracting' | 'verifying' | 'finished';
  readonly errorCode: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly suggestion: PreparationAssistanceSuggestion | null;
  readonly review: PreparationAssistanceReview | null;
  readonly application: {
    readonly requestId: string;
    readonly appliedAt: string;
    readonly commitmentVersion: number;
  } | null;
}

export interface PreparationAssistanceState {
  readonly contributionId: string;
  readonly reference: string;
  /** Also changes when only a job, source or human review changes. */
  readonly revision: string;
  readonly source: PreparationAssistanceSource | null;
  readonly run: PreparationAssistanceRun | null;
  readonly stale: boolean;
  readonly commitment: {
    readonly version: number;
    readonly state: 'needs_confirmation' | 'active';
    readonly amountMinor: number;
    readonly currency: string;
  };
  readonly capabilities: {
    readonly canManageSource: boolean;
    readonly canRun: boolean;
    readonly canReview: boolean;
    readonly canApply: boolean;
  };
}

interface PreparationAssistanceCommand {
  readonly contributionId: string;
  readonly requestId: string;
}

export interface PreparationAssistanceSourceRequest extends PreparationAssistanceCommand {
  readonly expectedSourceVersion: number | null;
  readonly title: string;
  readonly text: string;
}

export interface PreparationAssistanceRunRequest extends PreparationAssistanceCommand {
  readonly sourceVersion: number;
  readonly expectedCommitmentVersion: number;
  readonly rerun: boolean;
}

export interface PreparationAssistanceReviewRequest extends PreparationAssistanceCommand {
  readonly runId: string;
  readonly expectedReviewVersion: number;
  readonly decision: 'save' | 'reject';
  readonly draft: PreparationAssistanceDraft;
}

export interface PreparationAssistanceApplyRequest extends PreparationAssistanceCommand {
  readonly runId: string;
  readonly sourceVersion: number;
  readonly expectedCommitmentVersion: number;
  readonly expectedReviewVersion: number;
  readonly confirmation: string;
  readonly draft: PreparationAssistanceDraft;
}

/**
 * Conservative local assistance: index every non-empty line and locate channel
 * names. This does not infer contractual quantities, destinations or formats.
 * Text (including instructions and URLs) is data and is never executed/fetched.
 */
export function extractPreparationPublications(
  source: PreparationAssistanceSource
): PreparationAssistanceSuggestion {
  if (!source.text.trim() || source.text.length > PREPARATION_SOURCE_MAX_LENGTH)
    throw new Error('ASSISTANCE_SOURCE_INVALID');
  const items: PreparationAssistanceItem[] = [];
  for (const match of source.text.matchAll(/[^\r\n]+/g)) {
    const raw = match[0];
    const excerpt = raw.trim();
    if (!excerpt) continue;
    if (items.length >= PREPARATION_SOURCE_MAX_ITEMS)
      throw new Error('ASSISTANCE_TOO_MANY_CLAUSES');
    const start = match.index + raw.indexOf(excerpt);
    const searchable = excerpt.normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const channels: SponsorshipObligationChannel[] = [];
    if (/\b(?:website|web|site)\b/iu.test(excerpt)) channels.push('website');
    if (/\bfacebook\b/iu.test(excerpt)) channels.push('facebook');
    if (/\blinkedin\b/iu.test(excerpt)) channels.push('linkedin');
    items.push({
      id: `clause-${items.length + 1}`,
      citation: {
        sourceId: source.id,
        sourceVersion: source.version,
        start,
        end: start + excerpt.length,
        excerpt
      },
      channels,
      attention:
        /\b(?:articles?|mots|words?|hashtags?|visuels?|screenshots?|captures?|preuves?|proof|livraison|delivery|exclusivite|exclusivity|exclusive)\b/iu.test(
          searchable
        )
          ? 'unsupported_terms'
          : 'human_mapping_required'
    });
  }
  return {
    adapter: PREPARATION_ASSISTANCE_ADAPTER,
    items,
    limitations: [
      'local_channel_detection_only',
      'no_contractual_terms_inferred',
      'all_clauses_require_human_review'
    ],
    proposedOffer: null
  };
}

const quantityWords: Readonly<Record<string, number>> = {
  un: 1,
  une: 1,
  a: 1,
  an: 1,
  one: 1,
  deux: 2,
  two: 2,
  trois: 3,
  three: 3,
  quatre: 4,
  four: 4,
  cinq: 5,
  five: 5,
  six: 6,
  sept: 7,
  seven: 7,
  huit: 8,
  eight: 8,
  neuf: 9,
  nine: 9,
  dix: 10,
  ten: 10
};
const formatNames: Readonly<Record<string, SponsorshipPublicationFormat>> = {
  collective_text: 'collective_text',
  'texte collectif': 'collective_text',
  'collective text': 'collective_text',
  individual_portrait: 'individual_portrait',
  'portrait individuel': 'individual_portrait',
  'individual portrait': 'individual_portrait',
  collective_composite: 'collective_composite',
  'composition collective': 'collective_composite',
  'collective composite': 'collective_composite',
  image_collection: 'image_collection',
  "collection d'images": 'image_collection',
  'image collection': 'image_collection'
};

/**
 * A bounded FR/EN vocabulary records explicit, cited values for human review.
 * Ambiguous scope never supplies a quantity/destination/format. No offer is built.
 * The v1 extractor above remains unchanged for persisted historical jobs.
 */
export function extractStructuredPreparationPublications(
  source: PreparationAssistanceSource
): PreparationAssistanceSuggestion {
  const legacy = extractPreparationPublications(source);
  return {
    adapter: PREPARATION_ASSISTANCE_STRUCTURED_ADAPTER,
    items: legacy.items.map((item) => structuredItem(item)),
    limitations: [
      'local_explicit_vocabulary_only',
      'ambiguous_values_require_human_review',
      'unsupported_terms_do_not_extend_offer_model',
      'all_clauses_require_human_review'
    ],
    proposedOffer: null
  };
}

function structuredItem(
  item: PreparationAssistanceItem
): PreparationAssistanceItem {
  const text = item.citation.excerpt;
  const facts: PreparationAssistanceFact[] = [];
  const gaps = new Set<PreparationAssistanceGap>();
  const collect = (
    kind: PreparationAssistanceFact['kind'],
    pattern: RegExp
  ) => {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const excerpt = match[0].trim();
      const start =
        item.citation.start + match.index + match[0].indexOf(excerpt);
      facts.push({
        kind,
        citation: {
          ...item.citation,
          start,
          end: start + excerpt.length,
          excerpt
        }
      });
    }
    return matches;
  };
  const proofs = collect(
    'nature',
    /\b(?:preuves?|proofs?|evidence|screenshots?|captures?(?: d['’][ée]cran)?)\b/giu
  );
  const publications = collect(
    'nature',
    /\b(?:publications?|posts?|articles?|publier|publiera|publieront|publish|publishes)\b/giu
  );
  const nature = proofs.length
    ? 'proof'
    : publications.length
      ? 'publication'
      : 'other';
  const quantities = collect(
    'quantity',
    /(?<![\p{L}\p{N}_])([+-]?\d+(?:[\u0020\u00a0\u202f]\d{3})*|un|une|a|an|one|deux|two|trois|three|quatre|four|cinq|five|six|sept|seven|huit|eight|neuf|nine|dix|ten)(?:\s*([–—-]|à|to)\s*(?:\d+|un|une|one|deux|two|trois|three|quatre|four|cinq|five|six|sept|seven|huit|eight|neuf|nine|dix|ten))?\s+(?:(?:facebook|linkedin|web|website)\s+)?(?:publications?|posts?|articles?)\b/giu
  );
  const targets = collect('target', /\bopeng(?:20|7)\b/giu);
  const destinations = [
    ...text.matchAll(
      /\b(?:cible|target|destination|compte|account|page|site|sur|on|pour|for)(?:\s+|\s*[:=]\s*)(openg(?:20|7))\b/giu
    )
  ];
  const formats = collect(
    'format',
    /\bformat(?:\s+|\s*[:=]\s*)(collective_text|individual_portrait|collective_composite|image_collection|texte collectif|collective text|portrait individuel|individual portrait|composition collective|collective composite|collection d['’]images|image collection)\b/giu
  );
  collect(
    'word_count',
    /(?<![\p{L}\p{N}_])\d+(?:[\u0020\u00a0\u202f]\d{3})*(?:\s*(?:[–—-]|à|to)\s*\d+(?:[\u0020\u00a0\u202f]\d{3})*)?\s*(?:mots|words?)\b/giu
  );
  collect(
    'visual_count',
    /(?<![\p{L}\p{N}_])(?:\d+|un|une|one|deux|two|trois|three|quatre|four|cinq|five|six|sept|seven|huit|eight|neuf|nine|dix|ten)\s+(?:visuels?|images?|photos?|visuals?|pictures?)\b/giu
  );
  collect('hashtag', /#[\p{L}\p{N}_]+|\bhashtags?\b/giu);
  collect(
    'delivery_deadline',
    /\b(?:dans(?:\s+un\s+d[ée]lai\s+de)?|sous|within|under|d[ée]lai(?:\s+de)?|deadline(?:\s+of)?)\s+\d+\s*(?:h(?:eures?)?|hours?|jours?|days?)\b/giu
  );
  if (nature === 'proof')
    collect(
      'delivery_deadline',
      /\b\d+\s*(?:h(?:eures?)?|hours?|jours?|days?)\b/giu
    );
  collect(
    'unsupported_term',
    /(?<![\p{L}\p{M}\p{N}_])(?:articles?|carrousels?|carousels?|natif|native|exclusivit(?:é|e\u0301|e)|exclusivity|exclusive|livraison|delivery|mots|words?|visuels?|screenshots?|captures?|preuves?|proof|hashtags?)(?![\p{L}\p{M}\p{N}_])/giu
  );
  const unknownFormats = [
    ...text.matchAll(/\bformat\b[^,;.\r\n]{0,80}/giu)
  ].filter((match) => !formats.some((known) => known.index === match.index));
  for (const match of unknownFormats) {
    const start = item.citation.start + match.index;
    facts.push({
      kind: 'unsupported_term',
      citation: {
        ...item.citation,
        start,
        end: start + match[0].length,
        excerpt: match[0]
      }
    });
  }

  const searchable = text.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const ambiguous =
    /\b(?:pas|jamais|sans|aucun(?:e)?s?|non|not|no|none|never|neither|nor|cannot|without|si|if|unless|exemple|example|hypothese|conditions?|conditionnel|conditionnelle|pourrait|pourra|pourront|peut|peuvent|possible|may|might|could|should|devrait|eventuellement|optional|optionnel|environ|maximum|minimum|approx(?:imately)?|about|ignore|oublie|execute|fetch|visite|visit|system|assistant|instructions?|prompt|commande|command|curl|javascript|ou|or)\b|\b(?:won|can|don|doesn|isn|aren|wasn|weren|wouldn|shouldn|couldn)['’]t\b|\bau moins\b|\bat least\b|\bup to\b|jusqu['’]|\b(?:par|per)\s+(?:jour|day|semaine|week|mois|month|an|year)/iu.test(
      searchable
    ) ||
    (proofs.length > 0 && quantities.length > 0);
  if (ambiguous) gaps.add('ambiguous_context');

  let quantity: number | null = null;
  let target: PreparationAssistanceStructuredItem['target'] = null;
  let format: SponsorshipPublicationFormat | null = null;
  if (nature === 'publication') {
    const scopedChannel =
      /\b(?:facebook|linkedin|web|website)\s+(?:publications?|posts?|articles?)\b|\b(?:publications?|posts?|articles?|publier|publiera|publieront|publish|publishes)\s+(?:(?:sur|on|pour|for)\s+)?(?:(?:le|la|the)\s+)?(?:site(?:\s+web)?|website|web|facebook|linkedin)\b/iu.test(
        text
      );
    if (!item.channels.length) gaps.add('channel_missing');
    if (
      item.channels.length > 1 ||
      (item.channels.length === 1 && !scopedChannel)
    )
      gaps.add('channel_ambiguous');
    const candidate =
      quantities.length === 1 ? quantities[0]![1]!.toLowerCase() : null;
    const count =
      candidate === null
        ? null
        : (quantityWords[candidate] ??
          Number(candidate.replace(/[\u0020\u00a0\u202f]/g, '')));
    const unknownNumbers = [
      ...text.matchAll(
        /\d+|\b(?:un|une|one|deux|two|trois|three|quatre|four|cinq|five|six|sept|seven|huit|eight|neuf|nine|dix|ten)\b/giu
      )
    ].some(
      (number) =>
        !facts.some(
          ({ citation }) =>
            number.index >= citation.start - item.citation.start &&
            number.index + number[0].length <=
              citation.end - item.citation.start
        )
    );
    const exactCount =
      quantities.length === 1 &&
      quantities[0]![2] === undefined &&
      Number.isSafeInteger(count) &&
      count! >= 1 &&
      count! <= 100;
    const quantityClause = quantities.length === 1 ? quantities[0]! : null;
    const quantityChannelBound =
      quantityClause !== null &&
      (/\b(?:facebook|linkedin|web|website)\s+(?:publications?|posts?|articles?)$/iu.test(
        quantityClause[0]
      ) ||
        /^\s+(?:(?:sur|on|pour|for)\s+)?(?:(?:le|la|the)\s+)?(?:site(?:\s+web)?|website|web|facebook|linkedin)\b/iu.test(
          text.slice(quantityClause.index + quantityClause[0].length)
        ));
    if (!quantities.length) gaps.add('quantity_missing');
    if (
      (quantities.length && !exactCount) ||
      unknownNumbers ||
      item.channels.length > 1 ||
      (quantities.length > 0 && !quantityChannelBound)
    )
      gaps.add('quantity_ambiguous');
    if (
      !ambiguous &&
      item.channels.length === 1 &&
      scopedChannel &&
      quantityChannelBound &&
      exactCount &&
      !unknownNumbers
    )
      quantity = count;
    const targetValues = [
      ...new Set(targets.map((match) => match[0].toLowerCase()))
    ];
    if (!destinations.length) gaps.add('target_missing');
    if (targetValues.length > 1) gaps.add('target_ambiguous');
    if (
      !ambiguous &&
      item.channels.length === 1 &&
      scopedChannel &&
      destinations.length &&
      targetValues.length === 1
    )
      target =
        destinations[0]![1]!.toLowerCase() as PreparationAssistanceStructuredItem['target'];
    const formatValues = [
      ...new Set(
        formats.map(
          (match) => formatNames[match[1]!.toLowerCase().replace('’', "'")]
        )
      )
    ];
    if (!formats.length) gaps.add('format_missing');
    const knownFormat = formatValues.length === 1 ? formatValues[0]! : null;
    const availableFormat =
      knownFormat !== null &&
      item.channels.length === 1 &&
      scopedChannel &&
      publicationFormatCapability(item.channels[0]!, knownFormat).available;
    if (
      formatValues.length > 1 ||
      unknownFormats.length ||
      (knownFormat !== null && !availableFormat)
    )
      gaps.add('format_ambiguous');
    if (!ambiguous && availableFormat && !unknownFormats.length)
      format = knownFormat;
  }
  const outside =
    nature !== 'publication' ||
    unknownFormats.length > 0 ||
    gaps.has('format_ambiguous') ||
    facts.some(({ kind }) =>
      [
        'word_count',
        'visual_count',
        'hashtag',
        'delivery_deadline',
        'unsupported_term'
      ].includes(kind)
    );
  if (outside) gaps.add('outside_offer_model');
  const uniqueFacts = facts.filter(
    (fact, index) =>
      !facts
        .slice(0, index)
        .some(
          (earlier) =>
            earlier.kind === fact.kind &&
            earlier.citation.start === fact.citation.start &&
            earlier.citation.end === fact.citation.end
        )
  );
  uniqueFacts.sort(
    (left, right) =>
      left.citation.start - right.citation.start ||
      left.citation.end - right.citation.end ||
      left.kind.localeCompare(right.kind, 'en')
  );
  return {
    ...item,
    attention: outside ? 'unsupported_terms' : item.attention,
    structured: {
      version: 1,
      nature,
      quantity,
      target,
      format,
      facts: uniqueFacts,
      gaps: [...gaps]
    }
  };
}

/** Check persisted provenance again before exposing or applying a proposal. */
export function preparationCitationsMatch(
  source: PreparationAssistanceSource,
  suggestion: PreparationAssistanceSuggestion
): boolean {
  if (suggestion?.adapter === PREPARATION_ASSISTANCE_STRUCTURED_ADAPTER) {
    try {
      return sameJsonValue(
        suggestion,
        extractStructuredPreparationPublications(source)
      );
    } catch {
      return false;
    }
  }
  if (
    !hasExactKeys(suggestion, [
      'adapter',
      'items',
      'limitations',
      'proposedOffer'
    ]) ||
    suggestion.proposedOffer !== null ||
    !Array.isArray(suggestion.items) ||
    !Array.isArray(suggestion.limitations) ||
    suggestion.limitations.some((value) => typeof value !== 'string') ||
    suggestion.items.some(
      (item) =>
        !hasExactKeys(item, ['id', 'citation', 'channels', 'attention']) ||
        typeof item.id !== 'string' ||
        !item.id ||
        !['human_mapping_required', 'unsupported_terms'].includes(
          item.attention
        ) ||
        !Array.isArray(item.channels) ||
        new Set(item.channels).size !== item.channels.length ||
        item.channels.some(
          (channel: unknown) =>
            typeof channel !== 'string' ||
            !['website', 'facebook', 'linkedin'].includes(channel)
        ) ||
        !hasExactKeys(item.citation, [
          'sourceId',
          'sourceVersion',
          'start',
          'end',
          'excerpt'
        ])
    )
  )
    return false;
  const spans = [...source.text.matchAll(/[^\r\n]+/g)]
    .filter((match) => match[0].trim().length > 0)
    .map((match) => {
      const excerpt = match[0].trim();
      return {
        start: match.index + match[0].indexOf(excerpt),
        end: match.index + match[0].indexOf(excerpt) + excerpt.length
      };
    });
  return (
    suggestion.adapter === PREPARATION_ASSISTANCE_ADAPTER &&
    suggestion.items.length > 0 &&
    suggestion.items.length <= PREPARATION_SOURCE_MAX_ITEMS &&
    new Set(suggestion.items.map((item) => item.id)).size ===
      suggestion.items.length &&
    spans.length === suggestion.items.length &&
    spans.every(
      (span) =>
        suggestion.items.filter(
          ({ citation }) =>
            citation.start === span.start && citation.end === span.end
        ).length === 1
    ) &&
    suggestion.items.every(
      ({ citation }) =>
        citation.sourceId === source.id &&
        citation.sourceVersion === source.version &&
        Number.isSafeInteger(citation.start) &&
        Number.isSafeInteger(citation.end) &&
        citation.start >= 0 &&
        citation.end > citation.start &&
        citation.end <= source.text.length &&
        source.text.slice(citation.start, citation.end) === citation.excerpt
    )
  );
}

/** JSONB may reorder object keys; array order and every value remain significant. */
function sameJsonValue(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) => sameJsonValue(actual[index], value))
    );
  if (expected && typeof expected === 'object') {
    const record = expected as Record<string, unknown>;
    return (
      hasExactKeys(actual, Object.keys(record)) &&
      Object.entries(record).every(([key, value]) =>
        sameJsonValue((actual as Record<string, unknown>)[key], value)
      )
    );
  }
  return false;
}

function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('ASSISTANCE_REVIEW_INVALID');
  return value as Record<string, unknown>;
};
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error('ASSISTANCE_REVIEW_INVALID');
};

/** A draft may remain incomplete. Applying requires every clause to be resolved. */
export function normalizePreparationAssistanceDraft(
  raw: unknown,
  suggestion: PreparationAssistanceSuggestion,
  options: { readonly requireResolved?: boolean } = {}
): PreparationAssistanceDraft {
  const value = object(raw);
  exactKeys(value, ['offer', 'items', 'reason']);
  if (
    !Array.isArray(value.items) ||
    value.items.length !== suggestion.items.length ||
    typeof value.reason !== 'string' ||
    value.reason.length > 2_000
  )
    throw new Error('ASSISTANCE_REVIEW_INVALID');
  const offer =
    value.offer === null
      ? null
      : normalizeSponsorshipOfferSnapshot(value.offer);
  const seen = new Set<string>();
  const items = value.items.map((rawItem): PreparationAssistanceResolution => {
    const item = object(rawItem);
    exactKeys(item, ['itemId', 'disposition', 'benefitId', 'note']);
    if (
      typeof item.itemId !== 'string' ||
      seen.has(item.itemId) ||
      !suggestion.items.some((sourceItem) => sourceItem.id === item.itemId) ||
      !['unresolved', 'included', 'excluded', 'unsupported'].includes(
        String(item.disposition)
      ) ||
      typeof item.disposition !== 'string' ||
      typeof item.note !== 'string' ||
      item.note.length > 2_000 ||
      (item.benefitId !== null &&
        !offer?.benefits.some((benefit) => benefit.id === item.benefitId))
    )
      throw new Error('ASSISTANCE_REVIEW_INVALID');
    seen.add(item.itemId);
    const result: PreparationAssistanceResolution = {
      itemId: item.itemId,
      disposition:
        item.disposition as PreparationAssistanceResolution['disposition'],
      benefitId: item.benefitId as SponsorshipBenefitId | null,
      note: item.note.trim()
    };
    if (
      options.requireResolved &&
      (result.disposition === 'unresolved' ||
        result.disposition === 'unsupported' ||
        (result.disposition === 'included' &&
          (result.benefitId === null ||
            suggestion.items.find((item) => item.id === result.itemId)
              ?.attention === 'unsupported_terms')) ||
        (result.disposition === 'excluded' &&
          (result.note.length < 5 || result.benefitId !== null)))
    )
      throw new Error('ASSISTANCE_REVIEW_UNRESOLVED');
    return result;
  });
  if (
    options.requireResolved &&
    (!offer ||
      offer.version !== 'historical-qualification-v1' ||
      value.reason.trim().length < 5 ||
      offer.benefits.some(
        (benefit) =>
          !items.some(
            (item) =>
              item.disposition === 'included' && item.benefitId === benefit.id
          )
      ))
  )
    throw new Error('ASSISTANCE_REVIEW_UNRESOLVED');
  return { offer, items, reason: value.reason.trim() };
}
