import { Pool } from 'pg';
import Stripe from 'stripe';

import {
  runStripeBackfill,
  type StripeBackfillCreatedRange,
  type StripeBackfillOptions
} from './stripe-backfill.service.js';

interface ParsedBackfillArgs {
  readonly apiKey: string;
  readonly databaseUrl: string;
  readonly live: boolean;
  readonly test: boolean;
  readonly options: StripeBackfillOptions;
}

class BackfillCliUsageError extends Error {}

const usage = `Usage:
  yarn stripe:backfill [options]
  yarn stripe:backfill:live [options]

Options:
  --project <id>                 Funding project id to match in Stripe metadata.
                                 Default: FUNDING_PROJECT_ID or openg7.
  --include-unmatched            Import Checkout Sessions without matching project metadata.
  --from <date|unix>             Include Stripe objects created at or after this time.
  --to <date|unix>               Include Stripe objects created at or before this time.
  --limit <count>                Maximum objects to scan per Stripe resource.
  --api-key <sk_...>             Use an explicit Stripe secret key.
  --live                         Require a live Stripe secret key.
  --test                         Require a test Stripe secret key.
  --dry-run                      Read Stripe and PostgreSQL without writing rows.
  --skip-payouts                 Do not import payout transactions.
  --skip-refunds                 Do not import refund transactions.
  --skip-disputes                Do not update disputed contribution statuses.
  --no-assume-non-charity-acknowledged
                                 Keep legacy sessions without this metadata out of contribution totals.
`;

const parseTimestamp = (value: string, name: string): number => {
  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new BackfillCliUsageError(`Invalid ${name} value: ${value}`);
  }

  return Math.floor(parsed / 1000);
};

const readValue = (
  args: readonly string[],
  index: number,
  name: string
): string => {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new BackfillCliUsageError(`Missing value for ${name}.`);
  }

  return value;
};

const parsePositiveInteger = (value: string, name: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BackfillCliUsageError(`${name} must be a positive integer.`);
  }

  return parsed;
};

const setCreatedFrom = (
  created: StripeBackfillCreatedRange,
  value: string
): StripeBackfillCreatedRange => ({
  ...created,
  gte: parseTimestamp(value, '--from')
});

const setCreatedTo = (
  created: StripeBackfillCreatedRange,
  value: string
): StripeBackfillCreatedRange => ({
  ...created,
  lte: parseTimestamp(value, '--to')
});

const parseArgs = (rawArgs: readonly string[]): ParsedBackfillArgs => {
  let apiKey = process.env.STRIPE_SECRET_KEY ?? '';
  const databaseUrl = process.env.DATABASE_URL ?? '';
  let projectId = process.env.FUNDING_PROJECT_ID ?? 'openg7';
  let includeUnmatched = false;
  let includePayouts = true;
  let includeRefunds = true;
  let includeDisputes = true;
  let dryRun = false;
  let assumeNonCharityAcknowledged = true;
  let created: StripeBackfillCreatedRange = {};
  let maxRecords: number | null = null;
  let live = false;
  let test = false;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === '--help' || arg === '-h') {
      console.log(usage);
      process.exit(0);
    }

    if (arg === '--project') {
      projectId = readValue(rawArgs, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--project=')) {
      projectId = arg.slice('--project='.length);
      continue;
    }

    if (arg === '--api-key') {
      apiKey = readValue(rawArgs, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--api-key=')) {
      apiKey = arg.slice('--api-key='.length);
      continue;
    }

    if (arg === '--from' || arg === '--since') {
      created = setCreatedFrom(created, readValue(rawArgs, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--from=')) {
      created = setCreatedFrom(created, arg.slice('--from='.length));
      continue;
    }

    if (arg.startsWith('--since=')) {
      created = setCreatedFrom(created, arg.slice('--since='.length));
      continue;
    }

    if (arg === '--to') {
      created = setCreatedTo(created, readValue(rawArgs, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--to=')) {
      created = setCreatedTo(created, arg.slice('--to='.length));
      continue;
    }

    if (arg === '--limit' || arg === '--max-records') {
      maxRecords = parsePositiveInteger(readValue(rawArgs, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      maxRecords = parsePositiveInteger(
        arg.slice('--limit='.length),
        '--limit'
      );
      continue;
    }

    if (arg.startsWith('--max-records=')) {
      maxRecords = parsePositiveInteger(
        arg.slice('--max-records='.length),
        '--max-records'
      );
      continue;
    }

    if (arg === '--include-unmatched') {
      includeUnmatched = true;
      continue;
    }

    if (arg === '--skip-payouts') {
      includePayouts = false;
      continue;
    }

    if (arg === '--skip-refunds') {
      includeRefunds = false;
      continue;
    }

    if (arg === '--skip-disputes') {
      includeDisputes = false;
      continue;
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--live') {
      live = true;
      continue;
    }

    if (arg === '--test') {
      test = true;
      continue;
    }

    if (arg === '--no-assume-non-charity-acknowledged') {
      assumeNonCharityAcknowledged = false;
      continue;
    }

    throw new BackfillCliUsageError(`Unknown option: ${arg}`);
  }

  if (!apiKey) {
    throw new Error('STRIPE_SECRET_KEY is required for Stripe backfill.');
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for Stripe backfill.');
  }

  if (live && test) {
    throw new BackfillCliUsageError(
      'Choose either --live or --test, not both.'
    );
  }

  if (live && !apiKey.startsWith('sk_live_')) {
    throw new BackfillCliUsageError(
      '--live was passed but the selected Stripe key is not sk_live_...'
    );
  }

  if (test && !apiKey.startsWith('sk_test_')) {
    throw new BackfillCliUsageError(
      '--test was passed but the selected Stripe key is not sk_test_...'
    );
  }

  return {
    apiKey,
    databaseUrl,
    live,
    test,
    options: {
      projectId,
      includeUnmatched,
      includePayouts,
      includeRefunds,
      includeDisputes,
      dryRun,
      assumeNonCharityAcknowledged,
      created:
        created.gte === undefined && created.lte === undefined ? null : created,
      maxRecords,
      logger: console
    }
  };
};

const main = async (): Promise<void> => {
  const parsed = parseArgs(process.argv.slice(2));
  const stripe = new Stripe(parsed.apiKey);
  const pool = new Pool({
    connectionString: parsed.databaseUrl
  });

  try {
    const summary = await runStripeBackfill(stripe, pool, parsed.options);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

const getOperationalHint = (message: string): string | null => {
  if (message.includes('ENOTFOUND postgres')) {
    return [
      'Hint: DATABASE_URL points to host `postgres`, which only resolves inside Docker Compose.',
      'Run `corepack yarn stripe:backfill:docker --dry-run`, or run this command from a container on the Compose data network.'
    ].join('\n');
  }

  if (message.includes('ECONNREFUSED')) {
    return [
      'Hint: PostgreSQL refused the connection.',
      'Start the private database first with `corepack yarn db:up`, then retry the backfill.'
    ].join('\n');
  }

  return null;
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  const hint = getOperationalHint(message);
  if (hint) {
    console.error(hint);
  }

  if (error instanceof BackfillCliUsageError) {
    console.error(usage);
  }

  process.exitCode = 1;
});
