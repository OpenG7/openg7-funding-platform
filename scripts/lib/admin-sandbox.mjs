import { randomBytes } from 'node:crypto';
import { delimiter, isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';

import {
  acceptanceEnvironment,
  prepareAcceptanceStack
} from './admin-acceptance.mjs';

export const sandboxLabel = 'org.openg7.admin-sandbox';
export const sandboxBrowserArgs = Object.freeze([
  '--config',
  'tests/playwright-sandbox.config.mjs',
  '--workers=1'
]);

/** A terminal or a pipe can request the same local shutdown; EOF is not a stop command. */
export function listenForSandboxStop(input, requestStop) {
  const lines = createInterface({
    input,
    terminal: false,
    crlfDelay: Infinity
  });
  const stop = (line) => {
    if (line.trim().toLowerCase() === 'stop') requestStop();
  };
  lines.on('line', stop);
  return () => {
    lines.off('line', stop);
    lines.close();
  };
}

/** Public presentation capability only; it contains no credential or financial fact. */
export function sandboxManifest() {
  return {
    version: 1,
    enabled: true,
    stripeBasePath: '/__sandbox/stripe'
  };
}

/** Reuse the sanitized acceptance environment, never a local application's .env. */
export function sandboxEnvironment(options) {
  const { manifestFile, nginxFile, ...acceptance } = options;
  if (
    ![manifestFile, nginxFile].every(
      (path) => typeof path === 'string' && isAbsolute(path)
    )
  )
    throw new Error('Sandbox configuration files must be absolute.');
  const env = acceptanceEnvironment(acceptance);
  return {
    ...env,
    COMPOSE_FILE: [
      env.COMPOSE_FILE,
      join(acceptance.root, 'docker-compose.sandbox.yml')
    ].join(delimiter),
    COMPOSE_PATH_SEPARATOR: delimiter,
    SANDBOX_MANIFEST_FILE: manifestFile,
    SANDBOX_NGINX_FILE: nginxFile,
    SANDBOX_PUBLIC_BASE_URL: env.MODERATION_WEB_BASE_URL,
    PLAYWRIGHT_BASE_URL: env.MODERATION_WEB_BASE_URL,
    FUNDING_ADMIN_TOKEN: randomBytes(32).toString('base64url'),
    FUNDING_ADMIN_SESSION_SECRET: randomBytes(32).toString('base64url')
  };
}

/** Freeze explicit Compose targets, including during teardown after an interruption. */
export function sandboxComposeArgs({ root, project, envFile }) {
  if (!/^og7-acceptance-[a-f0-9-]+$/.test(project))
    throw new Error('Invalid sandbox project.');
  if (![root, envFile].every(isAbsolute))
    throw new Error('Sandbox Compose paths must be absolute.');
  return [
    'compose',
    '--project-name',
    project,
    '--env-file',
    envFile,
    '--file',
    join(root, 'docker-compose.acceptance.yml'),
    '--file',
    join(root, 'docker-compose.sandbox.yml')
  ];
}

/** The proxy stays on the sandbox origin; no browser CORS exception is needed. */
export function sandboxNginxConfiguration(source, { oidc = false } = {}) {
  if (
    !source.includes('proxy_pass http://api:3333;') ||
    !source.includes('  location = /health {')
  )
    throw new Error('Missing sandbox proxy insertion point.');
  const proxy = `  location = /openg7-sandbox.json {
    default_type application/json;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
    try_files /openg7-sandbox.json =404;
  }

  location = /__sandbox/stripe { return 308 /__sandbox/stripe/; }
  location ^~ /__sandbox/stripe/ {
    access_log off;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://stripe-stub:4242/;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
  }

`;
  const configured = oidc
    ? source.replaceAll(
        'proxy_pass http://api:3333;',
        'proxy_pass http://api:3334;'
      )
    : source;
  return configured.replace(
    '  location = /health {',
    proxy + '  location = /health {'
  );
}

/** Every discovered resource must belong to this disposable project and sandbox. */
export function assertSandboxCleanupLabels(project, labels) {
  if (!/^og7-acceptance-[a-f0-9-]+$/.test(project))
    throw new Error('Invalid sandbox cleanup project.');
  if (
    !Array.isArray(labels) ||
    labels.some(
      (resource) =>
        resource?.['com.docker.compose.project'] !== project ||
        resource?.[sandboxLabel] !== 'true'
    )
  )
    throw new Error('Refusing cleanup of resources outside this sandbox.');
}

/** Inspect every container and network before the single project-scoped mutation. */
export async function cleanupSandboxResources({ project, readDocker, run }) {
  assertSandboxCleanupLabels(project, []);
  for (const kind of ['container', 'network']) {
    const list = kind === 'container' ? ['ps', '--all'] : ['network', 'ls'];
    const ids = readDocker([
      ...list,
      '--quiet',
      '--filter',
      `label=com.docker.compose.project=${project}`
    ])
      .split(/\s+/)
      .filter(Boolean);
    if (!ids.length) continue;
    if (ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id)))
      throw new Error('Invalid sandbox resource identifier.');
    const format =
      kind === 'container' ? '{{json .Config.Labels}}' : '{{json .Labels}}';
    const labels = readDocker([
      'inspect',
      '--type',
      kind,
      '--format',
      format,
      ...ids
    ])
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assertSandboxCleanupLabels(project, labels);
  }
  await run('docker', ['compose', 'down', '--remove-orphans']);
}

/** Interactive lifetime: no browser runner or financial fixture seed is invoked. */
export async function sandboxStages({
  run,
  node,
  ready,
  waitForStop,
  cleanup,
  verify = false,
  cli,
  diagnostics = async () => {}
}) {
  try {
    if (verify && (typeof cli !== 'string' || !cli))
      throw new Error('Missing sandbox browser runner.');
    await prepareAcceptanceStack({
      run,
      node,
      seed: false,
      services: ['api', 'mailpit', 'stripe-stub', 'web-oidc']
    });
    await ready();
    if (verify) await run(node, [cli, 'test', ...sandboxBrowserArgs]);
    else await waitForStop();
  } catch (error) {
    await diagnostics().catch(() => {});
    throw error;
  } finally {
    await cleanup();
  }
}
