import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import test from 'node:test';

// Minimal ustar fixture lets Windows and Linux exercise unsafe entries identically.
const archive = (entries) => {
  const blocks = [];
  for (const { name, text = '', type = '0', link = '' } of entries) {
    const data = Buffer.from(text),
      header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000600\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156);
    header.write(type, 156);
    header.write(link, 157, 100);
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.write(
      [...header]
        .reduce((a, b) => a + b, 0)
        .toString(8)
        .padStart(6, '0') + '\0 ',
      148
    );
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
};
const cli = (args, input) => {
  try {
    return {
      code: 0,
      output: execFileSync(
        process.execPath,
        ['scripts/backup-artifacts.mjs', ...args],
        {
          encoding: 'utf8',
          input,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        }
      )
    };
  } catch (error) {
    return { code: error.status, output: error.stdout + error.stderr };
  }
};
test('backup integrity binds a complete artifact set, tolerates renaming, and refuses corruption, links and traversal', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'og7-backup-integrity-'));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  });
  const config = join(directory, 'config.tar.gz'),
    database = join(directory, 'database.sql'),
    media = join(directory, 'media.tar.gz');
  await writeFile(
    config,
    archive([
      { name: '.env', text: 'SYNTHETIC_SECRET=private-fixture\n' },
      { name: 'docker-compose.yml', text: 'services: {}\n' }
    ])
  );
  await writeFile(database, 'SELECT 1;\n');
  await writeFile(
    media,
    archive([{ name: 'private/image.webp', text: 'synthetic' }])
  );
  const create = async (driver = 'local') => {
    await rm(config + '.manifest.json', { force: true });
    assert.equal(cli(['manifest', config, database, media, driver]).code, 0);
  };
  await create();
  const verified = cli(['verify', config, database, media]);
  assert.equal(verified.code, 0, verified.output);
  const manifest = await readFile(config + '.manifest.json', 'utf8');
  assert.ok(!manifest.includes('private-fixture'));
  const renamed = join(directory, 'renamed.sql');
  await writeFile(renamed, await readFile(database));
  assert.equal(cli(['verify', config, renamed, media]).code, 0);
  await writeFile(renamed, 'SELECT 2;\n');
  assert.match(
    cli(['verify', config, renamed, media]).output,
    /checksum mismatch/
  );
  await create('ovh-s3');
  assert.equal(cli(['verify-s3', config, media]).code, 0);
  assert.equal(cli(['verify', config, database, media, 'ovh-s3']).code, 0);
  assert.notEqual(cli(['verify', config, renamed, media, 'ovh-s3']).code, 0);
  assert.notEqual(cli(['verify-s3', config, renamed]).code, 0);
  assert.notEqual(
    cli(['verify', config, database, media]).code,
    0,
    'remote media must never be extracted as a local volume'
  );
  for (const entry of [
    { name: '../escape' },
    { name: '/absolute' },
    { name: 'C:/escape' },
    { name: 'private/link', type: '2', link: '/outside' },
    { name: 'private/hardlink', type: '1', link: '../outside' }
  ]) {
    await writeFile(media, archive([entry]));
    await create();
    const result = cli(['verify', config, database, media]);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Unsafe archive path|links and special files/);
    await create('ovh-s3');
    assert.notEqual(cli(['verify-s3', config, media]).code, 0);
  }
  await writeFile(config + '.manifest.json', '{"private-fixture": invalid}');
  const invalid = cli(['verify', config, database, media]);
  assert.notEqual(invalid.code, 0);
  assert.ok(!invalid.output.includes('private-fixture'));
});

test('restore preflight rejects mismatched volumes, external networks and a remote application database', () => {
  const project = 'og7-recovery-fixture';
  const configuration = {
    name: project,
    volumes: {
      'postgres-data': { name: project + '-postgres-data' },
      'sponsor-logos': { name: project + '-sponsor-logos' }
    },
    networks: { data: { name: project + '-data' } },
    services: {
      postgres: {
        environment: { POSTGRES_DB: 'fixture' },
        volumes: [
          {
            type: 'volume',
            source: 'postgres-data',
            target: '/var/lib/postgresql/data'
          }
        ]
      },
      api: {
        environment: {
          DATABASE_URL: 'postgres://synthetic@postgres/fixture',
          SPONSOR_MEDIA_STORAGE_DRIVER: 'local'
        },
        volumes: [
          {
            type: 'volume',
            source: 'sponsor-logos',
            target: '/app/var/sponsor-logos'
          }
        ]
      }
    }
  };
  const check = (value) =>
    cli(['check-compose', project], JSON.stringify(value));
  assert.equal(check(configuration).code, 0);
  for (const change of [
    (c) => (c.volumes['postgres-data'].name = 'other-existing-volume'),
    (c) => (c.networks.data.external = true),
    (c) =>
      (c.services.api.environment.DATABASE_URL =
        'postgres://private-fixture@remote.example.test/fixture'),
    (c) => (c.services.postgres.volumes[0].type = 'bind')
  ]) {
    const altered = structuredClone(configuration);
    change(altered);
    const result = check(altered);
    assert.notEqual(result.code, 0);
    assert.ok(!result.output.includes('private-fixture'));
  }
});
