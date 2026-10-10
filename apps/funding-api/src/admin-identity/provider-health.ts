import { createPublicKey, type JsonWebKey } from 'node:crypto';

const maximumBodyBytes = 128 * 1024;
const unavailableMessage = 'The identity provider health check failed.';
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const privateReadinessUrl = 'http://keycloak:9000/health/ready';

export interface IdentityProviderHealth {
  readonly provider: 'Keycloak' | 'OIDC';
  readonly evidence: 'oidc_discovery' | 'keycloak_readiness';
  readonly read: (signal: AbortSignal) => Promise<void>;
}

interface IdentityProviderHealthOptions {
  readonly keycloak?: boolean;
  readonly fetcher?: typeof fetch;
  readonly readinessUrl?: URL;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const endpoint = (
  value: unknown,
  noQuery = false,
  httpTarget: 'none' | 'loopback' | 'keycloak-readiness' = 'none'
): URL => {
  if (typeof value !== 'string') throw new Error();
  const url = new URL(value);
  const approvedHttp =
    url.protocol === 'http:' &&
    ((httpTarget === 'loopback' && loopbackHosts.has(url.hostname)) ||
      (httpTarget === 'keycloak-readiness' &&
        url.href === privateReadinessUrl));
  if (
    (url.protocol !== 'https:' && !approvedHttp) ||
    url.username ||
    url.password ||
    url.href.includes('#') ||
    (noQuery && url.href.includes('?'))
  )
    throw new Error();
  return url;
};

export function validateIdentityReadinessUrl(value: string): URL {
  try {
    return endpoint(value, true, 'keycloak-readiness');
  } catch {
    throw new Error(
      'The identity readiness URL is not an approved secure target.'
    );
  }
}

export function createIdentityProviderHealth(
  issuer: URL,
  env: NodeJS.ProcessEnv
): IdentityProviderHealth {
  const enabled = env.FUNDING_KEYCLOAK_ENABLED ?? 'false';
  if (!['true', 'false'].includes(enabled))
    throw new Error('FUNDING_KEYCLOAK_ENABLED must be true or false.');
  const keycloak = enabled === 'true';
  const readiness = env.FUNDING_KEYCLOAK_HEALTH_URL ?? '';
  if (readiness && !keycloak)
    throw new Error('FUNDING_KEYCLOAK_HEALTH_URL requires managed Keycloak.');
  const readinessUrl = readiness
    ? validateIdentityReadinessUrl(readiness)
    : undefined;
  return {
    provider: keycloak ? 'Keycloak' : 'OIDC',
    evidence: readinessUrl ? 'keycloak_readiness' : 'oidc_discovery',
    read: (signal) =>
      readIdentityProviderHealth(issuer, signal, { keycloak, readinessUrl })
  };
}

const abortable = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const aborted = (): void => reject(new Error());
    if (signal.aborted) {
      void operation.catch(() => undefined);
      aborted();
      return;
    }
    signal.addEventListener('abort', aborted, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', aborted);
        reject(error);
      }
    );
  });

const discard = (body: ReadableStream<Uint8Array> | null): void => {
  try {
    void body?.cancel().catch(() => undefined);
  } catch {
    // A rejected probe must not wait for an untrusted response to finish.
  }
};

const readJson = async (
  response: Response,
  signal: AbortSignal
): Promise<unknown> => {
  if (
    !response.ok ||
    response.redirected ||
    Number(response.headers.get('content-length')) > maximumBodyBytes ||
    !response.body
  ) {
    discard(response.body);
    throw new Error();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > maximumBodyBytes) throw new Error();
      chunks.push(value);
    }
    signal.throwIfAborted();
    const body = Buffer.concat(chunks, total);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    void reader.cancel().catch(() => undefined);
    throw new Error();
  } finally {
    reader.releaseLock();
  }
};

const usableSignatureKey = (value: unknown): boolean => {
  if (
    !object(value) ||
    (value.use !== undefined && value.use !== 'sig') ||
    (value.key_ops !== undefined &&
      (!Array.isArray(value.key_ops) ||
        value.key_ops.some((operation) => typeof operation !== 'string') ||
        !value.key_ops.includes('verify'))) ||
    ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some((name) =>
      Object.hasOwn(value, name)
    )
  )
    return false;
  const algorithm = value.alg;
  const base64url = (part: unknown): boolean =>
    typeof part === 'string' && /^[a-zA-Z0-9_-]+$/.test(part);
  try {
    if (value.kty === 'RSA') {
      if (
        !base64url(value.n) ||
        !base64url(value.e) ||
        (algorithm !== undefined &&
          !['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512'].includes(
            String(algorithm)
          ))
      )
        return false;
      const key = createPublicKey({ key: value as JsonWebKey, format: 'jwk' });
      const details = key.asymmetricKeyDetails;
      const exponent = details?.publicExponent;
      return (
        key.asymmetricKeyType === 'rsa' &&
        (details?.modulusLength ?? 0) >= 2048 &&
        exponent !== undefined &&
        exponent >= 3n &&
        exponent % 2n === 1n
      );
    }
    if (value.kty === 'EC') {
      const curveAlgorithm: Record<string, string> = {
        'P-256': 'ES256',
        'P-384': 'ES384',
        'P-521': 'ES512'
      };
      if (
        typeof value.crv !== 'string' ||
        !Object.hasOwn(curveAlgorithm, value.crv) ||
        !base64url(value.x) ||
        !base64url(value.y) ||
        (algorithm !== undefined && algorithm !== curveAlgorithm[value.crv])
      )
        return false;
      return (
        createPublicKey({ key: value as JsonWebKey, format: 'jwk' })
          .asymmetricKeyType === 'ec'
      );
    }
    if (value.kty === 'OKP') {
      if (
        !['Ed25519', 'Ed448'].includes(String(value.crv)) ||
        !base64url(value.x) ||
        (algorithm !== undefined && algorithm !== 'EdDSA')
      )
        return false;
      return ['ed25519', 'ed448'].includes(
        createPublicKey({ key: value as JsonWebKey, format: 'jwk' })
          .asymmetricKeyType ?? ''
      );
    }
  } catch {
    return false;
  }
  return false;
};

const databaseReady = (value: unknown): boolean =>
  object(value) &&
  value.status === 'UP' &&
  Array.isArray(value.checks) &&
  value.checks.length > 0 &&
  value.checks.every(
    (check: unknown) =>
      object(check) && typeof check.name === 'string' && check.status === 'UP'
  ) &&
  value.checks.some((check: Record<string, unknown>) =>
    String(check.name).toLowerCase().includes('database connections')
  );

/** Unauthenticated checks; this probe never authenticates or populates login caches. */
export async function readIdentityProviderHealth(
  issuer: URL,
  signal: AbortSignal,
  {
    keycloak = false,
    fetcher = fetch,
    readinessUrl
  }: IdentityProviderHealthOptions = {}
): Promise<void> {
  try {
    const expected = endpoint(issuer.href, true, 'loopback');
    const httpTarget = expected.protocol === 'http:' ? 'loopback' : 'none';
    const readiness =
      keycloak && readinessUrl
        ? validateIdentityReadinessUrl(readinessUrl.href)
        : undefined;
    const get = async (url: URL): Promise<unknown> => {
      signal.throwIfAborted();
      const operation = fetcher(url, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        signal,
        headers: { Accept: 'application/json' }
      });
      void operation.then(
        (response) => {
          if (signal.aborted) discard(response.body);
        },
        () => undefined
      );
      return readJson(await abortable(operation, signal), signal);
    };
    const discovery = await get(
      new URL(
        `${expected.href.replace(/\/$/, '')}/.well-known/openid-configuration`
      )
    );
    if (
      !object(discovery) ||
      endpoint(discovery.issuer, true, httpTarget).href !== expected.href
    )
      throw new Error();
    endpoint(discovery.authorization_endpoint, false, httpTarget);
    endpoint(discovery.token_endpoint, false, httpTarget);
    const jwks = endpoint(discovery.jwks_uri, keycloak, httpTarget);
    if (keycloak) {
      if (jwks.origin !== expected.origin) throw new Error();
      const keys = await get(jwks);
      if (
        !object(keys) ||
        !Array.isArray(keys.keys) ||
        !keys.keys.some(usableSignatureKey)
      )
        throw new Error();
      if (readiness && !databaseReady(await get(readiness))) throw new Error();
    }
    signal.throwIfAborted();
  } catch {
    throw new Error(unavailableMessage);
  }
}
