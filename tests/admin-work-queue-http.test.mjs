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
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    }
  }
);
