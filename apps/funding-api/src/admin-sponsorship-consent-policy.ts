import type { AdminSponsorshipConsentRecordRequest } from '@openg7/funding-core';

import { SPONSORSHIP_PUBLIC_CONSENT_SCOPE } from '../../../packages/funding-core/src/admin-sponsorship-consent.js';

export class SponsorshipConsentError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409
  ) {
    super(code);
  }
}

export function consentCheck(
  value: unknown,
  code: string,
  status = 409
): asserts value {
  if (!value) throw new SponsorshipConsentError(code, status);
}

export const consentUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export const consentActor = (actor: string) =>
  consentCheck(
    typeof actor === 'string' && actor.trim().length > 0 && actor.length <= 200,
    'CONSENT_ACTOR_REQUIRED',
    403
  );

export function parseSponsorshipConsent(
  raw: unknown
): AdminSponsorshipConsentRecordRequest {
  consentCheck(
    raw && typeof raw === 'object' && !Array.isArray(raw),
    'CONSENT_INVALID_REQUEST',
    400
  );
  const value = raw as Record<string, unknown>;
  consentCheck(
    Object.keys(value).length === 8 &&
      Object.keys(value).every((key) =>
        [
          'contributionId',
          'expectedVersion',
          'requestId',
          'agreementReceived',
          'scope',
          'agreedOn',
          'evidenceReference',
          'confirmed'
        ].includes(key)
      ) &&
      consentUuid(value.contributionId) &&
      consentUuid(value.requestId) &&
      typeof value.expectedVersion === 'string' &&
      value.expectedVersion.trim().length > 0 &&
      value.expectedVersion.length <= 128 &&
      value.agreementReceived === true &&
      value.confirmed === true &&
      value.scope === SPONSORSHIP_PUBLIC_CONSENT_SCOPE &&
      typeof value.agreedOn === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.agreedOn) &&
      Number(value.agreedOn.slice(0, 4)) > 0 &&
      Number.isFinite(Date.parse(value.agreedOn + 'T00:00:00.000Z')) &&
      new Date(value.agreedOn + 'T00:00:00.000Z')
        .toISOString()
        .startsWith(value.agreedOn + 'T') &&
      typeof value.evidenceReference === 'string' &&
      value.evidenceReference.trim().length > 0 &&
      value.evidenceReference.trim().length <= 1000 &&
      !/[\u0000-\u001f\u007f]/.test(value.evidenceReference),
    'CONSENT_INVALID_REQUEST',
    400
  );
  return {
    contributionId: (value.contributionId as string).toLowerCase(),
    expectedVersion: value.expectedVersion as string,
    requestId: (value.requestId as string).toLowerCase(),
    agreementReceived: true,
    scope: SPONSORSHIP_PUBLIC_CONSENT_SCOPE,
    agreedOn: value.agreedOn as string,
    evidenceReference: (value.evidenceReference as string).trim(),
    confirmed: true
  };
}
