/** Identity variables shared by operator guidance and the configuration table. */
export const IDENTITY_SETUP_ENV_KEYS = [
  'FUNDING_ADMIN_AUTH_MODE',
  'FUNDING_PUBLIC_BASE_URL',
  'FUNDING_ADMIN_OIDC_ISSUER',
  'FUNDING_ADMIN_OIDC_CLIENT_ID',
  'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
  'FUNDING_ADMIN_OIDC_OWNER_SUBJECTS',
  'FUNDING_ADMIN_OIDC_MFA_ACR',
  'FUNDING_PRIVATE_DATA_ENCRYPTION_KEY'
] as const;

export type IdentitySetupEnvKey = (typeof IDENTITY_SETUP_ENV_KEYS)[number];

// Encryption belongs to the database step; the authentication mode is explicit.
export const IDENTITY_GUIDE_ENVIRONMENT_EXAMPLES =
  IDENTITY_SETUP_ENV_KEYS.filter(
    (key) => key !== 'FUNDING_PRIVATE_DATA_ENCRYPTION_KEY'
  ).map((key) => (key === 'FUNDING_ADMIN_AUTH_MODE' ? `${key}=oidc` : key));
