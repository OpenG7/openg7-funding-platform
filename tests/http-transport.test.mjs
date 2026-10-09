import assert from 'node:assert/strict';
import { Agent, createServer, request } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  createHttpTransport,
  readBody,
  readBodyBuffer
} from '../dist/apps/funding-api/src/http-transport.js';

const allowedOrigin = 'https://funding.example.org';
const production = createHttpTransport({
  isProduction: true,
  allowedOrigins: [allowedOrigin]
});

const startServer = async (t, handler) => {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const { port } = server.address();
  return ({
    method = 'GET',
    headers = {},
    path = '/',
    body,
    send,
    agent = false
  } = {}) =>
    new Promise((resolve, reject) => {
      const outgoing = request(
        { hostname: '127.0.0.1', port, method, headers, path, agent },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks)
            })
          );
        }
      );
      outgoing.on('error', reject);
      outgoing.setTimeout(5000, () =>
        outgoing.destroy(new Error('Isolated HTTP exchange timeout'))
      );
      t.after(() => outgoing.destroy());
      if (send) send(outgoing);
      else outgoing.end(body);
    });
};

const assertCommonHeaders = (headers) => {
  assert.equal(headers.vary, 'Origin');
  assert.equal(headers['referrer-policy'], 'no-referrer');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['access-control-allow-credentials'], undefined);
};

test('HTTP writers preserve statuses, UTF-8 JSON/text/CSV and binary/PDF downloads', async (t) => {
  const binary = Buffer.from([0, 128, 255, 10]);
  const pdf = Buffer.from('%PDF-1.4\nsynthetic invoice\n');
  const cases = [
    {
      name: 'JSON',
      write: (incoming, response) =>
        production.writeJson(
          incoming,
          response,
          201,
          { message: 'Créé' },
          {
            'Cache-Control': 'no-store',
            'X-Request-Id': 'synthetic-request',
            'Content-Type': 'text/plain'
          }
        ),
      status: 201,
      body: Buffer.from('{"message":"Créé"}'),
      contentType: 'application/json; charset=utf-8',
      extraHeaders: {
        'cache-control': 'no-store',
        'x-request-id': 'synthetic-request'
      }
    },
    {
      name: 'text',
      write: (incoming, response) =>
        production.writeText(incoming, response, 503, 'Indisponibilité'),
      status: 503,
      body: Buffer.from('Indisponibilité'),
      contentType: 'text/plain; charset=utf-8'
    },
    {
      name: 'CSV',
      write: (incoming, response) =>
        production.writeCsv(
          incoming,
          response,
          200,
          'nom,montant\nÉquipe,2500\n',
          'contributions.csv'
        ),
      status: 200,
      body: Buffer.from('nom,montant\nÉquipe,2500\n'),
      contentType: 'text/csv; charset=utf-8',
      extraHeaders: {
        'content-disposition': 'attachment; filename="contributions.csv"'
      }
    },
    {
      name: 'binary',
      write: (incoming, response) =>
        production.writeBinary(incoming, response, 206, binary, 'image/png', {
          'Cache-Control': 'private, max-age=60',
          'Content-Length': '999',
          'Content-Type': 'text/plain'
        }),
      status: 206,
      body: binary,
      contentType: 'image/png',
      extraHeaders: {
        'cache-control': 'private, max-age=60',
        'content-length': String(binary.byteLength)
      }
    },
    {
      name: 'PDF',
      write: (incoming, response) =>
        production.writePdf(incoming, response, 200, pdf, 'invoice.pdf'),
      status: 200,
      body: pdf,
      contentType: 'application/pdf',
      extraHeaders: {
        'cache-control': 'no-store',
        'content-disposition': 'attachment; filename="invoice.pdf"',
        'content-length': String(pdf.byteLength)
      }
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async (nested) => {
      const exchange = await startServer(nested, fixture.write);
      const result = await exchange({ headers: { Origin: allowedOrigin } });
      assert.equal(result.status, fixture.status);
      assert.deepEqual(result.body, fixture.body);
      assert.equal(result.headers['content-type'], fixture.contentType);
      assert.equal(
        result.headers['access-control-allow-origin'],
        allowedOrigin
      );
      assertCommonHeaders(result.headers);
      for (const [name, value] of Object.entries(fixture.extraHeaders ?? {})) {
        assert.equal(result.headers[name], value);
      }
    });
  }
});

test('admin JSON, CSV, text and binary responses cannot be cached, including on errors', async (t) => {
  const writers = [
    (incoming, response, status) =>
      production.writeJson(
        incoming,
        response,
        status,
        { synthetic: true },
        {
          'Cache-Control': 'public, max-age=3600'
        }
      ),
    (incoming, response, status) =>
      production.writeCsv(
        incoming,
        response,
        status,
        'synthetic\n',
        'test.csv'
      ),
    (incoming, response, status) =>
      production.writeText(incoming, response, status, 'synthetic'),
    (incoming, response, status) =>
      production.writeBinary(
        incoming,
        response,
        status,
        Buffer.from('synthetic'),
        'image/webp',
        { 'Cache-Control': 'public, max-age=3600' }
      )
  ];
  for (const write of writers) {
    for (const status of [200, 401, 403, 503]) {
      const exchange = await startServer(t, (incoming, response) =>
        write(incoming, response, status)
      );
      for (const path of [
        '/admin/contributions',
        '/api/admin/session?test=1'
      ]) {
        const result = await exchange({ path });
        assert.equal(result.status, status);
        assert.equal(result.headers['cache-control'], 'no-store');
      }
    }
  }
});

test('private sponsorship follow-up responses cannot be cached across aliases and errors', async (t) => {
  for (const status of [200, 404]) {
    const exchange = await startServer(t, (incoming, response) =>
      production.writeJson(
        incoming,
        response,
        status,
        { contactEmail: 'synthetic@example.org' },
        { 'Cache-Control': 'public, max-age=60' }
      )
    );
    for (const path of [
      '/sponsorship-followup?token=synthetic',
      '/api/sponsorship-followup?token=synthetic',
      '/sponsorship-followup/draft?token=synthetic',
      '/api/sponsorship-followup/draft?token=synthetic',
      '/sponsorship-followup/media?token=synthetic',
      '/api/sponsorship-followup/media?token=synthetic'
    ]) {
      const result = await exchange({ path });
      assert.equal(result.status, status);
      assert.equal(result.headers['cache-control'], 'no-store');
    }
  }
});

test('public JSON and media cache policies are preserved', async (t) => {
  for (const write of [
    (incoming, response) =>
      production.writeJson(
        incoming,
        response,
        200,
        { synthetic: true },
        {
          'Cache-Control': 'public, max-age=60'
        }
      ),
    (incoming, response) =>
      production.writeBinary(
        incoming,
        response,
        200,
        Buffer.from('synthetic'),
        'image/webp',
        { 'Cache-Control': 'public, max-age=60' }
      )
  ]) {
    const exchange = await startServer(t, write);
    for (const path of [
      '/public/sponsor-media/asset',
      '/api/public/fund-transparency',
      '/public/sponsorships',
      '/api/public/sponsorships',
      '/sponsorship-followup-public'
    ]) {
      const result = await exchange({ path });
      assert.equal(result.headers['cache-control'], 'public, max-age=60');
    }
  }
});

test('explicit private no-store policies remain intact for administrative handlers', async (t) => {
  const exchange = await startServer(t, (incoming, response) =>
    production.writeJson(
      incoming,
      response,
      200,
      {},
      {
        'Cache-Control': 'private, no-store'
      }
    )
  );
  for (const path of [
    '/api/admin/contribution-activity',
    '/api/sponsorship-followup/media?token=synthetic'
  ]) {
    const result = await exchange({ path });
    assert.equal(result.headers['cache-control'], 'private, no-store');
  }
});

test('production CORS allows only exact configured origins, including on preflight', async (t) => {
  const exchange = await startServer(t, (incoming, response) => {
    if (incoming.method === 'OPTIONS') {
      production.writeOptions(incoming, response);
    } else {
      production.writeJson(incoming, response, 200, { ok: true });
    }
  });
  for (const origin of [
    allowedOrigin,
    'https://funding.example.org.invalid',
    'https://other.example.org',
    'null',
    undefined
  ]) {
    for (const method of ['GET', 'OPTIONS']) {
      const result = await exchange({
        method,
        headers: origin === undefined ? {} : { Origin: origin }
      });
      assertCommonHeaders(result.headers);
      assert.equal(
        result.headers['access-control-allow-origin'],
        origin === allowedOrigin ? allowedOrigin : undefined
      );
      assert.equal(result.status, method === 'OPTIONS' ? 204 : 200);
      if (method === 'OPTIONS') {
        assert.equal(result.body.byteLength, 0);
        assert.equal(
          result.headers['access-control-allow-methods'],
          'GET, POST, OPTIONS'
        );
        assert.equal(
          result.headers['access-control-allow-headers'],
          'Content-Type, Stripe-Signature, Authorization, X-Funding-Admin-Token, X-Sponsorship-Followup-Token'
        );
        assert.equal(result.headers['content-type'], undefined);
      }
    }
  }
});

test('development CORS keeps wildcard responses with or without an origin', async (t) => {
  const development = createHttpTransport({
    isProduction: false,
    allowedOrigins: []
  });
  const exchange = await startServer(t, (incoming, response) => {
    if (incoming.method === 'OPTIONS') {
      development.writeOptions(incoming, response);
    } else {
      development.writeJson(incoming, response, 200, {});
    }
  });
  for (const method of ['GET', 'OPTIONS']) {
    for (const headers of [{}, { Origin: 'https://local.example.org' }]) {
      const result = await exchange({ method, headers });
      assertCommonHeaders(result.headers);
      assert.equal(result.headers['access-control-allow-origin'], '*');
    }
  }
});

test('body readers preserve empty payloads, strings, raw bytes and split UTF-8 characters', async () => {
  assert.equal(await readBody(Readable.from([])), '');
  assert.deepEqual(await readBodyBuffer(Readable.from([]), 0), Buffer.alloc(0));
  const payload = Buffer.from('{"message":"Créé"}\n');
  const accent = payload.indexOf(Buffer.from('é'));
  assert.equal(
    await readBody(
      Readable.from([
        payload.subarray(0, accent + 1),
        payload.subarray(accent + 1)
      ]),
      payload.byteLength
    ),
    payload.toString('utf8')
  );
  assert.equal(await readBody(Readable.from(['Cré', 'é']), 6), 'Créé');
  const binary = Buffer.from([0, 128, 255, 10]);
  assert.deepEqual(
    await readBodyBuffer(
      Readable.from([binary.subarray(0, 1), binary.subarray(1)]),
      binary.byteLength
    ),
    binary
  );
});

test('body readers accept the byte limit and reject cumulative or multibyte overflows', async () => {
  for (const reader of [readBody, readBodyBuffer]) {
    await reader(Readable.from([Buffer.from('ab'), Buffer.from('cd')]), 4);
    await assert.rejects(
      reader(
        Readable.from([Buffer.from('ab'), Buffer.from('cd'), Buffer.from('e')]),
        4
      ),
      { message: 'Request body is too large.' }
    );
    await assert.rejects(reader(Readable.from(['é']), 1), {
      message: 'Request body is too large.'
    });
  }
  const defaultLimit = 256 * 1024;
  assert.equal(
    (await readBody(Readable.from([Buffer.alloc(defaultLimit, 97)]))).length,
    defaultLimit
  );
  await assert.rejects(
    readBody(Readable.from([Buffer.alloc(defaultLimit), Buffer.from([1])])),
    { message: 'Request body is too large.' }
  );
});

test('body readers propagate request stream failures without returning a partial body', async () => {
  for (const reader of [readBody, readBodyBuffer]) {
    const failure = new Error('synthetic request stream failure');
    const incoming = Readable.from(
      (async function* () {
        yield Buffer.from('partial');
        throw failure;
      })()
    );
    await assert.rejects(reader(incoming, 1024), (error) => error === failure);
  }
});

test(
  'real HTTP bodies retain the exact byte limit and complete 413 responses across framing modes',
  { timeout: 10000 },
  async (t) => {
    const limit = 32;
    const exchange = await startServer(t, async (incoming, response) => {
      if (incoming.url === '/health') {
        production.writeJson(incoming, response, 200, { ok: true });
        return;
      }
      try {
        const body = await readBodyBuffer(incoming, limit);
        production.writeBinary(
          incoming,
          response,
          200,
          body,
          'application/octet-stream'
        );
      } catch (error) {
        production.writeJson(incoming, response, 413, { error: error.message });
      }
    });
    for (const framing of ['content-length', 'chunked']) {
      for (const size of [limit, limit + 1]) {
        const body = Buffer.alloc(size, 97);
        const result = await exchange({
          method: 'POST',
          body,
          headers:
            framing === 'content-length'
              ? { 'Content-Length': String(size) }
              : { 'Transfer-Encoding': 'chunked' }
        });
        assert.equal(
          result.status,
          size === limit ? 200 : 413,
          `${framing}: ${size} bytes`
        );
        if (size === limit) assert.deepEqual(result.body, body);
        else {
          assert.deepEqual(JSON.parse(result.body), {
            error: 'Request body is too large.'
          });
          assert.equal((await exchange({ path: '/health' })).status, 200);
        }
      }
    }
  }
);

test(
  'over-limit HTTP requests preserve their socket before EOF and handle completion or abort while draining',
  { timeout: 10000 },
  async (t) => {
    const limit = 32;
    for (const [framing, abort] of [
      ['content-length', false],
      ['chunked', false],
      ['chunked', true]
    ]) {
      await t.test(
        `${framing}: ${abort ? 'abort' : 'complete'} after 413`,
        { timeout: 3000 },
        async (nested) => {
          const agent = new Agent({ keepAlive: true, maxSockets: 1 });
          nested.after(() => agent.destroy());
          const rejected = Promise.withResolvers();
          const finished = Promise.withResolvers();
          const socketClosed = Promise.withResolvers();
          let incomingUpload;
          let healthSocket;
          const exchange = await startServer(
            nested,
            async (incoming, response) => {
              if (incoming.url === '/health') {
                healthSocket = incoming.socket;
                production.writeJson(incoming, response, 200, { ok: true });
                return;
              }
              incomingUpload = incoming;
              incoming.once('end', () => finished.resolve());
              incoming.socket.once('close', () => socketClosed.resolve());
              try {
                await readBodyBuffer(incoming, limit);
                response.end('Unexpectedly accepted an oversized body');
              } catch (error) {
                const state = {
                  destroyed: incoming.destroyed,
                  complete: incoming.complete
                };
                rejected.resolve(state);
                production.writeJson(incoming, response, 413, {
                  error: error.message
                });
              }
            }
          );
          let outgoingUpload;
          const outcome = exchange({
            method: 'POST',
            agent,
            headers:
              framing === 'content-length'
                ? { 'Content-Length': String(limit + 2) }
                : { 'Transfer-Encoding': 'chunked' },
            send: (outgoing) => {
              outgoingUpload = outgoing;
              outgoing.write(Buffer.alloc(limit + 1));
            }
          }).then(
            (result) => ({ result }),
            (error) => ({ error })
          );
          const state = await rejected.promise;
          assert.equal(state.complete, false, 'refusal precedes request EOF');
          assert.equal(
            state.destroyed,
            false,
            'the reader must leave the response socket intact'
          );
          const { result, error } = await outcome;
          assert.ifError(error);
          assert.equal(result.status, 413);
          assert.deepEqual(JSON.parse(result.body), {
            error: 'Request body is too large.'
          });
          if (abort) {
            outgoingUpload.destroy();
            await socketClosed.promise;
          } else {
            outgoingUpload.end(Buffer.from([1]));
            await finished.promise;
            assert.equal(incomingUpload.complete, true);
          }
          assert.equal(
            (await exchange({ path: '/health', agent })).status,
            200
          );
          if (!abort)
            assert.equal(
              healthSocket,
              incomingUpload.socket,
              'drain permits keep-alive reuse'
            );
        }
      );
    }
  }
);

test(
  'a client abort below the HTTP body limit rejects instead of returning partial bytes',
  { timeout: 10000 },
  async (t) => {
    const started = Promise.withResolvers();
    const rejected = Promise.withResolvers();
    let partialBody;
    const exchange = await startServer(t, async (incoming, response) => {
      if (incoming.url === '/health') {
        production.writeJson(incoming, response, 200, { ok: true });
        return;
      }
      const reading = readBodyBuffer(incoming, 32);
      started.resolve();
      try {
        partialBody = await reading;
        response.end('Unexpectedly accepted a partial body');
      } catch (error) {
        rejected.resolve({
          error,
          aborted: incoming.aborted,
          complete: incoming.complete
        });
      }
    });
    let outgoingUpload;
    const outcome = exchange({
      method: 'POST',
      headers: { 'Content-Length': '32' },
      send: (outgoing) => {
        outgoingUpload = outgoing;
        outgoing.write(Buffer.from('partial'));
      }
    }).then(
      (result) => ({ result }),
      (error) => ({ error })
    );
    await started.promise;
    outgoingUpload.destroy(new Error('Synthetic client abort'));
    assert.match((await outcome).error.message, /Synthetic client abort/);
    const failure = await rejected.promise;
    assert.ok(failure.error);
    assert.equal(failure.aborted, true);
    assert.equal(failure.complete, false);
    assert.equal(partialBody, undefined);
    assert.equal((await exchange({ path: '/health' })).status, 200);
  }
);
