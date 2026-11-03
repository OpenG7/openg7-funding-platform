import { createHash } from 'node:crypto';

export interface ProducerSettings {
  readonly enabled: boolean;
  readonly tenantId: string;
  readonly maxCostUsd: number;
}
/** Disabled configuration has no DB or external effects, including on payment replay. */
export function producerSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ProducerSettings {
  if (env.PREFLIGHT_ENABLED !== 'true')
    return { enabled: false, tenantId: '', maxCostUsd: 0 };
  const tenantId = (env.PREFLIGHT_TENANT_ID ?? '').trim();
  const maxCostUsd = Number(env.PREFLIGHT_MAX_COST_USD ?? '0.5');
  if (
    !tenantId ||
    tenantId.length > 128 ||
    !Number.isFinite(maxCostUsd) ||
    maxCostUsd < 0 ||
    maxCostUsd > 100
  )
    throw new Error('PREFLIGHT_SOURCE_CONFIGURATION_INVALID');
  return { enabled: true, tenantId, maxCostUsd };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const snapshotHash = (value: unknown): string =>
  createHash('sha256').update(stableJson(value)).digest('hex');

export interface FundingSourceSnapshot {
  readonly commitmentId: string;
  readonly contributionId: string;
  readonly commitmentVersion: number;
  readonly offerFingerprint: string;
  readonly eligible: boolean;
  readonly paymentStatus: string;
  readonly refundStatus: string;
  readonly consent: boolean;
  readonly reviewStatus: string;
  readonly title: string;
  readonly description: string;
  readonly benefits: readonly string[];
  readonly obligations: readonly {
    id: string;
    version: number;
    state: string;
  }[];
}

export function preparationInput(
  snapshot: FundingSourceSnapshot,
  digest: string
): Record<string, unknown> {
  return {
    title: snapshot.title,
    description: snapshot.description,
    benefits: [...snapshot.benefits],
    sourceSnapshotDigest: digest,
    sourceCommitmentVersion: snapshot.commitmentVersion,
    preparationOnly: true
  };
}
