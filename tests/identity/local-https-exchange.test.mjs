import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';

import { createLocalTlsFixture } from '../support/local-tls-fixture.mjs';
import { createLocalHttpsExchange } from './local-https-exchange.mjs';

const fixture = async (t, handler, timeout = 1_000) => {
  const root = await mkdtemp(join(tmpdir(), 'og7-local-https-exchange-'));
  let server;
  const sockets = new Set();
  t.after(async () => {
    try {
      if (server) {
        for (const socket of sockets) socket.destroy();
        await new Promise((resolveClose, reject) =>
          server.close((error) => (error ? reject(error) : resolveClose()))
        );
      }
    } finally {
      const target = resolve(root);
      assert.ok(
        target.startsWith(resolve(tmpdir()) + sep + 'og7-local-https-exchange-')
      );
      await rm(target, { recursive: true, force: true });
    }
  });
  const certificates = createLocalTlsFixture(root);
  const [key, cert, ca] = await Promise.all([
    readFile(certificates.keyPath),
    readFile(certificates.certificatePath),
    readFile(certificates.caPath)
  ]);
  server = createServer({ key, cert }, handler);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  return createLocalHttpsExchange({
    port,
    origin: `https://localhost:${port}`,
    issuer: 'https://auth.openg7.test/realms/openg7',
    ca,
    timeout
  });
};

test(
  'trusted HTTPS preserves a complete provider response and request scope',
  { timeout: 5_000 },
  async (t) => {
    let requestScope;
    const exchange = await fixture(t, (request, response) => {
      requestScope = {
        host: request.headers.host,
        servername: request.socket.servername,
        path: request.url,
        cookie: request.headers.cookie
      };
      response.writeHead(201, { 'X-Synthetic-Response': 'complete' });
      response.write('synthetic-');
      response.end('body');
    });
    const result = await exchange('/realms/openg7/probe?mode=fixture', {
      provider: true,
      cookie: 'synthetic_session=fixture'
    });
    assert.equal(result.status, 201);
    assert.equal(result.headers['x-synthetic-response'], 'complete');
    assert.equal(result.body, 'synthetic-body');
    assert.deepEqual(requestScope, {
      host: 'auth.openg7.test',
      servername: 'auth.openg7.test',
      path: '/realms/openg7/probe?mode=fixture',
      cookie: 'synthetic_session=fixture'
    });
  }
);

test(
  'an interrupted HTTPS body rejects instead of leaving the exchange pending',
  { timeout: 5_000 },
  async (t) => {
    const exchange = await fixture(t, (_request, response) => {
      response.writeHead(200, { 'Content-Length': '100' });
      response.write('partial', () => response.socket.destroy());
    });
    await assert.rejects(exchange('/interrupted'), {
      message: 'Local HTTPS response was interrupted.'
    });
  }
);

test(
  'the HTTPS deadline closes a response that keeps sending body chunks',
  { timeout: 5_000 },
  async (t) => {
    let writes = 0;
    let resolveClosed;
    const closed = new Promise((resolveClose) => {
      resolveClosed = resolveClose;
    });
    const exchange = await fixture(
      t,
      (_request, response) => {
        response.writeHead(200);
        const interval = setInterval(() => {
          writes += 1;
          response.write('synthetic-chunk');
        }, 20);
        response.once('close', () => {
          clearInterval(interval);
          resolveClosed();
        });
      },
      200
    );
    await assert.rejects(exchange('/never-complete'), {
      message: 'Local HTTPS request timed out.'
    });
    await closed;
    assert.ok(writes >= 2, 'The server must keep sending before the deadline.');
  }
);
