#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readDockerConfiguration } from './lib/docker-environment.mjs';
import { prepareLocalIdentity } from './lib/local-identity.mjs';

try {
  if (process.argv.slice(2).join(' ') === '--help') {
    console.log(
      'Usage: node scripts/prepare-local-identity.mjs\nPrepare development HTTPS identity from canonical Traefik files. Requires existing local certificates and public rootCA.pem; no Docker services, secrets or trust stores are changed.'
    );
  } else {
    if (process.argv.length !== 2)
      throw new Error('Usage: node scripts/prepare-local-identity.mjs');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    prepareLocalIdentity({ root, env: readDockerConfiguration({ cwd: root }) });
    console.log(
      'Local HTTPS identity prepared in traefik/local. Production configuration is unchanged.'
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
