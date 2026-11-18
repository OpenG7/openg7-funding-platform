import type { ModerationSubjectType } from '@openg7/funding-core';

export interface ModerationPreviewField {
  readonly key: string;
  readonly labelKey: string | null;
  readonly number: number | null;
  readonly value: string | null;
  readonly children: readonly ModerationPreviewField[];
  readonly multiline: boolean;
}

const subjectFields: Record<ModerationSubjectType, readonly string[]> = {
  sponsorship: [
    'publicName',
    'companyName',
    'website',
    'message',
    'publicSummary',
    'publicSlug',
    'logoUrl'
  ],
  media: [
    'kind',
    'altText',
    'width',
    'height',
    'usage',
    'effectiveRule',
    'deletedAt'
  ],
  publication_draft: [
    'title',
    'body',
    'disclosure',
    'feedTarget',
    'channel',
    'sponsor'
  ],
  publication_delivery: [
    'message',
    'feedId',
    'accountId',
    'mode',
    'media',
    'sources',
    'preparedMedia',
    'visual'
  ]
};
const translatedFields = new Set([
  ...Object.values(subjectFields).flat(),
  'id',
  'contributionId',
  'content'
]);
const multilineFields = new Set([
  'message',
  'body',
  'disclosure',
  'altText',
  'publicSummary'
]);
const evidenceOnlyFields = new Set([
  'id',
  'contributionId',
  'checksum',
  'hash',
  'sourceHash',
  'derivedHash',
  'fingerprint',
  'storageKey',
  'originalStorageKey',
  'usageAcceptanceId',
  'documentedConsentRecordId',
  'obligationId',
  'version'
]);

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectFields(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): readonly ModerationPreviewField[] {
  return keys
    .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
    .map((key) => field(key, value[key]));
}

function field(
  key: string,
  value: unknown,
  number: number | null = null,
  source = false
): ModerationPreviewField {
  let children: readonly ModerationPreviewField[] = [];
  let text: string | null = null;
  if (Array.isArray(value)) {
    children = value.map((item, index) =>
      field(
        String(index),
        item,
        index + 1,
        key === 'sources' &&
          record(item) &&
          Object.prototype.hasOwnProperty.call(item, 'content')
      )
    );
    if (!value.length) text = '[]';
  } else if (record(value)) {
    const keys = source
      ? ['id', 'contributionId', 'content']
      : key === 'sponsor'
        ? subjectFields.sponsorship
        : key === 'content'
          ? subjectFields.publication_draft
          : Object.keys(value).filter((name) => !evidenceOnlyFields.has(name));
    children = objectFields(value, keys);
    if (!Object.keys(value).length) text = '{}';
  } else if (typeof value === 'string') {
    text = value === '' ? null : value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    text = String(value);
  }
  return {
    key,
    labelKey:
      number === null && translatedFields.has(key)
        ? `admin.moderation.fields.${key}`
        : null,
    number,
    value: text,
    children,
    multiline:
      multilineFields.has(key) || (text !== null && /[\r\n]/u.test(text))
  };
}

/** Human-readable content only; the complete snapshot remains the exact evidence. */
export function moderationPreviewFields(
  snapshot: Readonly<Record<string, unknown>>,
  subjectType: ModerationSubjectType
): readonly ModerationPreviewField[] {
  return objectFields(snapshot, subjectFields[subjectType]);
}
