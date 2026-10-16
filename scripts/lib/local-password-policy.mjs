/** Explicit development exception; never infer it from browser request headers. */
export function validateLocalPasswordOnly(env) {
  const value = env.FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY ?? 'false';
  if (!['true', 'false'].includes(value))
    throw new Error(
      'FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY must be true or false.'
    );
  if (value === 'false') return false;
  let base;
  try {
    base = new URL(env.FUNDING_PUBLIC_BASE_URL);
  } catch {
    // URL exceptions can include private input.
  }
  if (
    env.FUNDING_PLATFORM_ENV !== 'development' ||
    env.FUNDING_ADMIN_AUTH_MODE !== 'oidc' ||
    env.FUNDING_KEYCLOAK_ENABLED !== 'true' ||
    env.FUNDING_KEYCLOAK_HOSTNAME !== 'auth.openg7.test' ||
    env.FUNDING_ADMIN_OIDC_ISSUER !==
      'https://auth.openg7.test/realms/openg7' ||
    env.FUNDING_ADMIN_OIDC_MFA_ACR?.trim() ||
    env.COMPOSE_FILE ||
    !base ||
    base.protocol !== 'https:' ||
    base.hostname !== 'localhost' ||
    base.port === '0' ||
    env.FUNDING_PUBLIC_BASE_URL !== base.origin
  )
    throw new Error(
      'Local password-only sign-in requires explicit development, managed HTTPS localhost Keycloak and no MFA ACR override or custom Compose files.'
    );
  return true;
}
