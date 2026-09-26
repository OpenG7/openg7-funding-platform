#!/usr/bin/env node
// Trusted recovery orchestration only. Never sources a shell file or logs configuration.
import { randomUUID } from 'node:crypto';
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

const keys = [
  'SPONSOR_MEDIA_ENDPOINT',
  'SPONSOR_MEDIA_REGION',
  'SPONSOR_MEDIA_PRIVATE_BUCKET',
  'SPONSOR_MEDIA_PUBLIC_BUCKET',
  'SPONSOR_MEDIA_PUBLIC_BASE_URL',
  'SPONSOR_MEDIA_PRIVATE_BASE_URL',
  'OVH_S3_ACCESS_KEY_ID',
  'OVH_S3_SECRET_ACCESS_KEY'
];
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value, flag = 'wx') =>
  writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag });
const [command, path, arg, confirmation, archive, stage] =
  process.argv.slice(2);
class RecoveryInputError extends Error {}
const phase =
  {
    'prepare-s3': 'S3 target preflight',
    'check-s3-compose': 'API storage configuration check',
    'restore-s3': 'S3 object recovery',
    report: 'Recovery report update'
  }[command] || 'Recovery command';
let client;
try {
  if (command === 'prepare-s3') {
    const { preflightS3Restore, s3BackupConfig } =
      await import('./lib/s3-backup.mjs');
    // Explicit file, never process.env: inherited source credentials cannot select a target.
    const values = parseEnv(await readFile(arg, 'utf8'));
    if (
      Object.keys(values).some((key) => ![...keys, 'NODE_ENV'].includes(key)) ||
      keys.some((key) => !values[key]) ||
      Object.values(values).some((value) => /['\r\n\x00]/.test(value))
    )
      throw new RecoveryInputError(
        'Target file must contain only the required S3 settings, without apostrophes or line breaks.'
      );
    for (const key of [
      'SPONSOR_MEDIA_ENDPOINT',
      'SPONSOR_MEDIA_PUBLIC_BASE_URL',
      'SPONSOR_MEDIA_PRIVATE_BASE_URL'
    ]) {
      const url = new URL(values[key]);
      if (
        values[key].endsWith('/') ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !(
          url.protocol === 'https:' ||
          (values.NODE_ENV === 'test' &&
            url.protocol === 'http:' &&
            url.hostname === '127.0.0.1')
        )
      )
        throw new RecoveryInputError(
          'Target URLs must use HTTPS without credentials, query, fragment or trailing slash.'
        );
    }
    const config = s3BackupConfig(values);
    client = config.client;
    await preflightS3Restore(
      config,
      join(path, '.recovery-media'),
      confirmation
    );
    await save(join(path, '.recovery-s3.json'), { values, confirmation });
    // Single-quoted literal values have identical semantics in Bash and Compose .env.
    // Apostrophes and line breaks are deliberately rejected above, not escaped ambiguously.
    await appendFile(
      join(path, '.env'),
      '\n' +
        Object.entries({
          ...Object.fromEntries(keys.map((key) => [key, values[key]])),
          SPONSOR_MEDIA_STORAGE_DRIVER: 'ovh-s3'
        })
          .map(([key, value]) => `${key}='${value}'`)
          .join('\n') +
        '\n'
    );
  } else if (command === 'check-s3-compose') {
    const { values } = await json(join(path, '.recovery-s3.json'));
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const environment = JSON.parse(input).services?.api?.environment;
    if (keys.some((key) => environment?.[key] !== values[key]))
      throw new RecoveryInputError(
        'API S3 configuration does not match the recovery target.'
      );
  } else if (command === 'restore-s3') {
    const { restoreS3, s3BackupConfig } = await import('./lib/s3-backup.mjs');
    const { values, confirmation: approved } = await json(
      join(path, '.recovery-s3.json')
    );
    const config = s3BackupConfig(values);
    client = config.client;
    const receipt = await restoreS3(
      config,
      join(path, '.recovery-media'),
      approved
    );
    const report = await json(arg);
    report.s3 = receipt;
    await save(arg + '.tmp', report);
    await rename(arg + '.tmp', arg);
  } else if (command === 'report') {
    if (arg === 'start') {
      const manifest = await json(archive + '.manifest.json');
      const target =
        manifest.mediaDriver === 'ovh-s3'
          ? (await json(join(stage, '.recovery-s3.json'))).values
          : null;
      await save(path, {
        version: 1,
        id: randomUUID(),
        project: confirmation,
        mediaDriver: manifest.mediaDriver,
        startedAt: new Date().toISOString(),
        state: 'in-progress',
        stage: 'prepared',
        database: 'pending',
        media: 'pending',
        applicationChecks: 'pending',
        ...(target
          ? {
              s3Target: {
                endpoint: target.SPONSOR_MEDIA_ENDPOINT,
                privateBucket: target.SPONSOR_MEDIA_PRIVATE_BUCKET,
                publicBucket: target.SPONSOR_MEDIA_PUBLIC_BUCKET
              }
            }
          : {}),
        artifacts: Object.fromEntries(
          Object.entries(manifest.artifacts).map(([role, a]) => [
            role,
            { bytes: a.bytes, sha256: a.sha256 }
          ])
        ),
        reconciliationRequired: [
          'provider-state',
          'worker-settings',
          ...(manifest.mediaDriver === 'ovh-s3'
            ? ['stored-public-media-urls', 'bucket-access']
            : [])
        ]
      });
    } else {
      const report = await json(path);
      if (arg === 'failed') report.state = 'failed';
      else if (arg === 'complete') {
        if (report.database !== 'restored' || report.media !== 'restored')
          throw new Error('Incomplete recovery.');
        report.state = 'restored-stopped';
        report.completedAt = new Date().toISOString();
      } else if (
        [
          'database-importing',
          'database-restored',
          'media-restoring',
          'media-restored'
        ].includes(arg)
      ) {
        report.stage = arg;
        const [role, state] = arg.split('-');
        report[role] = state;
      } else throw new Error('Unknown recovery stage.');
      report.updatedAt = new Date().toISOString();
      await save(path + '.tmp', report);
      await rename(path + '.tmp', path);
    }
  } else throw new Error('Unknown recovery command.');
} catch (error) {
  // Parse errors, SDK errors and child process output can contain private values.
  console.error(
    'FAIL: ' +
      phase +
      ' failed. ' +
      (error instanceof RecoveryInputError ? error.message + ' ' : '') +
      'Services remain stopped.'
  );
  process.exitCode = 1;
} finally {
  client?.destroy();
}
