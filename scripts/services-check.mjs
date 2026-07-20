#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const usage = `Usage: node scripts/services-check.mjs [--env <path>] [--env-only]

Checks whether the local configuration is ready to operate the funding services.
The report never prints secret values.

Options:
  --env <path>  Read configuration from this env file. Defaults to .env.
  --env-only   Ignore inherited shell environment variables.
  --help       Show this help message.
`;

const secretNames = new Set([
  'DATABASE_URL',
  'FUNDING_ADMIN_SESSION_SECRET',
  'FUNDING_ADMIN_TOKEN',
  'OVH_S3_ACCESS_KEY_ID',
  'OVH_S3_SECRET_ACCESS_KEY',
  'SMTP_PASSWORD',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET'
]);

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(usage);
  process.exit(0);
}

const envPath = resolve(process.cwd(), args.envFile);
const fileEnv = existsSync(envPath) ? readEnvFile(envPath) : {};
const env = args.envOnly ? fileEnv : { ...fileEnv, ...process.env };
const checks = [];

record(
  existsSync(envPath) ? 'ok' : 'warn',
  'Configuration',
  args.envFile,
  existsSync(envPath)
    ? 'env file found'
    : 'env file not found; using shell environment only'
);

if (!process.versions.node.startsWith('22.')) {
  record('warn', 'Configuration', 'Node.js', 'repository expects Node.js 22.x');
} else {
  record('ok', 'Configuration', 'Node.js', 'Node.js 22.x detected');
}

checkCommand('docker', ['--version'], 'Configuration', 'Docker CLI');
checkCommand('stripe', ['--version'], 'Stripe', 'Stripe CLI');

required('HTTPS', 'APP_DOMAIN', 'set the public application domain');
requiredEmail(
  'HTTPS',
  'LETSENCRYPT_EMAIL',
  'set a real email for certificate renewal notices'
);
requiredHttpsUrl(
  'HTTPS',
  'FUNDING_PUBLIC_BASE_URL',
  'set the public base URL with https'
);
requiredHttpsUrl(
  'HTTPS',
  'FUNDING_PLATFORM_API_BASE_URL',
  'set the API base URL with https and /api'
);
if (hasRealValue('FUNDING_PLATFORM_API_BASE_URL')) {
  const apiUrl = readValue('FUNDING_PLATFORM_API_BASE_URL');
  if (!safeUrl(apiUrl)?.pathname.includes('/api')) {
    record(
      'warn',
      'HTTPS',
      'FUNDING_PLATFORM_API_BASE_URL',
      'URL should include /api'
    );
  }
}
checkAllowedOrigins();

requiredSecret(
  'Admin',
  'FUNDING_ADMIN_TOKEN',
  'set a long root admin token',
  32
);
requiredSecret(
  'Admin',
  'FUNDING_ADMIN_SESSION_SECRET',
  'set a distinct long session signing secret',
  32
);
if (
  hasRealValue('FUNDING_ADMIN_TOKEN') &&
  hasRealValue('FUNDING_ADMIN_SESSION_SECRET') &&
  readValue('FUNDING_ADMIN_TOKEN') === readValue('FUNDING_ADMIN_SESSION_SECRET')
) {
  record(
    'missing',
    'Admin',
    'FUNDING_ADMIN_SESSION_SECRET',
    'session secret must be different from the root admin token'
  );
}
requiredPositiveInteger(
  'Admin',
  'FUNDING_ADMIN_SESSION_TTL_MINUTES',
  'set a positive session duration'
);

checkStripeKey();
requiredPattern(
  'Stripe',
  'STRIPE_WEBHOOK_SECRET',
  /^whsec_/,
  'set a real webhook signing secret starting with whsec_'
);

checkSmtp();
requiredEmail(
  'Mail',
  'FUNDING_ADMIN_NOTIFICATION_EMAIL',
  'set the admin notification recipient'
);

requiredPattern(
  'PostgreSQL',
  'DATABASE_URL',
  /^postgres(?:ql)?:\/\//,
  'set the private PostgreSQL URL for the full admin cockpit, invoices, email queue, and sponsorship follow-up'
);

checkSponsorMediaStorage();

printReport();
process.exitCode = checks.some((check) => check.status === 'missing') ? 1 : 0;

function parseArgs(argv) {
  const parsed = {
    envFile: '.env',
    envOnly: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--env-only') {
      parsed.envOnly = true;
      continue;
    }

    if (arg === '--env') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--env requires a path');
      }
      parsed.envFile = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--env=')) {
      parsed.envFile = arg.slice('--env='.length);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

function readEnvFile(path) {
  const values = {};
  const content = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    values[key] = normalizeEnvValue(rawValue);
  }

  return values;
}

function normalizeEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed.replace(/\s+#.*$/, '').trim();
}

function readValue(name) {
  return `${env[name] ?? ''}`.trim();
}

function hasRealValue(name) {
  const value = readValue(name);
  return value.length > 0 && !isPlaceholder(value);
}

function isPlaceholder(value) {
  return /(?:\.\.\.|change[_-]?me|example\.com|remplace|replace|todo|your[_ -])/i.test(
    value
  );
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isHttpsUrl(value) {
  const url = safeUrl(value);
  return url?.protocol === 'https:';
}

function required(section, name, hint) {
  if (!hasRealValue(name)) {
    record('missing', section, name, hint);
    return false;
  }

  record('ok', section, name, 'configured');
  return true;
}

function requiredSecret(section, name, hint, minLength) {
  if (!required(section, name, hint)) {
    return false;
  }

  if (readValue(name).length < minLength) {
    record(
      'missing',
      section,
      name,
      `must be at least ${minLength} characters`
    );
    return false;
  }

  return true;
}

function requiredPattern(section, name, pattern, hint) {
  if (!required(section, name, hint)) {
    return false;
  }

  if (!pattern.test(readValue(name))) {
    record('missing', section, name, hint);
    return false;
  }

  return true;
}

function requiredEmail(section, name, hint) {
  if (!required(section, name, hint)) {
    return false;
  }

  if (!isEmail(readValue(name))) {
    record('missing', section, name, 'set a valid email address');
    return false;
  }

  return true;
}

function requiredHttpsUrl(section, name, hint) {
  if (!required(section, name, hint)) {
    return false;
  }

  if (!isHttpsUrl(readValue(name))) {
    record('missing', section, name, hint);
    return false;
  }

  return true;
}

function requiredPositiveInteger(section, name, hint) {
  if (!required(section, name, hint)) {
    return false;
  }

  const value = Number(readValue(name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    record('missing', section, name, hint);
    return false;
  }

  return true;
}

function checkAllowedOrigins() {
  if (!required('HTTPS', 'FUNDING_ALLOWED_ORIGINS', 'set allowed origins')) {
    return;
  }

  const origins = readValue('FUNDING_ALLOWED_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    record(
      'missing',
      'HTTPS',
      'FUNDING_ALLOWED_ORIGINS',
      'set allowed origins'
    );
    return;
  }

  const hasInvalidOrigin = origins.some((origin) => !safeUrl(origin));
  if (hasInvalidOrigin) {
    record(
      'missing',
      'HTTPS',
      'FUNDING_ALLOWED_ORIGINS',
      'every origin must be a valid URL'
    );
    return;
  }

  const environment = readValue('FUNDING_PLATFORM_ENV') || 'development';
  const hasHttpOrigin = origins.some(
    (origin) => safeUrl(origin)?.protocol === 'http:'
  );
  if (environment === 'production' && hasHttpOrigin) {
    record(
      'missing',
      'HTTPS',
      'FUNDING_ALLOWED_ORIGINS',
      'production origins must use https'
    );
  }
}

function checkStripeKey() {
  if (
    !requiredPattern(
      'Stripe',
      'STRIPE_SECRET_KEY',
      /^sk_(?:test|live)_/,
      'set a real Stripe secret key starting with sk_test_ or sk_live_'
    )
  ) {
    return;
  }

  const environment = readValue('FUNDING_PLATFORM_ENV') || 'development';
  const key = readValue('STRIPE_SECRET_KEY');
  if (environment === 'production' && key.startsWith('sk_test_')) {
    record(
      'warn',
      'Stripe',
      'STRIPE_SECRET_KEY',
      'test key detected while FUNDING_PLATFORM_ENV=production'
    );
  }

  if (environment !== 'production' && key.startsWith('sk_live_')) {
    record(
      'warn',
      'Stripe',
      'STRIPE_SECRET_KEY',
      'live key detected outside production; keep live operations explicit'
    );
  }
}

function checkSmtp() {
  const smtpEnabled = readValue('SMTP_ENABLED').toLowerCase();
  if (smtpEnabled !== 'true') {
    record(
      'missing',
      'Mail',
      'SMTP_ENABLED',
      'set SMTP_ENABLED=true to send and verify real email'
    );
    return;
  }

  record('ok', 'Mail', 'SMTP_ENABLED', 'enabled');
  required('Mail', 'SMTP_HOST', 'set the SMTP host');
  requiredPositiveInteger('Mail', 'SMTP_PORT', 'set a valid SMTP port');

  const secure = readValue('SMTP_SECURE').toLowerCase();
  if (!['true', 'false'].includes(secure)) {
    record('missing', 'Mail', 'SMTP_SECURE', 'set SMTP_SECURE=true or false');
  } else {
    record('ok', 'Mail', 'SMTP_SECURE', 'configured');
  }

  requiredEmail('Mail', 'SMTP_USER', 'set the SMTP username email');
  requiredSecret('Mail', 'SMTP_PASSWORD', 'set the SMTP password', 8);
  requiredEmail('Mail', 'MAIL_FROM_ADDRESS', 'set the sender email address');

  if (hasRealValue('MAIL_REPLY_TO_ADDRESS')) {
    if (!isEmail(readValue('MAIL_REPLY_TO_ADDRESS'))) {
      record(
        'warn',
        'Mail',
        'MAIL_REPLY_TO_ADDRESS',
        'reply-to email is invalid'
      );
    } else {
      record('ok', 'Mail', 'MAIL_REPLY_TO_ADDRESS', 'configured');
    }
  }
}

function checkSponsorMediaStorage() {
  if (
    !required(
      'Sponsor media',
      'SPONSOR_MEDIA_STORAGE_DRIVER',
      'set local or ovh-s3'
    )
  ) {
    return;
  }

  const driver = readValue('SPONSOR_MEDIA_STORAGE_DRIVER');
  if (driver === 'local') {
    required(
      'Sponsor media',
      'FUNDING_SPONSOR_LOGO_STORAGE_DIR',
      'set the local sponsor logo storage directory'
    );
    return;
  }

  if (driver !== 'ovh-s3') {
    record(
      'missing',
      'Sponsor media',
      'SPONSOR_MEDIA_STORAGE_DRIVER',
      'must be local or ovh-s3'
    );
    return;
  }

  required('Sponsor media', 'SPONSOR_MEDIA_REGION', 'set the OVH S3 region');
  requiredHttpsUrl(
    'Sponsor media',
    'SPONSOR_MEDIA_ENDPOINT',
    'set the OVH S3 https endpoint'
  );
  required(
    'Sponsor media',
    'SPONSOR_MEDIA_PUBLIC_BUCKET',
    'set the public sponsor media bucket'
  );
  requiredHttpsUrl(
    'Sponsor media',
    'SPONSOR_MEDIA_PUBLIC_BASE_URL',
    'set the public sponsor media base URL'
  );
  required(
    'Sponsor media',
    'SPONSOR_MEDIA_PRIVATE_BUCKET',
    'set the private sponsor media bucket'
  );
  requiredHttpsUrl(
    'Sponsor media',
    'SPONSOR_MEDIA_PRIVATE_BASE_URL',
    'set the private sponsor media base URL'
  );
  requiredSecret(
    'Sponsor media',
    'OVH_S3_ACCESS_KEY_ID',
    'set the OVH S3 access key id',
    8
  );
  requiredSecret(
    'Sponsor media',
    'OVH_S3_SECRET_ACCESS_KEY',
    'set the OVH S3 secret access key',
    16
  );
}

function checkCommand(command, commandArgs, section, label) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: 'pipe'
  });

  record(
    result.status === 0 ? 'ok' : 'warn',
    section,
    label,
    result.status === 0 ? 'available' : `${command} command not found`
  );
}

function record(status, section, label, detail) {
  checks.push({ status, section, label, detail });
}

function printReport() {
  process.stdout.write('OpenG7 funding services readiness\n');
  process.stdout.write(`Env file: ${args.envFile}\n`);
  process.stdout.write(
    'Scope: configuration and local tool availability only.\n'
  );
  process.stdout.write('Secrets: values are never printed.\n\n');

  for (const check of checks) {
    process.stdout.write(
      `${statusLabel(check.status)} ${check.section} / ${check.label}: ${maskDetail(
        check
      )}\n`
    );
  }

  const okCount = checks.filter((check) => check.status === 'ok').length;
  const warningCount = checks.filter((check) => check.status === 'warn').length;
  const missingChecks = checks.filter((check) => check.status === 'missing');

  process.stdout.write(
    `\nSummary: ${okCount} ok, ${warningCount} warning, ${missingChecks.length} missing\n`
  );

  if (missingChecks.length > 0) {
    process.stdout.write('\nMissing before full operations:\n');
    for (const check of missingChecks) {
      process.stdout.write(
        `- ${check.section} / ${check.label}: ${maskDetail(check)}\n`
      );
    }
    process.stdout.write(
      '\nNext: fill .env, then rerun yarn services:check.\n'
    );
    return;
  }

  process.stdout.write(
    '\nConfiguration looks ready. Recommended live checks: yarn storage:check, yarn email:verify, yarn prod:check.\n'
  );
}

function statusLabel(status) {
  if (status === 'ok') {
    return '[OK]';
  }

  if (status === 'warn') {
    return '[WARN]';
  }

  return '[MISSING]';
}

function maskDetail(check) {
  if (secretNames.has(check.label)) {
    return check.detail.replace(/configured|available|enabled/, 'present');
  }

  return check.detail;
}
