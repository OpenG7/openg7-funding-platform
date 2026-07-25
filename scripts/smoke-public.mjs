#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

// Read-only, prod-like smoke test for a deployed OpenG7 funding stack.
//
// This is a NON-DESTRUCTIVE complement to scripts/check.sh (prod:check).
// Unlike check.sh -- which is Bash + openssl, tied to the exact production
// domain, and reads the local Traefik/cAdvisor dashboards -- this script is
// portable Node that runs against any base URL (the local Docker web
// container, a staging URL, or production) on Windows, macOS or Linux.
//
// Guarantees:
//   - GET only. It never mutates data, never calls Stripe, never sends email.
//   - No live keys required. It only reads public endpoints plus one
//     unauthenticated admin probe that must be REJECTED.
//   - It never prints secret values. It scans every response body for
//     secret- and PII-shaped content and fails if any is found, but it
//     prints only the field/pattern name that matched, never the value.
//   - Non-zero exit code on any failure, zero on success.
//
// Usage:
//   node scripts/smoke-public.mjs [--base-url <url>] [--expect-secure-headers]
//                                 [--timeout <ms>] [--help]
//
// Base URL resolution order: --base-url, SMOKE_BASE_URL, PLAYWRIGHT_BASE_URL,
// then the local default http://127.0.0.1:8080.
//
// --expect-secure-headers makes the Traefik security headers (HSTS, CSP,
// X-Frame-Options, ...) a hard requirement. It is off by default because a
// smoke run pointed straight at the web container (bypassing Traefik) will
// not see those headers; point it at the HTTPS domain and pass the flag to
// enforce them.

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
const DEFAULT_TIMEOUT_MS = 10_000;

// Public JSON payloads must never carry these private field names. Mirrors
// the assertions in tests/playwright/docker-public-smoke.spec.ts.
const FORBIDDEN_PUBLIC_FIELDS = [
  'sponsor_contact_email',
  'sponsor_contact_name',
  'email_private',
  'contact_email',
  'stripe_session_id',
  'stripe_payment_intent_id',
  'stripe_customer_id',
  'followup_token',
  'sponsorship_followup_token',
  'admin_note',
  'admin_notes'
];

// Secret-shaped substrings that must never appear in any response body.
const SECRET_PATTERNS = [
  /sk_live_[0-9a-zA-Z]/,
  /sk_test_[0-9a-zA-Z]/,
  /rk_live_[0-9a-zA-Z]/,
  /whsec_[0-9a-zA-Z]/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /SMTP_PASSWORD/,
  /OVH_S3_SECRET_ACCESS_KEY/,
  /FUNDING_ADMIN_TOKEN/,
  /FUNDING_ADMIN_SESSION_SECRET/
];

const REQUIRED_SECURE_HEADERS = [
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'content-security-policy'
];

const USAGE = `Usage: node scripts/smoke-public.mjs [options]

Read-only smoke test for a deployed OpenG7 funding stack. GET requests only.

Options:
  --base-url <url>          Target base URL (default resolution: --base-url,
                            SMOKE_BASE_URL, PLAYWRIGHT_BASE_URL, then
                            ${DEFAULT_BASE_URL}).
  --expect-secure-headers   Require Traefik security headers on GET /.
  --timeout <ms>            Per-request timeout in milliseconds
                            (default ${DEFAULT_TIMEOUT_MS}).
  --help                    Show this help message.

The script never prints secret values and never mutates remote state.
`;

export function parseArgs(argv) {
  const parsed = {
    baseUrl: null,
    expectSecureHeaders: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--expect-secure-headers') {
      parsed.expectSecureHeaders = true;
      continue;
    }

    if (arg === '--base-url') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--base-url requires a URL');
      }
      parsed.baseUrl = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--base-url=')) {
      parsed.baseUrl = arg.slice('--base-url='.length);
      continue;
    }

    if (arg === '--timeout') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--timeout requires a value in milliseconds');
      }
      parsed.timeoutMs = requirePositiveInteger(value);
      index += 1;
      continue;
    }

    if (arg.startsWith('--timeout=')) {
      parsed.timeoutMs = requirePositiveInteger(arg.slice('--timeout='.length));
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

function requirePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

export function resolveBaseUrl(explicit, env = process.env) {
  const candidate =
    explicit ||
    env.SMOKE_BASE_URL ||
    env.PLAYWRIGHT_BASE_URL ||
    DEFAULT_BASE_URL;
  const normalized = candidate.replace(/\/+$/, '');

  // Throws on an invalid URL so a typo fails fast instead of producing
  // confusing per-check connection errors.
  // eslint-disable-next-line no-new
  new URL(normalized);
  return normalized;
}

// Returns the private field names that appear in the raw body, if any.
export function findForbiddenFields(rawBody) {
  const haystack = rawBody.toLowerCase();
  return FORBIDDEN_PUBLIC_FIELDS.filter((field) =>
    haystack.includes(field.toLowerCase())
  );
}

// Returns the names (never the values) of any secret-shaped matches.
export function scanForSecrets(rawBody) {
  return SECRET_PATTERNS.filter((pattern) => pattern.test(rawBody)).map(
    (pattern) => pattern.source
  );
}

async function fetchWithTimeout(url, options, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Runs every read-only check and returns a structured result. Injectable
// `fetchImpl` and `log` keep this unit-testable without a real server.
export async function runSmokeChecks({
  baseUrl,
  expectSecureHeaders = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  log = () => {}
} = {}) {
  const results = [];

  const record = (status, name, detail) => {
    results.push({ status, name, detail });
    const label =
      status === 'ok' ? '[OK]' : status === 'warn' ? '[WARN]' : '[FAIL]';
    log(`${label} ${name}: ${detail}`);
  };

  const get = async (path, { method = 'GET' } = {}) => {
    const url = `${baseUrl}${path}`;
    const response = await fetchWithTimeout(
      url,
      { method, redirect: 'manual' },
      timeoutMs,
      fetchImpl
    );
    const body = await response.text();
    return { response, body };
  };

  // Scans a body and records a failure if anything sensitive leaked. Returns
  // true when the body is clean.
  const assertNoLeak = (name, body) => {
    const secrets = scanForSecrets(body);
    if (secrets.length > 0) {
      record('fail', `${name} secret scan`, `matched: ${secrets.join(', ')}`);
      return false;
    }
    return true;
  };

  const runCheck = async (name, fn) => {
    try {
      await fn();
    } catch (error) {
      record('fail', name, safeErrorMessage(error));
    }
  };

  await runCheck('GET /health', async () => {
    const { response, body } = await get('/health');
    if (response.status !== 200) {
      record(
        'fail',
        'GET /health',
        `expected 200, received ${response.status}`
      );
      return;
    }
    if (body.trim() !== 'ok') {
      record('fail', 'GET /health', 'body was not "ok"');
      return;
    }
    record('ok', 'GET /health', 'returned 200 ok');
  });

  await runCheck('GET /', async () => {
    const { response, body } = await get('/');
    if (response.status !== 200) {
      record('fail', 'GET /', `expected 200, received ${response.status}`);
      return;
    }
    if (!/<html/i.test(body)) {
      record('fail', 'GET /', 'Angular shell HTML was not served');
      return;
    }
    if (!assertNoLeak('GET /', body)) {
      return;
    }

    if (expectSecureHeaders) {
      const missing = REQUIRED_SECURE_HEADERS.filter(
        (header) => !response.headers.get(header)
      );
      if (missing.length > 0) {
        record('fail', 'Secure headers', `missing: ${missing.join(', ')}`);
        return;
      }
      record('ok', 'Secure headers', 'all required headers present');
    } else {
      const present = REQUIRED_SECURE_HEADERS.filter((header) =>
        response.headers.get(header)
      );
      record(
        'warn',
        'Secure headers',
        `${present.length}/${REQUIRED_SECURE_HEADERS.length} present (pass --expect-secure-headers to enforce)`
      );
    }

    record('ok', 'GET /', 'served the Angular shell');
  });

  await runCheck('GET /api/public/funding-config', async () => {
    const { response, body } = await get('/api/public/funding-config');
    if (response.status !== 200) {
      record(
        'fail',
        'GET /api/public/funding-config',
        `expected 200, received ${response.status}`
      );
      return;
    }
    if (!assertNoLeak('GET /api/public/funding-config', body)) {
      return;
    }
    const json = parseJson(body);
    if (!json || typeof json.business_sponsorship_enabled !== 'boolean') {
      record(
        'fail',
        'GET /api/public/funding-config',
        'missing boolean business_sponsorship_enabled'
      );
      return;
    }
    record(
      'ok',
      'GET /api/public/funding-config',
      `business_sponsorship_enabled=${json.business_sponsorship_enabled}`
    );
  });

  await runCheck('GET /api/public/fund-transparency', async () => {
    const { response, body } = await get('/api/public/fund-transparency');
    if (response.status !== 200) {
      record(
        'fail',
        'GET /api/public/fund-transparency',
        `expected 200, received ${response.status}`
      );
      return;
    }
    if (!assertNoLeak('GET /api/public/fund-transparency', body)) {
      return;
    }
    const forbidden = findForbiddenFields(body);
    if (forbidden.length > 0) {
      record(
        'fail',
        'GET /api/public/fund-transparency',
        `exposed private field(s): ${forbidden.join(', ')}`
      );
      return;
    }
    if (!parseJson(body)) {
      record(
        'fail',
        'GET /api/public/fund-transparency',
        'response was not valid JSON'
      );
      return;
    }
    record(
      'ok',
      'GET /api/public/fund-transparency',
      'JSON with no PII fields'
    );
  });

  await runCheck('GET /api/public/sponsorships', async () => {
    const { response, body } = await get('/api/public/sponsorships');
    if (response.status !== 200) {
      record(
        'fail',
        'GET /api/public/sponsorships',
        `expected 200, received ${response.status}`
      );
      return;
    }
    if (!assertNoLeak('GET /api/public/sponsorships', body)) {
      return;
    }
    const forbidden = findForbiddenFields(body);
    if (forbidden.length > 0) {
      record(
        'fail',
        'GET /api/public/sponsorships',
        `exposed private field(s): ${forbidden.join(', ')}`
      );
      return;
    }
    if (!parseJson(body)) {
      record(
        'fail',
        'GET /api/public/sponsorships',
        'response was not valid JSON'
      );
      return;
    }
    record('ok', 'GET /api/public/sponsorships', 'JSON with no private fields');
  });

  // Unauthenticated admin probe: the boundary MUST reject it. 200 means the
  // admin API is exposed without a session -- a critical failure.
  await runCheck('GET /api/admin/dashboard (unauthenticated)', async () => {
    const { response, body } = await get('/api/admin/dashboard');
    if (!assertNoLeak('GET /api/admin/dashboard', body)) {
      return;
    }
    if (response.status === 200) {
      record(
        'fail',
        'Admin boundary',
        'unauthenticated /api/admin/dashboard returned 200'
      );
      return;
    }
    if ([401, 403, 503].includes(response.status)) {
      record(
        'ok',
        'Admin boundary',
        `unauthenticated request rejected with ${response.status}`
      );
      return;
    }
    record(
      'warn',
      'Admin boundary',
      `unexpected status ${response.status}; expected 401/403/503`
    );
  });

  const failures = results.filter((result) => result.status === 'fail');
  const warnings = results.filter((result) => result.status === 'warn');
  return { ok: failures.length === 0, results, failures, warnings };
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function safeErrorMessage(error) {
  if (error && typeof error === 'object' && 'name' in error) {
    if (error.name === 'AbortError') {
      return 'request timed out';
    }
    if ('code' in error && error.code) {
      return `request failed (${error.code})`;
    }
  }
  return 'request failed';
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  let baseUrl;
  try {
    baseUrl = resolveBaseUrl(options.baseUrl);
  } catch {
    process.stderr.write('The resolved base URL is not a valid URL.\n');
    process.exitCode = 2;
    return;
  }

  process.stdout.write('OpenG7 public smoke test (read-only)\n');
  process.stdout.write(`Target: ${baseUrl}\n`);
  process.stdout.write('Method: GET requests only, no mutations.\n\n');

  const { ok, results, failures, warnings } = await runSmokeChecks({
    baseUrl,
    expectSecureHeaders: options.expectSecureHeaders,
    timeoutMs: options.timeoutMs,
    log: (line) => process.stdout.write(`${line}\n`)
  });

  const okCount = results.filter((result) => result.status === 'ok').length;
  process.stdout.write(
    `\nSummary: ${okCount} ok, ${warnings.length} warning, ${failures.length} failed\n`
  );

  if (!ok) {
    process.stdout.write('\nFailures:\n');
    for (const failure of failures) {
      process.stdout.write(`- ${failure.name}: ${failure.detail}\n`);
    }
  }

  process.exitCode = ok ? 0 : 1;
}

// Cross-platform "is this the entry module?" check. On Windows the file://
// URL carries a drive letter and backslashes, so build it with pathToFileURL
// rather than string-concatenating a file:// prefix.
const invokedDirectly =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  await main();
}
