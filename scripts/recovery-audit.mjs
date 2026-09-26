#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, open } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, promisify } from 'node:util';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3BackupConfig } from './lib/s3-backup.mjs';
import { fingerprintStream } from './lib/recovery-media-reader.mjs';
import {
  mediaReferences,
  safeKey,
  summarizeAudit
} from './lib/recovery-audit.mjs';

const usage = `Usage: node scripts/recovery-audit.mjs --target-dir <recovery-checkout> --target-project <project> --output <new-private-report.json> [--public-base-url <expected-https-origin>]
Requires Node 22, local Docker, a completed recovery-report.json and stopped application services.
Reads PostgreSQL in a read-only transaction and media using only reads.
Local media uses a temporary container with a read-only volume and no network.
No application startup, migration, repair, provider reconciliation or activation is performed.
Exit 0: checks completed (review still required); 2: consistency findings; 1: incomplete/refused audit.
`;
const root = dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);
// Compose must never inherit a source DATABASE_URL, storage credentials or project settings.
const cleanEnv = Object.fromEntries(
  [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'DOCKER_CONFIG',
    'DOCKER_CONTEXT'
  ]
    .filter((k) => process.env[k])
    .map((k) => [k, process.env[k]])
);
const run = async (command, args, input = '', timeout = 60000) => {
  const pending = exec(command, args, {
    env: cleanEnv,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout
  });
  pending.child.stdin.on('error', () => {}); // The child exit status remains authoritative.
  pending.child.stdin.end(input);
  return (await pending).stdout.trim();
};
let output, client, docker, mediaContainer;
let phase = 'arguments';
const audit = {
  version: 1,
  id: randomUUID(),
  startedAt: new Date().toISOString(),
  scope: 'restored-data-consistency',
  integrity: 'incomplete',
  activation: 'not-authorized'
};
try {
  const args = process.argv.slice(2),
    options = {};
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    process.exit(0);
  }
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index],
      value = args[index + 1];
    if (
      ![
        '--target-dir',
        '--target-project',
        '--output',
        '--public-base-url'
      ].includes(key) ||
      options[key] ||
      !value ||
      value.startsWith('--')
    )
      throw new Error('Invalid audit arguments.');
    options[key] = value;
  }
  if (
    Number(process.versions.node.split('.')[0]) !== 22 ||
    !options['--target-dir'] ||
    !options['--output'] ||
    !/^[a-z0-9][a-z0-9_-]{2,49}$/.test(options['--target-project'] || '')
  )
    throw new Error('Explicit target and Node 22 are required.');
  const directory = resolve(options['--target-dir']),
    project = options['--target-project'];
  let expectedOrigin = null;
  if (options['--public-base-url']) {
    const url = new URL(options['--public-base-url']);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error('Expected a HTTPS origin.');
    expectedOrigin = url.origin;
  }
  phase = 'output-reservation';
  // Never overwrite a prior report, symlink, .env, or other existing file.
  output = await open(resolve(options['--output']), 'wx', 0o600);
  audit.project = project;
  phase = 'recovery-evidence';
  const evidence = JSON.parse(
    await readFile(join(directory, 'recovery-report.json'), 'utf8')
  );
  if (
    evidence.version !== 1 ||
    evidence.project !== project ||
    evidence.state !== 'restored-stopped' ||
    evidence.database !== 'restored' ||
    evidence.media !== 'restored' ||
    !/^[0-9a-f-]{36}$/.test(evidence.id)
  )
    throw new Error('Completed target evidence required.');
  audit.recoveryId = evidence.id;
  audit.mediaDriver = evidence.mediaDriver;
  phase = 'docker-target';
  const context = await run('docker', ['context', 'show']);
  const endpoint = await run('docker', [
    'context',
    'inspect',
    context,
    '--format',
    '{{.Endpoints.docker.Host}}'
  ]);
  if (!/^(npipe|unix):\/\//.test(endpoint))
    throw new Error('Local Docker required.');
  docker = (args, input, timeout) =>
    run('docker', ['--context', context, ...args], input, timeout);
  const compose = [
    'compose',
    '--project-directory',
    directory,
    '--env-file',
    join(directory, '.env'),
    '-p',
    project,
    '-f',
    join(directory, 'docker-compose.yml'),
    '--profile',
    'database'
  ];
  const rawConfiguration = await docker([
    ...compose,
    'config',
    '--format',
    'json'
  ]);
  await run(
    process.execPath,
    [
      join(root, 'backup-artifacts.mjs'),
      'check-compose',
      project,
      evidence.mediaDriver
    ],
    rawConfiguration
  );
  const configuration = JSON.parse(rawConfiguration);
  const environment = configuration.services.api.environment;
  const targetSettings = parseEnv(
    await readFile(join(directory, '.env'), 'utf8')
  );
  environment.FUNDING_OPERATIONS_WATCHER_ENABLED =
    targetSettings.FUNDING_OPERATIONS_WATCHER_ENABLED;
  const pgEnvironment = configuration.services.postgres.environment;
  if (
    ![pgEnvironment.POSTGRES_USER, pgEnvironment.POSTGRES_DB].every((s) =>
      /^[A-Za-z0-9_-]{1,63}$/.test(s || '')
    )
  )
    throw new Error('Unsupported PostgreSQL target name.');
  const assertStopped = async () => {
    const ids = (
      await docker([
        'ps',
        '-aq',
        '--filter',
        'label=com.docker.compose.project=' + project
      ])
    )
      .split(/\s+/)
      .filter(Boolean);
    if (!ids.length) throw new Error('Target is absent.');
    const containers = JSON.parse(await docker(['inspect', ...ids]));
    const running = containers.filter((c) => c.State.Running);
    if (
      running.length !== 1 ||
      running[0].Config.Labels['com.docker.compose.service'] !== 'postgres'
    )
      throw new Error('Application services must remain stopped.');
    const postgres = running[0];
    if (
      !postgres.Mounts.some(
        (m) =>
          m.Type === 'volume' &&
          m.Name === project + '-postgres-data' &&
          m.Destination === '/var/lib/postgresql/data'
      )
    )
      throw new Error('Unexpected database volume.');
    for (const key of ['POSTGRES_USER', 'POSTGRES_DB'])
      if (!postgres.Config.Env.includes(key + '=' + pgEnvironment[key]))
        throw new Error('Database target differs from Compose.');
    return postgres.Id;
  };
  const postgresId = await assertStopped();
  phase = 'database-read';
  const snapshot = JSON.parse(
    await docker(
      [
        'exec',
        '-i',
        '-e',
        'PGOPTIONS=-c default_transaction_read_only=on',
        '-e',
        'PGCONNECT_TIMEOUT=10',
        '-e',
        'PGAPPNAME=openg7-recovery-audit',
        postgresId,
        'psql',
        '-X',
        '-qAt',
        '-v',
        'ON_ERROR_STOP=1',
        '-v',
        'VERBOSITY=terse',
        '-h',
        '/var/run/postgresql',
        '-p',
        '5432',
        '-U',
        pgEnvironment.POSTGRES_USER,
        '-d',
        pgEnvironment.POSTGRES_DB
      ],
      await readFile(join(root, 'sql/recovery-audit.sql'), 'utf8')
    )
  );
  phase = 'media-read';
  const media = mediaReferences(snapshot, environment, expectedOrigin);
  let results;
  if (evidence.mediaDriver === 'local') {
    const volume = project + '-sponsor-logos';
    await docker(['volume', 'inspect', volume]);
    mediaContainer = project + '-audit-' + randomUUID().slice(0, 8);
    const program =
      (await readFile(join(root, 'lib/recovery-media-reader.mjs'), 'utf8')) +
      '\nlet input = ""; for await (const chunk of process.stdin) input += chunk; console.log(JSON.stringify(await readLocalMedia(JSON.parse(input), "/media")));';
    results = JSON.parse(
      await docker(
        [
          'run',
          '--rm',
          '-i',
          '--pull',
          'never',
          '--name',
          mediaContainer,
          '--network',
          'none',
          '--read-only',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges:true',
          '--pids-limit',
          '32',
          '--memory',
          '256m',
          '--mount',
          `type=volume,src=${volume},dst=/media,readonly,volume-nocopy`,
          '--entrypoint',
          'node',
          configuration.services.api.image,
          '--input-type=module',
          '--eval',
          program
        ],
        JSON.stringify(media.references),
        120000
      )
    );
  } else {
    const config = s3BackupConfig(environment);
    client = config.client;
    if (
      !evidence.s3Target ||
      evidence.s3Target.endpoint !== environment.SPONSOR_MEDIA_ENDPOINT ||
      evidence.s3Target.privateBucket !== config.buckets.private ||
      evidence.s3Target.publicBucket !== config.buckets.public
    )
      throw new Error('S3 target differs from recovery evidence.');
    const deadline = AbortSignal.timeout(600000);
    results = [];
    for (const reference of media.references) {
      if (deadline.aborted) throw new Error('Media audit time limit.');
      if (!safeKey(reference.key)) {
        results.push({ status: 'unsafe_key' });
        continue;
      }
      let body;
      try {
        const signal = AbortSignal.any([deadline, AbortSignal.timeout(60000)]);
        const response = await client.send(
          new GetObjectCommand({
            Bucket: config.buckets[reference.role],
            Key: reference.key
          }),
          { abortSignal: signal }
        );
        body = response.Body;
        const abort = () => body.destroy(new Error('Media read timed out.'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        try {
          results.push(await fingerprintStream(body, reference));
        } finally {
          signal.removeEventListener('abort', abort);
        }
      } catch (error) {
        body?.destroy();
        results.push({
          status: ['NoSuchKey', 'NotFound'].includes(error.name)
            ? 'missing'
            : 'unreadable'
        });
      }
    }
  }
  phase = 'final-target-check';
  if ((await assertStopped()) !== postgresId)
    throw new Error('Database changed during the audit.');
  Object.assign(audit, summarizeAudit(snapshot, media, results, environment));
  audit.completedAt = new Date().toISOString();
  process.exitCode = audit.integrity === 'passed' ? 0 : 2;
} catch {
  audit.integrity = 'incomplete';
  audit.failedPhase = phase;
  process.exitCode = 1;
  console.error(
    'FAIL: Recovery audit incomplete at ' +
      phase +
      '; no activation authorized.'
  );
} finally {
  client?.destroy();
  if (mediaContainer && docker)
    await docker(['rm', '-f', mediaContainer]).catch(() => {});
  if (output) {
    try {
      await output.writeFile(JSON.stringify(audit, null, 2) + '\n');
      await output.close();
      console.log(
        'Recovery audit recorded: ' +
          audit.integrity +
          '. Provider reconciliation and activation remain separate.'
      );
    } catch {
      await output.close().catch(() => {});
      process.exitCode = 1;
      console.error('FAIL: Could not finish the private audit report.');
    }
  }
}
