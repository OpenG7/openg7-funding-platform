import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as proxyRequest } from 'node:http';
import { startDisposablePostgres } from '../integration/support/disposable-postgres.mjs';
import { createBuiltWebServer } from '../ui/serve-built-web.mjs';
import { startIdentityProvider } from './oidc-provider.mjs';

// Real API and built Angular app; no .env, existing DB or external credentials.
export async function startIdentityStack() {
  if (Number(process.versions.node.split('.')[0]) !== 22)
    throw new Error('Identity acceptance requires Node 22.');
  const db = await startDisposablePostgres();
  let provider, child, apiPort;
  const web = createBuiltWebServer((req, res) => {
    const upstream = proxyRequest(
      {
        hostname: '127.0.0.1',
        port: apiPort,
        path: req.url,
        method: req.method,
        headers: req.headers
      },
      (answer) => {
        res.writeHead(answer.statusCode, answer.headers);
        answer.pipe(res);
      }
    );
    upstream.on('error', () => res.writeHead(503).end());
    req.pipe(upstream);
  });
  const stop = async () => {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exit = once(child, 'exit');
        child.kill();
        await exit;
      }
      if (web.listening)
        await new Promise((resolve) => {
          web.close(resolve);
          web.closeAllConnections();
        });
      await provider?.stop();
    } finally {
      await db.stop();
    }
  };
  try {
    web.listen(0, '127.0.0.1');
    await once(web, 'listening');
    const origin = `http://127.0.0.1:${web.address().port}`;
    provider = await startIdentityProvider(origin);
    const options = db.pool.options;
    child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import http from 'node:http';
      const listen = http.Server.prototype.listen;
      http.Server.prototype.listen = function(_port, callback) {
        return listen.call(this, 0, '127.0.0.1', () => { console.log('TEST_PORT=' + this.address().port); callback?.(); });
      };
      await import('./dist/apps/funding-api/src/main.js');
    `
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          NODE_ENV: 'test',
          FUNDING_PLATFORM_ENV: 'development',
          FUNDING_API_PORT: '0',
          DATABASE_URL: `postgresql://${encodeURIComponent(options.user)}:${encodeURIComponent(options.password)}@127.0.0.1:${options.port}/${options.database}`,
          FUNDING_ADMIN_AUTH_MODE: 'oidc',
          FUNDING_ADMIN_OIDC_ISSUER: provider.issuer,
          FUNDING_ADMIN_TOKEN: 'synthetic-root',
          FUNDING_ADMIN_OIDC_CLIENT_ID: provider.clientId,
          FUNDING_ADMIN_OIDC_CLIENT_SECRET: provider.clientSecret,
          FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: 'fixture-owner',
          FUNDING_PUBLIC_BASE_URL: origin,
          FUNDING_ALLOWED_ORIGINS: origin,
          FUNDING_ADMIN_RATE_LIMIT_MAX: '0',
          FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'false',
          FUNDING_EMAIL_WORKER_ENABLED: 'false',
          SOCIAL_PUBLICATION_WORKER_ENABLED: 'false',
          SOCIAL_PUBLICATION_MODE: 'mock',
          FUNDING_CONTRIBUTION_EMAIL_ENABLED: 'false',
          FUNDING_CONTRIBUTION_SMS_MODE: 'disabled'
        }
      }
    );
    apiPort = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Identity fixture API did not start.')),
        15000
      );
      const finish = (error, port) => {
        clearTimeout(timer);
        error ? reject(error) : resolve(port);
      };
      child.once('error', () =>
        finish(new Error('Identity fixture API could not start.'))
      );
      child.once('exit', () =>
        finish(new Error('Identity fixture API exited.'))
      );
      let output = '';
      child.stdout.on('data', (chunk) => {
        output = (output + chunk).slice(-4096);
        const match = /TEST_PORT=(\d+)/.exec(output);
        if (match) finish(null, Number(match[1]));
      });
    });
    return { origin, pool: db.pool, provider, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
