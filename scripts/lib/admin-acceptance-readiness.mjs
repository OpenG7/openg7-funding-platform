import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const readinessTimeoutMs = 30000;
const requestTimeoutMs = 1000;
const retryIntervalMs = 500;

async function inspectEndpoint([url, matches]) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  return {
    status: response.status,
    ready: response.ok && matches(await response.json())
  };
}

/** Wait in a child process that the recipe can interrupt during startup. */
export async function waitForModerationIdentity(env = process.env) {
  const issuer = 'http://127.0.0.1:' + env.ACCEPTANCE_OIDC_PROVIDER_PORT;
  const checks = [
    [
      env.MODERATION_WEB_BASE_URL + '/api/admin/auth/config',
      (body) => body.mode === 'oidc'
    ],
    [
      issuer + '/.well-known/openid-configuration',
      (body) => body.issuer === issuer
    ]
  ];
  // AbortSignal timeout timers are unreferenced; keep the CLI alive during startup.
  const keepAlive = setTimeout(() => {}, readinessTimeoutMs + 5000);
  const deadline = Date.now() + readinessTimeoutMs;
  let status = [];
  try {
    while (Date.now() < deadline) {
      const results = await Promise.allSettled(checks.map(inspectEndpoint));
      status = results.map((result) =>
        result.status === 'fulfilled'
          ? result.value
          : { error: result.reason.cause?.code ?? result.reason.name }
      );
      if (status.every((result) => result.ready)) return;
      await delay(retryIntervalMs);
    }
    // Do not include response bodies, provider inputs or private configuration.
    throw new Error(
      'Moderation OIDC acceptance API and provider did not become reachable: ' +
        JSON.stringify(status)
    );
  } finally {
    clearTimeout(keepAlive);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await waitForModerationIdentity();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
