import { createPrivateKey, X509Certificate } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateKeycloakConfig } from './keycloak-config.mjs';

export const localIdentityHostname = 'auth.openg7.test';

export function copyPublicLocalCa(caRoot, certificateDirectory) {
  try {
    const source = join(caRoot, 'rootCA.pem');
    const text = readFileSync(source, 'utf8');
    if (text.includes('PRIVATE KEY') || !new X509Certificate(text).ca)
      throw new Error();
    mkdirSync(certificateDirectory, { recursive: true });
    copyFileSync(source, join(certificateDirectory, 'rootCA.pem'));
  } catch {
    throw new Error(
      'Cannot copy the public mkcert rootCA.pem. The private CA key must remain outside the project.'
    );
  }
}

export function validateLocalIdentityConfig(env) {
  if (!validateKeycloakConfig(env))
    throw new Error('Local identity requires FUNDING_KEYCLOAK_ENABLED=true.');
  if (env.FUNDING_PLATFORM_ENV !== 'development')
    throw new Error(
      'Local identity requires FUNDING_PLATFORM_ENV=development.'
    );
  if (env.COMPOSE_FILE)
    throw new Error('Local identity cannot be combined with COMPOSE_FILE.');
  if (env.FUNDING_KEYCLOAK_HOSTNAME !== localIdentityHostname)
    throw new Error(
      'Local identity requires FUNDING_KEYCLOAK_HOSTNAME=auth.openg7.test.'
    );
  if (new URL(env.FUNDING_PUBLIC_BASE_URL).hostname !== 'localhost')
    throw new Error(
      'Local identity requires an HTTPS localhost public origin.'
    );
  return true;
}

export function validateLocalIdentityCertificates(root) {
  try {
    const directory = join(root, 'traefik', 'certs');
    const caText = readFileSync(join(directory, 'rootCA.pem'), 'utf8');
    if (caText.includes('PRIVATE KEY')) throw new Error();
    const ca = new X509Certificate(caText);
    const certificate = new X509Certificate(
      readFileSync(join(directory, 'localhost.pem'))
    );
    const key = createPrivateKey(
      readFileSync(join(directory, 'localhost-key.pem'))
    );
    const now = Date.now();
    if (
      !ca.ca ||
      !certificate.checkHost('localhost', { subject: 'never' }) ||
      !certificate.checkHost(localIdentityHostname, { subject: 'never' }) ||
      !certificate.checkPrivateKey(key) ||
      !certificate.verify(ca.publicKey) ||
      now < Date.parse(certificate.validFrom) ||
      now >= Date.parse(certificate.validTo) ||
      now < Date.parse(ca.validFrom) ||
      now >= Date.parse(ca.validTo)
    )
      throw new Error();
  } catch {
    throw new Error(
      'Local identity requires a valid local localhost/auth.openg7.test certificate, matching key and public rootCA.pem. Run yarn tls:local:setup --renew --no-restart.'
    );
  }
}

/** Derive local files without changing routing, middleware or TLS policy. */
export function localTraefikConfiguration(
  source,
  { staticConfig = false } = {}
) {
  let result = source.replaceAll('\r\n', '\n');
  if (staticConfig) {
    const block = result.match(
      /^certificatesResolvers:\n(?:[ \t].*\n|\n)*/m
    )?.[0];
    if (
      !block ||
      !/^certificatesResolvers:\n  letsencrypt:\n    acme:\n(?: {6}.*\n|\n)*$/.test(
        block
      )
    )
      throw new Error('Unexpected canonical Traefik ACME configuration.');
    result = result.replace(block, '');
    const references = result.match(/^ +certResolver: letsencrypt\n/gm) ?? [];
    if (references.length !== 1)
      throw new Error('Unexpected canonical Traefik TLS configuration.');
    result = result.replace(/^ +certResolver: letsencrypt\n/gm, '');
  } else {
    const references = result.match(/^ +certResolver: letsencrypt\n/gm) ?? [];
    let removed = 0;
    result = result.replace(
      /^( +)tls:\n\1  certResolver: letsencrypt\n/gm,
      (_match, indent) => {
        removed++;
        return `${indent}tls: {}\n`;
      }
    );
    if (!removed || removed !== references.length)
      throw new Error('Unexpected canonical Traefik router TLS configuration.');
  }
  if (/\b(?:certificatesResolvers|certResolver|acme):/.test(result))
    throw new Error('Unexpected remaining Traefik ACME configuration.');
  return result;
}

export function prepareLocalIdentity({ root, env }) {
  validateLocalIdentityConfig(env);
  validateLocalIdentityCertificates(root);
  const files = ['traefik.yml', 'dynamic.yml', 'keycloak.yml'].map((name) => ({
    path: join(root, 'traefik', 'local', name),
    content: localTraefikConfiguration(
      readFileSync(join(root, 'traefik', name), 'utf8'),
      { staticConfig: name === 'traefik.yml' }
    )
  }));
  mkdirSync(join(root, 'traefik', 'local'), { recursive: true });
  for (const file of files) writeFileSync(file.path, file.content);
  return files.map((file) => file.path);
}
