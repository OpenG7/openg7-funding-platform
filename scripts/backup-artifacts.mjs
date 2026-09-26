#!/usr/bin/env node
// Metadata and preflight checks only. Never connects to an application/database.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const fingerprint = async (file) => {
  if (!(await stat(file)).isFile()) throw new Error('Expected a backup file.');
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  if (!bytes) throw new Error('Empty backup artifact.');
  return { name: basename(file), bytes, sha256: hash.digest('hex') };
};

const validateArchive = (file, configuration = false) => {
  // Trusted deployment archives may contain secrets. Never print their contents.
  const run = (flag) =>
    execFileSync('tar', [flag, './' + basename(file)], {
      cwd: dirname(resolve(file)),
      timeout: 30000,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    })
      .replace(/\r\n/g, '\n')
      .trim()
      .split('\n');
  const names = run('-tzf');
  if (
    names.some(
      (name) =>
        name.startsWith('/') ||
        name.includes(':') ||
        name.includes('\\') ||
        name.split('/').includes('..') ||
        /[\x00-\x1f]/.test(name)
    )
  )
    throw new Error('Unsafe archive path.');
  if (run('-tvzf').some((line) => !/^[-d]/.test(line)))
    throw new Error('Archive links and special files are not supported.');
  if (
    configuration &&
    !['.env', 'docker-compose.yml'].every((name) => names.includes(name))
  )
    throw new Error('Incomplete configuration archive.');
};

const [command, config, database, media, driver] = process.argv.slice(2);
try {
  if (command === 'manifest') {
    const artifacts = {};
    for (const [role, path] of Object.entries({ config, database, media })) {
      if (path !== '-') artifacts[role] = await fingerprint(path);
    }
    await writeFile(
      config + '.manifest.json',
      JSON.stringify(
        {
          version: 1,
          createdAt: new Date().toISOString(),
          environment: process.env.FUNDING_PLATFORM_ENV || 'unspecified',
          database: process.env.POSTGRES_DB || null,
          mediaDriver: driver,
          artifacts
        },
        null,
        2
      ) + '\n',
      { mode: 0o600, flag: 'wx' }
    );
  } else if (command === 'verify-s3') {
    const manifest = JSON.parse(
      await readFile(config + '.manifest.json', 'utf8')
    );
    if (manifest.version !== 1 || manifest.mediaDriver !== 'ovh-s3')
      throw new Error('Expected a completed S3 backup set.');
    for (const [role, file] of Object.entries({ config, media: database })) {
      const expected = manifest.artifacts?.[role],
        actual = await fingerprint(file);
      if (
        !expected ||
        actual.bytes !== expected.bytes ||
        actual.sha256 !== expected.sha256
      )
        throw new Error('Backup artifact checksum mismatch: ' + role);
    }
    validateArchive(config, true);
    validateArchive(database);
    console.log('S3 backup archive integrity verified.');
  } else if (command === 'verify') {
    const manifest = JSON.parse(
      await readFile(config + '.manifest.json', 'utf8')
    );
    if (manifest.version !== 1 || manifest.mediaDriver !== 'local')
      throw new Error(
        'This restore requires a completed local-media backup set. Restore S3 separately.'
      );
    for (const [role, path] of Object.entries({ config, database, media })) {
      if (!path || path === '-' || !manifest.artifacts?.[role])
        throw new Error(
          'Configuration, database and media artifacts are required.'
        );
      const actual = await fingerprint(path),
        expected = manifest.artifacts[role];
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
        throw new Error('Backup artifact checksum mismatch: ' + role);
    }
    validateArchive(config, true);
    validateArchive(media);
    console.log('Backup set integrity verified.');
  } else if (command === 'check-compose') {
    const project = config;
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const compose = JSON.parse(input);
    const db = compose.services?.postgres;
    const api = compose.services?.api;
    const expected = {
      'postgres-data': project + '-postgres-data',
      'sponsor-logos': project + '-sponsor-logos'
    };
    if (compose.name !== project || !db || !api)
      throw new Error('Unexpected restore project/services.');
    for (const [key, name] of Object.entries(expected)) {
      if (
        compose.volumes?.[key]?.name !== name ||
        compose.volumes[key].external
      )
        throw new Error('Restore volume does not match the dedicated target.');
    }
    for (const [key, network] of Object.entries(compose.networks || {})) {
      if (network.name !== project + '-' + key || network.external)
        throw new Error('Restore network does not match the dedicated target.');
    }
    if (
      !db.volumes?.some(
        (v) =>
          v.type === 'volume' &&
          v.source === 'postgres-data' &&
          v.target === '/var/lib/postgresql/data'
      ) ||
      !api.volumes?.some(
        (v) => v.type === 'volume' && v.source === 'sponsor-logos'
      )
    )
      throw new Error('Unexpected database/media mounts.');
    const url = new URL(api.environment?.DATABASE_URL);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== 'postgres' ||
      (url.port && url.port !== '5432') ||
      decodeURIComponent(url.pathname.slice(1)) !==
        db.environment.POSTGRES_DB ||
      api.environment.SPONSOR_MEDIA_STORAGE_DRIVER !== 'local'
    )
      throw new Error(
        'The API must use the restored PostgreSQL and local media.'
      );
    console.log('Dedicated Compose target verified.');
  } else throw new Error('Unknown backup artifact command.');
} catch (error) {
  // Child-process errors can include archive contents or private environment values.
  console.error(
    'FAIL: ' +
      (error.code ||
      error.status !== undefined ||
      error instanceof SyntaxError ||
      error instanceof TypeError
        ? 'Backup preflight failed.'
        : error.message)
  );
  process.exitCode = 1;
}
