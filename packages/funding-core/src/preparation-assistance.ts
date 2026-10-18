import type { SponsorshipBenefitId } from './sponsorship-benefits.js';
import {
  normalizeSponsorshipOfferSnapshot,
  type SponsorshipObligationChannel,
  type SponsorshipOfferSnapshot
} from './sponsorship-offers.js';

export const PREPARATION_SOURCE_MAX_LENGTH = 16_000;
export const PREPARATION_SOURCE_MAX_ITEMS = 60;
export const PREPARATION_ASSISTANCE_ADAPTER = 'local_rules_v1' as const;

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
}

export interface PreparationAssistanceSuggestion {
  readonly adapter: typeof PREPARATION_ASSISTANCE_ADAPTER;
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
  readonly adapter: typeof PREPARATION_ASSISTANCE_ADAPTER;
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

/** Check persisted provenance again before exposing or applying a proposal. */
export function preparationCitationsMatch(
  source: PreparationAssistanceSource,
  suggestion: PreparationAssistanceSuggestion
): boolean {
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
