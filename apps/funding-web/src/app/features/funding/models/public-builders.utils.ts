import type { PublicBuildersResponse } from '@openg7/funding-core';

export function isPublicBuildersResponse(
  value: unknown
): value is PublicBuildersResponse {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  if (
    !['database', 'empty'].includes(String(d['data_source'])) ||
    typeof d['last_updated_at'] !== 'string' ||
    !Number.isFinite(Date.parse(d['last_updated_at'])) ||
    !Array.isArray(d['builders']) ||
    !d['pagination'] ||
    typeof d['pagination'] !== 'object'
  )
    return false;
  const p = d['pagination'] as Record<string, unknown>;
  if (
    !['page', 'page_size', 'total_count'].every((k) =>
      Number.isSafeInteger(p[k])
    ) ||
    Number(p['page']) < 1 ||
    Number(p['page']) > 100_000 ||
    Number(p['page_size']) < 1 ||
    Number(p['page_size']) > 50 ||
    Number(p['total_count']) < 0 ||
    (d['data_source'] === 'empty' &&
      (Number(p['total_count']) !== 0 || d['builders'].length !== 0))
  )
    return false;
  const ids = new Set<string>();
  return (
    d['builders'].length ===
      Math.max(
        0,
        Math.min(
          Number(p['page_size']),
          Number(p['total_count']) -
            (Number(p['page']) - 1) * Number(p['page_size'])
        )
      ) &&
    d['builders'].every((row: unknown) => {
      if (!row || typeof row !== 'object') return false;
      const b = row as Record<string, unknown>;
      if (
        typeof b['public_id'] !== 'string' ||
        !b['public_id'] ||
        ids.has(b['public_id'])
      )
        return false;
      ids.add(b['public_id']);
      return (
        typeof b['display_name'] === 'string' &&
        b['display_name'].trim().length > 0 &&
        ['personal_support', 'sponsorship_interest'].includes(
          String(b['contribution_type'])
        ) &&
        (b['amount'] === null ||
          (typeof b['amount'] === 'number' &&
            Number.isFinite(b['amount']) &&
            b['amount'] >= 0)) &&
        typeof b['currency'] === 'string' &&
        /^[A-Z]{3}$/.test(b['currency']) &&
        (b['paid_at'] === null ||
          (typeof b['paid_at'] === 'string' &&
            Number.isFinite(Date.parse(b['paid_at']))))
      );
    })
  );
}
