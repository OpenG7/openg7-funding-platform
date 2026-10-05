import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';

import { createAdminTokenSessionService } from '../dist/apps/funding-api/src/admin-token-session.js';

const adminToken = 'synthetic-admin-token-for-local-tests';
const sessionSecret = 'synthetic-session-secret-for-local-tests';
const tokenSessions = () =>
  createAdminTokenSessionService({
    adminToken,
    sessionSecret,
    sessionTtlMinutes: 60,
    isProduction: false,
    projectId: 'openg7'
  });

const startApi = async (t, configuration = {}) => {
  // Isolate credentials and providers. PostgreSQL is simulated only in the
  // identity fixture; no query can reach a database or an external provider.
  const source = `
    import http from 'node:http';
    import pg from 'pg';
    import { createHash } from 'node:crypto';
    const digest = value => createHash('sha256').update(value).digest('hex');
    pg.Pool.prototype.query = async function(sql, values) {
      if (sql.includes('FROM admin_identity_sessions')) {
        if (values[0] === digest('e'.repeat(43))) throw new Error('Synthetic identity outage');
        const role = ['reader', 'operator', 'owner'].find((_, index) =>
          values[0] === digest(String(index + 1).repeat(43)));
        return { rows: role ? [{ id: 'synthetic-' + role, display_name: role, role,
          session_id: 'synthetic-session', expires_at: new Date(Date.now() + 60000) }] : [] };
      }
      throw new Error('Unexpected database operation in dispatch fixture');
    };
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(_port, callback) {
      return listen.call(this, 0, '127.0.0.1', () => {
        console.log('TEST_PORT=' + this.address().port); callback?.();
      });
    };
    await import('./dist/apps/funding-api/src/main.js');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      FUNDING_API_PORT: '0',
      FUNDING_PLATFORM_ENV: 'test',
      FUNDING_ADMIN_TOKEN: adminToken,
      FUNDING_ADMIN_SESSION_SECRET: sessionSecret,
      FUNDING_PUBLIC_BASE_URL: 'http://127.0.0.1',
      FUNDING_EMAIL_WORKER_ENABLED: 'false',
      FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'false',
      FUNDING_RATE_LIMIT_WINDOW_MS: '60000',
      FUNDING_PUBLIC_WRITE_RATE_LIMIT_MAX: '0',
      FUNDING_REFERENCE_LOOKUP_RATE_LIMIT_MAX: '0',
      FUNDING_REFERENCE_RECOVERY_RATE_LIMIT_MAX: '0',
      FUNDING_ADMIN_RATE_LIMIT_MAX: '0',
      ...configuration
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stderr.on('data', () => {});
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await exited;
    }
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error('Isolated API startup timeout')),
      10000
    );
    child.on('error', reject);
    child.on('exit', () => {
      clearTimeout(timer);
      reject(new Error('Isolated API exited before startup'));
    });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = /TEST_PORT=(\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
  });
  const exchange = async (path, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...options,
      headers: { connection: 'close', ...options.headers },
      signal: AbortSignal.timeout(5000)
    });
    const text = await response.text();
    return {
      status: response.status,
      payload: response.headers
        .get('content-type')
        ?.startsWith('application/json')
        ? JSON.parse(text)
        : text
    };
  };
  // Send headers with an unfinished body. An early refusal must arrive before
  // EOF; parsing the body first would instead wait and fail the timeout.
  const beforeBody = (path, headers = {}, method = 'POST') =>
    new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port,
          path,
          method,
          headers: { connection: 'close', 'content-length': '100', ...headers }
        },
        (response) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            text += chunk;
          });
          response.on('end', () => {
            request.destroy();
            resolve({ status: response.statusCode, payload: JSON.parse(text) });
          });
        }
      );
      request.on('error', reject);
      request.setTimeout(5000, () =>
        request.destroy(new Error('Refusal waited for body EOF'))
      );
      request.flushHeaders();
    });
  return { exchange, beforeBody };
};

test(
  'assembled routes preserve aliases, method fallthrough and global early guards',
  { timeout: 30000 },
  async (t) => {
    const api = await startApi(t);
    assert.deepEqual(await api.exchange('/health'), {
      status: 200,
      payload: 'ok'
    });
    assert.equal((await api.exchange('/api/health')).status, 404);
    for (const prefix of ['', '/api']) {
      const malformed = {
        method: 'POST',
        body: '{',
        headers: { 'content-type': 'application/json' }
      };
      for (const [path, status] of [
        ['/checkout-sessions', 400],
        ['/reference-lookup', 503],
        ['/reference-recovery', 503],
        ['/admin/session', 400]
      ]) {
        assert.equal(
          (await api.exchange(prefix + path, malformed)).status,
          status,
          path
        );
        assert.equal(
          (await api.exchange(prefix + path)).status,
          404,
          `${path} GET falls through`
        );
      }
      assert.equal(
        (await api.exchange(prefix + '/stripe/webhook', malformed)).status,
        503
      );
      assert.equal(
        (await api.exchange(prefix + '/stripe/webhook')).status,
        404
      );
      assert.equal(
        (await api.exchange(prefix + '/sponsorship-details', malformed)).status,
        410
      );
      assert.equal(
        (await api.exchange(prefix + '/sponsorship-details')).status,
        404
      );
      for (const path of [
        '/admin/sponsorships/refund',
        '/admin/stripe-backfill',
        '/admin/backups',
        '/admin/contribution-activity/present',
        '/admin/sponsorships/followup-access'
      ]) {
        assert.equal(
          (await api.beforeBody(prefix + path)).status,
          401,
          `${path} rejects before body`
        );
      }
      assert.equal(
        (await api.exchange(prefix + '/admin/auth/config')).payload.mode,
        'token'
      );
      assert.equal(
        (
          await api.exchange(prefix + '/admin/setup-status', {
            headers: {
              authorization: `Bearer ${tokenSessions().createAdminSession().sessionToken}`
            }
          })
        ).status,
        200,
        'setup remains available without PostgreSQL'
      );
      assert.equal(
        (
          await api.exchange(prefix + '/sponsorship-followup/details', {
            method: 'POST',
            body: '{}'
          })
        ).status,
        415,
        'global JSON guard remains before handler'
      );
      assert.equal(
        (
          await api.exchange(prefix + '/admin/sponsorships/refund', {
            method: 'OPTIONS'
          })
        ).status,
        204
      );
    }
  }
);

test(
  'OIDC dispatch resolves sessions and enforces roles/origin before moved handlers read a body',
  { timeout: 30000 },
  async (t) => {
    const api = await startApi(t, {
      DATABASE_URL: 'postgres://synthetic@127.0.0.1:1/dispatch',
      FUNDING_ADMIN_AUTH_MODE: 'oidc',
      FUNDING_ADMIN_OIDC_ISSUER: 'http://127.0.0.1:1',
      FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-client',
      FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-secret'
    });
    for (const prefix of ['', '/api']) {
      for (const role of ['1', '2']) {
        const headers = {
          cookie: `og7-admin=${role.repeat(43)}`,
          origin: 'http://127.0.0.1'
        };
        for (const path of [
          '/admin/sponsorships/refund',
          '/admin/stripe-backfill',
          '/admin/backups',
          '/admin/sponsorships/followup-access'
        ]) {
          assert.equal(
            (await api.beforeBody(prefix + path, headers)).status,
            403,
            `${path}: insufficient role`
          );
        }
        assert.equal(
          (await api.exchange(prefix + '/admin/setup-status', { headers }))
            .status,
          403
        );
      }
      const owner = { cookie: `og7-admin=${'3'.repeat(43)}` };
      assert.equal(
        (await api.beforeBody(prefix + '/admin/sponsorships/refund', owner))
          .status,
        403,
        'origin checked before body'
      );
      assert.equal(
        (
          await api.beforeBody(prefix + '/admin/sponsorships/refund', {
            cookie: `og7-admin=${'x'.repeat(43)}`
          })
        ).status,
        401,
        'expired/revoked session rejected'
      );
      assert.equal(
        (await api.beforeBody(prefix + '/admin/session', owner)).status,
        403,
        'OIDC session handler precedes token sessions'
      );
      const outage = { cookie: `og7-admin=${'e'.repeat(43)}` };
      assert.equal(
        (await api.beforeBody(prefix + '/admin/sponsorships/refund', outage))
          .status,
        503
      );
      assert.equal(
        (await api.exchange(prefix + '/admin/auth/config', { headers: outage }))
          .status,
        200,
        'auth discovery precedes identity resolution'
      );
      assert.equal(
        (
          await api.beforeBody(prefix + '/admin/sponsorships/refund', {
            authorization: `Bearer ${adminToken}`
          })
        ).status,
        401,
        'OIDC never falls back to the root token'
      );
      assert.equal(
        (
          await api.exchange(prefix + '/admin/sponsorships/refund', {
            method: 'OPTIONS',
            headers: outage
          })
        ).status,
        204
      );
      assert.equal(
        (
          await api.exchange(prefix + '/admin/sponsorships/refund', {
            method: 'POST',
            body: '{',
            headers: { ...owner, origin: 'http://127.0.0.1' }
          })
        ).status,
        400,
        'authorized request reaches refund parser'
      );
    }
  }
);

test(
  'assembled token sessions expire and setup authorization remains independent of PostgreSQL',
  { timeout: 20000 },
  async (t) => {
    const api = await startApi(t);
    const sessions = tokenSessions();
    const valid = sessions.createAdminSession().sessionToken;
    const expired = sessions.createAdminSession(
      Date.now() - 7200000
    ).sessionToken;
    for (const prefix of ['', '/api']) {
      const headers = { authorization: `Bearer ${valid}` };
      assert.equal(
        (await api.exchange(prefix + '/admin/setup-status', { headers }))
          .status,
        200
      );
      const databaseRequired = await api.beforeBody(
        prefix + '/admin/sponsorships/refund',
        headers
      );
      assert.deepEqual(databaseRequired, {
        status: 503,
        payload: {
          error: 'Admin review requires DATABASE_URL and PostgreSQL migrations.'
        }
      });
      assert.equal(
        (
          await api.exchange(prefix + '/admin/setup-status', {
            headers: { authorization: `Bearer ${expired}` }
          })
        ).status,
        401
      );
    }
  }
);

test(
  'OPTIONS precedes quotas and quotas precede JSON validation and auth discovery',
  { timeout: 20000 },
  async (t) => {
    const api = await startApi(t, {
      FUNDING_REFERENCE_RECOVERY_RATE_LIMIT_MAX: '1',
      FUNDING_ADMIN_RATE_LIMIT_MAX: '1',
      DATABASE_URL: 'postgres://synthetic@127.0.0.1:1/dispatch',
      FUNDING_ADMIN_AUTH_MODE: 'oidc',
      FUNDING_ADMIN_OIDC_ISSUER: 'http://127.0.0.1:1',
      FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-client',
      FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-secret'
    });
    const outage = { cookie: `og7-admin=${'e'.repeat(43)}` };
    assert.equal(
      (
        await api.exchange('/api/admin/auth/config', {
          method: 'OPTIONS',
          headers: outage
        })
      ).status,
      204
    );
    assert.deepEqual(
      await api.exchange('/admin/auth/config', { headers: outage }),
      { status: 200, payload: { mode: 'oidc' } }
    );
    assert.equal(
      (await api.exchange('/api/admin/auth/config', { headers: outage }))
        .status,
      429
    );
    assert.equal(
      (
        await api.exchange('/sponsorship-followup/recover', {
          method: 'OPTIONS'
        })
      ).status,
      204
    );
    assert.equal(
      (await api.beforeBody('/sponsorship-followup/recover')).status,
      415
    );
    assert.equal(
      (await api.beforeBody('/api/sponsorship-followup/recover')).status,
      429
    );
    assert.equal(
      (
        await api.exchange('/api/sponsorship-followup/recover', {
          method: 'OPTIONS'
        })
      ).status,
      204
    );
  }
);

test(
  'the global reference quota precedes body parsing and covers both aliases',
  { timeout: 20000 },
  async (t) => {
    const api = await startApi(t, {
      FUNDING_REFERENCE_LOOKUP_RATE_LIMIT_MAX: '1'
    });
    assert.equal(
      (await api.exchange('/reference-lookup', { method: 'POST', body: '{' }))
        .status,
      503
    );
    assert.equal((await api.beforeBody('/api/reference-lookup')).status, 429);
    assert.equal((await api.exchange('/health')).status, 200);
  }
);
