#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dockerComposeFileArgs } from './lib/docker-config.mjs';
import {
  dockerCommandEnvironment,
  readDockerConfiguration
} from './lib/docker-environment.mjs';
import { prepareLocalIdentity } from './lib/local-identity.mjs';
import { prepareLocalInitialUser } from './lib/keycloak-initial-user.mjs';

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
      [
        ...compose,
        'up',
        '-d',
        '--force-recreate',
        ...(configurationEnv.FUNDING_KEYCLOAK_PROVISION_USER === 'true'
          ? ['--no-deps']
          : []),
        'api',
        'web'
      ]
    ];
    if (options.includes('--dry-run')) {
      if (localIdentity)
        console.log(
          'node scripts/prepare-local-identity.mjs (before Docker; no files written in dry-run)'
        );
      if (configurationEnv.FUNDING_KEYCLOAK_PROVISION_USER === 'true')
        console.log(
          'Preparation du compte Keycloak et des subjects proprietaires avant l\u2019application (aucun compte modifie ni contact reseau en dry-run).'
        );
      for (const args of commands) console.log(`docker ${args.join(' ')}`);
    } else {
      const commandEnv = { ...configurationEnv };
      if (localIdentity) {
        prepareLocalIdentity({ root, env: commandEnv });
        if (commandEnv.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME) {
          const readiness = spawnSync(
            process.execPath,
            ['scripts/docker-ready.mjs', '--', process.execPath, '--eval', ''],
            {
              cwd: root,
              env: dockerCommandEnvironment(
                commandEnv,
                configurationEnv,
                shellEnv
              ),
              stdio: 'inherit',
              windowsHide: true
            }
          );
          if (readiness.error || readiness.signal || readiness.status !== 0)
            throw new Error(
              'Docker recreation failed before initial-user preparation.'
            );
        }
        prepareLocalInitialUser({ root, env: commandEnv, allowCreate: false });
      }
      if (commandEnv.FUNDING_KEYCLOAK_PROVISION_USER === 'true') {
        const { provisionKeycloakUser } =
          await import('./lib/keycloak-provision-user.mjs');
        await provisionKeycloakUser({
          root,
          env: commandEnv,
          requireEnrollment: commandEnv.FUNDING_PLATFORM_ENV === 'production'
        });
        console.log('Compte Keycloak et subjects proprietaires verifies.');
      }
      for (const args of commands) {
        const result = spawnSync(
          process.execPath,
          ['scripts/docker-ready.mjs', '--', 'docker', ...args],
          {
            cwd: root,
            env: dockerCommandEnvironment(
              commandEnv,
              configurationEnv,
              shellEnv
            ),
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
