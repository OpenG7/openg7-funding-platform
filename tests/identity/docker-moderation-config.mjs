// Pure configuration for the disposable Docker recipe's secondary OIDC API.
const apiPort = 3334;
const clientId = 'identity-acceptance';
const clientSecret = 'identity-acceptance-secret';

function loopbackOrigin(value) {
  try {
    const url = new URL(value);
    if (
      typeof value !== 'string' ||
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !Number.isInteger(Number(url.port)) ||
      Number(url.port) < 1024 ||
      Number(url.port) > 65535
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error('Moderation acceptance requires a loopback test origin.');
  }
}

/** Reject inherited production targets before opening any listener or DB. */
export function dockerModerationConfiguration(env) {
  if (
    env.OPENG7_E2E_ISOLATED !== '1' ||
    !/^og7-acceptance-[a-f0-9-]+$/.test(env.COMPOSE_PROJECT_NAME ?? '') ||
    env.FUNDING_PLATFORM_ENV === 'production'
  )
    throw new Error('Moderation identity requires the disposable test stack.');
  const webOrigin = loopbackOrigin(env.MODERATION_WEB_BASE_URL);
  const providerPort = Number(env.ACCEPTANCE_OIDC_PROVIDER_PORT);
  if (
    !/^\d+$/.test(env.ACCEPTANCE_OIDC_PROVIDER_PORT ?? '') ||
    !Number.isInteger(providerPort) ||
    providerPort < 1024 ||
    providerPort > 65535 ||
    [3333, apiPort, Number(new URL(webOrigin).port)].includes(providerPort)
  )
    throw new Error('Invalid moderation identity fixture port.');
  const issuer = `http://127.0.0.1:${providerPort}`;
  if (
    env.STRIPE_API_HOST !== 'stripe-stub' ||
    env.STRIPE_API_PROTOCOL !== 'http' ||
    env.STRIPE_API_PORT !== '4242' ||
    env.SOCIAL_PUBLICATION_MODE !== 'mock'
  )
    throw new Error('Invalid moderation acceptance identity configuration.');
  try {
    const database = new URL(env.DATABASE_URL);
    if (
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      database.hostname !== 'postgres' ||
      !['', '5432'].includes(database.port) ||
      database.pathname !== '/acceptance' ||
      database.username !== 'acceptance' ||
      !database.password ||
      database.search ||
      database.hash
    )
      throw new Error();
  } catch {
    throw new Error('Moderation identity requires the acceptance database.');
  }
  return { apiPort, providerPort, webOrigin, issuer, clientId, clientSecret };
}

/** Only the secondary process adopts these settings after its preflight. */
export function buildDockerModerationEnvironment(config) {
  return {
    NODE_ENV: 'test',
    FUNDING_PLATFORM_ENV: 'test',
    FUNDING_API_PORT: String(config.apiPort),
    FUNDING_ADMIN_AUTH_MODE: 'oidc',
    FUNDING_PUBLIC_BASE_URL: config.webOrigin,
    FUNDING_ALLOWED_ORIGINS: config.webOrigin,
    FUNDING_ADMIN_OIDC_ISSUER: config.issuer,
    FUNDING_ADMIN_OIDC_CLIENT_ID: config.clientId,
    FUNDING_ADMIN_OIDC_CLIENT_SECRET: config.clientSecret,
    FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: 'fixture-owner',
    FUNDING_EMAIL_WORKER_ENABLED: 'false',
    FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'false',
    SOCIAL_PUBLICATION_WORKER_ENABLED: 'false'
  };
}
