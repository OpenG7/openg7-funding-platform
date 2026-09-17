#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  acceptanceEnvironment,
  acceptanceStages,
  assertLocalDockerEndpoint
} from './lib/admin-acceptance.mjs';

if (Number(process.versions.node.split('.')[0]) !== 22) {
  throw new Error('Acceptance requires Node.js 22 (repository runtime).');
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'og7-acceptance-'));
const envFile = join(temporary, 'empty.env');
await writeFile(envFile, '');
const servers = [createServer(), createServer()];
const ports = await Promise.all(
  servers.map(
    (server) =>
      new Promise((resolvePort, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolvePort(server.address().port));
      })
  )
);
await Promise.all(
  servers.map(
    (server) => new Promise((resolveClose) => server.close(resolveClose))
  )
);
const project = `og7-acceptance-${randomUUID()}`;
const env = acceptanceEnvironment({
  parent: process.env,
  root,
  project,
  envFile,
  webPort: ports[0],
  stripePort: ports[1]
});
const artifacts = join(root, 'test-results', 'acceptance');
await mkdir(artifacts, { recursive: true });
// Do not attribute an earlier run's failures to the current revision.
await Promise.all(
  ['docker.log', 'results.json'].map((file) =>
    rm(join(artifacts, file), { force: true })
  )
);
await writeFile(
  join(artifacts, 'run.json'),
  JSON.stringify(
    {
      project,
      revision: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8'
      }).trim(),
      workingTreeDirty:
        execFileSync('git', ['status', '--porcelain'], {
          cwd: root,
          encoding: 'utf8'
        }).trim().length > 0,
      baseURL: env.PLAYWRIGHT_BASE_URL,
      startedAt: new Date().toISOString()
    },
    null,
    2
  )
);
console.log(`Acceptance project: ${project} (${env.PLAYWRIGHT_BASE_URL})`);

let activeChild;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  activeChild?.kill('SIGTERM');
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
const run = (command, args) =>
  new Promise((resolveRun, reject) => {
    if (interrupted && !args.includes('down'))
      return reject(new Error('Acceptance interrupted.'));
    activeChild = spawn(command, args, {
      cwd: root,
      env,
      stdio: 'inherit',
      windowsHide: true
    });
    activeChild.once('error', reject);
    activeChild.once('exit', (code) => {
      activeChild = undefined;
      if (code === 0) resolveRun();
      else
        reject(
          new Error(
            `Acceptance stage failed: ${command} ${args.join(' ')} (exit ${code}).`
          )
        );
    });
  });
try {
  const endpoint =
    (!env.DOCKER_CONTEXT && env.DOCKER_HOST) ||
    JSON.parse(
      execFileSync(
        'docker',
        ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
        { cwd: root, env, encoding: 'utf8' }
      )
    );
  assertLocalDockerEndpoint(endpoint);
  await acceptanceStages({
    run,
    node: process.execPath,
    cli: createRequire(import.meta.url).resolve('@playwright/test/cli'),
    args: process.argv.slice(2),
    diagnostics: async () => {
      const logs = execFileSync(
        'docker',
        ['compose', 'logs', '--no-color', '--timestamps'],
        { cwd: root, env, maxBuffer: 16 * 1024 * 1024 }
      );
      await writeFile(join(artifacts, 'docker.log'), logs);
    }
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
  // Verify the resolved target stays under the intended temporary directory.
  if (dirname(resolve(temporary)) !== resolve(tmpdir())) {
    throw new Error('Refusing cleanup outside the temporary directory.');
  }
  await rm(temporary, { recursive: true, force: true });
}
