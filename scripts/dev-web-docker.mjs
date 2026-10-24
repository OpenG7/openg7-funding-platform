#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { get as getSecure } from 'node:https';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { localDevWebConfiguration } from './lib/dev-web-docker.mjs';
import { readDockerConfiguration } from './lib/docker-environment.mjs';
import {
  localTraefikConfiguration,
  validateLocalIdentityCertificates,
  validateLocalIdentityConfig
} from './lib/local-identity.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const routePath = join(root, 'traefik/local/dynamic.yml');
const backupPath = join(root, 'traefik/local/dev-web-backup.json');
const usage =
  'Usage: yarn dev:web:docker [--restore]\nServe live Angular at https://localhost with the existing local Docker API/Keycloak. Requires the prepared local HTTPS stack and free port 4200. Ctrl+C restores Docker Web routing; --restore recovers an interrupted launcher. No container restart, database or identity changes.';

function dockerOutput(args) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
    timeout: 10000
  });
  if (result.status !== 0)
    throw new Error('Cannot verify the local Docker gateway target.');
  return result.stdout.trim();
}

function assertLocalDockerTarget(target) {
  if (
    !target ||
    typeof target.context !== 'string' ||
    !/^[a-f0-9]{64}$/.test(target.container)
  )
    throw new Error('Invalid local Docker gateway target.');
  const endpoint = JSON.parse(
    dockerOutput([
      'context',
      'inspect',
      target.context,
      '--format',
      '{{json .Endpoints.docker.Host}}'
    ])
  );
  if (
    endpoint !== target.endpoint ||
    !(
      endpoint.startsWith('npipe:////./pipe/') ||
      endpoint.startsWith('unix:///')
    )
  )
    throw new Error(
      'The local Docker endpoint changed; preserving the routing backup.'
    );
  const container = JSON.parse(
    dockerOutput(['--context', target.context, 'inspect', target.container])
  )[0];
  const binding = container.HostConfig.PortBindings?.['443/tcp'];
  if (
    !container.State.Running ||
    !container.Mounts.some(
      (mount) =>
        mount.Destination === '/etc/traefik/dynamic/routes.yml' &&
        mount.Source.replaceAll('\\', '/').endsWith(
          '/traefik/local/dynamic.yml'
        )
    ) ||
    !binding?.length ||
    binding.some((port) => !['127.0.0.1', '::1'].includes(port.HostIp))
  )
    throw new Error(
      'The gateway requires the existing Traefik local profile with HTTPS bound to loopback.'
    );
}

function localDockerTarget() {
  const context = dockerOutput(['context', 'show']);
  const endpoint = JSON.parse(
    dockerOutput([
      'context',
      'inspect',
      context,
      '--format',
      '{{json .Endpoints.docker.Host}}'
    ])
  );
  if (process.env.DOCKER_HOST && process.env.DOCKER_HOST !== endpoint)
    throw new Error(
      'DOCKER_HOST differs from the local Docker context; refusing to change routing.'
    );
  const container = dockerOutput([
    '--context',
    context,
    'compose',
    'ps',
    '-q',
    'traefik'
  ]);
  const target = { context, endpoint, container };
  assertLocalDockerTarget(target);
  return target;
}

function reloadRouting(target) {
  assertLocalDockerTarget(target);
  // Docker Desktop can update a single-file mount without forwarding its host
  // filesystem event. A temporary file inside the watched directory triggers
  // Traefik's native watcher; its empty configuration changes no routing.
  const marker = `/etc/traefik/dynamic/openg7-angular-dev-reload-${process.pid}.yml`;
  for (const command of ['touch', 'rm']) {
    const result = spawnSync(
      'docker',
      ['--context', target.context, 'exec', target.container, command, marker],
      {
        cwd: root,
        stdio: 'ignore',
        windowsHide: true,
        timeout: 10000
      }
    );
    if (result.status !== 0)
      throw new Error(
        'Routes were saved, but Traefik could not be notified. Keep the backup and retry with --restore.'
      );
  }
}

function restoreRouting() {
  let backup;
  try {
    backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error('Cannot read the local Web routing backup.');
  }
  if (
    typeof backup.original !== 'string' ||
    localDevWebConfiguration(backup.original) !== backup.development
  )
    throw new Error('Invalid local Web routing backup; no files restored.');
  const current = readFileSync(routePath, 'utf8');
  if (current !== backup.development && current !== backup.original)
    throw new Error(
      'Local routes changed during development; preserving them and the routing backup for review.'
    );
  // This path is a Docker single-file mount: preserve its inode.
  if (current !== backup.original) writeFileSync(routePath, backup.original);
  reloadRouting(backup.target);
  unlinkSync(backupPath);
  console.log('Docker Web routing restored.');
}

function readHttp(url, collectBody = true) {
  return new Promise((resolve, reject) => {
    const secure = url.startsWith('https:');
    const request = (secure ? getSecure : get)(
      url,
      {
        timeout: 5000,
        ...(secure
          ? { ca: readFileSync(join(root, 'traefik/certs/rootCA.pem')) }
          : {})
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          if (!collectBody) return;
          body += chunk;
          if (body.length > 65536)
            request.destroy(new Error('Response too large.'));
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            contentType: response.headers['content-type'] ?? '',
            body
          })
        );
        response.on('error', reject);
      }
    );
    request.on('timeout', () =>
      request.destroy(new Error('Request timed out.'))
    );
    request.on('error', reject);
  });
}

function assertFreePort(host) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      if (host === '::1' && error.code === 'EADDRNOTAVAIL') resolve();
      else
        reject(
          new Error(
            'Port 4200 is occupied. Stop the existing Angular server first.'
          )
        );
    });
    server.listen(4200, host, () => server.close(resolve));
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--restore'))
    throw new Error(usage);

  let previous;
  try {
    previous = JSON.parse(readFileSync(backupPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error('Cannot read the local routing backup.');
  }
  if (previous) {
    if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0)
      throw new Error(
        'Invalid process identifier in the local routing backup.'
      );
    let running = true;
    try {
      process.kill(previous.pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') running = false;
    }
    if (running)
      throw new Error('A Web gateway is already running; stop it with Ctrl+C.');
    if (args[0] !== '--restore')
      throw new Error(
        'A previous Web gateway stopped unexpectedly. Run this command before restarting:\nyarn dev:web:docker --restore'
      );
  }
  if (args[0] === '--restore') {
    restoreRouting();
    return;
  }

  const env = readDockerConfiguration({ cwd: root });
  validateLocalIdentityConfig(env);
  validateLocalIdentityCertificates(root);
  if (env.FUNDING_PUBLIC_BASE_URL !== 'https://localhost')
    throw new Error(
      'The Web gateway requires FUNDING_PUBLIC_BASE_URL=https://localhost.'
    );

  const original = readFileSync(routePath, 'utf8');
  const canonical = localTraefikConfiguration(
    readFileSync(join(root, 'traefik/dynamic.yml'), 'utf8')
  );
  if (original !== canonical)
    throw new Error(
      'Local routes differ from the prepared HTTPS profile; preserve and review them before starting the gateway.'
    );
  const development = localDevWebConfiguration(original);
  const target = localDockerTarget();
  await assertFreePort('127.0.0.1');
  await assertFreePort('::1');
  let api;
  try {
    api = await readHttp('http://127.0.0.1:8080/api/admin/auth/config');
    if (api.status !== 200 || JSON.parse(api.body).mode !== 'oidc')
      throw new Error();
  } catch {
    throw new Error(
      'The existing Docker Web/API must be running on 127.0.0.1:8080 in OIDC mode.'
    );
  }

  writeFileSync(
    backupPath,
    JSON.stringify({ pid: process.pid, target, original, development }),
    { flag: 'wx' }
  );
  let finished = false;
  let child;
  const onInput = (chunk) => {
    if (chunk.includes(3)) finish(0);
  };
  function finish(code) {
    if (finished) return;
    finished = true;
    process.stdin.removeListener('data', onInput);
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
    } catch {
      /* A closed terminal must not prevent routing restoration. */
    }
    if (child?.pid && child.exitCode === null) {
      if (process.platform === 'win32')
        spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true
        });
      else child.kill('SIGTERM');
    }
    try {
      restoreRouting();
    } catch (error) {
      console.error(error.message);
      code = 1;
    }
    process.exit(code);
  }
  process.once('SIGINT', () => finish(0));
  process.once('SIGTERM', () => finish(0));
  process.once('SIGHUP', () => finish(0));
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.on('data', onInput);
    process.stdin.resume();
  }
  try {
    child = spawn(
      process.execPath,
      [
        join(root, 'node_modules/@angular/cli/bin/ng.js'),
        'serve',
        'funding-web',
        '--host',
        '127.0.0.1',
        '--port',
        '4200',
        '--poll',
        '1000',
        '--proxy-config',
        'apps/funding-web/proxy.docker.conf.json'
      ],
      {
        cwd: root,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, NG_FORCE_TTY: '0' },
        windowsHide: true
      }
    );
    child.once('error', () => {
      console.error('Cannot start Angular.');
      finish(1);
    });
    child.once('exit', (code) => finish(code ?? 1));
    console.log(
      'Starting Angular on IPv4 loopback; waiting before switching local HTTPS routing.'
    );
    let ready = false;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      try {
        if ((await readHttp('http://127.0.0.1:4200/', false)).status === 200) {
          ready = true;
          break;
        }
      } catch {
        /* Angular is still compiling. */
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready)
      throw new Error(
        'Angular did not become ready; Docker routing is unchanged.'
      );
    const probe = spawnSync(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        'web',
        'wget',
        '--timeout=5',
        '--tries=1',
        '--header',
        'Host: localhost',
        '-q',
        '-O',
        '/dev/null',
        'http://host.docker.internal:4200/'
      ],
      { cwd: root, stdio: 'ignore', windowsHide: true, timeout: 10000 }
    );
    if (probe.status !== 0)
      throw new Error(
        'Docker cannot reach Angular on host.docker.internal:4200; Docker routing is unchanged.'
      );
    if (readFileSync(routePath, 'utf8') !== original)
      throw new Error(
        'Local routes changed while Angular was starting; preserving them.'
      );
    writeFileSync(routePath, development);
    reloadRouting(target);
    let routed = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const client = await readHttp('https://localhost/@vite/client', false);
        if (
          client.status === 200 &&
          client.contentType.includes('javascript')
        ) {
          routed = true;
          break;
        }
      } catch {
        /* Wait for the HTTPS route to be reloaded. */
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!routed)
      throw new Error(
        'The HTTPS Angular route did not become ready; restoring Docker Web.'
      );
    console.log(
      'Web gateway active: open https://localhost (Angular watch + Docker API/Keycloak). Ctrl+C restores Docker Web.'
    );
  } catch (error) {
    console.error(error.message);
    finish(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
