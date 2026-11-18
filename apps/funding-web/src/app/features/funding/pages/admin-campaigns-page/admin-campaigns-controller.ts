import type { AdminCampaignItem } from '@openg7/funding-core';

export type CampaignDetailAction =
  'preparation' | 'proof' | 'delivery' | 'owner';

/** Choose one reading destination; this projection grants no mutation or authority. */
export function campaignDetailAction(
  row: AdminCampaignItem,
  canApprovePreparation: boolean
): CampaignDetailAction {
  if (row.workflow.state === 'uncertain' || row.workflow.state === 'error')
    return row.workflow.deliveryId ? 'delivery' : 'owner';
  if (row.obligationState === 'adjusted' || row.workflow.state === 'complete')
    return 'proof';
  if (
    row.workflow.responsibility === 'admin' &&
    (canApprovePreparation || row.preparation.status !== 'approved')
  )
    return 'preparation';
  return row.workflow.deliveryId ? 'delivery' : 'owner';
}

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
