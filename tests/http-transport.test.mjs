import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
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
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  return ({ method = 'GET', headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const outgoing = request(
        { hostname: '127.0.0.1', port, method, headers, agent: false },
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
      outgoing.end();
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
