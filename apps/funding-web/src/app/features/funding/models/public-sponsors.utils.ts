import type { PublicSponsorshipsResponse } from '@openg7/funding-core';

export function publicHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Public media can use the same-origin media endpoint or an approved HTTPS host. */
export function publicMediaUrl(value: unknown): string | null {
  if (
    typeof value === 'string' &&
    /^\/api\/public\/sponsor-(media|logos)\/[a-zA-Z0-9._-]+$/.test(value)
  )
    return value;
  return publicHttpsUrl(value);
}

export function isPublicSponsorshipsResponse(
  value: unknown
): value is PublicSponsorshipsResponse {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const nullableText = (v: unknown) => v === null || typeof v === 'string';
  if (
    !['database', 'empty'].includes(String(data['data_source'])) ||
    typeof data['last_updated_at'] !== 'string' ||
    !Number.isFinite(Date.parse(data['last_updated_at'])) ||
    !Array.isArray(data['sponsorships'])
  )
    return false;
  if (data['data_source'] === 'empty' && data['sponsorships'].length > 0)
    return false;
  if (
    !data['sponsorships'].every((row: unknown) => {
      if (!row || typeof row !== 'object') return false;
      const p = row as Record<string, unknown>;
      return (
        typeof p['company_name'] === 'string' &&
        p['company_name'].trim().length > 0 &&
        (p['public_id'] === undefined ||
          (typeof p['public_id'] === 'string' && p['public_id'].length > 0)) &&
        [
          'public_slug',
          'website_url',
          'logo_url',
          'message',
          'public_summary',
          'feed_public_url'
        ].every((k) => nullableText(p[k])) &&
        (p['amount'] === null ||
          (typeof p['amount'] === 'number' &&
            Number.isFinite(p['amount']) &&
            p['amount'] >= 0)) &&
        typeof p['currency'] === 'string' &&
        /^[A-Z]{3}$/.test(p['currency']) &&
        ['not_planned', 'planned', 'drafted', 'published'].includes(
          String(p['feed_status'])
        ) &&
        [null, 'openg7', 'openg20'].includes(
          p['feed_target'] as null | string
        ) &&
        Array.isArray(p['feed_channels']) &&
        p['feed_channels'].every((c) => ['facebook', 'linkedin'].includes(c)) &&
        Array.isArray(p['media']) &&
        p['media'].every((asset: unknown) => {
          if (!asset || typeof asset !== 'object') return false;
          const a = asset as Record<string, unknown>;
          return (
            typeof a['id'] === 'string' &&
            ['logo', 'supporting_image'].includes(String(a['kind'])) &&
            typeof a['url'] === 'string' &&
            typeof a['alt_text'] === 'string' &&
            Number.isSafeInteger(a['width']) &&
            Number(a['width']) > 0 &&
            Number.isSafeInteger(a['height']) &&
            Number(a['height']) > 0
          );
        })
      );
    })
  )
    return false;
  const ids = data['sponsorships']
    .map((p) => p.public_id)
    .filter((id) => id !== undefined);
  if (new Set(ids).size !== ids.length) return false;
  const pagination = data['pagination'];
  if (pagination === undefined) return true; // Older servers expose only their first page.
  if (!pagination || typeof pagination !== 'object') return false;
  const p = pagination as Record<string, unknown>;
  return (
    ['page', 'page_size', 'total_count', 'published_count'].every((k) =>
      Number.isSafeInteger(p[k])
    ) &&
    Number(p['page']) >= 1 &&
    Number(p['page']) <= 100_000 &&
    Number(p['page_size']) >= 1 &&
    Number(p['page_size']) <= 50 &&
    Number(p['total_count']) >= 0 &&
    Number(p['published_count']) >= 0 &&
    Number(p['published_count']) <= Number(p['total_count']) &&
    data['sponsorships'].length ===
      Math.max(
        0,
        Math.min(
          Number(p['page_size']),
          Number(p['total_count']) -
            (Number(p['page']) - 1) * Number(p['page_size'])
        )
      )
  );
}
