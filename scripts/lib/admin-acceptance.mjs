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
  stripePort
}) {
  if (!/^og7-acceptance-[a-f0-9-]+$/.test(project))
    throw new Error('Invalid acceptance project.');
  for (const port of [webPort, stripePort]) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('Invalid loopback port.');
  }
  if (webPort === stripePort) throw new Error('Acceptance ports must differ.');
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
    PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${webPort}`,
    STRIPE_STUB_BASE_URL: `http://127.0.0.1:${stripePort}`,
    POSTGRES_DB: 'acceptance',
    POSTGRES_USER: 'acceptance',
    FUNDING_ADMIN_TOKEN: ADMIN_TOKEN,
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
    await run(node, ['scripts/e2e-seed.mjs']);
    await run('docker', ['compose', 'up', '-d', '--wait']);
    await run(node, [cli, 'test', ...args]);
  } catch (error) {
    await diagnostics().catch(() => {});
    throw error;
  } finally {
    // No named data volumes: only this unique project's ephemeral containers
    // and networks are removed. Existing local stacks are unaffected.
    await run('docker', ['compose', 'down', '--remove-orphans']);
  }
}
