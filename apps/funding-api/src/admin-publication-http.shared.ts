import type { IncomingMessage, ServerResponse } from 'node:http';

import type { SponsorFeedChannel } from '@openg7/funding-core';

import type { createHttpTransport } from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

/** Shared transport ports; authorization still resolves API rights and database access. */
export interface AdminPublicationHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAccess: (
    request: ApiRequest,
    response: ApiResponse
  ) => boolean;
  readonly getAdminAuditActor: (request: ApiRequest) => string;
  readonly readBody: (
    request: ApiRequest,
    maxBytes?: number
  ) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly isValidUuid: (value: unknown) => value is string;
  readonly isAllowedSponsorFeedChannel: (
    value: unknown
  ) => value is SponsorFeedChannel;
  readonly isValidOptionalBoundedText: (
    value: unknown,
    maxLength: number
  ) => boolean;
  readonly reportFailure: (message: string, error: unknown) => void;
}

export const PUBLICATION_BATCH_NOTES_MAX_LENGTH = 500;
export const PUBLICATION_BATCH_MIN_CAPACITY = 1;
export const PUBLICATION_BATCH_MAX_CAPACITY = 50;
export const PUBLICATION_SLOT_DEFAULT_TIMEZONE = 'America/Toronto';
export const PUBLICATION_SLOT_TIMEZONE_MAX_LENGTH = 64;

export const isValidPublicationBatchCapacity = (
  value: unknown
): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= PUBLICATION_BATCH_MIN_CAPACITY &&
  value <= PUBLICATION_BATCH_MAX_CAPACITY;

export const isFutureDateString = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  Date.parse(value) > Date.now();

export const isValidPublicationSlotTimezone = (
  value: unknown
): value is string => {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > PUBLICATION_SLOT_TIMEZONE_MAX_LENGTH
  ) {
    return false;
  }

  try {
    new Intl.DateTimeFormat('fr-CA', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
};

export const normalizePublicationSlotTimezone = (value: unknown): string =>
  isValidPublicationSlotTimezone(value)
    ? value.trim()
    : PUBLICATION_SLOT_DEFAULT_TIMEZONE;

export const channelLabel = (channel: SponsorFeedChannel): string =>
  channel === 'linkedin' ? 'LinkedIn' : 'Facebook';
