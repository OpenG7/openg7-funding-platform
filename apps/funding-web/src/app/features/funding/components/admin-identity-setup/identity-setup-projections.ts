import type { AdminIdentitySetupStatus } from '@openg7/funding-core';

export type IdentityConfigurationState =
  'configured' | 'incomplete' | 'unknown' | 'token';

export const IDENTITY_GUIDE_STEPS = [
  'provider',
  'client',
  'environment',
  'database',
  'mfa',
  'deployment',
  'verification'
] as const;
export type IdentityGuideStep = (typeof IDENTITY_GUIDE_STEPS)[number];
export type IdentityGuideObservation =
  'reported' | 'missing' | 'unknown' | 'manual';
export type IdentityGuideObservations = Readonly<
  Record<IdentityGuideStep, IdentityGuideObservation>
>;

/** Configuration presence only; no provider request or MFA verification. */
export function projectIdentityConfiguration(
  status: AdminIdentitySetupStatus | null | undefined
): IdentityConfigurationState {
  if (!status) return 'unknown';
  if (status.mode === 'token') return 'token';
  return status.issuer?.trim() &&
    status.callback_url?.trim() &&
    status.client_id_configured &&
    status.client_secret_configured &&
    status.private_data_encryption_configured
    ? 'configured'
    : 'incomplete';
}

/** Local observations cannot confirm provider, MFA, deployment or access checks. */
export function projectIdentityGuideObservations(
  status: AdminIdentitySetupStatus | null | undefined,
  databaseConfigured: boolean | null,
  databaseReachable: boolean | null
): IdentityGuideObservations {
  const reported = (configured: boolean): IdentityGuideObservation =>
    configured ? 'reported' : 'missing';
  const local: IdentityGuideObservation = !status
    ? 'unknown'
    : status.mode === 'token'
      ? 'manual'
      : reported(projectIdentityConfiguration(status) === 'configured');
  return {
    provider: 'manual',
    client:
      !status || status.mode === 'token'
        ? local
        : reported(
            status.client_id_configured &&
              status.client_secret_configured &&
              Boolean(status.callback_url)
          ),
    environment: local,
    database:
      databaseConfigured === null || databaseReachable === null
        ? 'unknown'
        : reported(databaseConfigured === true && databaseReachable === true),
    mfa: 'manual',
    deployment: 'manual',
    verification: 'manual'
  };
}
