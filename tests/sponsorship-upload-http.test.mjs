import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';

test(
  'follow-up HTTP rejects malformed bodies, oversize uploads and ineligible media before decoding',
  { timeout: 25000 },
  async () => {
    // Loopback only. No .env or credentials. All database operations are simulated.
    const source = `
    import http from 'node:http';
    import pg from 'pg';
    import {createHash} from 'node:crypto';
    const digest = value => createHash('sha256').update(value).digest('hex');
    pg.Pool.prototype.query = async function(sql, values) {
      if (sql.includes('sponsorship_followup_token_hash') && values?.[0] === digest('q'.repeat(43)))
        return {rows:[{id:'11111111-1111-4111-8111-111111111111', payment_status:'paid', sponsor_review_status:'pending_review', amount_cents:'50000', currency:'cad'}]};
      if (sql.includes('sponsorship_followup_token_hash') && values?.[0] === digest('r'.repeat(43)))
        return {rows:[{id:'22222222-2222-4222-8222-222222222222', payment_status:'paid', sponsor_review_status:'rejected', amount_cents:'50000', currency:'cad'}]};
      if (sql.includes('AS supporting_count')) return {rows:[{status:'paid',sponsor_review_status:values[0].startsWith('2')?'rejected':'pending_review',supporting_count:'3',approved_logo:false}]};
      return {rows:[],rowCount:0};
    };
    pg.Pool.prototype.connect = async function(){ return {query:async()=>({rows:[],rowCount:0}),release(){}}; };
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(_port, callback) {
      return listen.call(this, 0, '127.0.0.1', () => {console.log('TEST_PORT='+this.address().port);callback?.();});
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
          DATABASE_URL: 'postgres://synthetic@127.0.0.1:1/audit',
          FUNDING_EMAIL_WORKER_ENABLED: 'false',
          FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'false'
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      }
    );
    child.stderr.on('data', () => {});
    const exited = once(child, 'exit');
    try {
      const port = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(
          () => reject(new Error('Isolated API startup timeout')),
          10000
        );
        child.on('error', reject);
        child.on('exit', () => {
          clearTimeout(timer);
          reject(new Error('Isolated API exited'));
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
      const base = `http://127.0.0.1:${port}/api/sponsorship-followup`;
      const exchange = async (url, options = {}) => {
        try {
          // Keep the connection open while an early 413 drains the upload;
          // consume each response before starting the next exchange.
          const response = await fetch(url, {
            ...options,
            signal: AbortSignal.timeout(5000)
          });
          const body = await response.text();
          return {
            status: response.status,
            payload: response.headers
              .get('content-type')
              ?.startsWith('application/json')
              ? JSON.parse(body)
              : body
          };
        } catch (error) {
          throw new Error(
            `${options.method ?? 'GET'} ${new URL(url).pathname} failed: ${error.name} (${error.cause?.code ?? error.code ?? 'no code'})`,
            { cause: error }
          );
        }
      };
      const post = (path, body, contentType = 'application/json') =>
        exchange(base + path, {
          method: 'POST',
          headers: { 'content-type': contentType },
          body
        });
      for (const body of ['null', '[]', '1', '"text"', '{}', '{']) {
        assert.equal((await post('/media/delete', body)).status, 400);
        assert.equal(
          (await exchange(`http://127.0.0.1:${port}/health`)).status,
          200,
          'API remains available after malformed input'
        );
      }
      assert.equal(
        (await post('/media/delete', '{}', 'text/plain')).status,
        415
      );
      const deletion = {
        token: 'a'.repeat(43),
        assetId: '11111111-1111-4111-8111-111111111111',
        expectedVersion: '2026-01-01T00:00:00.000Z'
      };
      assert.equal(
        (await post('/media/delete', JSON.stringify(deletion))).status,
        400
      );
      assert.equal(
        (
          await post(
            '/media/delete',
            JSON.stringify({ ...deletion, confirmed: true })
          )
        ).status,
        404
      );
      const valid = {
        token: 'a'.repeat(43),
        companyName: 'Atelier',
        contactName: 'Camille',
        contactEmail: 'camille@example.test'
      };
      for (const values of [
        { companyName: 'bad\0name' },
        { contactEmail: 'a..b@example.test' },
        { websiteUrl: 'https://user:pass@example.test' },
        { message: 'bad\0message' },
        { approved: true }
      ])
        assert.equal(
          (await post('/details', JSON.stringify({ ...valid, ...values })))
            .status,
          400
        );
      assert.equal((await post('/details', JSON.stringify(valid))).status, 404);
      const upload = (size, token = 'a'.repeat(43), duplicate = false) => {
        const body = new FormData();
        body.set('token', token);
        body.set('kind', 'supporting_image');
        body.set(
          'media',
          new Blob([Buffer.alloc(size)], { type: 'image/png' }),
          'synthetic.png'
        );
        if (duplicate) body.append('kind', 'logo');
        return exchange(base + '/media', {
          method: 'POST',
          body
        });
      };
      assert.equal((await upload(0)).status, 400);
      assert.equal(
        (await upload(8388608)).status,
        404,
        'file at byte limit reaches access check'
      );
      for (const size of [8388609, 8388608 + 128 * 1024 + 1]) {
        const response = await upload(size);
        assert.equal(response.status, 413);
        assert.equal(response.payload.code, 'SPONSOR_MEDIA_TOO_LARGE');
        assert.equal(
          (await exchange(`http://127.0.0.1:${port}/health`)).status,
          200,
          'API remains available after an oversized upload'
        );
      }
      assert.equal((await upload(1, 'a'.repeat(43), true)).status, 400);
      // Invalid image bytes would fail decoding with 400 if the preflight did not run first.
      for (const [token, code] of [
        ['q', 'supporting_image_limit_reached'],
        ['r', 'not_editable']
      ]) {
        const response = await upload(1, token.repeat(43));
        assert.equal(response.status, 409);
        assert.equal(response.payload.code, code);
      }
    } finally {
      if (child.exitCode === null) {
        child.kill();
        await exited;
      }
    }
  }
);
