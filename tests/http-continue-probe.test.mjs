import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { probeHttpWithContinue } from './support/http-continue-probe.mjs';

async function fixture(t, handleContinue) {
  const server = createServer();
  server.on('checkContinue', handleContinue);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });
  return `http://127.0.0.1:${server.address().port}/synthetic-probe`;
}

test('a final 413 before continue is a real complete response and sends no body', async (t) => {
  let received = 0;
  const url = await fixture(t, (request, response) => {
    assert.equal(request.headers.expect, '100-continue');
    request.on('data', (chunk) => {
      received += chunk.length;
    });
    response.writeHead(413, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ rejectedBeforeBody: true }));
  });
  const response = await probeHttpWithContinue(url, {
    body: Buffer.alloc(589824 + 1)
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { rejectedBeforeBody: true });
  assert.equal(received, 0);
});

test('continue sends the exact body once and waits for its complete 200 response', async (t) => {
  const body = Buffer.alloc(512 * 1024, 37);
  const url = await fixture(t, (request, response) => {
    assert.equal(Number(request.headers['content-length']), body.length);
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      assert.deepEqual(Buffer.concat(chunks), body);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ bytes: Buffer.concat(chunks).length }));
    });
    response.writeContinue();
    response.writeContinue();
  });
  const response = await probeHttpWithContinue(url, { body });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { bytes: body.length });
});

test('a socket closed without any final response remains an error', async (t) => {
  const url = await fixture(t, (request) => request.socket.destroy());
  await assert.rejects(probeHttpWithContinue(url, { body: 'synthetic-body' }), {
    code: 'ECONNRESET'
  });
});

test('an incomplete final response remains an error', async (t) => {
  const url = await fixture(t, (request, response) => {
    response.writeHead(413, { 'Content-Length': '100' });
    response.write('partial');
    response.flushHeaders();
    setImmediate(() => request.socket.destroy());
  });
  await assert.rejects(
    probeHttpWithContinue(url, { body: Buffer.alloc(589824 + 1) }),
    /aborted|incomplete|socket hang up/i
  );
});

test('a server withholding continue and its final response times out without sending a body', async (t) => {
  let received = 0;
  const url = await fixture(t, (request) => {
    request.on('data', (chunk) => {
      received += chunk.length;
    });
  });
  await assert.rejects(
    probeHttpWithContinue(url, { body: 'synthetic-body', timeoutMs: 50 }),
    /Fixture request timeout/
  );
  assert.equal(received, 0);
});
