import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const findOnWindowsPath = (name, env) => {
  const result = spawnSync('where.exe', [name], {
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000
  });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/) : [];
};

/** Resolve npm's native Windows binary without executing a shell launcher. */
export function resolveStripeExecutable(
  env,
  {
    platform = process.platform,
    arch = process.arch,
    findExecutables = findOnWindowsPath
  } = {}
) {
  if (platform !== 'win32') return 'stripe';
  const native = findExecutables('stripe.exe', env).find(existsSync);
  if (native) return native;
  for (const launcher of findExecutables('stripe.cmd', env)) {
    const packagePath = join(
      dirname(launcher),
      'node_modules',
      '@stripe',
      'cli',
      'package.json'
    );
    if (!existsSync(packagePath)) continue;
    try {
      const require = createRequire(packagePath);
      const nativePackage = require.resolve(
        `@stripe/cli-win32-${arch}/package.json`
      );
      const binary = join(dirname(nativePackage), 'bin', 'stripe.exe');
      if (existsSync(binary)) return binary;
    } catch {
      /* The npm installer can fall back to its vendor directory. */
    }
    const vendor = join(dirname(packagePath), 'vendor', 'bin', 'stripe.exe');
    if (existsSync(vendor)) return vendor;
  }
  throw new Error(
    'Stripe CLI introuvable. Installer avec yarn stripe:cli:install.'
  );
}

export const redactStripeOutput = (line) =>
  line.replace(
    /(?:[sr]k_(?:test|live)_|whsec_)[A-Za-z0-9_]+/g,
    '[secret masque]'
  );

export function resendStripeEvents(
  { eventIds, live, webhookEndpoint, apiKey, dryRun, confirm },
  {
    env = process.env,
    resolveExecutable = resolveStripeExecutable,
    spawn = spawnSync,
    write = console.log
  } = {}
) {
  // Explicit credentials never enter the Stripe child's argv or dry-run logs.
  // Preserve Stripe CLI precedence: an inherited STRIPE_API_KEY overrides --api-key.
  const childEnv =
    apiKey && !env.STRIPE_API_KEY
      ? { ...env, STRIPE_API_KEY: apiKey }
      : { ...env };
  const executable = dryRun ? null : resolveExecutable(childEnv);
  for (const eventId of eventIds) {
    const args = ['events', 'resend', eventId];
    if (confirm) args.push('--confirm');
    if (live) args.push('--live');
    if (webhookEndpoint) args.push('--webhook-endpoint', webhookEndpoint);
    if (dryRun) {
      write(redactStripeOutput(`stripe ${args.join(' ')}`));
      continue;
    }
    write(`Resending ${eventId}${live ? ' in live mode' : ''}...`);
    const result = spawn(executable, args, {
      env: childEnv,
      stdio: 'inherit',
      shell: false,
      windowsHide: true
    });
    if (result.error || result.signal || result.status !== 0) {
      const error = new Error(
        'Stripe CLI execution failed. Verify the CLI, credentials and event outcome before retrying.'
      );
      error.exitCode = result.status || 1;
      throw error;
    }
  }
}
