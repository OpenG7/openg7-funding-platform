import type { PublicBuildersResponse } from '@openg7/funding-core';

/** Both public directories require a complete, bounded page matching its totals. */
export function isPublicDirectoryPage(
  pagination: unknown,
  entriesCount: number
): pagination is PublicBuildersResponse['pagination'] &
  Record<string, unknown> {
  if (!pagination || typeof pagination !== 'object') return false;
  const page = pagination as Record<string, unknown>;
  return (
    ['page', 'page_size', 'total_count'].every((key) =>
      Number.isSafeInteger(page[key])
    ) &&
    Number(page['page']) >= 1 &&
    Number(page['page']) <= 100_000 &&
    Number(page['page_size']) >= 1 &&
    Number(page['page_size']) <= 50 &&
    Number(page['total_count']) >= 0 &&
    entriesCount ===
      Math.max(
        0,
        Math.min(
          Number(page['page_size']),
          Number(page['total_count']) -
            (Number(page['page']) - 1) * Number(page['page_size'])
        )
      )
  );
}
