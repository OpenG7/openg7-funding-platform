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
  return `(${alias}.usage_rights->>'state'='confirmed'
    AND ${alias}.usage_rights->'transformations' ? 'technical'
    AND (${alias}.usage_rights->>'restrictions' IS NULL OR ${alias}.usage_restrictions_reviewed IS TRUE)
    ${channel ? `AND ${alias}.usage_rights->'channels' ? '${channel}'` : ''}
    ${target ? `AND ${alias}.usage_rights->'targets' ? '${target}'` : ''})`;
}
