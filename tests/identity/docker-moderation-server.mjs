// Real OIDC API in the disposable Docker recipe's existing API container.
import http from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildDockerModerationEnvironment,
  dockerModerationConfiguration
} from './docker-moderation-config.mjs';
import { startIdentityProvider } from './oidc-provider.mjs';

export { dockerModerationConfiguration };

export async function startDockerModerationServer(env = process.env) {
  const config = dockerModerationConfiguration(env);
  // docker exec has its own environment. The container's primary token API is
  // unchanged; only this child process adopts the bounded OIDC test settings.
  Object.assign(process.env, buildDockerModerationEnvironment(config));
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
