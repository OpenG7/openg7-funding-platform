// This optional provider has its own credentials; it never shares the funding DB.
export function keycloakEnabled(env) {
  const value = env.FUNDING_KEYCLOAK_ENABLED ?? 'false';
  if (!['true', 'false'].includes(value))
    throw new Error('FUNDING_KEYCLOAK_ENABLED must be true or false.');
  return value === 'true';
}

export function keycloakProvisionUserEnabled(env) {
  const value = env.FUNDING_KEYCLOAK_PROVISION_USER ?? 'false';
  if (!['true', 'false'].includes(value))
    throw new Error('FUNDING_KEYCLOAK_PROVISION_USER must be true or false.');
  return value === 'true';
}

export function validateKeycloakInitialUserConfig(env) {
  const provisioning = keycloakProvisionUserEnabled(env);
  const username = env.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME ?? '';
  const password = env.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD ?? '';
  if (!username && !password && !provisioning) return false;
  if (!username || !password)
    throw new Error(
      'Initial Keycloak user requires both FUNDING_KEYCLOAK_INITIAL_USER_USERNAME and FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD.'
    );
  if (
    !(
      (env.FUNDING_PLATFORM_ENV === 'development' &&
        env.FUNDING_KEYCLOAK_HOSTNAME === 'auth.openg7.test') ||
      (provisioning && env.FUNDING_PLATFORM_ENV === 'production')
    ) ||
    env.FUNDING_KEYCLOAK_ENABLED !== 'true' ||
    env.COMPOSE_FILE
  )
    throw new Error(
      'Initial Keycloak user preparation requires managed local development, or explicit production user provisioning.'
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
      env.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD,
      env.FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET
    ].includes(password)
  )
    throw new Error(
      'The initial user password must be distinct from Keycloak database, bootstrap and OIDC secrets.'
    );
  return true;
}

export function validateKeycloakProvisionUserConfig(env) {
  if (!keycloakProvisionUserEnabled(env)) return false;
  validateKeycloakConfig(env);
  return true;
}

function validateProvisioningTarget(env) {
  const origin = new URL(env.FUNDING_PUBLIC_BASE_URL);
  const host = env.FUNDING_KEYCLOAK_HOSTNAME;
  if (
    env.COMPOSE_FILE ||
    !['development', 'production'].includes(env.FUNDING_PLATFORM_ENV) ||
    (env.FUNDING_PLATFORM_ENV === 'development' &&
      (host !== 'auth.openg7.test' || origin.hostname !== 'localhost')) ||
    (env.FUNDING_PLATFORM_ENV === 'production' &&
      [host, origin.hostname].some(
        (name) =>
          name === 'localhost' ||
          name.endsWith('.localhost') ||
          name.endsWith('.test') ||
          /^[\d.]+$/.test(name) ||
          name.startsWith('[')
      ))
  )
    throw new Error(
      'User provisioning requires the managed local or public production HTTPS target.'
    );
  const client = env.FUNDING_KEYCLOAK_PROVISION_CLIENT_ID ?? '';
  const secret = env.FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET ?? '';
  if (client || secret) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,127}$/.test(client) ||
      secret.trim().length < 32 ||
      /[\r\n\0]/.test(secret) ||
      [
        env.FUNDING_ADMIN_OIDC_CLIENT_SECRET,
        env.FUNDING_KEYCLOAK_DB_PASSWORD,
        env.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD,
        env.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD
      ].includes(secret)
    )
      throw new Error(
        'Provisioning requires a separate client ID and secret of at least 32 characters.'
      );
  } else if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,127}$/.test(
      env.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME
    )
  ) {
    throw new Error(
      'A valid Keycloak bootstrap administrator username is required for initial provisioning.'
    );
  }
  const owners = (env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS ?? '').trim();
  if (
    owners.length > 8192 ||
    (owners &&
      owners
        .split(',')
        .some(
          (subject) =>
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              subject.trim()
            )
        ))
  )
    throw new Error('Managed Keycloak owner subjects must be UUIDs.');
  return true;
}

export function validateKeycloakConfig(env) {
  if (keycloakProvisionUserEnabled(env) && !keycloakEnabled(env))
    throw new Error(
      'User provisioning requires FUNDING_KEYCLOAK_ENABLED=true.'
    );
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
  if (keycloakProvisionUserEnabled(env)) validateProvisioningTarget(env);
  return true;
}
