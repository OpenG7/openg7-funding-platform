// Real OIDC API in the disposable Docker recipe's existing API container.
import http from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startIdentityProvider } from './oidc-provider.mjs';

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

export async function startDockerModerationServer(env = process.env) {
  const config = dockerModerationConfiguration(env);
  // docker exec has its own environment. The container's primary token API is
  // unchanged; only this child process adopts the bounded OIDC test settings.
  Object.assign(process.env, {
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
  });
  const provider = await startIdentityProvider(config.webOrigin, {
    host: '0.0.0.0',
    port: config.providerPort,
    publicIssuer: config.issuer,
    clientSecret: config.clientSecret
  });
  let api;
  let stopping;
  const stop = () =>
    (stopping ??= (async () => {
      if (api?.listening)
        await new Promise((done) => {
          api.close(done);
          api.closeAllConnections();
        });
      await provider.stop();
    })());
  const listen = http.Server.prototype.listen;
  let resolveListening;
  let rejectListening;
  const listening = new Promise((done, fail) => {
    resolveListening = done;
    rejectListening = fail;
  });
  // A listen failure can precede the import's completion; retain the failure for
  // the awaited startup without producing an unhandled rejection in between.
  void listening.catch(() => {});
  // The primary API owns all background work. The main listen callback only
  // logs startup and starts those workers; handlers and authorization stay real.
  http.Server.prototype.listen = function (port, callback) {
    if (api || port !== config.apiPort || typeof callback !== 'function')
      throw new Error('Unexpected moderation fixture API listener.');
    api = this;
    this.once('error', rejectListening);
    return listen.call(this, port, '0.0.0.0', resolveListening);
  };
  try {
    await import('../../dist/apps/funding-api/src/main.js');
    await listening;
    return { ...config, stop };
  } catch (error) {
    await stop();
    throw error;
  } finally {
    http.Server.prototype.listen = listen;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (Number(process.versions.node.split('.')[0]) !== 22)
      throw new Error('Moderation acceptance requires Node 22.');
    const server = await startDockerModerationServer();
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      try {
        await server.stop();
        process.exit(0);
      } catch {
        process.exit(1);
      }
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    console.log('Moderation OIDC acceptance API ready.');
  } catch {
    // Provider, DB and OIDC errors can include private inputs. Keep them out of
    // Docker evidence; the recipe reports its own stage and failed readiness.
    console.error('Moderation OIDC acceptance API failed to start.');
    process.exit(1);
  }
}
