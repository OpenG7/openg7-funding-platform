#!/usr/bin/env node
import { appendFileSync, lstatSync, readFileSync } from 'node:fs';
import { reconcileKeycloakSso } from './lib/keycloak-sso.mjs';

const usage =
  'Usage: node scripts/keycloak-sso.mjs --issuer https://host/realms/openg7 --token-file <private-file> [--ca-file <file>] [--apply --audit-file <private-file>]';
const read = (path, privateFile = false) => {
  const info = lstatSync(path);
  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.size > 65_536 ||
    (privateFile && process.platform !== 'win32' && info.mode & 0o077)
  )
    throw new Error();
  return readFileSync(path, 'utf8');
};
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log(usage);
  else {
    const values = {};
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (
        ![
          '--issuer',
          '--token-file',
          '--ca-file',
          '--apply',
          '--audit-file'
        ].includes(key) ||
        Object.hasOwn(values, key)
      )
        throw new Error();
      if (key === '--apply') values[key] = true;
      else {
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error();
        values[key] = args[++i];
      }
    }
    if (
      !values['--issuer'] ||
      !values['--token-file'] ||
      (values['--apply'] && !values['--audit-file'])
    )
      throw new Error();
    const result = await reconcileKeycloakSso({
      issuer: values['--issuer'],
      accessToken: read(values['--token-file'], true).trim(),
      ...(values['--ca-file'] ? { ca: read(values['--ca-file']) } : {}),
      apply: values['--apply'] === true,
      audit: (event) => {
        const path = values['--audit-file'];
        const existing = lstatSync(path, { throwIfNoEntry: false });
        if (
          existing &&
          (existing.isSymbolicLink() ||
            !existing.isFile() ||
            (process.platform !== 'win32' && existing.mode & 0o077))
        )
          throw new Error();
        appendFileSync(path, JSON.stringify(event) + '\n', { mode: 0o600 });
      }
    });
    console.log(JSON.stringify(result));
  }
} catch {
  console.error(
    'Keycloak SSO preparation failed; sensitive diagnostics are withheld. ' +
      usage
  );
  process.exitCode = 1;
}
