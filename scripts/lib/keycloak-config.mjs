// This optional provider has its own credentials; it never shares the funding DB.
export function keycloakEnabled(env) {
  const value = env.FUNDING_KEYCLOAK_ENABLED ?? 'false';
  if (!['true', 'false'].includes(value))
    throw new Error('FUNDING_KEYCLOAK_ENABLED must be true or false.');
  return value === 'true';
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
  return true;
}
