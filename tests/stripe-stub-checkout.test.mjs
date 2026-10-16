import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

test(
  'reopening a paid simulated Checkout exposes its escaped continuation without paying or replaying a webhook',
  { timeout: 15000 },
  async (t) => {
    const delivered = [];
    const webhookSecret = 'synthetic-local-checkout-webhook-secret';
    const receiver = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      delivered.push({ body, signature: request.headers['stripe-signature'] });
      response.writeHead(200).end('{}');
    });
    receiver.listen(0, '127.0.0.1');
    await once(receiver, 'listening');
    t.after(async () => {
      const closed = new Promise((done) => receiver.close(done));
      receiver.closeAllConnections();
      await closed;
    });
    const bootstrap = `
    import http from 'node:http';
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(_port, callback) {
      return listen.call(this, 0, '127.0.0.1', () => {
        process.env.STUB_PUBLIC_BASE_URL = 'http://127.0.0.1:' + this.address().port;
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
          PATH: process.env.PATH,
          STUB_WEBHOOK_URL: `http://127.0.0.1:${receiver.address().port}/webhook`,
          STRIPE_WEBHOOK_SECRET: webhookSecret
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      }
    );
    t.after(async () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null)
        return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    });
    const port = await new Promise((done, fail) => {
      let output = '';
      const timer = setTimeout(
        () => fail(new Error('Synthetic Checkout startup timed out')),
        5000
      );
      child.once('error', (error) => {
        clearTimeout(timer);
        fail(error);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        fail(new Error('Synthetic Checkout exited'));
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/TEST_PORT=(\d+)/);
        if (match) {
          clearTimeout(timer);
          done(Number(match[1]));
        }
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const successUrl = `${base}/return?session_id={CHECKOUT_SESSION_ID}&followup_token=synthetic-token&label="x"<script>'`;
    const created = await fetch(base + '/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': 'synthetic-checkout'
      },
      body: new URLSearchParams({
        'metadata[openg7CheckoutOperationId]':
          '10000000-0000-4000-8000-000000000001',
        'line_items[0][price_data][unit_amount]': '10000',
        'line_items[0][price_data][currency]': 'cad',
        success_url: successUrl,
        cancel_url: base + '/cancel'
      }),
      signal: AbortSignal.timeout(5000)
    });
    assert.equal(created.status, 200);
    const checkout = await created.json();
    const pageUrl = base + '/checkout/' + checkout.id;
    const before = await fetch(pageUrl);
    const unpaid = await before.text();
    assert.match(unpaid, /<form method="post">/);
    assert.match(unpaid, /Confirmer le paiement simulé/);
    assert.doesNotMatch(unpaid, /Continuer vers OpenG7/);
    assert.equal(delivered.length, 0);
    const pay = () =>
      fetch(pageUrl, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'controller@simulation.example.test',
          action: 'success'
        }),
        signal: AbortSignal.timeout(5000)
      });
    const paid = await pay();
    assert.equal(paid.status, 303);
    assert.equal(
      paid.headers.get('location'),
      successUrl.replace('{CHECKOUT_SESSION_ID}', checkout.id)
    );
    assert.equal(delivered.length, 1);
    const [time, signature] = delivered[0].signature.split(',');
    const signed = createHmac('sha256', webhookSecret)
      .update(`${time.slice(2)}.${delivered[0].body}`)
      .digest('hex');
    assert.equal(signature, `v1=${signed}`);
    const snapshot = await (
      await fetch(base + '/v1/checkout/sessions/' + checkout.id)
    ).json();
    assert.equal(snapshot.payment_status, 'paid');
    const escapedUrl = successUrl
      .replace('{CHECKOUT_SESSION_ID}', checkout.id)
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    for (let read = 0; read < 2; read++) {
      const reopened = await fetch(pageUrl);
      assert.equal(reopened.status, 200);
      assert.match(reopened.headers.get('cache-control'), /no-store/);
      const html = await reopened.text();
      assert.match(html, /Paiement simulé déjà confirmé/);
      assert.ok(
        html.includes(`<a href="${escapedUrl}">Continuer vers OpenG7</a>`)
      );
      assert.doesNotMatch(html, /<form|<script>|\{CHECKOUT_SESSION_ID\}/);
    }
    assert.equal(delivered.length, 1);
    assert.deepEqual(
      await (await fetch(base + '/v1/checkout/sessions/' + checkout.id)).json(),
      snapshot
    );
    const replay = await pay();
    assert.equal(replay.status, 303);
    assert.equal(delivered.length, 2);
    assert.equal(
      JSON.parse(delivered[1].body).id,
      JSON.parse(delivered[0].body).id
    );
  }
);
