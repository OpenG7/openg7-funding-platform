import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';

test(
  'Stripe dispute fixture supplies current scoped provider facts over isolated loopback HTTP',
  { timeout: 15000 },
  async (t) => {
    const bootstrap = `
    import http from 'node:http';
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(_port, callback) {
      return listen.call(this, 0, '127.0.0.1', () => {
        console.log('TEST_PORT=' + this.address().port);
        callback?.();
      });
    };
    await import('./tests/stripe-stub/server.mjs');
  `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', bootstrap],
      {
        env: {
          PORT: '0',
          SYSTEMROOT: process.env.SYSTEMROOT,
          PATH: process.env.PATH
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      }
    );
    let errors = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    t.after(async () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null)
        return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    });
    const port = await new Promise((resolvePort, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(new Error('Synthetic Stripe fixture startup timed out')),
        5000
      );
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Synthetic Stripe fixture exited: ' + errors));
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/TEST_PORT=(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolvePort(Number(match[1]));
        }
      });
    });
    const request = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5000)
      });
      return { status: response.status, body: await response.json() };
    };
    for (const [intent, charge] of [
      ['pi_synthetic_one', 'ch_synthetic_one'],
      ['pi_synthetic_other', 'ch_synthetic_other']
    ]) {
      assert.equal(
        (
          await request('/__test__/payment-intents', {
            id: intent,
            amount: 5000,
            chargeId: charge,
            created: 1000
          })
        ).status,
        200
      );
    }
    const register = (
      id,
      chargeId,
      status = 'needs_response',
      created = 1000
    ) =>
      request('/__test__/disputes', {
        id,
        chargeId,
        amount: 1000,
        status,
        created
      });
    await register('dp_synthetic_one', 'ch_synthetic_one');
    await register('dp_synthetic_other', 'ch_synthetic_other');
    await register('dp_synthetic_two', 'ch_synthetic_one', 'won', 2000);
    await register('dp_synthetic_missing_charge', 'ch_synthetic_absent');

    await t.test(
      'individual retrieval derives the payment intent and preserves charge expansion',
      async () => {
        const plain = await request('/v1/disputes/dp_synthetic_one');
        assert.equal(plain.status, 200);
        assert.equal(plain.body.payment_intent, 'pi_synthetic_one');
        assert.equal(plain.body.charge, 'ch_synthetic_one');
        const expanded = await request(
          '/v1/disputes/dp_synthetic_one?expand[]=charge'
        );
        assert.equal(expanded.body.payment_intent, 'pi_synthetic_one');
        assert.equal(expanded.body.charge.id, 'ch_synthetic_one');
        assert.equal(expanded.body.charge.payment_intent, 'pi_synthetic_one');
      }
    );
    await t.test(
      'list scope precedes pagination and retains created filters and expansions',
      async () => {
        const first = await request(
          '/v1/disputes?payment_intent=pi_synthetic_one&limit=1&expand[]=data.charge'
        );
        assert.deepEqual(
          first.body.data.map((row) => row.id),
          ['dp_synthetic_one']
        );
        assert.equal(first.body.has_more, true);
        assert.equal(first.body.data[0].payment_intent, 'pi_synthetic_one');
        assert.equal(first.body.data[0].charge.id, 'ch_synthetic_one');
        const next = await request(
          '/v1/disputes?payment_intent=pi_synthetic_one&limit=1&starting_after=dp_synthetic_one'
        );
        assert.deepEqual(
          next.body.data.map((row) => row.id),
          ['dp_synthetic_two']
        );
        assert.equal(next.body.has_more, false);
        const dated = await request(
          '/v1/disputes?payment_intent=pi_synthetic_one&created[gte]=1500'
        );
        assert.deepEqual(
          dated.body.data.map((row) => row.id),
          ['dp_synthetic_two']
        );
        const unmatched = await request(
          '/v1/disputes?payment_intent=pi_synthetic_absent'
        );
        assert.deepEqual(unmatched.body.data, []);
        assert.equal(unmatched.body.has_more, false);
        const all = await request('/v1/disputes');
        assert.equal(all.body.data.length, 4);
        assert.equal(all.body.data.at(-1).payment_intent, null);
      }
    );
    await t.test(
      'registration updates current dispute status without duplicating the list',
      async () => {
        await register('dp_synthetic_one', 'ch_synthetic_one', 'won');
        assert.equal(
          (await request('/v1/disputes/dp_synthetic_one')).body.status,
          'won'
        );
        assert.equal(
          (await request('/v1/disputes?payment_intent=pi_synthetic_one')).body
            .data.length,
          2
        );
      }
    );
    await t.test(
      'missing resources use Stripe errors and reset removes provider records',
      async () => {
        const missing = await request('/v1/disputes/dp_synthetic_absent');
        assert.equal(missing.status, 404);
        assert.equal(missing.body.error.code, 'resource_missing');
        await request('/__test__/reset', {});
        assert.deepEqual((await request('/v1/disputes')).body.data, []);
        assert.equal(
          (await request('/v1/disputes/dp_synthetic_one')).status,
          404
        );
      }
    );
  }
);
