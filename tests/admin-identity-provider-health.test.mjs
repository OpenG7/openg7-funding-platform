import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  readIdentityProviderHealth,
  validateIdentityReadinessUrl
} from '../dist/apps/funding-api/src/admin-identity/provider-health.js';

const issuer = new URL('https://identity.example.test/realms/synthetic');
const privateCanary = 'synthetic-provider-private-canary';
const failure = 'The identity provider health check failed.';
const publicKey = (type, options) =>
  generateKeyPairSync(type, options).publicKey.export({ format: 'jwk' });
const rsa = {
  ...publicKey('rsa', { modulusLength: 2048 }),
  alg: 'RS256',
  use: 'sig'
};
const ec = { ...publicKey('ec', { namedCurve: 'P-256' }), alg: 'ES256' };
const ed = { ...publicKey('ed25519'), alg: 'EdDSA', key_ops: ['verify'] };

const metadata = (selected = issuer, changes = {}) => ({
  issuer: selected.href,
  authorization_endpoint: selected.href.replace(/\/$/, '') + '/authorize',
  token_endpoint: selected.href.replace(/\/$/, '') + '/token',
  jwks_uri: selected.href.replace(/\/$/, '') + '/jwks',
  ...changes
});
const json = (body, options = {}) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
const safeError = (error) => {
  assert.equal(error.message, failure);
  assert.equal(error.cause, undefined);
  assert.equal(error.input, undefined);
  assert.ok(!String(error.stack).includes(privateCanary));
  return true;
};
const fetchFixture = (responses) => {
  const calls = [];
  const fetcher = async (url, options) => {
    const index = calls.length;
    calls.push({ url: String(url), options });
    assert.ok(!String(url).includes(privateCanary));
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(index < responses.length, 'Unexpected provider request');
    const selected = responses[index];
    return typeof selected === 'function' ? selected(url, options) : selected;
  };
  return { calls, fetcher };
};
const signal = () => new AbortController().signal;
const readinessUrl = new URL('http://keycloak:9000/health/ready');
const ready = () => ({
  status: 'UP',
  checks: [
    { name: 'Keycloak database connections async health check', status: 'UP' },
    { name: 'Keycloak cluster health check', status: 'UP' }
  ]
});

test('generic OIDC health validates discovery without fetching cross-origin signing keys or authenticating', async () => {
  const fixture = fetchFixture([
    json(
      metadata(issuer, {
        authorization_endpoint: 'https://login.example.test/authorize?public=1',
        token_endpoint: 'https://tokens.example.test/token?tenant=synthetic',
        jwks_uri: 'https://keys.example.test/public/jwks?tenant=synthetic',
        client_secret: privateCanary
      })
    )
  ]);
  const suppliedSignal = signal();
  await readIdentityProviderHealth(issuer, suppliedSignal, {
    fetcher: fixture.fetcher,
    readinessUrl
  });
  assert.equal(fixture.calls.length, 1);
  assert.equal(
    fixture.calls[0].url,
    issuer.href + '/.well-known/openid-configuration'
  );
  assert.equal(fixture.calls[0].options.signal, suppliedSignal);
});

test('managed Keycloak health reads usable RSA, EC and EdDSA public signing keys', async () => {
  for (const key of [rsa, ec, ed]) {
    const fixture = fetchFixture([
      json(metadata()),
      json({ keys: [{ kty: 'oct', k: privateCanary }, key] })
    ]);
    await readIdentityProviderHealth(issuer, signal(), {
      keycloak: true,
      fetcher: fixture.fetcher
    });
    assert.deepEqual(
      fixture.calls.map((call) => call.url),
      [issuer.href + '/.well-known/openid-configuration', issuer.href + '/jwks']
    );
  }
});

test('managed Keycloak readiness requires the database and every advertised check to be UP', async () => {
  const fixture = fetchFixture([
    json(metadata()),
    json({ keys: [rsa] }),
    json(ready())
  ]);
  await readIdentityProviderHealth(issuer, signal(), {
    keycloak: true,
    fetcher: fixture.fetcher,
    readinessUrl
  });
  assert.equal(fixture.calls[2].url, 'http://keycloak:9000/health/ready');
  for (const body of [
    { ...ready(), status: 'DOWN' },
    { status: 'UP' },
    { status: 'UP', checks: [] },
    { status: 'UP', checks: [{ name: 'other check', status: 'UP' }] },
    {
      status: 'UP',
      checks: [{ name: 'database connections', status: 'DOWN' }]
    },
    {
      status: 'UP',
      checks: [
        { name: 'database connections', status: 'UP' },
        { name: 'cluster', status: 'DOWN' }
      ]
    },
    { status: 'UP', checks: [null] }
  ]) {
    const refused = fetchFixture([
      json(metadata()),
      json({ keys: [rsa] }),
      json(body)
    ]);
    await assert.rejects(
      readIdentityProviderHealth(issuer, signal(), {
        keycloak: true,
        fetcher: refused.fetcher,
        readinessUrl
      }),
      safeError
    );
    assert.equal(refused.calls.length, 3);
  }
  const unavailable = fetchFixture([
    json(metadata()),
    json({ keys: [rsa] }),
    new Response(privateCanary, { status: 503 })
  ]);
  await assert.rejects(
    readIdentityProviderHealth(issuer, signal(), {
      keycloak: true,
      fetcher: unavailable.fetcher,
      readinessUrl
    }),
    safeError
  );
});

test('readiness accepts only the exact private Keycloak HTTP target or credential-free HTTPS', async () => {
  for (const value of [
    'http://keycloak:9000/health/ready',
    'https://identity.example.test/health/ready'
  ])
    assert.equal(validateIdentityReadinessUrl(value).href, value);
  for (const value of [
    'http://127.0.0.1:9000/health/ready',
    'http://keycloak:9000/health/live',
    'http://keycloak:9001/health/ready',
    'http://foreign.example.test:9000/health/ready',
    'http://keycloak:9000/health/ready?token=' + privateCanary,
    'https://synthetic:' +
      privateCanary +
      '@identity.example.test/health/ready',
    'https://identity.example.test/health/ready#' + privateCanary,
    'https://identity.example.test/health/ready?',
    'https://identity.example.test/health/ready#',
    'file:///tmp/synthetic-health.json'
  ]) {
    assert.throws(
      () => validateIdentityReadinessUrl(value),
      (error) => {
        assert.equal(
          error.message,
          'The identity readiness URL is not an approved secure target.'
        );
        assert.equal(error.cause, undefined);
        assert.equal(error.input, undefined);
        assert.ok(!String(error.stack).includes(privateCanary));
        return true;
      }
    );
    const fixture = fetchFixture([]);
    await assert.rejects(
      readIdentityProviderHealth(issuer, signal(), {
        keycloak: true,
        fetcher: fixture.fetcher,
        readinessUrl: new URL(value)
      }),
      safeError
    );
    assert.equal(fixture.calls.length, 0);
  }
});

test('issuer comparison follows the existing URL contract while preserving realm path and slash differences', async () => {
  const root = new URL('https://identity.example.test');
  const fixture = fetchFixture([
    json(metadata(root, { issuer: 'https://identity.example.test' }))
  ]);
  await readIdentityProviderHealth(root, signal(), {
    fetcher: fixture.fetcher
  });
  assert.equal(
    fixture.calls[0].url,
    'https://identity.example.test/.well-known/openid-configuration'
  );
  for (const changed of [
    'https://foreign.example.test/realms/synthetic',
    issuer.href + '/',
    issuer.href + '-different',
    'https://synthetic:' + privateCanary + '@identity.example.test',
    issuer.href + '?client_secret=' + privateCanary
  ]) {
    const refused = fetchFixture([json(metadata(issuer, { issuer: changed }))]);
    await assert.rejects(
      readIdentityProviderHealth(issuer, signal(), {
        fetcher: refused.fetcher
      }),
      safeError
    );
    assert.equal(refused.calls.length, 1);
  }
});

test('private or insecure issuer URLs are refused before contacting a provider', async () => {
  for (const value of [
    'http://identity.example.test/realms/synthetic',
    'https://synthetic:' + privateCanary + '@identity.example.test',
    issuer.href + '?secret=' + privateCanary,
    issuer.href + '#' + privateCanary,
    issuer.href + '?',
    issuer.href + '#',
    'file:///tmp/synthetic-discovery.json'
  ]) {
    const fixture = fetchFixture([]);
    await assert.rejects(
      readIdentityProviderHealth(new URL(value), signal(), {
        fetcher: fixture.fetcher
      }),
      safeError
    );
    assert.equal(fixture.calls.length, 0);
  }
});

test('discovery rejects missing, relative, private or insecure endpoints without following them', async () => {
  for (const attribute of [
    'authorization_endpoint',
    'token_endpoint',
    'jwks_uri'
  ]) {
    for (const value of [
      undefined,
      '/relative',
      'http://identity.example.test/insecure',
      'http://localhost/production-downgrade',
      'https://synthetic:' + privateCanary + '@identity.example.test/endpoint',
      'https://identity.example.test/endpoint#' + privateCanary,
      'https://identity.example.test/endpoint#'
    ]) {
      const fixture = fetchFixture([
        json(metadata(issuer, { [attribute]: value }))
      ]);
      await assert.rejects(
        readIdentityProviderHealth(issuer, signal(), {
          fetcher: fixture.fetcher
        }),
        safeError
      );
      assert.equal(fixture.calls.length, 1);
    }
  }
});

test('Keycloak JWKS refuses a foreign origin, alternate port and secret query before any second request', async () => {
  for (const value of [
    'https://foreign.example.test/jwks',
    'https://identity.example.test:8443/jwks',
    issuer.href + '/jwks?client_secret=' + privateCanary,
    issuer.href + '/jwks?'
  ]) {
    const fixture = fetchFixture([json(metadata(issuer, { jwks_uri: value }))]);
    await assert.rejects(
      readIdentityProviderHealth(issuer, signal(), {
        keycloak: true,
        fetcher: fixture.fetcher
      }),
      safeError
    );
    assert.equal(fixture.calls.length, 1);
  }
});

test('HTTP statuses, redirects and network or TLS exceptions produce only a generic failure', async () => {
  for (const stage of [0, 1]) {
    for (const selected of [
      () => new Response(privateCanary, { status: 503 }),
      () =>
        new Response(privateCanary, {
          status: 302,
          headers: { Location: 'https://foreign.example.test' }
        }),
      () => {
        const response = json({ keys: [rsa] });
        Object.defineProperty(response, 'redirected', { value: true });
        return response;
      },
      () => {
        throw new Error('TLS certificate rejected: ' + privateCanary);
      },
      () => {
        throw new TypeError('Network failure: ' + privateCanary);
      }
    ]) {
      const fixture = fetchFixture(
        stage === 0 ? [selected] : [json(metadata()), selected]
      );
      await assert.rejects(
        readIdentityProviderHealth(issuer, signal(), {
          keycloak: true,
          fetcher: fixture.fetcher
        }),
        safeError
      );
      assert.equal(fixture.calls.length, stage + 1);
    }
  }
});

test('malformed metadata and empty or unusable JWKS never count as a healthy identity provider', async () => {
  for (const body of ['', privateCanary, 'null', '[]', '{"issuer":']) {
    const fixture = fetchFixture([new Response(body)]);
    await assert.rejects(
      readIdentityProviderHealth(issuer, signal(), {
        fetcher: fixture.fetcher
      }),
      safeError
    );
  }
  for (const body of [
    null,
    [],
    {},
    { keys: [] },
    { keys: {} },
    { keys: [{ kty: 'oct', k: privateCanary, alg: 'HS256' }] },
    { keys: [{ ...rsa, use: 'enc' }] },
    { keys: [{ ...rsa, key_ops: ['encrypt'] }] },
    { keys: [{ ...rsa, key_ops: ['verify', 1] }] },
    { keys: [{ ...rsa, alg: 'RSA-OAEP' }] },
    { keys: [{ ...rsa, d: privateCanary }] },
    { keys: [{ ...rsa, n: 'malformed$modulus' }] },
    { keys: [{ kty: 'RSA', n: 'AQ', e: 'AQ' }] },
    { keys: [{ ...ec, alg: 'ES384' }] },
    { keys: [{ ...ec, x: 'bad' }] },
    { keys: [{ ...ed, crv: 'X25519' }] }
  ]) {
    const fixture = fetchFixture([json(metadata()), json(body)]);
    await assert.rejects(
      readIdentityProviderHealth(issuer, signal(), {
        keycloak: true,
        fetcher: fixture.fetcher
      }),
      safeError
    );
  }
});

test('streamed bodies are capped at 128 KiB and oversized responses are canceled promptly', async () => {
  for (const stage of [0, 1, 2]) {
    let canceled = 0;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(128 * 1024 + 1));
      },
      cancel() {
        canceled += 1;
      }
    });
    const oversized = new Response(body);
    const fixture = fetchFixture([
      ...[json(metadata()), json({ keys: [rsa] })].slice(0, stage),
      oversized
    ]);
    await assert.rejects(
      readIdentityProviderHealth(issuer, signal(), {
        keycloak: true,
        fetcher: fixture.fetcher,
        readinessUrl
      }),
      safeError
    );
    assert.equal(canceled, 1);
  }
  let canceled = 0;
  const advertised = new Response(
    new ReadableStream({
      cancel() {
        canceled += 1;
      }
    }),
    { headers: { 'Content-Length': String(128 * 1024 + 1) } }
  );
  const fixture = fetchFixture([advertised]);
  await assert.rejects(
    readIdentityProviderHealth(issuer, signal(), { fetcher: fixture.fetcher }),
    safeError
  );
  assert.equal(canceled, 1);
});

test('already-aborted and timed-out fetches stop the probe without preserving a private error reason', async () => {
  const aborted = new AbortController();
  aborted.abort(new Error(privateCanary));
  const unused = fetchFixture([]);
  await assert.rejects(
    readIdentityProviderHealth(issuer, aborted.signal, {
      fetcher: unused.fetcher
    }),
    safeError
  );
  assert.equal(unused.calls.length, 0);
  const pending = fetchFixture([() => new Promise(() => {})]);
  const timedOut = new AbortController();
  const timer = setTimeout(() => timedOut.abort(new Error(privateCanary)), 20);
  try {
    await assert.rejects(
      readIdentityProviderHealth(issuer, timedOut.signal, {
        fetcher: pending.fetcher
      }),
      safeError
    );
  } finally {
    clearTimeout(timer);
  }
});

test('aborting a stalled response cancels its reader without waiting for the body or its cancel callback', async () => {
  for (const stage of [0, 1]) {
    const controller = new AbortController();
    let canceled = 0;
    const body = new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{'));
      },
      cancel() {
        canceled += 1;
        return new Promise(() => {});
      }
    });
    const fixture = fetchFixture(
      stage === 0
        ? [new Response(body)]
        : [json(metadata()), new Response(body)]
    );
    const pending = readIdentityProviderHealth(issuer, controller.signal, {
      keycloak: true,
      fetcher: fixture.fetcher
    });
    setImmediate(() => controller.abort(new Error(privateCanary)));
    await assert.rejects(pending, safeError);
    assert.equal(canceled, 1);
  }
});

test('real fetch performs only public discovery and JWKS GETs on an isolated HTTP loopback provider', async (t) => {
  const requests = [];
  let local;
  const server = createServer((request, reply) => {
    requests.push({
      method: request.method,
      path: request.url,
      headers: request.headers
    });
    reply.setHeader('Content-Type', 'application/json');
    if (request.url === '/realms/synthetic/.well-known/openid-configuration')
      reply.end(JSON.stringify(metadata(local)));
    else if (request.url === '/realms/synthetic/jwks')
      reply.end(JSON.stringify({ keys: [rsa] }));
    else reply.writeHead(404).end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  );
  local = new URL(`http://127.0.0.1:${server.address().port}/realms/synthetic`);
  await readIdentityProviderHealth(local, AbortSignal.timeout(2000), {
    keycloak: true
  });
  assert.deepEqual(
    requests.map((request) => [request.method, request.path]),
    [
      ['GET', '/realms/synthetic/.well-known/openid-configuration'],
      ['GET', '/realms/synthetic/jwks']
    ]
  );
  for (const request of requests) {
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
  }
});
