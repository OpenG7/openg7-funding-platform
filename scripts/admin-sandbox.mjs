#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertLocalDockerEndpoint } from './lib/admin-acceptance.mjs';
import {
  cleanupSandboxResources,
  listenForSandboxStop,
  sandboxComposeArgs,
  sandboxEnvironment,
  sandboxManifest,
  sandboxNginxConfiguration,
  sandboxStages
} from './lib/admin-sandbox.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'yarn sandbox:admin [--verify]\nStarts a separate disposable local sandbox. Choose the simulated owner account to sign in. Ctrl+C or the line stop removes only this sandbox. --verify runs the browser recipe and then removes the sandbox automatically.'
  );
} else if (args.some((arg) => arg !== '--verify') || args.length > 1) {
  console.error('Unknown sandbox option. Use --help.');
  process.exitCode = 1;
} else {
  try {
    await main({ verify: args.includes('--verify') });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

async function main({ verify }) {
  if (Number(process.versions.node.split('.')[0]) < 22)
    throw new Error('The admin sandbox requires Node.js 22 or newer.');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const temporary = await mkdtemp(join(tmpdir(), 'og7-sandbox-'));
  let activeChild;
  let interrupted = false;
  let cleaning = false;
  let removed = false;
  const stop = new AbortController();
  const interrupt = () => {
    if (cleaning) return;
    interrupted = true;
    stop.abort();
    activeChild?.kill('SIGTERM');
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const detachInput = listenForSandboxStop(process.stdin, interrupt);
  try {
    const envFile = join(temporary, 'empty.env');
    const manifestFile = join(temporary, 'openg7-sandbox.json');
    const nginxFile = join(temporary, 'nginx.conf');
    const moderationNginxFile = join(temporary, 'nginx-oidc.conf');
    const nginx = await readFile(
      join(root, 'apps/funding-web/nginx.conf'),
      'utf8'
    );
    await writeFile(envFile, '', { mode: 0o600 });
    await writeFile(manifestFile, JSON.stringify(sandboxManifest()), {
      mode: 0o644
    });
    await writeFile(nginxFile, sandboxNginxConfiguration(nginx));
    await writeFile(
      moderationNginxFile,
      sandboxNginxConfiguration(nginx, { oidc: true })
    );
    const servers = Array.from({ length: 4 }, () => createServer());
    let ports;
    try {
      ports = await Promise.all(
        servers.map(
          (server) =>
            new Promise((done, fail) => {
              server.once('error', fail);
              server.listen(0, '127.0.0.1', () => done(server.address().port));
            })
        )
      );
    } finally {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise((done) =>
              server.listening ? server.close(done) : done()
            )
        )
      );
    }
    const project = `og7-acceptance-${randomUUID()}`;
    const env = sandboxEnvironment({
      parent: process.env,
      root,
      project,
      envFile,
      webPort: ports[0],
      stripePort: ports[1],
      moderationWebPort: ports[2],
      oidcProviderPort: ports[3],
      moderationNginxFile,
      manifestFile,
      nginxFile
    });
    const composeArgs = sandboxComposeArgs({ root, project, envFile });
    const artifacts = join(root, 'test-results', 'admin-sandbox');
    if (verify) {
      await mkdir(artifacts, { recursive: true });
      await rm(join(artifacts, 'docker.log'), { force: true });
      await writeFile(
        join(artifacts, 'run.json'),
        JSON.stringify(
          {
            project,
            baseURL: env.SANDBOX_PUBLIC_BASE_URL,
            startedAt: new Date().toISOString()
          },
          null,
          2
        )
      );
    }
    const readDocker = (arguments_) =>
      execFileSync('docker', arguments_, {
        cwd: root,
        env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024
      }).trim();
    const endpoint =
      (!env.DOCKER_CONTEXT && env.DOCKER_HOST) ||
      JSON.parse(
        readDocker([
          'context',
          'inspect',
          '--format',
          '{{json .Endpoints.docker.Host}}'
        ])
      );
    assertLocalDockerEndpoint(endpoint);
    const run = (command, arguments_) =>
      new Promise((done, fail) => {
        if (interrupted && !cleaning)
          return fail(new Error('Sandbox startup interrupted.'));
        const scoped =
          command === 'docker' && arguments_[0] === 'compose'
            ? [...composeArgs, ...arguments_.slice(1)]
            : arguments_;
        activeChild = spawn(command, scoped, {
          cwd: root,
          env,
          stdio: 'inherit',
          windowsHide: true
        });
        activeChild.once('error', fail);
        activeChild.once('exit', (code) => {
          activeChild = undefined;
          if (code === 0) done();
          else
            fail(
              new Error(
                `Sandbox stage failed: ${command} ${scoped.join(' ')} (exit ${code}).`
              )
            );
        });
      });
    const cleanup = async () => {
      cleaning = true;
      await cleanupSandboxResources({ project, readDocker, run });
      removed = true;
    };
    console.log(`Starting a separate disposable admin sandbox (${project}).`);
    await sandboxStages({
      run,
      node: process.execPath,
      cleanup,
      verify,
      cli: verify
        ? createRequire(import.meta.url).resolve('@playwright/test/cli')
        : undefined,
      diagnostics: verify
        ? async () => {
            const logs = execFileSync(
              'docker',
              [...composeArgs, 'logs', '--no-color', '--timestamps'],
              {
                cwd: root,
                env,
                windowsHide: true,
                timeout: 30000,
                maxBuffer: 16 * 1024 * 1024
              }
            );
            await writeFile(join(artifacts, 'docker.log'), logs);
          }
        : undefined,
      ready: () => {
        console.log(`Sandbox: ${env.SANDBOX_PUBLIC_BASE_URL}/admin/fundraiser`);
        console.log(
          `Contribution form: ${env.SANDBOX_PUBLIC_BASE_URL}/fonds-des-batisseurs?intent=sponsorship#support`
        );
        console.log(
          'Sign in using the simulated identity provider and choose owner. No real payment or external message is sent.'
        );
        if (!verify)
          console.log(
            'Keep this terminal open. Ctrl+C or type stop then Enter to remove this sandbox, including its temporary database.'
          );
      },
      waitForStop: () =>
        new Promise((done) => {
          if (stop.signal.aborted) return done();
          const keepAlive = setInterval(() => {}, 60000);
          stop.signal.addEventListener(
            'abort',
            () => {
              clearInterval(keepAlive);
              done();
            },
            { once: true }
          );
        })
    });
  } finally {
    detachInput();
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    if (
      dirname(resolve(temporary)) !== resolve(tmpdir()) ||
      !basename(temporary).startsWith('og7-sandbox-')
    )
      throw new Error(
        'Refusing cleanup outside the sandbox temporary directory.'
      );
    if (cleaning && !removed) {
      console.error(
        `Sandbox cleanup failed; its configuration is retained at ${temporary}.`
      );
    } else await rm(temporary, { recursive: true, force: true });
  }
}
