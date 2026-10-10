import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  prepareProductionAcme,
  validateProductionTlsSettings,
  waitForProductionIdentity
} from '../scripts/lib/production-identity.mjs';
import { createLocalTlsFixture } from './support/local-tls-fixture.mjs';

const canary = 'synthetic-provider-private-canary';
const env = () => ({
  LETSENCRYPT_EMAIL: 'operations@fund.example.org',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.org',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.example.org/realms/openg7',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: canary
});
const issuer = env().FUNDING_ADMIN_OIDC_ISSUER;
const discovery = () => ({
  issuer,
  authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
  token_endpoint: `${issuer}/protocol/openid-connect/token`,
  jwks_uri: `${issuer}/protocol/openid-connect/certs`
});
const key = {
  ...generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({
    format: 'jwk'
  }),
  kid: 'synthetic-rsa-signing-key',
  use: 'sig',
  alg: 'RS256',
  key_ops: ['verify']
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
const assertSafeError = (error, pattern) => {
  assert.match(error.message, pattern);
  assert.ok(
    !error.message.includes(canary),
    'Provider data must not appear in errors'
  );
  return true;
};
const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'og7-production-identity-'));
  t.after(() => {
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('og7-production-identity-'));
    rmSync(target, { recursive: true, force: true });
  });
  return root;
};

test('production TLS validates the configured email and managed issuer without changing inputs', () => {
  const input = Object.freeze(env());
  assert.equal(validateProductionTlsSettings(input), true);
  assert.deepEqual(input, env());
  assert.equal(
    validateProductionTlsSettings({
      ...input,
      FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.example.org:443/realms/openg7'
    }),
    true
  );
  for (const email of [
    '',
    'change-me@fund.example.org',
    'admin@example.com',
    'missing-domain',
    'line\nbreak@fund.example.org',
    canary
  ])
    assert.throws(
      () =>
        validateProductionTlsSettings({ ...input, LETSENCRYPT_EMAIL: email }),
      (error) => assertSafeError(error, /LETSENCRYPT_EMAIL/)
    );
  for (const value of [
    'http://auth.example.org/realms/openg7',
    'https://auth.example.org:8443/realms/openg7',
    'https://other.example.org/realms/openg7',
    'https://auth.example.org/realms/another',
    'https://auth.example.org/realms/openg7?mode=fixture',
    'https://auth.example.org/realms/openg7#fixture',
    `https://operator:${canary}@auth.example.org/realms/openg7`,
    canary
  ])
    assert.throws(
      () =>
        validateProductionTlsSettings({
          ...input,
          FUNDING_ADMIN_OIDC_ISSUER: value
        }),
      (error) => assertSafeError(error, /FUNDING_ADMIN_OIDC_ISSUER/)
    );
});

test('TLS bypasses in the supplied or process environment fail before any HTTPS request', async () => {
  let requests = 0;
  const fetchImpl = () => {
    requests++;
    assert.fail('TLS bypass must not make a request');
  };
  assert.throws(
    () =>
      validateProductionTlsSettings({
        ...env(),
        NODE_TLS_REJECT_UNAUTHORIZED: '0'
      }),
    /native TLS certificate verification/
  );
  await assert.rejects(
    waitForProductionIdentity(
      { ...env(), NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      { fetchImpl }
    ),
    /native TLS certificate verification/
  );
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    assert.throws(
      () => validateProductionTlsSettings(env()),
      /native TLS certificate verification/
    );
    await assert.rejects(
      waitForProductionIdentity(env(), { fetchImpl }),
      /native TLS certificate verification/
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
  }
  assert.equal(requests, 0);
});

test(
  'Windows ACME preparation refuses before creating storage',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const root = fixture(t);
    await assert.rejects(prepareProductionAcme(root), /POSIX host/);
    assert.ok(!existsSync(join(root, 'traefik')));
  }
);

test(
  'POSIX ACME preparation creates protected state and preserves existing content on repeated calls',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = fixture(t);
    const path = await prepareProductionAcme(root);
    assert.equal(path, join(root, 'traefik/acme/acme.json'));
    assert.equal(statSync(join(root, 'traefik/acme')).mode & 0o777, 0o700);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(readFileSync(path, 'utf8'), '');
    const content = JSON.stringify({ syntheticAcmeState: canary });
    writeFileSync(path, content);
    const before = statSync(path);
    await prepareProductionAcme(root);
    assert.equal(readFileSync(path, 'utf8'), content);
    assert.equal(statSync(path).ino, before.ino);
    assert.equal(statSync(path).mtimeMs, before.mtimeMs);
  }
);

test(
  'POSIX ACME preparation rejects symlinks and nonregular storage without touching their target',
  { skip: process.platform === 'win32' },
  async (t) => {
    for (const kind of [
      'traefik-link',
      'directory-link',
      'file-link',
      'file-directory',
      'file-fifo'
    ]) {
      const root = fixture(t);
      const target = join(root, 'untouched');
      mkdirSync(target);
      const targetFile = join(target, 'state');
      writeFileSync(targetFile, canary);
      if (kind === 'traefik-link') symlinkSync(target, join(root, 'traefik'));
      else {
        mkdirSync(join(root, 'traefik'));
        if (kind === 'directory-link')
          symlinkSync(target, join(root, 'traefik/acme'));
        else {
          mkdirSync(join(root, 'traefik/acme'));
          const path = join(root, 'traefik/acme/acme.json');
          if (kind === 'file-link') symlinkSync(targetFile, path);
          else if (kind === 'file-directory') mkdirSync(path);
          else
            assert.equal(
              spawnSync('mkfifo', [path], { stdio: 'ignore', timeout: 1_000 })
                .status,
              0
            );
        }
      }
      await assert.rejects(
        prepareProductionAcme(root),
        /protected traefik\/acme\/acme.json/
      );
      assert.equal(readFileSync(targetFile, 'utf8'), canary);
      assert.ok(!existsSync(join(target, 'acme.json')));
      if (kind === 'file-link')
        assert.equal(
          lstatSync(join(root, 'traefik/acme/acme.json')).isSymbolicLink(),
          true
        );
    }
  }
);

test('HTTPS readiness fetches discovery and a usable public signing key without sending credentials', async () => {
  const calls = [];
  const input = Object.freeze(env());
  await waitForProductionIdentity(input, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.redirect, 'error');
      assert.deepEqual(options.headers, { Accept: 'application/json' });
      assert.equal(options.body, undefined);
      assert.ok(!JSON.stringify({ url, options }).includes(canary));
      return json(
        url.endsWith('openid-configuration') ? discovery() : { keys: [key] }
      );
    }
  });
  assert.deepEqual(
    calls.map(({ url }) => url),
    [`${issuer}/.well-known/openid-configuration`, discovery().jwks_uri]
  );
  assert.deepEqual(input, env());
});

test('transient TLS and HTTP failures retry within the total deadline', async () => {
  let clock = 0;
  let requests = 0;
  const delays = [];
  await waitForProductionIdentity(env(), {
    now: () => clock,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
      clock += milliseconds;
    },
    timeoutMs: 100,
    intervalMs: 20,
    requestTimeoutMs: 50,
    fetchImpl: async (url) => {
      requests++;
      if (requests === 1) throw new Error(`CERT_HAS_EXPIRED ${canary}`);
      if (requests === 2) return json({ privateError: canary }, 503);
      return json(
        url.endsWith('openid-configuration') ? discovery() : { keys: [key] }
      );
    }
  });
  assert.equal(requests, 4);
  assert.deepEqual(delays, [20, 20]);
});

test('provider unavailability exhausts a bounded retry budget with a fixed last reason', async () => {
  let clock = 0;
  let requests = 0;
  const delays = [];
  await assert.rejects(
    waitForProductionIdentity(env(), {
      now: () => clock,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
        clock += milliseconds;
      },
      timeoutMs: 55,
      intervalMs: 20,
      requestTimeoutMs: 50,
      fetchImpl: async () => {
        requests++;
        throw new Error(canary);
      }
    }),
    (error) =>
      assertSafeError(error, /timed out: Trusted HTTPS response is unavailable/)
  );
  assert.equal(requests, 3);
  assert.deepEqual(delays, [20, 20, 15]);
});

test(
  'a response body that ignores abort cannot exceed the total readiness deadline',
  { timeout: 2_000 },
  async () => {
    const signals = [];
    const started = Date.now();
    await assert.rejects(
      waitForProductionIdentity(env(), {
        timeoutMs: 100,
        intervalMs: 10,
        requestTimeoutMs: 60,
        fetchImpl: async (_url, { signal }) => {
          signals.push(signal);
          return { ok: true, json: () => new Promise(() => {}) };
        }
      }),
      /timed out/
    );
    assert.ok(Date.now() - started < 1_000);
    assert.ok(signals.length >= 1 && signals.length <= 3);
    assert.ok(signals.every((signal) => signal.aborted));
  }
);

test('mismatched issuer or endpoints fail permanently before requesting an unsafe target', async () => {
  const invalid = [
    { issuer: `${issuer}-other-${canary}` },
    { authorization_endpoint: 'http://auth.example.org/realms/openg7/auth' },
    { token_endpoint: 'https://other.example.org/realms/openg7/token' },
    {
      jwks_uri: `https://operator:${canary}@auth.example.org/realms/openg7/certs`
    },
    { jwks_uri: 'https://auth.example.org/realms/another/certs' },
    { jwks_uri: `${issuer}/certs?fixture=1` },
    { jwks_uri: `${issuer}/certs#fixture` },
    { jwks_uri: canary }
  ];
  for (const patch of invalid) {
    let calls = 0;
    await assert.rejects(
      waitForProductionIdentity(env(), {
        fetchImpl: async () => {
          calls++;
          return json({ ...discovery(), ...patch });
        },
        sleep: () => assert.fail('An incompatible identity must not retry')
      }),
      (error) => assertSafeError(error, /Production identity is not ready/)
    );
    assert.equal(calls, 1);
  }
});

test('JWKS requires an importable public RSA signing key usable by the API', async () => {
  for (const keys of [
    [],
    [{}],
    [{ ...key, kty: 'oct', k: canary }],
    [{ ...key, d: canary }],
    [{ ...key, use: 'enc' }],
    [{ ...key, alg: 'RS512' }],
    [{ ...key, key_ops: ['sign'] }],
    [{ ...key, kid: '' }],
    [{ ...key, n: 'AA', e: 'AA' }],
    [{ ...key, n: canary + '!' }]
  ]) {
    await assert.rejects(
      waitForProductionIdentity(env(), {
        fetchImpl: async (url) =>
          json(url.endsWith('openid-configuration') ? discovery() : { keys }),
        sleep: () => assert.fail('An incompatible keyset must not retry')
      }),
      (error) => assertSafeError(error, /no usable public RSA signing key/)
    );
  }
  const minimal = { kty: key.kty, n: key.n, e: key.e, kid: key.kid };
  await waitForProductionIdentity(env(), {
    fetchImpl: async (url) =>
      json(
        url.endsWith('openid-configuration')
          ? discovery()
          : { keys: [{ kty: 'EC' }, minimal] }
      )
  });
});

const hostEnv = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name]])
);
const nativeProbe = (port, caPath) =>
  new Promise((resolveChild, reject) => {
    const code = `
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
dns.lookup = (hostname, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  if (hostname !== 'auth.example.org') throw new Error('Only the synthetic provider may be resolved');
  if (options?.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
  else callback(null, '127.0.0.1', 4);
};
syncBuiltinESMExports();
const { waitForProductionIdentity } = await import(${JSON.stringify(new URL('../scripts/lib/production-identity.mjs', import.meta.url).href)});
try {
  await waitForProductionIdentity(${JSON.stringify(env())}, {
    timeoutMs: 450, intervalMs: 20, requestTimeoutMs: 200,
    fetchImpl: (url, options) => {
      const target = new URL(url);
      if (target.hostname !== 'auth.example.org') throw new Error('Unsafe synthetic request');
      target.port = ${port};
      return fetch(target, options);
    }
  });
  console.log(JSON.stringify({ ok: true }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, message: error.message }));
}
`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...hostEnv, ...(caPath ? { NODE_EXTRA_CA_CERTS: caPath } : {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Synthetic HTTPS probe exceeded its test deadline'));
    }, 5_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      try {
        assert.equal(code, 0, 'The synthetic probe child must exit normally');
        assert.ok(
          !(stdout + stderr).includes(canary),
          'Native probe diagnostics must not disclose credentials'
        );
        resolveChild(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(error);
      }
    });
  });
const httpsFixture = async (
  t,
  { hosts = ['auth.example.org'], expired = false, handler } = {}
) => {
  const root = fixture(t);
  const tls = createLocalTlsFixture(root, { hosts });
  if (expired) {
    const openssl = [
      'openssl',
      ...(process.platform === 'win32'
        ? ['C:/Program Files/Git/usr/bin/openssl.exe']
        : [])
    ].find(
      (command) =>
        spawnSync(command, ['version'], { stdio: 'ignore', windowsHide: true })
          .status === 0
    );
    assert.ok(openssl, 'OpenSSL is required for synthetic expiration tests');
    const config = join(tls.caRoot, 'expired-ca.conf');
    const index = join(tls.caRoot, 'expired-index');
    const serial = join(tls.caRoot, 'expired-serial');
    const quotePath = (path) => `"${path.replaceAll('\\', '/')}"`;
    writeFileSync(index, '');
    writeFileSync(serial, '01\n');
    writeFileSync(
      config,
      `
[ca]
default_ca=synthetic
[synthetic]
database=${quotePath(index)}
serial=${quotePath(serial)}
new_certs_dir=${quotePath(tls.caRoot)}
certificate=${quotePath(tls.caPath)}
private_key=${quotePath(join(tls.caRoot, 'synthetic-ca-key.pem'))}
default_md=sha256
policy=synthetic_policy
[synthetic_policy]
commonName=supplied
`
    );
    assert.equal(
      spawnSync(
        openssl,
        [
          'ca',
          '-batch',
          '-notext',
          '-config',
          config,
          '-startdate',
          '20200101000000Z',
          '-enddate',
          '20200102000000Z',
          '-in',
          join(tls.caRoot, 'leaf.csr'),
          '-extfile',
          join(tls.caRoot, 'leaf.ext'),
          '-out',
          tls.certificatePath
        ],
        { stdio: 'ignore', windowsHide: true, timeout: 15_000 }
      ).status,
      0
    );
    assert.ok(
      Date.parse(
        new X509Certificate(readFileSync(tls.certificatePath)).validTo
      ) < Date.now()
    );
  }
  const requests = [];
  const sockets = new Set();
  const server = createServer(
    { key: readFileSync(tls.keyPath), cert: readFileSync(tls.certificatePath) },
    (request, response) => {
      requests.push(request.url);
      if (handler) return handler(request, response);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify(
          request.url.endsWith('openid-configuration')
            ? discovery()
            : { keys: [key] }
        )
      );
    }
  );
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose()))
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { port: server.address().port, caPath: tls.caPath, requests };
};

test(
  'native HTTPS accepts the synthetic CA only through the child trust setting',
  { timeout: 7_000 },
  async (t) => {
    const fixture = await httpsFixture(t);
    assert.deepEqual(await nativeProbe(fixture.port, fixture.caPath), {
      ok: true
    });
    assert.equal(fixture.requests.length, 2);
  }
);

for (const scenario of ['untrusted', 'wrong-host', 'expired'])
  test(
    `native HTTPS rejects a ${scenario} certificate within the bounded retry budget`,
    { timeout: 7_000 },
    async (t) => {
      const fixture = await httpsFixture(t, {
        ...(scenario === 'wrong-host'
          ? { hosts: ['unrelated.example.org'] }
          : {}),
        expired: scenario === 'expired'
      });
      const result = await nativeProbe(
        fixture.port,
        scenario === 'untrusted' ? undefined : fixture.caPath
      );
      assert.equal(result.ok, false);
      assert.match(result.message, /HTTPS readiness timed out/);
      assert.equal(fixture.requests.length, 0);
    }
  );

test(
  'native HTTPS aborts a continuously streaming discovery body at the readiness deadline',
  { timeout: 7_000 },
  async (t) => {
    const fixture = await httpsFixture(t, {
      handler: (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.write('{');
        const interval = setInterval(() => response.write(' '), 10);
        response.once('close', () => clearInterval(interval));
      }
    });
    const result = await nativeProbe(fixture.port, fixture.caPath);
    assert.equal(result.ok, false);
    assert.match(result.message, /HTTPS readiness timed out/);
    assert.ok(fixture.requests.length >= 1 && fixture.requests.length <= 4);
  }
);

test(
  'native HTTPS never follows a provider redirect',
  { timeout: 7_000 },
  async (t) => {
    const fixture = await httpsFixture(t, {
      handler: (_request, response) =>
        response.writeHead(302, { Location: `${issuer}/redirected` }).end()
    });
    const result = await nativeProbe(fixture.port, fixture.caPath);
    assert.equal(result.ok, false);
    assert.match(result.message, /HTTPS readiness timed out/);
    assert.ok(fixture.requests.length >= 1);
    assert.ok(
      fixture.requests.every((path) => path.endsWith('openid-configuration'))
    );
  }
);

test(
  'native HTTPS closes an unconsumed failing response before retrying',
  { timeout: 7_000 },
  async (t) => {
    const fixture = await httpsFixture(t, {
      handler: (_request, response) => {
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.write('{');
        const interval = setInterval(() => response.write(' '), 10);
        response.once('close', () => clearInterval(interval));
      }
    });
    const result = await nativeProbe(fixture.port, fixture.caPath);
    assert.equal(result.ok, false);
    assert.match(
      result.message,
      /HTTPS readiness timed out: HTTPS response is not ready/
    );
    assert.ok(fixture.requests.length >= 1);
  }
);
