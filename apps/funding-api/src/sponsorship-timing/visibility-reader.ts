import { createHash } from 'node:crypto';

import type {
  SponsorshipPublicObservation,
  SponsorshipPublicObservationReason
} from '@openg7/funding-core';

import {
  PublicObservationHttpError,
  type PublicObservationGet,
  type PublicObservationResponse
} from './visibility-http.js';

export interface ExpectedPublicPresence {
  readonly contributionId: string;
  readonly sourceSnapshot: unknown;
  readonly mediaSnapshot: unknown;
  readonly nextDirectoryPage: number;
}

export interface PublicPresenceResult extends SponsorshipPublicObservation {
  readonly nextDirectoryPage: number;
  readonly requestCount: number;
}

/** Shared per-run ceiling. DNS, headers and body reading all spend the same deadline. */
export interface PublicObservationBudget {
  readonly deadline: number;
  remainingRequests: number;
  remainingBytes: number;
}

function expectedPresence(input: ExpectedPublicPresence) {
  const sources = input.sourceSnapshot;
  const media = input.mediaSnapshot;
  if (
    !Array.isArray(sources) ||
    sources.length !== 1 ||
    !Array.isArray(media) ||
    media.length > 10 ||
    !Number.isSafeInteger(input.nextDirectoryPage) ||
    input.nextDirectoryPage < 1 ||
    input.nextDirectoryPage > 100000
  )
    throw new PublicObservationHttpError('SOURCE_CHANGED');
  const source = sources[0] as Record<string, unknown> | null;
  if (
    !source ||
    source.id !== input.contributionId ||
    typeof source.company !== 'string' ||
    !(source.summary === null || typeof source.summary === 'string')
  )
    throw new PublicObservationHttpError('SOURCE_CHANGED');
  const images = media.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new PublicObservationHttpError('SOURCE_CHANGED');
    const image = raw as Record<string, unknown>;
    const usage = image.usage as Record<string, unknown> | undefined;
    if (
      typeof image.id !== 'string' ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(image.id) ||
      image.contributionId !== input.contributionId ||
      !['logo', 'supporting_image'].includes(String(image.kind)) ||
      typeof image.derivedHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(image.derivedHash) ||
      !usage ||
      !(usage.credit === null || typeof usage.credit === 'string')
    )
      throw new PublicObservationHttpError('SOURCE_CHANGED');
    return {
      id: image.id,
      hash: image.derivedHash,
      kind: image.kind,
      credit: usage.credit
    };
  });
  if (!images.some((image) => image.kind === 'supporting_image'))
    throw new PublicObservationHttpError('SOURCE_CHANGED');
  return {
    publicId: createHash('sha256')
      .update(`public-sponsor:${input.contributionId}`)
      .digest('hex'),
    company: source.company,
    summary: source.summary,
    images
  };
}

/** Each invocation searches at most two pages, resuming its durable page next time. */
export async function observePublicPresence(
  input: ExpectedPublicPresence,
  get: PublicObservationGet,
  budget: PublicObservationBudget
): Promise<PublicPresenceResult> {
  let requests = 0;
  let page = input.nextDirectoryPage;
  let status: number | null = null;
  const result = (
    state: PublicPresenceResult['status'],
    reason: SponsorshipPublicObservationReason
  ): PublicPresenceResult => ({
    checkedAt: new Date().toISOString(),
    status: state,
    reason,
    httpStatus: status,
    nextDirectoryPage: page,
    requestCount: requests
  });
  const read = async (
    path: string,
    limit: number,
    mime: string
  ): Promise<PublicObservationResponse> => {
    const remaining = budget.deadline - Date.now();
    if (
      remaining <= 0 ||
      budget.remainingRequests <= 0 ||
      budget.remainingBytes <= 0
    )
      throw new PublicObservationHttpError('CHECK_BUDGET_EXHAUSTED');
    budget.remainingRequests--;
    requests++;
    // An unsuccessful transport can already have consumed a large body. Reserve
    // its full allowance before I/O; refund only known unused bytes on success.
    const allowance = Math.min(limit, budget.remainingBytes);
    budget.remainingBytes -= allowance;
    const response = await get(path, allowance, Math.min(3000, remaining));
    if (
      !Number.isSafeInteger(response.status) ||
      response.status < 100 ||
      response.status > 599
    )
      throw new PublicObservationHttpError('HTTP_INVALID');
    status = response.status;
    if (response.status >= 300 && response.status < 400)
      throw new PublicObservationHttpError('HTTP_REDIRECT');
    if (response.body.byteLength > allowance)
      throw new PublicObservationHttpError('HTTP_TOO_LARGE');
    budget.remainingBytes += allowance - response.body.byteLength;
    if (
      response.status === 200 &&
      response.contentType.split(';')[0]?.trim().toLowerCase() !== mime
    )
      throw new PublicObservationHttpError('HTTP_INVALID');
    return response;
  };
  try {
    const expected = expectedPresence(input);
    for (let scanned = 0; scanned < 2; scanned++) {
      const response = await read(
        `/api/public/sponsorships?page=${page}&pageSize=50`,
        256 * 1024,
        'application/json'
      );
      if (response.status !== 200) return result('unknown', 'HTTP_ERROR');
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(response.body.toString('utf8')) as Record<
          string,
          unknown
        >;
      } catch {
        return result('unknown', 'HTTP_INVALID');
      }
      const pagination = payload?.pagination as
        Record<string, unknown> | undefined;
      if (
        payload?.data_source !== 'database' ||
        !Array.isArray(payload.sponsorships) ||
        payload.sponsorships.length > 50 ||
        !pagination ||
        pagination.page !== page ||
        pagination.page_size !== 50 ||
        !Number.isSafeInteger(pagination.total_count) ||
        (pagination.total_count as number) < 0
      )
        return result('unknown', 'HTTP_INVALID');
      const matching = payload.sponsorships.filter(
        (profile: unknown) =>
          profile !== null &&
          typeof profile === 'object' &&
          (profile as Record<string, unknown>).public_id === expected.publicId
      );
      if (matching.length > 1) return result('unknown', 'HTTP_INVALID');
      const profile = matching[0] as Record<string, unknown> | undefined;
      if (profile) {
        if (
          profile.company_name !== expected.company ||
          profile.public_summary !== expected.summary ||
          !Array.isArray(profile.media)
        )
          return result('changed', 'PUBLIC_CONTENT_CHANGED');
        for (const image of expected.images) {
          const matchingImages = profile.media.filter(
            (raw: unknown) =>
              raw &&
              typeof raw === 'object' &&
              (raw as Record<string, unknown>).id === image.id
          );
          const publicImage = matchingImages[0] as
            Record<string, unknown> | undefined;
          const path = `/api/public/sponsor-media/${image.id}`;
          if (
            matchingImages.length !== 1 ||
            !publicImage ||
            publicImage.kind !== image.kind ||
            publicImage.url !== path ||
            (publicImage.credit ?? null) !== image.credit
          )
            return result('changed', 'PUBLIC_CONTENT_CHANGED');
          const bytes = await read(path, 8 * 1024 * 1024, 'image/webp');
          if (bytes.status === 404)
            return result('not_visible', 'PUBLIC_MEDIA_MISSING');
          if (bytes.status !== 200) return result('unknown', 'HTTP_ERROR');
          if (
            createHash('sha256').update(bytes.body).digest('hex') !== image.hash
          )
            return result('changed', 'PUBLIC_MEDIA_CHANGED');
        }
        return result('visible', 'MATCH');
      }
      const lastPage = Math.max(
        1,
        Math.ceil((pagination.total_count as number) / 50)
      );
      page = page >= lastPage || page >= 100000 ? 1 : page + 1;
      if (lastPage === 1) break;
    }
    // Pages are not a single HTTP snapshot. Missing is never inferred as deletion.
    return result('unknown', 'PROFILE_NOT_OBSERVED');
  } catch (error) {
    return result(
      'unknown',
      error instanceof PublicObservationHttpError ? error.reason : 'HTTP_ERROR'
    );
  }
}
