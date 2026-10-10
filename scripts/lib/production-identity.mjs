import { spawnSync } from 'node:child_process';
import { createPublicKey } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createServicesCheckContext } from './services-check-context.mjs';

const tlsConfigurationError = () =>
  new Error(
    'FUNDING_ADMIN_OIDC_ISSUER must identify the managed HTTPS Keycloak realm on port 443.'
  );
const requireTlsVerification = (env) => {
  if (
    env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
  )
    throw new Error(
      'Production identity requires native TLS certificate verification.'
    );
};
const managedIssuer = (env) => {
  try {
    const value = env.FUNDING_ADMIN_OIDC_ISSUER;
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.hostname !== env.FUNDING_KEYCLOAK_HOSTNAME ||
      url.pathname !== '/realms/openg7'
    )
      throw tlsConfigurationError();
    return url;
  } catch {
    throw tlsConfigurationError();
  }
};

export function validateProductionTlsSettings(env) {
  requireTlsVerification(env);
  const context = createServicesCheckContext(env);
  if (
    !context.hasRealValue('LETSENCRYPT_EMAIL') ||
    !context.isEmail(context.readValue('LETSENCRYPT_EMAIL'))
  )
    throw new Error(
      'LETSENCRYPT_EMAIL must be a configured, valid email address.'
    );
  managedIssuer(env);
  return true;
}

/** Existing ACME state is never read, replaced or reset. */
export async function prepareProductionAcme(
  root,
  { inspectProtectedStorage } = {}
) {
  if (process.platform === 'win32')
    throw new Error('Automatic production ACME storage requires a POSIX host.');
  const storageError = () =>
    new Error(
      'Cannot prepare protected traefik/acme/acme.json storage. Verify its permissions and the local Docker daemon.'
    );
  const directory = (path, mode, create) => {
    if (create) {
      try {
        mkdirSync(path, { mode });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw storageError();
    return stat;
  };
  const protect = (path, mode, isDirectory, create = false, metadata) => {
    if (metadata) {
      if (isDirectory ? !metadata.isDirectory() : !metadata.isFile())
        throw storageError();
      // A correct existing mode needs neither access to its contents nor
      // ownership. In particular, root's protected ACME file stays root-owned.
      if ((metadata.mode & 0o7777) === mode) return;
    }
    let descriptor;
    try {
      const flags =
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        (isDirectory ? constants.O_DIRECTORY : 0);
      if (create) {
        try {
          descriptor = openSync(
            path,
            flags | constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
            mode
          );
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
      descriptor ??= openSync(path, flags | constants.O_RDONLY);
      const stat = fstatSync(descriptor);
      if (isDirectory ? !stat.isDirectory() : !stat.isFile())
        throw storageError();
      fchmodSync(descriptor, mode);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  };
  try {
    const absolute = resolve(root);
    directory(absolute, 0o700, false);
    const traefik = join(absolute, 'traefik');
    directory(traefik, 0o755, true);
    const acme = join(traefik, 'acme');
    const acmeMetadata = directory(acme, 0o700, true);
    protect(acme, 0o700, true, false, acmeMetadata);
    const file = join(acme, 'acme.json');
    let fileMetadata;
    try {
      fileMetadata = lstatSync(file);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        if (
          !['EACCES', 'EPERM'].includes(error.code) ||
          acmeMetadata.uid !== 0 ||
          (acmeMetadata.mode & 0o7777) !== 0o700 ||
          typeof inspectProtectedStorage !== 'function'
        )
          throw error;
        await inspectProtectedStorage({
          directory: acme,
          device: acmeMetadata.dev,
          inode: acmeMetadata.ino
        });
        return file;
      }
    }
    protect(file, 0o600, false, true, fileMetadata);
    return file;
  } catch {
    throw storageError();
  }
}

// The operator can use the local Docker daemon to inspect an installer's
// root-owned directory. This helper never reads or changes certificate data.
export function inspectProductionAcmeWithDocker({
  root,
  storage,
  composeArgs,
  env = process.env,
  runDocker = spawnSync
}) {
  const failInspection = () =>
    new Error(
      'Cannot validate protected ACME metadata with the local Docker daemon.'
    );
  const options = {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true
  };
  try {
    const expectedDirectory = join(resolve(root), 'traefik', 'acme');
    if (
      storage.directory !== expectedDirectory ||
      /[,\r\n\0]/.test(storage.directory) ||
      ![storage.device, storage.inode].every(Number.isSafeInteger) ||
      composeArgs[0] !== 'compose'
    )
      throw failInspection();
    const configuration = runDocker(
      'docker',
      [...composeArgs, 'config', '--images', 'traefik'],
      { ...options, timeout: 15_000 }
    );
    const image = configuration.stdout?.trim();
    if (
      configuration.error ||
      configuration.status !== 0 ||
      !image ||
      !/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(image)
    )
      throw failInspection();
    const script = `directory="$1"
file="$directory/acme.json"
[ ! -L "$directory" ]
[ -d "$directory" ]
[ "$(stat -c %u "$directory")" = 0 ]
[ "$(stat -c %a "$directory")" = 700 ]
[ "$(stat -c %d:%i "$directory")" = "$2" ]
[ ! -L "$file" ]
[ -f "$file" ]
[ "$(stat -c %a "$file")" = 600 ]`;
    const inspection = runDocker(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--user',
        '0:0',
        '--pids-limit',
        '32',
        '--mount',
        `type=bind,source=${storage.directory},target=/acme,readonly,bind-recursive=disabled`,
        '--entrypoint',
        '/bin/sh',
        image,
        '-ec',
        script,
        'og7-acme-check',
        '/acme',
        `${storage.device}:${storage.inode}`
      ],
      { ...options, timeout: 60_000 }
    );
    if (inspection.error || inspection.status !== 0) throw failInspection();
  } catch {
    // Docker errors can include environment values; do not relay their output.
    throw failInspection();
  }
}

class PermanentIdentityError extends Error {}
class RetryableIdentityError extends Error {}
const fail = (reason) => {
  throw new PermanentIdentityError(reason);
};
const endpoint = (value, issuer) => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.origin !== issuer.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(`${issuer.pathname}/`)
    )
      fail('OIDC endpoints do not match the managed HTTPS realm');
    return url.href;
  } catch {
    fail('OIDC endpoints do not match the managed HTTPS realm');
  }
};
const usablePublicSigningKey = (key) => {
  if (
    !key ||
    key.kty !== 'RSA' ||
    typeof key.kid !== 'string' ||
    !key.kid.trim() ||
    (key.use !== undefined && key.use !== 'sig') ||
    (key.alg !== undefined && key.alg !== 'RS256') ||
    (key.key_ops !== undefined &&
      (!Array.isArray(key.key_ops) || !key.key_ops.includes('verify'))) ||
    ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some((name) => name in key) ||
    [key.n, key.e].some(
      (value) => typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)
    )
  )
    return false;
  try {
    const publicKey = createPublicKey({ key, format: 'jwk' });
    return (
      publicKey.asymmetricKeyType === 'rsa' &&
      publicKey.asymmetricKeyDetails?.modulusLength >= 2048
    );
  } catch {
    return false;
  }
};
const requestJson = async (url, fetchImpl, timeoutMs) => {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new RetryableIdentityError('HTTPS request exceeded its deadline'));
      controller.abort();
    }, timeoutMs);
  });
  const request = (async () => {
    try {
      const response = await fetchImpl(url, {
        redirect: 'error',
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      if (!response.ok)
        throw new RetryableIdentityError('HTTPS response is not ready');
      return await response.json();
    } catch (error) {
      controller.abort();
      if (error instanceof RetryableIdentityError) throw error;
      throw new RetryableIdentityError('Trusted HTTPS response is unavailable');
    }
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

export async function waitForProductionIdentity(
  env,
  {
    fetchImpl = fetch,
    now = Date.now,
    sleep = delay,
    timeoutMs = 180_000,
    intervalMs = 2_000,
    requestTimeoutMs = 10_000
  } = {}
) {
  requireTlsVerification(env);
  if (
    [timeoutMs, intervalMs, requestTimeoutMs].some(
      (value) => !Number.isFinite(value) || value <= 0
    )
  )
    throw new Error(
      'Production identity deadlines must be positive finite durations.'
    );
  const issuer = managedIssuer(env);
  const deadline = now() + timeoutMs;
  let reason = 'Trusted HTTPS identity is unavailable';
  while (now() < deadline) {
    try {
      const json = (url) => {
        const remaining = deadline - now();
        if (remaining <= 0)
          throw new RetryableIdentityError('HTTPS readiness deadline expired');
        return requestJson(
          url,
          fetchImpl,
          Math.min(requestTimeoutMs, remaining)
        );
      };
      const discovery = await json(
        `${env.FUNDING_ADMIN_OIDC_ISSUER}/.well-known/openid-configuration`
      );
      if (!discovery || discovery.issuer !== env.FUNDING_ADMIN_OIDC_ISSUER)
        fail('OIDC discovery issuer does not match the configured realm');
      endpoint(discovery.authorization_endpoint, issuer);
      endpoint(discovery.token_endpoint, issuer);
      const jwksUrl = endpoint(discovery.jwks_uri, issuer);
      const jwks = await json(jwksUrl);
      if (!Array.isArray(jwks?.keys) || !jwks.keys.some(usablePublicSigningKey))
        fail('OIDC JWKS has no usable public RSA signing key');
      return;
    } catch (error) {
      if (error instanceof PermanentIdentityError)
        throw new Error(`Production identity is not ready: ${error.message}.`);
      reason =
        error instanceof RetryableIdentityError
          ? error.message
          : 'Trusted HTTPS identity is unavailable';
    }
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(intervalMs, remaining));
  }
  throw new Error(`Production identity HTTPS readiness timed out: ${reason}.`);
}
