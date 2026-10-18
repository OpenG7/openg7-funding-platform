/** Content suggestions never grant usage rights, moderation approval or publication authority. */
export const SPONSOR_MEDIA_ANALYSIS_VERSION = 'local_technical_v1';
export const SPONSOR_MEDIA_CLASSIFICATIONS = [
  'unknown',
  'photo',
  'logo',
  'illustration',
  'document'
] as const;
export type SponsorMediaClassification =
  (typeof SPONSOR_MEDIA_CLASSIFICATIONS)[number];
export const SPONSOR_MEDIA_ANALYSIS_SIGNALS = [
  'person_detected',
  'text_detected',
  'logo_detected',
  'sensitive_content',
  'low_resolution'
] as const;
export type SponsorMediaAnalysisSignal =
  (typeof SPONSOR_MEDIA_ANALYSIS_SIGNALS)[number];
export interface SponsorMediaAnalysisCapabilities {
  readonly technical: 'local';
  readonly vision: 'not_configured' | 'configured';
  readonly ocr: 'not_configured' | 'configured';
}
export interface SponsorMediaAnalysisSuggestion {
  readonly adapterVersion: string;
  readonly checksum: string;
  readonly capabilities: SponsorMediaAnalysisCapabilities;
  readonly technical: {
    readonly width: number;
    readonly height: number;
    readonly sizeBytes: number;
    readonly mimeType: 'image/webp';
  };
  readonly altText: string | null;
  readonly classification: SponsorMediaClassification;
  readonly signals: readonly SponsorMediaAnalysisSignal[];
  readonly limitations: readonly string[];
}
export interface SponsorMediaAnalysisDraft {
  readonly altText: string | null;
  readonly classification: SponsorMediaClassification;
}
export interface SponsorMediaAnalysisReview {
  readonly version: number;
  readonly decision: 'saved' | 'rejected' | 'accepted';
  readonly draft: SponsorMediaAnalysisDraft;
  readonly actor: string;
  readonly createdAt: string;
}
export interface SponsorMediaAnalysisRun {
  readonly id: string;
  readonly assetId: string;
  readonly checksum: string;
  readonly adapterVersion: string;
  readonly state:
    'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  readonly stale: boolean;
  readonly errorCode: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly suggestion: SponsorMediaAnalysisSuggestion | null;
  readonly review: SponsorMediaAnalysisReview | null;
}
export interface SponsorMediaAnalysisResponse {
  readonly contributionId: string;
  readonly capabilities: SponsorMediaAnalysisCapabilities;
  /** Latest generation for each asset; reads never enqueue jobs. */
  readonly runs: readonly SponsorMediaAnalysisRun[];
}
export interface SponsorMediaAnalysisReceipt {
  readonly found: boolean;
  readonly action?: 'run' | 'review';
  readonly resultId?: string;
}
export interface SponsorMediaAnalysisRequest {
  readonly requestId: string;
  readonly contributionId: string;
  readonly assetId: string;
  readonly expectedVersion: string;
  readonly rerun: boolean;
}
export interface SponsorMediaAnalysisReviewRequest {
  readonly requestId: string;
  readonly contributionId: string;
  readonly runId: string;
  readonly expectedVersion: string;
  readonly expectedReviewVersion: number;
  readonly decision: 'save' | 'reject' | 'accept';
  readonly confirmation: string;
  readonly draft: SponsorMediaAnalysisDraft;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) =>
  Object.keys(value).length === expected.length &&
  Object.keys(value).every((key) => expected.includes(key));
export function isSponsorMediaAnalysisDraft(
  value: unknown
): value is SponsorMediaAnalysisDraft {
  return (
    object(value) &&
    keys(value, ['altText', 'classification']) &&
    (value.altText === null ||
      (typeof value.altText === 'string' &&
        value.altText.length <= 300 &&
        !/[\u0000-\u001f\u007f]/u.test(value.altText))) &&
    SPONSOR_MEDIA_CLASSIFICATIONS.includes(
      value.classification as SponsorMediaClassification
    )
  );
}
/** Strict allowlist keeps supplier output and embedded image instructions out of legal/decision fields. */
export function validateSponsorMediaAnalysisSuggestion(
  value: unknown,
  checksum: string,
  adapterVersion: string
): value is SponsorMediaAnalysisSuggestion {
  if (
    !object(value) ||
    !keys(value, [
      'adapterVersion',
      'checksum',
      'capabilities',
      'technical',
      'altText',
      'classification',
      'signals',
      'limitations'
    ]) ||
    value.checksum !== checksum ||
    value.adapterVersion !== adapterVersion ||
    !isSponsorMediaAnalysisDraft({
      altText: value.altText,
      classification: value.classification
    })
  )
    return false;
  const caps = value.capabilities,
    technical = value.technical;
  return (
    object(caps) &&
    keys(caps, ['technical', 'vision', 'ocr']) &&
    caps.technical === 'local' &&
    ['not_configured', 'configured'].includes(String(caps.vision)) &&
    ['not_configured', 'configured'].includes(String(caps.ocr)) &&
    object(technical) &&
    keys(technical, ['width', 'height', 'sizeBytes', 'mimeType']) &&
    technical.mimeType === 'image/webp' &&
    ['width', 'height', 'sizeBytes'].every(
      (key) =>
        Number.isSafeInteger(technical[key]) && Number(technical[key]) > 0
    ) &&
    Number(technical.width) * Number(technical.height) <= 40_000_000 &&
    Array.isArray(value.signals) &&
    value.signals.length <= 5 &&
    new Set(value.signals).size === value.signals.length &&
    value.signals.every((signal) =>
      SPONSOR_MEDIA_ANALYSIS_SIGNALS.includes(signal)
    ) &&
    Array.isArray(value.limitations) &&
    value.limitations.length <= 20 &&
    value.limitations.every(
      (item) => typeof item === 'string' && item.length <= 200
    ) &&
    (caps.vision === 'configured' ||
      (value.altText === null &&
        value.classification === 'unknown' &&
        value.signals.every((signal) => signal === 'low_resolution')))
  );
}
/** Explicit copy only into a pristine local draft; acceptance is a separate server command. */
export function sponsorMediaAnalysisPrefill(
  run: SponsorMediaAnalysisRun | null,
  pristine: boolean
): SponsorMediaAnalysisDraft | null {
  if (
    !pristine ||
    !run ||
    run.stale ||
    run.state !== 'succeeded' ||
    !run.suggestion ||
    run.review?.decision === 'accepted' ||
    run.review?.decision === 'rejected' ||
    !validateSponsorMediaAnalysisSuggestion(
      run.suggestion,
      run.checksum,
      run.adapterVersion
    )
  )
    return null;
  return {
    altText: run.suggestion.altText,
    classification: run.suggestion.classification
  };
}
