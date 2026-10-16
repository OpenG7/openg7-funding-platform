/** A password-only OIDC exception for the isolated HTTPS development stack. */
export const loadLocalPasswordOnly = (env: NodeJS.ProcessEnv): boolean => {
  const value = env.FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY;
  if (value === undefined || value === 'false') return false;
  if (value !== 'true')
    throw new Error(
      'FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY must be true or false.'
    );

  const invalid =
    'Local password-only OIDC requires the explicit development localhost Keycloak profile without an MFA ACR.';
  let base: URL;
  try {
    base = new URL(env.FUNDING_PUBLIC_BASE_URL ?? '');
  } catch {
    throw new Error(invalid);
  }
  if (
    env.FUNDING_PLATFORM_ENV !== 'development' ||
    env.FUNDING_ADMIN_AUTH_MODE !== 'oidc' ||
    env.FUNDING_KEYCLOAK_ENABLED !== 'true' ||
    env.FUNDING_KEYCLOAK_HOSTNAME !== 'auth.openg7.test' ||
    env.FUNDING_ADMIN_OIDC_ISSUER !==
      'https://auth.openg7.test/realms/openg7' ||
    Boolean(env.FUNDING_ADMIN_OIDC_MFA_ACR?.trim()) ||
    base.protocol !== 'https:' ||
    base.hostname !== 'localhost' ||
    base.port === '0' ||
    env.FUNDING_PUBLIC_BASE_URL !== base.origin
  )
    throw new Error(invalid);
  return true;
};
