import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import test from 'node:test';

import {
  findForbiddenFields,
  parseArgs,
  resolveBaseUrl,
  runSmokeChecks,
  scanForSecrets
} from '../scripts/smoke-public.mjs';

// A configurable in-process stand-in for the funding stack. Each route can be
// overridden per test so we can exercise both the healthy path and specific
// failure modes without a real Docker deployment.
const startStubServer = (routes = {}) =>
  new Promise((resolve) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      const handler = routes[url.pathname];

      if (!handler) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end('{"error":"not found"}');
        return;
      }

      const {
        status = 200,
        contentType = 'application/json',
        body = ''
      } = handler;
      response.writeHead(status, { 'content-type': contentType });
      response.end(body);
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.close(done);
          })
      });
    });
  });

const healthyRoutes = () => ({
  '/health': { status: 200, contentType: 'text/plain', body: 'ok' },
  '/': {
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html lang="fr"><body>OpenG7</body></html>'
  },
  '/api/public/funding-config': {
    body: JSON.stringify({
      business_sponsorship_enabled: true,
      last_updated_at: '2026-07-24T00:00:00.000Z'
    })
  },
  '/api/public/fund-transparency': {
    body: JSON.stringify({
      total_received: 0,
      currency: 'cad',
      contributions_count: 0
    })
  },
  '/api/public/sponsorships': {
    body: JSON.stringify({ sponsorships: [] })
  },
  '/api/admin/dashboard': {
    status: 401,
    body: JSON.stringify({ error: 'Admin authorization is required.' })
  }
});

test('smoke:public shortcut is registered', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts['smoke:public'], 'node scripts/smoke-public.mjs');
});

test('parseArgs resolves flags and rejects unknown options', () => {
  const parsed = parseArgs([
    '--base-url',
    'https://staging.example.org',
    '--expect-secure-headers',
    '--timeout',
    '2000'
  ]);
  assert.equal(parsed.baseUrl, 'https://staging.example.org');
  assert.equal(parsed.expectSecureHeaders, true);
  assert.equal(parsed.timeoutMs, 2000);

  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
  assert.throws(() => parseArgs(['--timeout', '0']), /positive integer/);
});

test('resolveBaseUrl honors precedence and strips trailing slashes', () => {
  assert.equal(
    resolveBaseUrl('https://explicit.example.org/', {}),
    'https://explicit.example.org'
  );
  assert.equal(
    resolveBaseUrl(null, { SMOKE_BASE_URL: 'https://smoke.example.org' }),
    'https://smoke.example.org'
  );
  assert.equal(
    resolveBaseUrl(null, { PLAYWRIGHT_BASE_URL: 'https://pw.example.org' }),
    'https://pw.example.org'
  );
  assert.equal(resolveBaseUrl(null, {}), 'http://127.0.0.1:8080');
  assert.throws(() => resolveBaseUrl('not a url', {}));
});

test('findForbiddenFields catches leaked private field names', () => {
  assert.deepEqual(findForbiddenFields('{"total_received":0}'), []);
  assert.ok(
    findForbiddenFields('{"sponsor_contact_email":"a@b.co"}').includes(
      'sponsor_contact_email'
    )
  );
});

test('scanForSecrets reports pattern names, never values', () => {
  assert.deepEqual(scanForSecrets('nothing sensitive here'), []);
  const matches = scanForSecrets('key=sk_live_abc123 more');
  assert.equal(matches.length, 1);
  // The reported match is the pattern source, not the secret value.
  assert.ok(!matches.join(' ').includes('abc123'));
});

test('runSmokeChecks passes against a healthy stub', async () => {
  const stub = await startStubServer(healthyRoutes());
  try {
    const { ok, failures } = await runSmokeChecks({ baseUrl: stub.baseUrl });
    assert.equal(ok, true, JSON.stringify(failures));
  } finally {
    await stub.close();
  }
});

test('runSmokeChecks fails when public transparency leaks PII', async () => {
  const routes = healthyRoutes();
  routes['/api/public/fund-transparency'] = {
    body: JSON.stringify({
      total_received: 100,
      currency: 'cad',
      sponsor_contact_email: 'donor@example.com'
    })
  };

  const stub = await startStubServer(routes);
  try {
    const { ok, failures } = await runSmokeChecks({ baseUrl: stub.baseUrl });
    assert.equal(ok, false);
    assert.ok(
      failures.some((failure) =>
        failure.detail.includes('sponsor_contact_email')
      )
    );
  } finally {
    await stub.close();
  }
});

test('runSmokeChecks fails when the admin boundary is open', async () => {
  const routes = healthyRoutes();
  routes['/api/admin/dashboard'] = {
    status: 200,
    body: JSON.stringify({ contributions: [] })
  };

  const stub = await startStubServer(routes);
  try {
    const { ok, failures } = await runSmokeChecks({ baseUrl: stub.baseUrl });
    assert.equal(ok, false);
    assert.ok(failures.some((failure) => failure.name === 'Admin boundary'));
  } finally {
    await stub.close();
  }
});

test('runSmokeChecks never surfaces secret values, only pattern names', async () => {
  const routes = healthyRoutes();
  routes['/api/public/funding-config'] = {
    body: JSON.stringify({
      business_sponsorship_enabled: true,
      leaked: 'sk_live_supersecretvalue123'
    })
  };

  const stub = await startStubServer(routes);
  const lines = [];
  try {
    const { ok } = await runSmokeChecks({
      baseUrl: stub.baseUrl,
      log: (line) => lines.push(line)
    });
    assert.equal(ok, false);
    assert.ok(!lines.join('\n').includes('supersecretvalue123'));
  } finally {
    await stub.close();
  }
});

test('runSmokeChecks enforces secure headers only when requested', async () => {
  const stub = await startStubServer(healthyRoutes());
  try {
    const enforced = await runSmokeChecks({
      baseUrl: stub.baseUrl,
      expectSecureHeaders: true
    });
    assert.equal(enforced.ok, false);
    assert.ok(
      enforced.failures.some((failure) => failure.name === 'Secure headers')
    );

    const relaxed = await runSmokeChecks({ baseUrl: stub.baseUrl });
    assert.equal(relaxed.ok, true);
    assert.ok(
      relaxed.warnings.some((warning) => warning.name === 'Secure headers')
    );
  } finally {
    await stub.close();
  }
});
