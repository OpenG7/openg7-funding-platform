import { join } from 'node:path';

import {
  ADMIN_TOKEN,
  STRIPE_TEST_SECRET_KEY,
  STRIPE_TEST_WEBHOOK_SECRET
} from '../../tests/playwright/fixtures/e2e-fixtures.mjs';

// Only toolchain variables cross into the runner. In particular, inherited
// Compose files/projects, DATABASE_URL and provider credentials cannot do so.
const toolchainKeys =
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG|DOCKER_TLS_VERIFY|DOCKER_CERT_PATH|CI|PLAYWRIGHT_BROWSERS_PATH)$/i;

export function acceptanceEnvironment({
  parent,
  root,
  project,
  envFile,
  webPort,
  stripePort,
  moderationWebPort,
  oidcProviderPort,
  moderationNginxFile
}) {
  if (!/^og7-acceptance-[a-f0-9-]+$/.test(project))
    throw new Error('Invalid acceptance project.');
  const ports = [webPort, stripePort, moderationWebPort, oidcProviderPort];
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('Invalid loopback port.');
  }
  if (
    new Set(ports).size !== ports.length ||
    ports.some((port) => [3333, 3334].includes(port))
  )
    throw new Error(
      'Acceptance ports must differ from each other and internal API ports.'
    );
  if (!moderationNginxFile)
    throw new Error('Missing isolated OIDC proxy configuration.');
  return {
    ...Object.fromEntries(
      Object.entries(parent).filter(([key]) => toolchainKeys.test(key))
    ),
    COMPOSE_PROJECT_NAME: project,
    COMPOSE_FILE: join(root, 'docker-compose.acceptance.yml'),
    COMPOSE_ENV_FILES: envFile,
    COMPOSE_DISABLE_ENV_FILE: 'true',
    OPENG7_E2E_ENV_FILE: envFile,
    OPENG7_E2E_ISOLATED: '1',
    ACCEPTANCE_WEB_PORT: String(webPort),
    ACCEPTANCE_STRIPE_PORT: String(stripePort),
    ACCEPTANCE_MODERATION_WEB_PORT: String(moderationWebPort),
    ACCEPTANCE_OIDC_PROVIDER_PORT: String(oidcProviderPort),
    ACCEPTANCE_OIDC_NGINX_FILE: moderationNginxFile,
    PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${webPort}`,
    MODERATION_WEB_BASE_URL: `http://127.0.0.1:${moderationWebPort}`,
    STRIPE_STUB_BASE_URL: `http://127.0.0.1:${stripePort}`,
    POSTGRES_DB: 'acceptance',
    POSTGRES_USER: 'acceptance',
    FUNDING_ADMIN_TOKEN: ADMIN_TOKEN,
    FUNDING_PLATFORM_ENV: 'test',
    FUNDING_ADMIN_AUTH_MODE: 'token',
    FUNDING_ADMIN_SESSION_SECRET:
      'local-acceptance-session-signing-secret-32-characters',
    FUNDING_ADMIN_SESSION_TTL_MINUTES: '60',
    STRIPE_SECRET_KEY: STRIPE_TEST_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: STRIPE_TEST_WEBHOOK_SECRET
  };
}

export function assertLocalDockerEndpoint(endpoint) {
  if (/^(unix:\/\/\/|npipe:\/\/)/.test(endpoint)) return;
  const url = new URL(endpoint);
  if (
    ['tcp:', 'http:', 'https:'].includes(url.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    return;
  throw new Error('Acceptance requires a local Docker daemon.');
}

/** Prepare only this recipe's private services; interactive callers can omit test fixtures. */
export async function prepareAcceptanceStack({
  run,
  node,
  seed = true,
  services = []
}) {
  await run('docker', ['compose', 'config', '--quiet']);
  await run('docker', ['compose', 'build']);
  await run('docker', [
    'compose',
    'up',
    '-d',
    '--wait',
    'postgres',
    'stripe-stub'
  ]);
  await run(node, ['scripts/db-migrate.mjs']);
  if (seed) await run(node, ['scripts/e2e-seed.mjs']);
  await run('docker', ['compose', 'up', '-d', '--wait', ...services]);
  // A separate OIDC API process exercises decisions requiring two stable
  // identities. It shares the disposable database and local media only.
  await run('docker', [
    'compose',
    'exec',
    '-d',
    'api',
    'node',
    '/app/tests/identity/docker-moderation-server.mjs'
  ]);
  await run(node, ['scripts/lib/admin-acceptance-readiness.mjs']);
}

// Each stage must succeed. Diagnostics and teardown run on startup, migration,
// seed or browser failures too; cleanup failure also makes the command fail.
export async function acceptanceStages({
  run,
  diagnostics,
  node,
  cli,
  args = []
}) {
  try {
    await prepareAcceptanceStack({ run, node });
    // Scenarios share the database, global settings and API restarts. Keep the
    // stack sequential. The override must precede the CLI option terminator.
    const browserArgs = [...args];
    const separator = browserArgs.indexOf('--');
    browserArgs.splice(
      separator < 0 ? browserArgs.length : separator,
      0,
      '--workers=1'
    );
    await run(node, [cli, 'test', ...browserArgs]);
  } catch (error) {
    await diagnostics().catch(() => {});
    throw error;
  } finally {
    // No named data volumes: only this unique project's ephemeral containers
    // and networks are removed. Existing local stacks are unaffected.
    await run('docker', ['compose', 'down', '--remove-orphans']);
  }
}
