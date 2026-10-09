#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dockerComposeFileArgs } from './lib/docker-config.mjs';
import { readDockerConfiguration } from './lib/docker-environment.mjs';
import { prepareLocalIdentity } from './lib/local-identity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const help = `Usage: yarn docker:recreate [--dry-run] [--help]

Recree Web/API avec la configuration .env/shell et les overlays actifs.
Conserve les profils Compose existants, les images et les volumes.
Avec .env, --dry-run exige Compose, sans contacter le daemon Docker.
`;

try {
  const options = process.argv.slice(2);
  if (options.some((option) => !['--help', '-h', '--dry-run'].includes(option)))
    throw new Error('Option inconnue. Consulter yarn docker:recreate --help.');
  if (options.includes('--help') || options.includes('-h')) console.log(help);
  else {
    process.chdir(root);
    const shellEnv = { ...process.env };
    const configurationEnv = readDockerConfiguration({ env: shellEnv });
    const compose = [
      'compose',
      ...dockerComposeFileArgs(configurationEnv, {
        localTls:
          configurationEnv.FUNDING_PLATFORM_ENV === 'development' &&
          existsSync('traefik/certs/localhost.pem') &&
          existsSync('traefik/certs/localhost-key.pem')
      })
    ];
    const localIdentity = compose.includes('docker-compose.identity.local.yml');
    const commands = [
      [...compose, 'config', '--quiet'],
      [...compose, 'up', '-d', '--force-recreate', 'api', 'web']
    ];
    if (options.includes('--dry-run')) {
      if (localIdentity)
        console.log(
          'node scripts/prepare-local-identity.mjs (before Docker; no files written in dry-run)'
        );
      for (const args of commands) console.log(`docker ${args.join(' ')}`);
    } else {
      if (localIdentity) prepareLocalIdentity({ root, env: configurationEnv });
      for (const args of commands) {
        const result = spawnSync(
          process.execPath,
          ['scripts/docker-ready.mjs', '--', 'docker', ...args],
          {
            cwd: root,
            env: shellEnv,
            stdio: 'inherit',
            windowsHide: true
          }
        );
        if (result.error || result.signal || result.status !== 0)
          throw new Error('Docker recreation failed.');
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
