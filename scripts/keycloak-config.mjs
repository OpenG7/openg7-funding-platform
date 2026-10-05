#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDockerConfiguration } from './lib/docker-environment.mjs';
import { validateKeycloakConfig } from './lib/keycloak-config.mjs';

try {
  if (process.argv.slice(2).join(' ') !== '--check')
    throw new Error('Usage: node scripts/keycloak-config.mjs --check');
  const configuration = readDockerConfiguration({
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    env: process.env
  });
  console.log(
    validateKeycloakConfig(configuration)
      ? 'Keycloak configuration is valid. DNS, TLS and MFA still require verification.'
      : 'Keycloak is disabled (FUNDING_KEYCLOAK_ENABLED=false).'
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
