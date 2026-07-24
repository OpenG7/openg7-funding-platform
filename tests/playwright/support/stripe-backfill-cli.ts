import { execFileSync } from 'node:child_process';

// Runs the real stripe-backfill CLI (apps/funding-api/src/stripe-backfill.cli.ts,
// built into the `api` image at dist/apps/funding-api/src/stripe-backfill.cli.js)
// inside the already-running `api` container via `docker compose exec`, the
// same way scripts/e2e-seed.mjs shells into the `postgres` container -- the
// CLI's own main() calls process.exit() on failure and isn't safe to import
// directly (see apps/funding-api/src/stripe-backfill.cli.ts), so a
// subprocess is the only way to invoke it.
//
// No extra Stripe/Postgres flags are needed: the `api` container already has
// STRIPE_SECRET_KEY, STRIPE_API_HOST (pointed at the Stripe stub) and
// DATABASE_URL set (docker-compose.yml + docker-compose.e2e.yml), which is
// exactly what stripe-backfill.cli.ts reads by default.
export interface StripeBackfillSummary {
  readonly dryRun: boolean;
  readonly checkoutSessions: {
    readonly scanned: number;
    readonly matched: number;
    readonly skippedUnmatched: number;
    readonly upserted: number;
    readonly dryRunMatched: number;
  };
  readonly paymentIntents: {
    readonly seen: number;
    readonly insertedTransactions: number;
    readonly skippedExistingTransactions: number;
    readonly missingBalanceTransactions: number;
    readonly dryRunWouldInsertTransactions: number;
  };
  readonly refunds: {
    readonly seen: number;
    readonly insertedTransactions: number;
    readonly skippedExistingTransactions: number;
    readonly dryRunWouldInsertTransactions: number;
  };
  readonly [key: string]: unknown;
}

export const runStripeBackfill = (
  args: readonly string[] = []
): StripeBackfillSummary => {
  const stdout = execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'api',
      'node',
      'dist/apps/funding-api/src/stripe-backfill.cli.js',
      ...args
    ],
    { encoding: 'utf8' }
  );
  // The CLI's own progress logging (options.logger, wired to `console` in
  // stripe-backfill.cli.ts) writes plain-text lines to stdout before and
  // after the JSON summary -- "Stripe backfill started..."/"...completed." --
  // so the JSON is a suffix of stdout, not the whole of it.
  const jsonStart = stdout.indexOf('{');
  if (jsonStart === -1) {
    throw new Error(`stripe-backfill.cli.js produced no JSON summary:\n${stdout}`);
  }
  return JSON.parse(stdout.slice(jsonStart)) as StripeBackfillSummary;
};
