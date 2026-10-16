import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';

import pg from 'pg';

import { AdminAutomaticRunsService } from '../../dist/apps/funding-api/src/admin-automatic-runs.service.js';
import { createAdminAutomaticRunsHttpHandler } from '../../dist/apps/funding-api/src/admin-automatic-runs.http.js';
import { createAdminAuthorization } from '../../dist/apps/funding-api/src/admin-authorization.js';
import { adminRoleAllows } from '../../dist/apps/funding-api/src/admin-identity.js';
import { assertProductionDatabasePrivileges } from '../../dist/apps/funding-api/src/database-runtime-security.js';
import {
  createHttpTransport,
  readBody
} from '../../dist/apps/funding-api/src/http-transport.js';
import {
  buildMigrationSql,
  readMigrations
} from '../../scripts/lib/database-migrations.mjs';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const origin = 'https://synthetic-admin.invalid';
const migrations = readMigrations('apps/funding-api/migrations');

// Synthetic identities exercise the real role/origin policy. This fixture does
// not claim to qualify OIDC or MFA, which have their own disposable recipes.
async function listen(pool) {
  const transport = createHttpTransport({
    isProduction: true,
    allowedOrigins: [origin]
  });
  const identity = (request) => {
    const role = request.headers['x-synthetic-role'];
    return ['reader', 'operator', 'owner'].includes(role)
      ? { id: `synthetic-${role}`, role }
      : null;
  };
  const authorization = createAdminAuthorization({
    adminIdentity: {
      identity,
      permits(request) {
        const account = identity(request);
        return Boolean(
          account &&
          (request.method === 'GET' || request.headers.origin === origin) &&
          adminRoleAllows(
            account.role,
            request.method,
            new URL(request.url, origin).pathname
          )
        );
      }
    },
    adminTokenConfigured: false,
    isProduction: true,
    hasDatabase: true,
    verifyAdminSession: () => null,
    adminTokenMatches: () => false,
    writeJson: transport.writeJson
  });
  const handler = createAdminAutomaticRunsHttpHandler({
    publicBaseOrigin: origin,
    ...authorization,
    readBody,
    writeJson: transport.writeJson,
    automaticRuns: new AdminAutomaticRunsService(pool)
  });
  const server = createServer(async (request, response) => {
    if (!(await handler(request, response))) {
      transport.writeJson(request, response, 404, { code: 'NOT_FOUND' });
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    async request(
      path = '',
      { role = 'operator', body, requestOrigin = origin, prefix = '/api' } = {}
    ) {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}${prefix}/admin/automatic-runs${path}`,
        {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            ...(role ? { 'x-synthetic-role': role } : {}),
            origin: requestOrigin,
            ...(body === undefined
              ? {}
              : { 'content-type': 'application/json' })
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }
      );
      assert.match(response.headers.get('cache-control'), /no-store/);
      return { status: response.status, body: await response.json() };
    },
    stop: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  };
}

test(
  'automatic portfolio upgrades existing facts, traverses real HTTP/PostgreSQL and retains an immutable actor-scoped report',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres({ migrate: false });
    let runtime;
    let http;
    t.after(async () => {
      await http?.stop();
      await runtime?.end();
      await database.stop();
    });
    const databaseName = (
      await database.pool.query('SELECT current_database() AS name')
    ).rows[0].name;
    const migrate = (files) =>
      database.pool.query(buildMigrationSql(files, { database: databaseName }));
    await migrate(migrations.filter((migration) => migration.version < 55));
    const ids = [];
    for (const [type, currency, status] of [
      ['personal_support', 'cad', 'paid'],
      ['personal_support', 'usd', 'paid'],
      ['sponsorship_interest', 'cad', 'paid'],
      ['personal_support', 'cad', 'pending']
    ]) {
      ids.push(
        (
          await database.pool.query(
            `INSERT INTO fund_contributions
        (contribution_type,amount_cents,currency,status,paid_at,created_at)
        VALUES($1,2500,$2,$3,CASE WHEN $3='paid' THEN NOW() ELSE NULL END,NOW()-INTERVAL '1 day') RETURNING id`,
            [type, currency, status]
          )
        ).rows[0].id
      );
    }
    const originalFacts = (
      await database.pool.query('SELECT * FROM fund_contributions ORDER BY id')
    ).rows;
    await migrate(migrations);
    await migrate(migrations);
    assert.deepEqual(
      (
        await database.pool.query(
          'SELECT * FROM fund_contributions ORDER BY id'
        )
      ).rows,
      originalFacts
    );

    const role = 'og7_automatic_http_runtime';
    const password = randomBytes(32).toString('hex');
    const roleConfig = { role, password, database: databaseName };
    await database.pool.query(
      buildRuntimeRoleSql(roleConfig, { create: true })
    );
    runtime = new pg.Pool({ ...database.pool.options, user: role, password });
    await assertProductionDatabasePrivileges(runtime, true);
    http = await listen(runtime);

    for (const [account, requestOrigin, expected] of [
      [null, origin, 401],
      ['reader', origin, 403],
      ['operator', 'https://untrusted.invalid', 403]
    ]) {
      assert.equal(
        (
          await http.request('', {
            role: account,
            requestOrigin,
            body: { requestId: randomUUID() }
          })
        ).status,
        expected
      );
    }
    assert.equal((await http.request('', { role: 'reader' })).body.run, null);
    const startCommand = { requestId: randomUUID() };
    let state = await http.request('', { body: startCommand });
    assert.equal(state.status, 200);
    const runId = state.body.run.id;
    assert.equal(state.body.run.dossierCount, 3);
    assert.equal(state.body.run.processedCount, 0);
    assert.equal(state.body.run.globalBalanced, false);
    assert.deepEqual(state.body.run.currencyTotals, [
      { currency: 'CAD', amountMinor: 5000 },
      { currency: 'USD', amountMinor: 2500 }
    ]);
    assert.equal(
      (await http.request('', { body: startCommand })).body.run.id,
      runId
    );
    assert.equal(
      (await http.request(`?runId=${runId}`, { role: 'owner' })).status,
      404
    );

    const command = (run, extra = {}) => ({
      runId,
      requestId: randomUUID(),
      expectedVersion: run.version,
      ...extra
    });
    const paused = await http.request('/control', {
      body: command(state.body.run, { action: 'pause' })
    });
    assert.equal(paused.status, 200);
    assert.equal(paused.body.run.status, 'paused');
    assert.equal(
      (await http.request('/advance', { body: command(paused.body.run) }))
        .status,
      409
    );
    state = await http.request('/control', {
      body: command(paused.body.run, { action: 'resume' })
    });
    assert.equal(state.status, 200);
    const advanceCommand = command(state.body.run);
    state = await http.request('/advance', { body: advanceCommand });
    assert.equal(state.status, 200);
    const replay = await http.request('/advance', { body: advanceCommand });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.run.processedCount, 1);
    assert.equal(replay.body.run.version, state.body.run.version);

    // The contribution predates the manifest. Late confirmation must still be
    // reported as new work, irrespective of created_at or browser state.
    await database.pool.query(
      "UPDATE fund_contributions SET status='paid',paid_at=NOW(),updated_at=NOW() WHERE id=$1",
      [ids[3]]
    );
    for (
      let remaining = 0;
      state.body.run.status === 'running' && remaining < 4;
      remaining++
    ) {
      state = await http.request('/advance', { body: command(state.body.run) });
      assert.equal(state.status, 200);
    }
    assert.equal(state.body.run.status, 'completed');
    assert.equal(state.body.run.processedCount, 3);
    assert.equal(state.body.run.balancedCount, 2);
    assert.equal(state.body.run.unknownCount, 1);
    assert.equal(state.body.run.newPaymentCount, 1);
    assert.equal(state.body.run.globalBalanced, false);

    const entries = [];
    let cursor = 0;
    do {
      const page = await http.request(
        `/report?runId=${runId}&after=${cursor}&limit=1`
      );
      assert.equal(page.status, 200);
      assert.ok(page.body.entries.length <= 1);
      entries.push(...page.body.entries);
      cursor = page.body.nextCursor;
    } while (cursor !== null);
    assert.equal(entries.length, 3);
    assert.deepEqual(
      new Set(entries.map((entry) => entry.contributionId)),
      new Set(ids.slice(0, 3))
    );
    assert.ok(
      entries.every(
        (entry) =>
          entry.actor === 'admin:synthetic-operator' &&
          entry.auditReference &&
          entry.requestId
      )
    );
    assert.ok(entries.every((entry) => entry.actions.length === 0));
    assert.equal(
      entries.find((entry) => entry.contributionId === ids[2]).balance.status,
      'unknown'
    );
    assert.doesNotMatch(
      JSON.stringify(entries),
      /password|authorization|sponsor_contact_email|privateData/i
    );

    await http.stop();
    http = await listen(runtime);
    assert.deepEqual((await http.request('')).body.run, state.body.run);
    assert.equal(
      (await http.request(`/report?runId=${runId}`, { role: 'reader' })).status,
      404
    );
    const persisted = (await http.request(`/report?runId=${runId}`)).body
      .entries;
    assert.deepEqual(persisted, entries);
    assert.equal(
      (
        await runtime.query(
          'SELECT count(*)::int AS count FROM admin_automatic_run_entries'
        )
      ).rows[0].count,
      3
    );
    await assert.rejects(
      runtime.query('UPDATE admin_automatic_run_entries SET actor=actor'),
      { code: '42501' }
    );
    await assert.rejects(
      runtime.query('DELETE FROM admin_automatic_run_entries'),
      { code: '42501' }
    );
    await database.pool.query(
      `GRANT UPDATE ON admin_automatic_run_entries TO ${role}`
    );
    await assert.rejects(assertProductionDatabasePrivileges(runtime, true), {
      message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
    });
    await database.pool.query(buildRuntimeRoleSql(roleConfig));
    await assertProductionDatabasePrivileges(runtime, true);

    // Capture more than the public/admin list limit without loading that list or
    // claiming that unvisited dossiers are balanced.
    await database.pool
      .query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at)
      SELECT 'personal_support',1,'cad','paid',NOW() FROM generate_series(1,251)`);
    const next = await http.request('', {
      body: { requestId: randomUUID() },
      prefix: ''
    });
    assert.equal(next.status, 200);
    assert.notEqual(next.body.run.id, runId);
    assert.equal(next.body.run.dossierCount, 255);
    assert.equal(next.body.run.processedCount, 0);
    assert.equal(next.body.run.globalBalanced, false);
    assert.equal(next.body.run.uncoveredCount, 0);
    assert.equal(
      (
        await database.pool.query(
          'SELECT count(*)::int AS count FROM sponsor_publication_drafts'
        )
      ).rows[0].count,
      0
    );
  }
);
