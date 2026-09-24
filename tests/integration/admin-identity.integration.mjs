import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign
} from 'node:crypto';
import {
  AdminIdentityService,
  identityHash
} from '../../dist/apps/funding-api/src/admin-identity.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const start = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
};
const close = (server) => new Promise((resolve) => server.close(resolve));
test(
  'OIDC validates PKCE, nonce, MFA and membership, then enforces roles, CSRF and individual session revocation',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048
    });
    const jwk = {
      ...publicKey.export({ format: 'jwk' }),
      kid: 'fixture',
      alg: 'RS256',
      use: 'sig'
    };
    let issuer, origin, identity;
    let claimsOverride = {},
      badSignature = false;
    const grants = new Map();
    const provider = createServer(async (req, res) => {
      const url = new URL(req.url, issuer);
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/.well-known/openid-configuration')
        return res.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            code_challenge_methods_supported: ['S256']
          })
        );
      if (url.pathname === '/jwks')
        return res.end(JSON.stringify({ keys: [jwk] }));
      if (url.pathname === '/authorize') {
        const code = randomBytes(16).toString('hex');
        grants.set(code, Object.fromEntries(url.searchParams));
        const callback = new URL(url.searchParams.get('redirect_uri'));
        callback.searchParams.set('code', code);
        callback.searchParams.set('state', url.searchParams.get('state'));
        res.writeHead(302, { Location: callback.href });
        return res.end();
      }
      if (url.pathname === '/token') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const params = new URLSearchParams(body);
        const grant = grants.get(params.get('code'));
        grants.delete(params.get('code'));
        if (
          !grant ||
          createHash('sha256')
            .update(params.get('code_verifier'))
            .digest('base64url') !== grant.code_challenge
        ) {
          res.statusCode = 400;
          return res.end('{}');
        }
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(
          JSON.stringify({ alg: 'RS256', kid: 'fixture' })
        ).toString('base64url');
        const payload = Buffer.from(
          JSON.stringify({
            iss: issuer,
            sub: 'owner-fixture',
            aud: 'test-client',
            iat: now,
            exp: now + 120,
            nonce: grant.nonce,
            amr: ['mfa'],
            name: 'Fixture Owner',
            ...claimsOverride
          })
        ).toString('base64url');
        const data = `${header}.${payload}`;
        const signature = badSignature
          ? randomBytes(256)
          : sign('RSA-SHA256', Buffer.from(data), privateKey);
        return res.end(
          JSON.stringify({
            token_type: 'Bearer',
            access_token: 'synthetic-token',
            expires_in: 120,
            id_token: `${data}.${signature.toString('base64url')}`
          })
        );
      }
      res.writeHead(404).end();
    });
    issuer = await start(provider);
    t.after(() => close(provider));
    const app = createServer(async (req, res) => {
      try {
        await identity.resolve(req);
        if (await identity.handle(req, res)) return;
        res.writeHead(identity.permits(req) ? 200 : 403).end();
      } catch {
        res.writeHead(503).end();
      }
    });
    origin = await start(app);
    t.after(() => close(app));
    identity = new AdminIdentityService(database.pool, {
      NODE_ENV: 'test',
      FUNDING_PUBLIC_BASE_URL: origin,
      FUNDING_ADMIN_OIDC_ISSUER: issuer,
      FUNDING_ADMIN_OIDC_CLIENT_ID: 'test-client',
      FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-client-secret',
      FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: 'owner-fixture'
    });
    const login = async ({ wrongBrowser = false } = {}) => {
      const begin = await fetch(
        `${origin}/api/admin/auth/start?returnUrl=/admin/fundraiser/access`,
        { redirect: 'manual' }
      );
      assert.equal(begin.status, 303);
      const loginCookie = begin.headers.get('set-cookie').split(';')[0];
      const authorize = await fetch(begin.headers.get('location'), {
        redirect: 'manual'
      });
      const callback = authorize.headers.get('location');
      const finish = await fetch(callback, {
        redirect: 'manual',
        headers: { cookie: wrongBrowser ? '' : loginCookie }
      });
      return {
        finish,
        callback,
        loginCookie,
        cookie: finish.headers
          .getSetCookie()
          .find((c) => c.startsWith('og7-admin='))
          ?.split(';')[0]
      };
    };
    const first = await login();
    assert.equal(
      first.finish.headers.get('location'),
      '/admin/fundraiser/access'
    );
    assert.match(first.finish.headers.getSetCookie().join(';'), /HttpOnly/);
    const current = await fetch(`${origin}/api/admin/auth/current`, {
      headers: { cookie: first.cookie }
    });
    const profile = await current.json();
    assert.equal(profile.role, 'owner');
    for (const change of [
      { sessionId: profile.sessionId },
      { sessionId: profile.sessionId, confirmation: 'wrong-target' },
      {
        subject: 'unconfirmed',
        displayName: 'Unconfirmed',
        role: 'owner',
        disabled: false
      }
    ]) {
      const result = await fetch(`${origin}/api/admin/access`, {
        method: 'POST',
        headers: {
          cookie: first.cookie,
          origin,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(change)
      });
      assert.equal(result.status, 400);
      assert.equal((await result.json()).code, 'CONFIRMATION_REQUIRED');
    }
    assert.equal(
      (
        await database.pool.query(
          "SELECT 1 FROM admin_accounts WHERE subject='unconfirmed'"
        )
      ).rowCount,
      0
    );
    assert.equal(
      (
        await fetch(first.callback, {
          redirect: 'manual',
          headers: { cookie: first.loginCookie }
        })
      ).headers.get('location'),
      '/admin/login?identityError=1'
    );
    assert.equal(
      (await login({ wrongBrowser: true })).finish.headers.get('location'),
      '/admin/login?identityError=1'
    );
    for (const override of [
      { amr: ['pwd'] },
      { sub: 'unknown-subject' },
      { nonce: 'wrong' },
      { aud: 'other-client' },
      { exp: 1 }
    ]) {
      claimsOverride = override;
      assert.equal(
        (await login()).finish.headers.get('location'),
        '/admin/login?identityError=1'
      );
    }
    claimsOverride = {};
    badSignature = true;
    assert.equal(
      (await login()).finish.headers.get('location'),
      '/admin/login?identityError=1'
    );
    badSignature = false;
    const second = await login();
    const lastOwnerChange = await fetch(`${origin}/api/admin/access`, {
      method: 'POST',
      headers: { cookie: first.cookie, origin },
      body: JSON.stringify({
        subject: 'owner-fixture',
        confirmation: 'owner-fixture',
        displayName: 'Owner',
        role: 'reader',
        disabled: false
      })
    });
    assert.equal(lastOwnerChange.status, 409);
    assert.equal((await lastOwnerChange.json()).code, 'LAST_OWNER');
    await t.test(
      'a session belonging to another issuer is neither revoked nor audited',
      async () => {
        const account = (
          await database.pool.query(`INSERT INTO admin_accounts
        (issuer,subject,display_name,role) VALUES('https://other-issuer.example.test/','other','Other fixture','reader') RETURNING id`)
        ).rows[0].id;
        const sessionId = (
          await database.pool.query(
            `INSERT INTO admin_identity_sessions
        (account_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour') RETURNING id`,
            [account, identityHash('other-issuer-synthetic-token')]
          )
        ).rows[0].id;
        const result = await fetch(`${origin}/api/admin/access`, {
          method: 'POST',
          headers: { cookie: first.cookie, origin },
          body: JSON.stringify({ sessionId, confirmation: sessionId })
        });
        assert.equal(result.status, 200);
        assert.equal(
          (
            await database.pool.query(
              'SELECT revoked_at FROM admin_identity_sessions WHERE id=$1',
              [sessionId]
            )
          ).rows[0].revoked_at,
          null
        );
        assert.equal(
          (
            await database.pool.query(
              'SELECT 1 FROM admin_audit_log WHERE entity_id=$1',
              [sessionId]
            )
          ).rowCount,
          0
        );
      }
    );
    await t.test(
      'an unavailable audit rolls back both session revocation and account creation',
      async () => {
        await database.pool
          .query(`CREATE FUNCTION fail_identity_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action IN ('admin.session.revoked','admin.account.updated') THEN
          RAISE EXCEPTION 'synthetic identity audit failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_identity_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION fail_identity_audit()`);
        try {
          for (const change of [
            { sessionId: profile.sessionId, confirmation: profile.sessionId },
            {
              subject: 'rollback-fixture',
              confirmation: 'rollback-fixture',
              displayName: 'Rollback fixture',
              role: 'reader',
              disabled: false
            }
          ]) {
            const result = await fetch(`${origin}/api/admin/access`, {
              method: 'POST',
              headers: { cookie: first.cookie, origin },
              body: JSON.stringify(change)
            });
            assert.equal(result.status, 503);
            assert.deepEqual(await result.json(), {
              code: 'ACCESS_UNAVAILABLE',
              error: 'Access change unavailable.'
            });
          }
          assert.equal(
            (
              await database.pool.query(
                'SELECT revoked_at FROM admin_identity_sessions WHERE id=$1',
                [profile.sessionId]
              )
            ).rows[0].revoked_at,
            null
          );
          assert.equal(
            (
              await database.pool.query(
                "SELECT 1 FROM admin_accounts WHERE subject='rollback-fixture'"
              )
            ).rowCount,
            0
          );
        } finally {
          await database.pool.query(
            'DROP TRIGGER fail_identity_audit ON admin_audit_log; DROP FUNCTION fail_identity_audit()'
          );
        }
      }
    );
    assert.equal(
      (await fetch(`${origin}/api/admin/session`, { method: 'POST' })).status,
      403
    );
    assert.equal(
      (
        await fetch(`${origin}/api/admin/access`, {
          method: 'POST',
          headers: { cookie: first.cookie },
          body: '{}'
        })
      ).status,
      403
    );
    assert.equal(
      (
        await fetch(`${origin}/api/admin/access`, {
          method: 'POST',
          headers: { cookie: first.cookie, origin },
          body: JSON.stringify({
            sessionId: profile.sessionId,
            confirmation: profile.sessionId
          })
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${origin}/api/admin/auth/current`, {
          headers: { cookie: first.cookie }
        })
      ).status,
      401
    );
    for (const method of ['GET', 'POST'])
      assert.equal(
        (
          await fetch(`${origin}/api/admin/access`, {
            method,
            headers: { cookie: first.cookie, origin },
            ...(method === 'POST'
              ? {
                  body: JSON.stringify({
                    sessionId: profile.sessionId,
                    confirmation: profile.sessionId
                  })
                }
              : {})
          })
        ).status,
        401
      );
    await Promise.all(
      Array.from({ length: 4 }, () =>
        fetch(`${origin}/api/admin/access`, {
          method: 'POST',
          headers: { cookie: second.cookie, origin },
          body: JSON.stringify({
            sessionId: profile.sessionId,
            confirmation: profile.sessionId
          })
        }).then((response) => assert.equal(response.status, 200))
      )
    );
    assert.equal(
      (
        await database.pool.query(
          "SELECT 1 FROM admin_audit_log WHERE action='admin.session.revoked' AND entity_id=$1",
          [profile.sessionId]
        )
      ).rowCount,
      1
    );
    assert.equal(
      (
        await fetch(`${origin}/api/admin/auth/current`, {
          headers: { cookie: second.cookie }
        })
      ).status,
      200
    );
    await assert.rejects(
      identity.saveAccount(profile, {
        subject: 'owner-fixture',
        displayName: 'Owner',
        role: 'reader',
        disabled: false
      })
    );
    await identity.saveAccount(profile, {
      subject: 'reader-fixture',
      displayName: 'Reader',
      role: 'reader',
      disabled: false
    });
    claimsOverride = { sub: 'reader-fixture' };
    const reader = await login();
    claimsOverride = {};
    assert.equal(
      (
        await fetch(`${origin}/api/admin/dashboard`, {
          headers: { cookie: reader.cookie }
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${origin}/api/admin/access`, {
          headers: { cookie: reader.cookie }
        })
      ).status,
      403
    );
    assert.equal(
      (
        await fetch(`${origin}/api/admin/sponsorships/review`, {
          method: 'POST',
          headers: { cookie: reader.cookie, origin }
        })
      ).status,
      403
    );
    assert.equal(
      (
        await fetch(`${origin}/api/admin/search`, {
          method: 'POST',
          headers: { cookie: reader.cookie, origin }
        })
      ).status,
      200
    );
    await identity.saveAccount(profile, {
      subject: 'reader-fixture',
      displayName: 'Reader',
      role: 'reader',
      disabled: true
    });
    assert.equal(
      (
        await fetch(`${origin}/api/admin/auth/current`, {
          headers: { cookie: reader.cookie }
        })
      ).status,
      401
    );
    const stored = (
      await database.pool.query(
        'SELECT token_hash FROM admin_identity_sessions'
      )
    ).rows;
    assert.ok(stored.every((row) => /^[a-f0-9]{64}$/.test(row.token_hash)));
    assert.ok(
      stored.some(
        (row) => row.token_hash === identityHash(second.cookie.split('=')[1])
      )
    );
    assert.ok(
      (
        await database.pool.query(
          "SELECT 1 FROM admin_audit_log WHERE action='admin.session.revoked'"
        )
      ).rowCount
    );
    await identity.saveAccount(profile, {
      subject: 'second-owner',
      displayName: 'Second owner',
      role: 'owner',
      disabled: false
    });
    await t.test(
      'concurrent owner demotions leave exactly one active owner',
      async () => {
        const results = await Promise.allSettled(
          ['owner-fixture', 'second-owner'].map((subject) =>
            identity.saveAccount(profile, {
              subject,
              displayName: 'Owner fixture',
              role: 'reader',
              disabled: false
            })
          )
        );
        assert.equal(
          results.filter((result) => result.status === 'fulfilled').length,
          1
        );
        const denied = results.find((result) => result.status === 'rejected');
        assert.equal(denied.reason.message, 'Last owner');
        assert.equal(
          (
            await database.pool.query(
              "SELECT 1 FROM admin_accounts WHERE issuer=$1 AND role='owner' AND NOT disabled",
              [new URL(issuer).href]
            )
          ).rowCount,
          1
        );
      }
    );
    await identity.saveAccount(profile, {
      subject: 'second-owner',
      displayName: 'Second owner',
      role: 'owner',
      disabled: false
    });
    await identity.saveAccount(profile, {
      subject: 'owner-fixture',
      displayName: 'Owner',
      role: 'owner',
      disabled: true
    });
    assert.equal(
      (await login()).finish.headers.get('location'),
      '/admin/login?identityError=1',
      'bootstrap subjects cannot reactivate disabled accounts'
    );
  }
);
