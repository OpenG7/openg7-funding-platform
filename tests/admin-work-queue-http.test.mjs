import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';

test(
  'attention API authenticates before reading data and validates filters',
  { timeout: 15000 },
  async () => {
    const token = randomUUID();
    // Force this test server onto loopback with an ephemeral port. No .env, DB,
    // mail or Stripe configuration is inherited by the child.
    const source = `
    import http from 'node:http';
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(_port, callback) {
      return listen.call(this, 0, '127.0.0.1', () => { console.log('TEST_PORT=' + this.address().port); callback?.(); });
    };
    await import('./dist/apps/funding-api/src/main.js');
  `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', source],
      {
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          FUNDING_API_PORT: '0',
          FUNDING_ADMIN_TOKEN: token,
          FUNDING_ADMIN_SESSION_SECRET: randomUUID(),
          FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'false'
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      }
    );
    try {
      const port = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(
          () => reject(new Error('Test API did not start')),
          10000
        );
        child.on('error', reject);
        child.on('exit', () => {
          clearTimeout(timer);
          reject(new Error('Test API exited before ready'));
        });
        child.stdout.on('data', (chunk) => {
          output += chunk;
          const match = output.match(/TEST_PORT=(\d+)/);
          if (match) {
            clearTimeout(timer);
            resolve(Number(match[1]));
          }
        });
      });
      const url = `http://127.0.0.1:${port}/api/admin/attention`;
      const anonymous = await fetch(url);
      assert.equal(anonymous.status, 401);
      const headers = { authorization: `Bearer ${token}` };
      const valid = await fetch(url, { headers });
      assert.equal(valid.status, 200);
      assert.equal(valid.headers.get('cache-control'), 'private, no-store');
      assert.equal((await valid.json()).available, false);
      assert.equal(
        (await fetch(url + '?pageSize=101', { headers })).status,
        400
      );
      assert.equal(
        (await fetch(url + '?type=not-a-type', { headers })).status,
        400
      );
      assert.equal((await fetch(url + '?pageSize=101')).status, 401);
      const base = `http://127.0.0.1:${port}/api/admin`;
      const searchUrl = base + '/search';
      assert.equal(
        (await fetch(searchUrl, { method: 'POST', body: '{}' })).status,
        401
      );
      assert.equal((await fetch(searchUrl, { headers })).status, 405);
      assert.equal(
        (await fetch(searchUrl, { method: 'POST', headers, body: '{}' }))
          .status,
        415
      );
      const searchHeaders = { ...headers, 'Content-Type': 'application/json' };
      for (const body of [
        '{',
        '{}',
        JSON.stringify({ query: 'private@example.invalid', pageSize: 21 }),
        JSON.stringify({ query: 'x'.repeat(5000) })
      ]) {
        const invalid = await fetch(searchUrl, {
          method: 'POST',
          headers: searchHeaders,
          body
        });
        assert.equal(invalid.status, 400);
        assert.ok(!(await invalid.text()).includes('private@'));
      }
      const search = await fetch(searchUrl, {
        method: 'POST',
        headers: searchHeaders,
        body: JSON.stringify({ query: 'private@example.invalid' })
      });
      assert.equal(search.status, 200);
      assert.equal(search.headers.get('cache-control'), 'private, no-store');
      assert.equal((await search.json()).available, false);
      for (const block of ['metrics', 'activity', 'systems']) {
        assert.equal((await fetch(`${base}/cockpit/${block}`)).status, 401);
        const result = await fetch(`${base}/cockpit/${block}`, { headers });
        assert.equal(result.status, 200);
        assert.equal(result.headers.get('cache-control'), 'private, no-store');
        const body = await result.json();
        if (block !== 'systems') assert.equal(body.available, false);
        else
          assert.equal(
            body.systems.find((system) => system.id === 'stripe').state,
            'not_configured'
          );
      }
      assert.equal((await fetch(`${base}/sponsorships/progress`)).status, 401);
      assert.equal(
        (await fetch(`${base}/sponsorships/progress?sponsorshipId=invalid`))
          .status,
        401
      );
      assert.equal(
        (
          await fetch(`${base}/sponsorships/progress?sponsorshipId=invalid`, {
            headers
          })
        ).status,
        400
      );
      const progress = await fetch(`${base}/sponsorships/progress`, {
        headers
      });
      assert.equal(progress.status, 200);
      assert.equal(progress.headers.get('cache-control'), 'private, no-store');
      assert.equal((await progress.json()).status, 'unavailable');
      assert.equal((await fetch(`${base}/assistant/context`)).status, 401);
      const context = await fetch(`${base}/assistant/context`, { headers });
      assert.equal(context.status, 200);
      assert.equal(context.headers.get('cache-control'), 'private, no-store');
      assert.equal((await context.json()).status, 'unavailable');
      assert.equal(
        (
          await fetch(`${base}/assistant/context?sponsorshipId=invalid`, {
            headers
          })
        ).status,
        400
      );
      assert.equal(
        (await fetch(`${base}/assistant/context?sponsorshipId=invalid`)).status,
        401
      );
      assert.equal(
        (
          await fetch(`${base}/sponsorships/request-information`, {
            method: 'POST',
            body: '{}'
          })
        ).status,
        401
      );
      assert.equal(
        (
          await fetch(`${base}/sponsorships/request-information`, {
            method: 'POST',
            headers,
            body: '{}'
          })
        ).status,
        503
      );
      assert.equal(
        (
          await fetch(`${base}/assistant/query`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              message: 'Explain',
              sponsorshipId: 'invalid'
            })
          })
        ).status,
        400
      );
      const query = await fetch(`${base}/assistant/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: 'Explain',
          sponsorshipId: '10000000-0000-4000-8000-000000000001'
        })
      });
      assert.equal((await query.json()).status, 'assistant_disabled');
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    }
  }
);
