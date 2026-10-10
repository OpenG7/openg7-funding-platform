#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readDockerConfiguration } from './lib/docker-environment.mjs';
import { prepareLocalIdentity } from './lib/local-identity.mjs';
import { prepareLocalInitialUser } from './lib/keycloak-initial-user.mjs';

try {
  if (process.argv.slice(2).join(' ') === '--help') {
    console.log(
      'Usage: node scripts/prepare-local-identity.mjs\nPrepare development HTTPS identity from canonical Traefik files. With INITIAL_USER_USERNAME/PASSWORD, also prepare the private first-user import after verifying a new local Docker identity volume. Requires existing local certificates and public rootCA.pem; no Docker services, accounts or trust stores are changed.'
    );
  } else {
    if (process.argv.length !== 2)
      throw new Error('Usage: node scripts/prepare-local-identity.mjs');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const env = readDockerConfiguration({ cwd: root });
    prepareLocalIdentity({ root, env });
    if (prepareLocalInitialUser({ root, env }))
      console.log(
        'Private initial-user import prepared. Use yarn docker:up:dev:keycloak to apply it; password change and OTP enrollment remain required.'
      );
    console.log(
      'Local HTTPS identity prepared in traefik/local. Production configuration is unchanged.'
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
