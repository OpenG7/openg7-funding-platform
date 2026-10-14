import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as proxyRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { startDisposablePostgres } from '../integration/support/disposable-postgres.mjs';
import { createBuiltWebServer } from '../ui/serve-built-web.mjs';
import { startIdentityProvider } from './oidc-provider.mjs';
import { socialFixtureEnvironment } from './social-provider.mjs';

// Real API and built Angular app; no .env, existing DB or external credentials.
export async function startIdentityStack({
  smtpPort,
  social,
  assistant,
  stripe
} = {}) {
  if (Number(process.versions.node.split('.')[0]) !== 22)
    throw new Error('Identity acceptance requires Node 22.');
  if (
    smtpPort !== undefined &&
    (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)
  )
    throw new Error('Invalid local SMTP fixture port.');
  const socialEnv = social ? socialFixtureEnvironment(social) : {};
  let stripeEnv = {};
  if (stripe) {
    const url = new URL(stripe.origin);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !url.port ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error(
        'The Stripe simulator must be an explicit loopback origin.'
      );
    stripeEnv = {
      STRIPE_SECRET_KEY: 'sk_test_identity_fixture',
      STRIPE_WEBHOOK_SECRET: 'whsec_identity_stripe_fixture',
      STRIPE_API_HOST: url.hostname,
      STRIPE_API_PORT: url.port,
      STRIPE_API_PROTOCOL: 'http'
    };
  }
  const assistantEnvironment = (settings) => {
    if (
      settings !== undefined &&
      (typeof settings?.enabled !== 'boolean' ||
        (settings.maxToolCalls !== undefined &&
          (!Number.isInteger(settings.maxToolCalls) ||
            settings.maxToolCalls < 1 ||
            settings.maxToolCalls > 20)))
    )
      throw new Error('Invalid local assistant fixture configuration.');
    return {
      ADMIN_AI_ASSISTANT_ENABLED: settings?.enabled ? 'true' : 'false',
      ADMIN_AI_PROVIDER: 'mock',
      ADMIN_AI_MAX_TOOL_CALLS: String(settings?.maxToolCalls ?? 6)
    };
  };
  let assistantEnv = assistantEnvironment(assistant);
  const db = await startDisposablePostgres();
  const mediaDirectory = await mkdtemp(join(tmpdir(), 'og7-identity-media-'));
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
  const stopApi = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.kill();
      await exit;
    }
  };
  const stop = async () => {
    try {
      await stopApi();
      if (web.listening)
        await new Promise((resolve) => {
          web.close(resolve);
          web.closeAllConnections();
        });
      await provider?.stop();
    } finally {
      try {
        await db.stop();
      } finally {
        if (!resolve(mediaDirectory).startsWith(resolve(tmpdir()) + sep))
          throw new Error(
            'Identity media cleanup must stay inside its temporary directory.'
          );
        await rm(mediaDirectory, { recursive: true, force: true });
      }
    }
  };
  try {
    web.listen(0, '127.0.0.1');
    await once(web, 'listening');
    const origin = `http://127.0.0.1:${web.address().port}`;
    provider = await startIdentityProvider(origin);
    const options = db.pool.options;
    let currentSocialEnv = socialEnv;
    const startApi = async () => {
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
            FUNDING_CONTRIBUTION_SMS_MODE: 'disabled',
            FUNDING_SPONSOR_LOGO_STORAGE_DIR: mediaDirectory,
            SPONSOR_MEDIA_STORAGE_DRIVER: 'local',
            ...currentSocialEnv,
            ...assistantEnv,
            ...stripeEnv,
            ...(smtpPort === undefined
              ? {}
              : {
                  SMTP_ENABLED: 'true',
                  SMTP_HOST: '127.0.0.1',
                  SMTP_PORT: String(smtpPort),
                  SMTP_SECURE: 'false',
                  SMTP_USER: 'sender@example.test',
                  SMTP_PASSWORD: 'synthetic-fixture',
                  SMTP_CONNECTION_TIMEOUT_MS: '5000',
                  SMTP_GREETING_TIMEOUT_MS: '10000',
                  SMTP_SOCKET_TIMEOUT_MS: '10000',
                  MAIL_FROM_ADDRESS: 'sender@example.test',
                  MAIL_REPLY_TO_ADDRESS: 'reply@example.test',
                  FUNDING_ADMIN_NOTIFICATION_EMAIL: 'admin@example.test'
                })
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
    };
    await startApi();
    return {
      origin,
      get apiOrigin() {
        return `http://127.0.0.1:${apiPort}`;
      },
      pool: db.pool,
      mediaDirectory,
      dumpDatabase: db.dumpDatabase,
      provider,
      async restartSocial(accounts) {
        if (!social) throw new Error('No local social fixture configured.');
        const next = socialFixtureEnvironment({
          origin: social.origin,
          accounts
        });
        await stopApi();
        currentSocialEnv = next;
        await startApi();
      },
      async restartAssistant(settings) {
        const next = assistantEnvironment(settings);
        await stopApi();
        assistantEnv = next;
        await startApi();
      },
      stop
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
