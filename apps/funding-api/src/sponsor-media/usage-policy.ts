import type {
  SponsorMediaUsageChannel,
  SponsorMediaUsageTarget
} from '@openg7/funding-core';

/** SQL preselection only; byte preparation and dispatch still validate the normalized rights. */
export function confirmedMediaUsageSql(
  alias: string,
  channel?: SponsorMediaUsageChannel,
  target?: SponsorMediaUsageTarget
): string {
  const usage = `sponsor_media_effective_usage(${alias}.id)`;
  return `(${usage}->>'state'='confirmed'
    AND ${usage}->'transformations' ? 'technical'
    AND (${usage}->>'restrictions' IS NULL OR ${alias}.usage_restrictions_reviewed IS TRUE)
    ${channel ? `AND ${usage}->'channels' ? '${channel}'` : ''}
    ${target ? `AND ${usage}->'targets' ? '${target}'` : ''})`;
}
