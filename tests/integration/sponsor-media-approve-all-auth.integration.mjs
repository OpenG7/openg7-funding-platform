import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import pg from 'pg';

import { createAdminAuthorization } from '../../dist/apps/funding-api/src/admin-authorization.js';
import {
  AdminIdentityService,
  identityHash
} from '../../dist/apps/funding-api/src/admin-identity.js';
import { createHttpDispatcher } from '../../dist/apps/funding-api/src/http-composition/dispatcher.js';
import { createRouteMatcher } from '../../dist/apps/funding-api/src/http-routing.js';
import {
  createHttpTransport,
  readBody
} from '../../dist/apps/funding-api/src/http-transport.js';
import { createSponsorMediaWorkspaceHttpHandler } from '../../dist/apps/funding-api/src/sponsor-media-workspace/http.js';
import { SponsorMediaWorkspaceService } from '../../dist/apps/funding-api/src/sponsor-media-workspace/service.js';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'whole-dossier preparation authenticates real HTTP sessions and enforces account roles and exact origins',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres();
    const owner = database.pool;
    let pool;
    let server;
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      await pool?.end();
      await database.stop();
    });

    const role = 'og7_approve_all_auth_runtime';
    const password = randomBytes(32).toString('hex');
    const databaseName = (
      await owner.query('SELECT current_database() AS name')
    ).rows[0].name;
    await owner.query(
      buildRuntimeRoleSql(
        { role, database: databaseName, password },
        { create: true }
      )
    );
    pool = new pg.Pool({ ...owner.options, user: role, password });
    const contributionId = (
      await owner.query(`INSERT INTO fund_contributions
        (contribution_type,amount_cents,currency,status,sponsor_company_name)
        VALUES('sponsorship_interest',50000,'cad','paid','Synthetic auth dossier') RETURNING id`)
    ).rows[0].id;
    const issuer = 'https://identity.example.test/';
    const sessions = new Map();
    for (const accountRole of ['owner', 'operator', 'reader']) {
      const accountId = (
        await owner.query(
          `INSERT INTO admin_accounts(issuer,subject,display_name,role)
            VALUES($1,$2,$3,$4) RETURNING id`,
          [
            issuer,
            `synthetic-${accountRole}`,
            'Synthetic administrator',
            accountRole
          ]
        )
      ).rows[0].id;
      const token = randomBytes(32).toString('base64url');
      await owner.query(
        `INSERT INTO admin_identity_sessions(account_id,token_hash,expires_at)
          VALUES($1,$2,now()+interval '1 hour')`,
        [accountId, identityHash(token)]
      );
      sessions.set(accountRole, { accountId, cookie: `og7-admin=${token}` });
    }

    let dispatch;
    const serverErrors = [];
    server = createServer((request, response) => {
      dispatch(request, response).catch((error) => {
        serverErrors.push(error.name);
        response.writeHead(500).end();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const identity = new AdminIdentityService(pool, {
      NODE_ENV: 'test',
      FUNDING_PLATFORM_ENV: 'test',
      FUNDING_PUBLIC_BASE_URL: origin,
      FUNDING_ADMIN_OIDC_ISSUER: issuer,
      FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-client',
      FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-client-secret'
    });
    const transport = createHttpTransport({
      isProduction: false,
      allowedOrigins: []
    });
    const authorization = createAdminAuthorization({
      adminIdentity: identity,
      adminTokenConfigured: false,
      isProduction: false,
      hasDatabase: true,
      verifyAdminSession() {
        assert.fail('OIDC requests cannot fall back to token authorization.');
      },
      adminTokenMatches() {
        assert.fail('OIDC requests cannot fall back to a root token.');
      },
      writeJson: transport.writeJson
    });
    const unavailableStorage = () => {
      assert.fail('Preparing an empty dossier cannot access media storage.');
    };
    const workspace = createSponsorMediaWorkspaceHttpHandler({
      publicBaseOrigin: origin,
      pool,
      service: new SponsorMediaWorkspaceService(pool, {
        readPrivateObject: unavailableStorage,
        deletePrivateObject: unavailableStorage,
        deletePublicObject: unavailableStorage
      }),
      ensureAdminAccess: authorization.ensureAdminAccess,
      canReview: (request) =>
        ['owner', 'operator'].includes(identity.identity(request)?.role ?? ''),
      getAdminAuditActor: authorization.getAdminAuditActor,
      readBody,
      writeJson: transport.writeJson
    });
    dispatch = createHttpDispatcher({
      transport,
      matcher: createRouteMatcher(origin),
      enforceRequestRateLimit: () => true,
      adminAuthMode: 'oidc',
      adminIdentity: identity,
      handlers: new Proxy(
        { handleAdminSponsorshipMediaRequest: workspace },
        { get: (handlers, name) => handlers[name] ?? (async () => false) }
      ),
      isProduction: false,
      readDevelopmentStatus: async () => ({})
    });

    const planCount = async () =>
      (
        await owner.query(
          'SELECT count(*)::int AS count FROM sponsor_media_batch_plans'
        )
      ).rows[0].count;
    const prepare = async ({
      accountRole = 'owner',
      requestOrigin = origin,
      prefix = '/api',
      cookie = sessions.get(accountRole)?.cookie
    } = {}) => {
      const requestId = randomUUID();
      const response = await fetch(
        `${origin}${prefix}/admin/sponsorships/media/approve-all/plan`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(cookie ? { cookie } : {}),
            ...(requestOrigin ? { origin: requestOrigin } : {})
          },
          body: JSON.stringify({
            requestId,
            contributionId,
            expectedRevision: '1'
          })
        }
      );
      return { response, body: await response.json(), requestId };
    };

    await t.test(
      'owner and operator prepare both aliases without approving anything',
      async () => {
        for (const accountRole of ['owner', 'operator']) {
          for (const prefix of ['', '/api']) {
            const { response, body, requestId } = await prepare({
              accountRole,
              prefix
            });
            assert.equal(response.status, 200);
            assert.equal(response.headers.get('cache-control'), 'no-store');
            assert.equal(body.kind, 'approve_all');
            assert.equal(body.contributionId, contributionId);
            assert.deepEqual(body.candidates, []);
            assert.equal(body.summary.total, 0);
            assert.equal(body.summary.eligible, 0);
            const stored = (
              await owner.query(
                'SELECT actor,plan FROM sponsor_media_batch_plans WHERE contribution_id=$1 AND request_id=$2',
                [contributionId, requestId]
              )
            ).rows[0];
            assert.equal(
              stored.actor,
              `admin:${sessions.get(accountRole).accountId}`
            );
            assert.equal(stored.plan.kind, 'approve_all');
          }
        }
      }
    );

    await t.test(
      'a reader can consult the workspace but cannot prepare approval',
      async () => {
        const response = await fetch(
          `${origin}/api/admin/sponsorships/media/workspace?contributionId=${contributionId}`,
          { headers: { cookie: sessions.get('reader').cookie } }
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json()).writable, false);
        const before = await planCount();
        const denied = await prepare({ accountRole: 'reader' });
        assert.equal(denied.response.status, 403);
        assert.deepEqual(denied.body, {
          error: 'This action is not permitted for this account or origin.'
        });
        assert.equal(await planCount(), before);
      }
    );

    await t.test(
      'even an owner cannot prepare with a foreign or absent origin',
      async () => {
        const before = await planCount();
        for (const requestOrigin of [
          undefined,
          'http://localhost:4200',
          'https://foreign.example.test'
        ]) {
          const denied = await prepare({
            requestOrigin: requestOrigin ?? null
          });
          assert.equal(denied.response.status, 403);
          assert.deepEqual(denied.body, {
            error: 'This action is not permitted for this account or origin.'
          });
        }
        assert.equal(await planCount(), before);
      }
    );

    await t.test(
      'missing and expired sessions cannot reach dossier preparation',
      async () => {
        const before = await planCount();
        const anonymous = await prepare({ cookie: null });
        assert.equal(anonymous.response.status, 401);
        assert.deepEqual(anonymous.body, {
          error: 'Admin authorization is required.'
        });
        await owner.query(
          `UPDATE admin_identity_sessions SET expires_at=now()-interval '1 second'
          WHERE account_id=$1`,
          [sessions.get('owner').accountId]
        );
        const expired = await prepare();
        assert.equal(expired.response.status, 401);
        assert.deepEqual(expired.body, {
          error: 'Admin authorization is required.'
        });
        assert.equal(await planCount(), before);
      }
    );

    assert.deepEqual(serverErrors, []);
    assert.deepEqual(
      (
        await owner.query(`SELECT
          (SELECT count(*)::int FROM sponsor_media_workspace_commands) AS commands,
          (SELECT count(*)::int FROM moderation_decisions) AS decisions,
          (SELECT count(*)::int FROM sponsor_media_terms_acceptances) AS consents,
          (SELECT count(*)::int FROM email_messages) AS messages,
          (SELECT count(*)::int FROM publication_deliveries) AS publications`)
      ).rows[0],
      { commands: 0, decisions: 0, consents: 0, messages: 0, publications: 0 }
    );
  }
);
