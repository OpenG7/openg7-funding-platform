// This optional provider has its own credentials; it never shares the funding DB.
export function keycloakEnabled(env) {
  const value = env.FUNDING_KEYCLOAK_ENABLED ?? 'false';
  if (!['true', 'false'].includes(value))
    throw new Error('FUNDING_KEYCLOAK_ENABLED must be true or false.');
  return value === 'true';
}

export function validateKeycloakInitialUserConfig(env) {
  const username = env.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME ?? '';
  const password = env.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD ?? '';
  if (!username && !password) return false;
  if (!username || !password)
    throw new Error(
      'Initial Keycloak user requires both FUNDING_KEYCLOAK_INITIAL_USER_USERNAME and FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD.'
    );
  if (
    env.FUNDING_PLATFORM_ENV !== 'development' ||
    env.FUNDING_KEYCLOAK_HOSTNAME !== 'auth.openg7.test' ||
    env.FUNDING_KEYCLOAK_ENABLED !== 'true' ||
    env.COMPOSE_FILE
  )
    throw new Error(
      'Initial Keycloak user preparation is restricted to managed local development.'
    );
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,127}$/.test(username))
    throw new Error(
      'FUNDING_KEYCLOAK_INITIAL_USER_USERNAME must be a valid username of at most 128 characters.'
    );
  if (password.trim().length < 14 || /[\r\n\0]/.test(password))
    throw new Error(
      'FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD must contain at least 14 characters without CR, LF or NUL.'
    );
  if (
    [
      env.FUNDING_ADMIN_OIDC_CLIENT_SECRET,
      env.FUNDING_KEYCLOAK_DB_PASSWORD,
      env.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD
    ].includes(password)
  )
    throw new Error(
      'The initial user password must be distinct from Keycloak database, bootstrap and OIDC secrets.'
    );
  return true;
}

export function validateKeycloakConfig(env) {
  if (!keycloakEnabled(env)) return false;
  const hostname = env.FUNDING_KEYCLOAK_HOSTNAME ?? '';
  if (
    hostname.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      hostname
    )
  )
    throw new Error('FUNDING_KEYCLOAK_HOSTNAME must be a DNS hostname.');

  let origin;
  try {
    origin = new URL(env.FUNDING_PUBLIC_BASE_URL ?? '');
  } catch {
    // URL errors can contain their input, including credentials. Never forward them.
    throw new Error('FUNDING_PUBLIC_BASE_URL must be an HTTPS origin.');
  }
  if (
    origin.protocol !== 'https:' ||
    env.FUNDING_PUBLIC_BASE_URL !== origin.origin ||
    origin.hostname === hostname
  )
    throw new Error(
      'FUNDING_PUBLIC_BASE_URL must be a separate HTTPS origin without a trailing slash.'
    );
  if ((env.FUNDING_ADMIN_AUTH_MODE ?? 'oidc') !== 'oidc')
    throw new Error(
      'The Keycloak overlay requires FUNDING_ADMIN_AUTH_MODE=oidc.'
    );
  if (env.FUNDING_ADMIN_OIDC_ISSUER !== `https://${hostname}/realms/openg7`)
    throw new Error(
      'FUNDING_ADMIN_OIDC_ISSUER must match the openg7 realm on the configured hostname.'
    );
  if (env.FUNDING_ADMIN_OIDC_MFA_ACR?.trim())
    throw new Error(
      'FUNDING_ADMIN_OIDC_MFA_ACR must be empty for the imported Keycloak AMR profile.'
    );
  if (!env.FUNDING_ADMIN_OIDC_CLIENT_ID?.trim())
    throw new Error('FUNDING_ADMIN_OIDC_CLIENT_ID is required.');
  if (!env.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME?.trim())
    throw new Error('FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME is required.');
  const names = [
    'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
    'FUNDING_KEYCLOAK_DB_PASSWORD',
    'FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD'
  ];
  const secrets = names.map((name) => {
    const value = env[name] ?? '';
    if (value.trim().length < 32)
      throw new Error(`${name} must contain at least 32 characters.`);
    return value;
  });
  if (new Set(secrets).size !== secrets.length)
    throw new Error(
      'Keycloak database, bootstrap and OIDC secrets must be distinct.'
    );
  validateKeycloakInitialUserConfig(env);
  return true;
}
