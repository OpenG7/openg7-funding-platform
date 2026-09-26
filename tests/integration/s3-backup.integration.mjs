import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  symlink
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3';
import { startDisposableProvider } from './support/disposable-provider.mjs';
import { captureS3, restoreS3 } from '../../scripts/lib/s3-backup.mjs';

const exec = promisify(execFile);
test(
  'real backup script captures paginated S3 media; CLI restores private verified objects, rejects corruption, source and occupied targets',
  { timeout: 240000 },
  async (t) => {
    const provider = await startDisposableProvider('s3');
    t.after(provider.stop);
    const endpoint = `http://127.0.0.1:${provider.ports[9090]}`;
    const client = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'fixture',
        secretAccessKey: 'synthetic-s3-backup-secret'
      }
    });
    t.after(() => client.destroy());
    const deadline = Date.now() + 60000;
    while (true) {
      try {
        await client.send(
          new CreateBucketCommand({ Bucket: 'source-private' })
        );
        break;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await setTimeout(500);
      }
    }
    for (const Bucket of [
      'source-public',
      'target-private',
      'target-public',
      'corrupt-private',
      'corrupt-public',
      'cycle-private',
      'cycle-public'
    ])
      await client.send(new CreateBucketCommand({ Bucket }));
    // Cross a real ListObjectsV2 page boundary, including an empty object and nested keys.
    for (let start = 0; start < 1001; start += 25)
      await Promise.all(
        Array.from({ length: Math.min(25, 1001 - start) }, (_, offset) =>
          client.send(
            new PutObjectCommand({
              Bucket: 'source-private',
              Key: `media/${start + offset}.webp`,
              Body: String(start + offset),
              ContentType: 'image/webp',
              CacheControl: 'private, no-store',
              Metadata: { provenance: 'synthetic' }
            })
          )
        )
      );
    await client.send(
      new PutObjectCommand({
        Bucket: 'source-public',
        Key: 'public/approved.webp',
        Body: 'approved-copy',
        ContentType: 'image/webp',
        ACL: 'public-read',
        CacheControl: 'public, max-age=31536000, immutable'
      })
    );
    await client.send(
      new PutObjectCommand({ Bucket: 'source-private', Key: 'empty', Body: '' })
    );
    const root = await mkdtemp(join(tmpdir(), 'og7-s3-backup-'));
    t.after(async () => {
      assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
      assert.ok(root.split(sep).pop().startsWith('og7-s3-backup-'));
      await rm(root, { recursive: true, force: true });
    });
    for (const file of [
      'scripts/backup.sh',
      'scripts/load-env.sh',
      'scripts/backup-artifacts.mjs',
      'scripts/storage-backup.mjs',
      'scripts/lib/s3-backup.mjs'
    ]) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(
        join(root, file),
        (await readFile(file, 'utf8')).replaceAll('\r\n', '\n')
      );
    }
    await symlink(
      resolve('node_modules'),
      join(root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    for (const file of [
      'docker-compose.yml',
      '.env.example',
      '.dockerignore',
      'apps/funding-api/Dockerfile',
      'apps/funding-web/Dockerfile',
      'apps/funding-web/nginx.conf',
      'traefik/fixture.yml',
      'docs/fixture.md'
    ]) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), '# synthetic\n');
    }
    const settings = {
      NODE_ENV: 'test',
      DATABASE_URL: '',
      SPONSOR_MEDIA_STORAGE_DRIVER: 'ovh-s3',
      SPONSOR_MEDIA_ENDPOINT: endpoint,
      SPONSOR_MEDIA_REGION: 'us-east-1',
      SPONSOR_MEDIA_PRIVATE_BUCKET: 'source-private',
      SPONSOR_MEDIA_PUBLIC_BUCKET: 'source-public',
      OVH_S3_ACCESS_KEY_ID: 'fixture',
      OVH_S3_SECRET_ACCESS_KEY: 'synthetic-s3-backup-secret'
    };
    await writeFile(
      join(root, '.env'),
      Object.entries(settings)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n'
    );
    await mkdir(join(root, 'bin'));
    await writeFile(
      join(root, 'bin/node'),
      '#!/usr/bin/env bash\nexec "$OPENG7_TEST_NODE" "$@"\n',
      { mode: 0o755 }
    );
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
        'APPDATA'
      ]
        .filter((k) => process.env[k])
        .map((k) => [k, process.env[k]])
    );
    const bash =
      process.platform === 'win32'
        ? 'C:/Program Files/Git/bin/bash.exe'
        : 'bash';
    const backup = await exec(
      bash,
      ['-c', 'export PATH="$PWD/bin:$PATH"\nbash scripts/backup.sh'],
      {
        cwd: root,
        env: {
          ...cleanEnv,
          OPENG7_TEST_NODE: process.execPath.replaceAll('\\', '/')
        },
        timeout: 120000,
        windowsHide: true
      }
    );
    assert.match(backup.stdout, /Backup set complete/);
    assert.doesNotMatch(
      backup.stdout + backup.stderr,
      /synthetic-s3-backup-secret/
    );
    const names = await readdir(join(root, 'backups'));
    const config = names.find((n) => /^openg7-backup-.*\.tar.gz$/.test(n));
    const manifest = JSON.parse(
      await readFile(join(root, 'backups', config + '.manifest.json'), 'utf8')
    );
    assert.equal(manifest.mediaDriver, 'ovh-s3');
    const media = join(root, 'backups', manifest.artifacts.media.name);
    assert.equal(
      createHash('sha256')
        .update(await readFile(media))
        .digest('hex'),
      manifest.artifacts.media.sha256
    );
    const unpacked = join(root, 'unpacked');
    await mkdir(unpacked);
    await exec('tar', ['-xzf', media, '-C', unpacked]);
    const inventory = JSON.parse(
      await readFile(join(unpacked, 'manifest.json'), 'utf8')
    );
    assert.equal(inventory.objects.length, 1003);
    const run = (command, overrides = {}, confirmation) =>
      exec(
        process.execPath,
        [
          join(root, 'scripts/storage-backup.mjs'),
          command,
          unpacked,
          ...(confirmation ? [confirmation] : [])
        ],
        {
          env: { ...cleanEnv, ...settings, ...overrides },
          timeout: 120000,
          windowsHide: true
        }
      );
    await run('verify');
    await assert.rejects(run('restore', {}, 'source-private,source-public'));
    const target = {
      SPONSOR_MEDIA_PRIVATE_BUCKET: 'target-private',
      SPONSOR_MEDIA_PUBLIC_BUCKET: 'target-public'
    };
    // S3Mock does not implement bucket policy/ACL inspection. Only those control-plane
    // responses are synthetic; object listing, conditional writes and byte reads use S3Mock.
    const writes = [];
    let unsafePolicy = false;
    const proxy = createServer((req, res) => {
      const url = new URL(req.url, endpoint);
      if (url.searchParams.has('acl') && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/xml');
        res.end(
          '<AccessControlPolicy xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>fixture</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>fixture</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>'
        );
        return;
      }
      if (url.searchParams.has('policy') && req.method === 'GET') {
        if (unsafePolicy)
          res
            .writeHead(200, { 'Content-Type': 'application/json' })
            .end('{"Statement":[{"Effect":"Allow","Principal":"*"}]}');
        else
          res
            .writeHead(404, { 'Content-Type': 'application/xml' })
            .end('<Error><Code>NoSuchBucketPolicy</Code></Error>');
        return;
      }
      if (req.method === 'PUT')
        writes.push({
          key: url.pathname,
          acl: req.headers['x-amz-acl'],
          condition: req.headers['if-none-match']
        });
      const upstream = request(
        url,
        { method: req.method, headers: req.headers },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        }
      );
      upstream.on('error', () => res.writeHead(502).end());
      req.pipe(upstream);
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    t.after(() => {
      proxy.closeAllConnections();
      return new Promise((done) => proxy.close(done));
    });
    target.SPONSOR_MEDIA_ENDPOINT = `http://127.0.0.1:${proxy.address().port}`;
    await assert.rejects(run('restore', target, 'wrong-confirmation'));
    const objectFile = join(unpacked, inventory.objects[0].file),
      original = await readFile(objectFile);
    await writeFile(objectFile, 'corrupt');
    await assert.rejects(
      run('restore', target, 'target-private,target-public')
    );
    assert.equal(
      (
        await client.send(
          new ListObjectsV2Command({ Bucket: 'target-private' })
        )
      ).KeyCount,
      0
    );
    await writeFile(objectFile, original);
    unsafePolicy = true;
    await assert.rejects(
      run('restore', target, 'target-private,target-public')
    );
    assert.equal(
      writes.length,
      0,
      'unsafe bucket policy fails before a claim or object is written'
    );
    unsafePolicy = false;
    const restored = await exec(
      process.execPath,
      [
        join(root, 'scripts/storage-backup.mjs'),
        'restore-archive',
        join(root, 'backups', config),
        media,
        'target-private,target-public'
      ],
      {
        env: { ...cleanEnv, ...settings, ...target },
        timeout: 120000,
        windowsHide: true
      }
    );
    assert.match(restored.stdout, /all objects remain private/);
    for (const [Bucket, Key, content] of [
      ['target-private', 'media/1000.webp', '1000'],
      ['target-public', 'public/approved.webp', 'approved-copy'],
      ['source-public', 'public/approved.webp', 'approved-copy']
    ]) {
      const response = await client.send(new GetObjectCommand({ Bucket, Key }));
      assert.equal(await response.Body.transformToString(), content);
    }
    assert.equal(writes.length, 1007);
    assert.ok(
      writes.every(
        (write) => write.acl === 'private' && write.condition === '*'
      )
    );
    const receipt = await client.send(
      new GetObjectCommand({
        Bucket: 'target-private',
        Key: 'system-recovery/restore-complete.json'
      })
    );
    assert.equal(
      JSON.parse(await receipt.Body.transformToString()).objects,
      1003
    );
    await assert.rejects(
      run('restore', target, 'target-private,target-public')
    );
    const targetClient = new S3Client({
      endpoint: target.SPONSOR_MEDIA_ENDPOINT,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'fixture',
        secretAccessKey: 'synthetic-s3-backup-secret'
      }
    });
    t.after(() => targetClient.destroy());
    const secondCapture = join(root, 'second-capture');
    const secondManifest = await captureS3(
      {
        client: targetClient,
        endpoint: target.SPONSOR_MEDIA_ENDPOINT,
        buckets: { private: 'target-private', public: 'target-public' }
      },
      secondCapture
    );
    assert.equal(
      secondManifest.objects.length,
      1007,
      'old recovery receipts are retained in the next capture'
    );
    const secondReceipt = await restoreS3(
      {
        client: targetClient,
        endpoint: target.SPONSOR_MEDIA_ENDPOINT,
        buckets: { private: 'cycle-private', public: 'cycle-public' }
      },
      secondCapture,
      'cycle-private,cycle-public'
    );
    assert.equal(secondReceipt.objects, 1003);
    assert.equal(secondReceipt.archivedRecoveryRecords, 4);
    const cycled = await client.send(
      new GetObjectCommand({
        Bucket: 'cycle-public',
        Key: 'public/approved.webp'
      })
    );
    assert.equal(await cycled.Body.transformToString(), 'approved-copy');
    const interrupted = {
      endpoint,
      buckets: { private: 'corrupt-private', public: 'corrupt-public' },
      client: {
        send(command, options) {
          if (
            command instanceof PutObjectCommand &&
            command.input.Key === inventory.objects[1].key
          )
            throw new Error('Synthetic transport interruption');
          return targetClient.send(command, options);
        }
      }
    };
    await assert.rejects(
      restoreS3(interrupted, unpacked, 'corrupt-private,corrupt-public'),
      /transport interruption/
    );
    await assert.rejects(
      restoreS3(
        { ...interrupted, client: targetClient },
        unpacked,
        'corrupt-private,corrupt-public'
      ),
      /must be empty/
    );
    await assert.rejects(
      client.send(
        new GetObjectCommand({
          Bucket: 'corrupt-private',
          Key: 'system-recovery/restore-complete.json'
        })
      )
    );
  }
);
