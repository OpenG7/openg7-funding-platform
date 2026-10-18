import type { AdminCampaignItem } from '@openg7/funding-core';

/** Contiguous groups preserve every server sort, including interleaved due dates. */
export function groupCampaignRows(
  rows: readonly AdminCampaignItem[],
  grouped: boolean
): readonly {
  readonly id: string;
  readonly rows: readonly AdminCampaignItem[];
}[] {
  if (!grouped) return [{ id: '', rows }];
  const groups: { id: string; rows: AdminCampaignItem[] }[] = [];
  for (const row of rows) {
    const previous = groups.at(-1);
    if (previous?.rows[0].contributionId === row.contributionId)
      previous.rows.push(row);
    else groups.push({ id: `${row.contributionId}:${row.id}`, rows: [row] });
  }
  return groups;
}
