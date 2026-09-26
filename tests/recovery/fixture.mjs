import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { request as proxy } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import pg from 'pg';
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3';
import { startDisposableProvider } from '../integration/support/disposable-provider.mjs';
import { createS3RecoveryProxy } from '../integration/support/s3-recovery-proxy.mjs';
import { createBuiltWebServer } from '../ui/serve-built-web.mjs';

const exec = promisify(execFile);
const bash =
  process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
export const token = 'synthetic-recovery-admin-token';
export const eventually = async (fn) => {
  const deadline = Date.now() + 45000;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await setTimeout(200);
    }
  }
};

export async function createRecoveryFixture({ mediaDriver = 'local' } = {}) {
  console.log('Recovery fixture: preparing local services.');
  if (Number(process.versions.node.split('.')[0]) !== 22)
    throw new Error('Node 22 required.');
  const run = async (command, args, options = {}) => {
    const { input, ...settings } = options;
    const pending = exec(command, args, {
      windowsHide: true,
      timeout: 90000,
      maxBuffer: 4 * 1024 * 1024,
      ...settings
    });
    pending.child.stdin.end(input || '');
    return pending;
  };
  const context = (await run('docker', ['context', 'show'])).stdout.trim();
  const endpoint = (
    await run('docker', [
      'context',
      'inspect',
      context,
      '--format',
      '{{.Endpoints.docker.Host}}'
    ])
  ).stdout.trim();
  if (!/^(npipe|unix):\/\//.test(endpoint))
    throw new Error('Recovery tests require local Docker.');
  const docker = async (args, options) =>
    (
      await run('docker', ['--context', context, ...args], options)
    ).stdout.trim();
  const root = await mkdtemp(join(tmpdir(), 'og7-recovery-'));
  const prefix = 'og7-restore-' + randomUUID().slice(0, 8);
  const image = process.env.OG7_RECOVERY_API_IMAGE || prefix + '-api';
  if (process.env.OG7_RECOVERY_API_IMAGE && !/^og7-[a-z0-9:_-]+$/.test(image))
    throw new Error('Invalid fixture image.');
  const targets = [];
  let s3;
  // Deliberate whitelist: no .env, DATABASE_URL, COMPOSE_FILE or external credentials.
  const env = Object.fromEntries(
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
  env.DOCKER_CONTEXT = context;
  env.OPENG7_TEST_NODE = process.execPath.replaceAll('\\', '/');
  const copy = async (from, to) => {
    await mkdir(dirname(to), { recursive: true });
    await writeFile(to, (await readFile(from, 'utf8')).replace(/\r\n/g, '\n'));
  };
  const makeTarget = async (name) => {
    const directory = join(root, name),
      project = prefix + '-' + name;
    await mkdir(directory);
    const target = { directory, project, pool: null, web: null, apiPort: null };
    targets.push(target);
    for (const file of [
      'backup.sh',
      'restore-from-backup.sh',
      'backup-artifacts.mjs',
      'recovery-state.mjs',
      'storage-backup.mjs',
      'lib/s3-backup.mjs',
      'load-env.sh'
    ])
      await copy(join('scripts', file), join(directory, 'scripts', file));
    await symlink(
      resolve('node_modules'),
      join(directory, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await mkdir(join(directory, 'bin'));
    await writeFile(
      join(directory, 'bin/node'),
      '#!/usr/bin/env bash\nexec "$OPENG7_TEST_NODE" "$@"\n',
      { mode: 0o755 }
    );
    if (s3) {
      target.s3 = {
        NODE_ENV: 'test',
        SPONSOR_MEDIA_ENDPOINT: s3.endpoint,
        SPONSOR_MEDIA_REGION: 'us-east-1',
        SPONSOR_MEDIA_PRIVATE_BUCKET: project + '-private',
        SPONSOR_MEDIA_PUBLIC_BUCKET: project + '-public',
        SPONSOR_MEDIA_PRIVATE_BASE_URL:
          s3.endpoint + '/' + project + '-private',
        SPONSOR_MEDIA_PUBLIC_BASE_URL: s3.endpoint + '/' + project + '-public',
        OVH_S3_ACCESS_KEY_ID: 'fixture',
        OVH_S3_SECRET_ACCESS_KEY: 'synthetic-recovery-s3-secret'
      };
      for (const Bucket of [
        target.s3.SPONSOR_MEDIA_PRIVATE_BUCKET,
        target.s3.SPONSOR_MEDIA_PUBLIC_BUCKET
      ])
        await eventually(() =>
          s3.client.send(new CreateBucketCommand({ Bucket }))
        );
      target.s3Env = join(directory, '.env.recovery-s3');
      await writeFile(
        target.s3Env,
        Object.entries(target.s3)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n') + '\n'
      );
    }
    target.compose = (args, extraFiles = []) =>
      docker(
        [
          'compose',
          '--project-directory',
          directory,
          '--env-file',
          join(directory, '.env'),
          '-p',
          project,
          '-f',
          join(directory, 'docker-compose.yml'),
          ...extraFiles.flatMap((file) => ['-f', file]),
          '--profile',
          'database',
          ...args
        ],
        { env }
      );
    target.script = async (script, args = [], options = {}) => {
      try {
        const shellArgs = args.map((arg) =>
          process.platform === 'win32' && /^[a-z]:[\\/]/i.test(arg)
            ? '/' +
              arg[0].toLowerCase() +
              '/' +
              arg.slice(3).replaceAll('\\', '/')
            : arg
        );
        const result = await run(
          bash,
          [
            '-c',
            'export PATH="$PWD/bin:$PATH"\nbash "$@"',
            'fixture',
            'scripts/' + script,
            ...shellArgs
          ],
          {
            cwd: directory,
            env,
            ...options
          }
        );
        return { code: 0, output: result.stdout + result.stderr };
      } catch (error) {
        return {
          code: error.code,
          output: (error.stdout || '') + (error.stderr || '')
        };
      }
    };
    target.connect = async () => {
      const match = /^127\.0\.0\.1:(\d+)$/.exec(
        await target.compose(['port', 'postgres', '5432'])
      );
      if (!match) throw new Error('Database must bind only to loopback.');
      target.pool = new pg.Pool({
        host: '127.0.0.1',
        port: Number(match[1]),
        user: 'recovery',
        password: 'synthetic-only',
        database: 'recovery',
        ssl: false,
        options: '',
        connectionTimeoutMillis: 1000
      });
      await eventually(() => target.pool.query('SELECT 1'));
      return target.pool;
    };
    target.startWeb = async () => {
      target.web = createBuiltWebServer((req, res) => {
        const upstream = proxy(
          {
            hostname: '127.0.0.1',
            port: target.apiPort,
            path: req.url,
            method: req.method,
            headers: req.headers
          },
          (answer) => {
            res.writeHead(answer.statusCode, answer.headers);
            answer.pipe(res);
          }
        );
        upstream.on('error', () => res.writeHead(503).end());
        req.pipe(upstream);
      });
      target.web.listen(0, '127.0.0.1');
      await once(target.web, 'listening');
      target.origin = 'http://127.0.0.1:' + target.web.address().port;
    };
    target.startApi = async () => {
      // Explicit isolated activation after restore verification, never a production config.
      let settings = await readFile(join(directory, '.env'), 'utf8');
      settings = settings.replace(
        /^FUNDING_PUBLIC_BASE_URL=.*$/m,
        'FUNDING_PUBLIC_BASE_URL=' + target.origin
      );
      await writeFile(join(directory, '.env'), settings);
      const extraFiles = [];
      if (s3) {
        // Host scripts use the loopback proxy; the isolated API reaches the same
        // disposable S3Mock over its owned Docker network, with the restored buckets.
        const networks = JSON.parse(
          await docker(['inspect', s3.provider.id])
        )[0].NetworkSettings.Networks;
        const network = project + '-edge';
        if (!networks[network])
          await docker(['network', 'connect', network, s3.provider.id]);
        const connected = JSON.parse(
          await docker(['inspect', s3.provider.id])
        )[0].NetworkSettings.Networks;
        const configurationPath = join(directory, '.fixture-api-network.json');
        await writeFile(
          configurationPath,
          JSON.stringify({
            services: {
              api: {
                environment: {
                  SPONSOR_MEDIA_ENDPOINT:
                    'http://' + connected[network].IPAddress + ':9090'
                }
              }
            }
          })
        );
        extraFiles.push(configurationPath);
      }
      await target.compose(['up', '-d', '--no-deps', 'api'], extraFiles);
      const match = /^127\.0\.0\.1:(\d+)$/.exec(
        await target.compose(['port', 'api', '3333'])
      );
      if (!match) throw new Error('API must bind only to loopback.');
      target.apiPort = Number(match[1]);
      await eventually(async () => {
        const response = await fetch(
          'http://127.0.0.1:' + target.apiPort + '/health',
          { signal: AbortSignal.timeout(3000) }
        );
        await response.text();
        if (!response.ok) throw new Error('API not ready.');
      });
    };
    return target;
  };
  const stop = async () => {
    if (s3) {
      s3.client.destroy();
      s3.proxy?.closeAllConnections();
      if (s3.proxy) await new Promise((done) => s3.proxy.close(done));
      await s3.provider.stop();
    }
    for (const target of targets.reverse()) {
      await target.pool?.end();
      if (target.web?.listening) {
        target.web.close();
        target.web.closeAllConnections();
      }
      // Only names generated here and containers labelled with this exact owned project.
      if (!target.project.startsWith(prefix + '-'))
        throw new Error('Unsafe fixture cleanup.');
      const ids = await docker([
        'ps',
        '-aq',
        '--filter',
        'label=com.docker.compose.project=' + target.project
      ]);
      if (ids) await docker(['rm', '-f', ...ids.split(/\s+/)]);
      for (const suffix of ['postgres-data', 'sponsor-logos'])
        await docker(['volume', 'rm', target.project + '-' + suffix]).catch(
          () => {}
        );
      for (const suffix of ['data', 'edge'])
        await docker(['network', 'rm', target.project + '-' + suffix]).catch(
          () => {}
        );
    }
    if (!process.env.OG7_RECOVERY_API_IMAGE)
      await docker(['image', 'rm', image]).catch(() => {});
    const absolute = resolve(root);
    if (
      !absolute.startsWith(resolve(tmpdir()) + sep) ||
      !absolute.split(sep).pop().startsWith('og7-recovery-')
    )
      throw new Error('Unsafe fixture directory.');
    await rm(absolute, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200
    });
  };
  try {
    if (mediaDriver === 'ovh-s3') {
      const provider = await startDisposableProvider('s3');
      const endpoint = 'http://127.0.0.1:' + provider.ports[9090];
      s3 = {
        provider,
        client: new S3Client({
          endpoint,
          region: 'us-east-1',
          forcePathStyle: true,
          credentials: {
            accessKeyId: 'fixture',
            secretAccessKey: 'synthetic-recovery-s3-secret'
          }
        }),
        writes: [],
        failBucket: null,
        unsafePolicy: false
      };
      s3.proxy = await createS3RecoveryProxy(endpoint, {
        unsafePolicy: () => s3.unsafePolicy,
        onRequest: (req, res, url) => {
          if (req.method !== 'PUT') return false;
          s3.writes.push({
            path: url.pathname,
            acl: req.headers['x-amz-acl'],
            condition: req.headers['if-none-match']
          });
          if (
            url.pathname.startsWith('/' + s3.failBucket + '/') &&
            !url.pathname.includes('/system-recovery/')
          ) {
            res
              .writeHead(503, { 'Content-Type': 'application/xml' })
              .end('<Error><Code>ServiceUnavailable</Code></Error>');
            return true;
          }
          return false;
        }
      });
      s3.endpoint = 'http://127.0.0.1:' + s3.proxy.address().port;
      s3.put = (Bucket, Key, Body) =>
        s3.client.send(
          new PutObjectCommand({
            Bucket,
            Key,
            Body,
            ContentType: 'image/webp',
            Metadata: { provenance: 'synthetic' }
          })
        );
      s3.get = async (Bucket, Key) =>
        Buffer.from(
          await (
            await s3.client.send(new GetObjectCommand({ Bucket, Key }))
          ).Body.transformToByteArray()
        );
      s3.list = async (Bucket) =>
        (await s3.client.send(new ListObjectsV2Command({ Bucket }))).Contents ||
        [];
    }
    if (!process.env.OG7_RECOVERY_API_IMAGE)
      await docker(
        ['build', '-t', image, '-f', 'apps/funding-api/Dockerfile', '.'],
        { timeout: 300000, maxBuffer: 1024 * 1024 }
      );
    else await docker(['image', 'inspect', image]);
    const source = await makeTarget('source');
    console.log('Recovery fixture: starting source.');
    await source.startWeb();
    const compose = {
      services: {
        postgres: {
          image: 'postgres:16-alpine',
          environment: {
            POSTGRES_DB: 'recovery',
            POSTGRES_USER: 'recovery',
            POSTGRES_PASSWORD: 'synthetic-only'
          },
          ports: ['127.0.0.1::5432'],
          volumes: ['postgres-data:/var/lib/postgresql/data'],
          networks: ['edge', 'data'],
          labels: { 'org.openg7.disposable-test': 'true' }
        },
        api: {
          image,
          ports: ['127.0.0.1::3333'],
          volumes: ['sponsor-logos:/app/var/sponsor-logos'],
          networks: ['edge', 'data'],
          environment: {
            NODE_ENV: 'test',
            FUNDING_PLATFORM_ENV: 'development',
            FUNDING_API_PORT: '3333',
            DATABASE_URL:
              'postgres://recovery:synthetic-only@postgres:5432/recovery',
            FUNDING_ADMIN_AUTH_MODE: 'token',
            FUNDING_ADMIN_TOKEN: token,
            FUNDING_ADMIN_SESSION_SECRET: 'synthetic-recovery-session-secret',
            FUNDING_PUBLIC_BASE_URL: '${FUNDING_PUBLIC_BASE_URL}',
            FUNDING_ALLOWED_ORIGINS: '${FUNDING_PUBLIC_BASE_URL}',
            FUNDING_ADMIN_RATE_LIMIT_MAX: '0',
            SPONSOR_MEDIA_STORAGE_DRIVER: mediaDriver,
            ...(s3
              ? Object.fromEntries(
                  Object.keys(source.s3)
                    .filter((key) => key !== 'NODE_ENV')
                    .map((key) => [key, '${' + key + '}'])
                )
              : {}),
            FUNDING_SPONSOR_LOGO_STORAGE_DIR: '/app/var/sponsor-logos',
            FUNDING_EMAIL_WORKER_ENABLED: 'false',
            FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'false',
            SMTP_ENABLED: 'false',
            SOCIAL_PUBLICATION_WORKER_ENABLED: 'false',
            SOCIAL_PUBLICATION_MODE: 'mock',
            FUNDING_CONTRIBUTION_SMS_MODE: 'disabled'
          },
          labels: { 'org.openg7.disposable-test': 'true' }
        }
      },
      volumes: {
        'postgres-data': { name: '${POSTGRES_VOLUME_NAME}' },
        'sponsor-logos': { name: '${SPONSOR_LOGOS_VOLUME_NAME}' }
      },
      networks: {
        edge: { name: '${OPENG7_EDGE_NETWORK_NAME}' },
        data: { name: '${OPENG7_DATA_NETWORK_NAME}', internal: true }
      }
    };
    await writeFile(
      join(source.directory, 'docker-compose.yml'),
      JSON.stringify(compose)
    );
    await writeFile(
      join(source.directory, '.env'),
      Object.entries({
        COMPOSE_PROJECT_NAME: source.project,
        POSTGRES_VOLUME_NAME: source.project + '-postgres-data',
        SPONSOR_LOGOS_VOLUME_NAME: source.project + '-sponsor-logos',
        OPENG7_EDGE_NETWORK_NAME: source.project + '-edge',
        OPENG7_DATA_NETWORK_NAME: source.project + '-data',
        POSTGRES_DB: 'recovery',
        POSTGRES_USER: 'recovery',
        DATABASE_URL:
          'postgres://recovery:synthetic-only@postgres:5432/recovery',
        SPONSOR_MEDIA_STORAGE_DRIVER: mediaDriver,
        ...source.s3,
        FUNDING_PLATFORM_ENV: 'development',
        FUNDING_PUBLIC_BASE_URL: source.origin
      })
        .map(([k, v]) => k + '=' + v)
        .join('\n') + '\n'
    );
    for (const file of [
      '.env.example',
      '.dockerignore',
      'apps/funding-api/Dockerfile',
      'apps/funding-web/Dockerfile',
      'apps/funding-web/nginx.conf'
    ])
      await copy(file, join(source.directory, file));
    await mkdir(join(source.directory, 'traefik'));
    await writeFile(
      join(source.directory, 'traefik', 'fixture.yml'),
      '# Synthetic configuration only\n'
    );
    await mkdir(join(source.directory, 'docs'));
    await writeFile(
      join(source.directory, 'docs', 'fixture.md'),
      'Synthetic recovery fixture.\n'
    );
    await source.compose(['up', '-d', 'postgres']);
    const pool = await source.connect();
    for (const name of (await readdir('apps/funding-api/migrations'))
      .filter((n) => /^\d+_.+\.sql$/.test(n))
      .sort())
      await pool.query(
        await readFile(join('apps/funding-api/migrations', name), 'utf8')
      );
    await source.startApi();
    console.log('Recovery fixture: source ready.');
    return { root, source, makeTarget, stop, docker, env, s3 };
  } catch (error) {
    console.log('Recovery fixture startup failed:', error.message);
    await stop();
    throw error;
  }
}
