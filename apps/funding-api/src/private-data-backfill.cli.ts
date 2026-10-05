import { Pool } from 'pg';

import {
  protectHistoricalPrivateData,
  type PrivateDataBackfillOptions
} from './private-data-backfill.js';

const run = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const allowed = new Set([
    '--kind',
    '--before',
    '--limit',
    '--after-id',
    '--confirm-database',
    '--actor',
    '--request-id',
    '--apply',
    '--dry-run'
  ]);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!allowed.has(flag))
      throw new Error('PRIVATE_DATA_BACKFILL_ARGUMENTS_INVALID');
    if (!['--apply', '--dry-run'].includes(flag)) {
      if (!args[++i] || args[i].startsWith('--'))
        throw new Error('PRIVATE_DATA_BACKFILL_ARGUMENTS_INVALID');
    }
  }
  const kind = value('--kind');
  const before = value('--before');
  const limit = Number(value('--limit'));
  const apply = args.includes('--apply');
  if (
    !['email', 'checkout', 'stripe', 'sessions'].includes(kind ?? '') ||
    !before ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(before) ||
    (apply && args.includes('--dry-run'))
  )
    throw new Error('PRIVATE_DATA_BACKFILL_ARGUMENTS_INVALID');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('PRIVATE_DATA_BACKFILL_DATABASE_INVALID');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (apply && (!database || value('--confirm-database') !== database))
    throw new Error('PRIVATE_DATA_BACKFILL_DATABASE_CONFIRMATION_REQUIRED');
  const pool = new Pool({
    connectionString: url.toString(),
    options: '-c statement_timeout=30000 -c lock_timeout=5000'
  });
  try {
    const result = await protectHistoricalPrivateData(pool, {
      kind: kind as PrivateDataBackfillOptions['kind'],
      before,
      limit,
      afterId: value('--after-id'),
      apply,
      actor: value('--actor'),
      requestId: value('--request-id')
    });
    console.info(JSON.stringify({ kind, ...result }));
  } finally {
    await pool.end();
  }
};

run().catch(() => {
  // Errors from pg/URL/crypto can contain credentials or private values.
  console.error(
    'Private data maintenance failed. Verify scope, configuration and database before retrying.'
  );
  process.exitCode = 1;
});
