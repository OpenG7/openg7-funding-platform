import { createHash } from 'node:crypto';

import type { AdminPrivatePreparationPolicy } from '@openg7/funding-core';

import { AdminAutomaticRunError } from './admin-automatic-run-error.js';

export function parsePrivatePreparationPolicy(
  raw: unknown
): AdminPrivatePreparationPolicy | undefined {
  if (raw === undefined) return undefined;
  const value = raw as Record<string, unknown> | null;
  const fields = [
    'capability',
    'confirmed',
    'maxDossiers',
    'maxDrafts',
    'maxProviderCalls',
    'maxCostMinor',
    'costCurrency',
    'expiresAt'
  ];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((key) => !fields.includes(key)) ||
    value['capability'] !== 'private_preparation' ||
    value['confirmed'] !== true ||
    value['maxDossiers'] !== 1 ||
    value['maxProviderCalls'] !== 0 ||
    value['maxCostMinor'] !== 0 ||
    value['costCurrency'] !== 'CAD' ||
    !Number.isSafeInteger(value['maxDrafts']) ||
    Number(value['maxDrafts']) < 1 ||
    Number(value['maxDrafts']) > 4 ||
    typeof value['expiresAt'] !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value['expiresAt']) ||
    !Number.isFinite(Date.parse(value['expiresAt'])) ||
    new Date(value['expiresAt']).toISOString() !== value['expiresAt']
  )
    throw new AdminAutomaticRunError('RUN_POLICY_INVALID', 400);
  return {
    capability: 'private_preparation',
    confirmed: true,
    maxDossiers: 1,
    maxDrafts: Number(value['maxDrafts']),
    maxProviderCalls: 0,
    maxCostMinor: 0,
    costCurrency: 'CAD',
    expiresAt: value['expiresAt']
  };
}

/** Separate from the start UUID; stable across restarts and lost HTTP responses. */
export function privatePreparationRequestId(startRequestId: string): string {
  const hex = createHash('sha256')
    .update('private-preparation/v1:' + startRequestId.toLowerCase())
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
