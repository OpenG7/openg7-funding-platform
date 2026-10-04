import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  cookie,
  hasAccessConfirmation,
  json,
  parseAdminAccountInput,
  readAccessChange,
  redirect,
  setCookie
} from '../dist/apps/funding-api/src/admin-identity/http.js';

const response = () => ({
  headers: {},
  setHeader(name, value) {
    this.headers[name] = value;
  },
  writeHead(status, headers) {
    this.status = status;
    Object.assign(this.headers, headers);
  },
  end(body) {
    this.body = body;
  }
});

test('identity cookies match exact names and retain the raw cookie value', () => {
  assert.equal(cookie({ headers: {} }, 'og7-admin'), '');
  const request = {
    headers: {
      cookie:
        'og7-admin-login=browser; other=x; og7-admin=raw%2Ftoken=; og7-admin=second'
    }
  };
  assert.equal(cookie(request, 'og7-admin'), 'raw%2Ftoken=');
  assert.equal(cookie(request, 'og7-admin-login'), 'browser');
  assert.equal(cookie(request, '__Host-og7-admin'), '');
});

test('session and login cookies keep their privacy attributes, expiry and secure origin flag', () => {
  const secure = { cookieName: '__Host-og7-admin', secure: true };
  const result = response();
  setCookie(result, 'synthetic-session', 3600, secure);
  assert.equal(
    result.headers['Set-Cookie'],
    '__Host-og7-admin=synthetic-session; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure'
  );
  setCookie(result, '', 0, secure, '__Host-og7-admin-login');
  assert.equal(
    result.headers['Set-Cookie'],
    '__Host-og7-admin-login=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure'
  );
  setCookie(result, 'synthetic-local', 300, {
    cookieName: 'og7-admin',
    secure: false
  });
  assert.equal(
    result.headers['Set-Cookie'],
    'og7-admin=synthetic-local; Path=/; HttpOnly; SameSite=Lax; Max-Age=300'
  );
});

test('identity JSON and redirects prevent caching and referrer disclosure', () => {
  const result = response();
  json(result, 401, { error: 'Sign-in required.' });
  assert.equal(result.status, 401);
  assert.equal(result.headers['Content-Type'], 'application/json');
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.headers['Referrer-Policy'], 'no-referrer');
  assert.deepEqual(JSON.parse(result.body), { error: 'Sign-in required.' });

  const moved = response();
  redirect(moved, '/admin/login?identityError=1');
  assert.equal(moved.status, 303);
  assert.equal(moved.headers.Location, '/admin/login?identityError=1');
  assert.equal(moved.headers['Cache-Control'], 'no-store');
  assert.equal(moved.headers['Referrer-Policy'], 'no-referrer');
  assert.equal(moved.body, undefined);
});

test('access changes accept only JSON objects and preserve syntax and stream errors', async () => {
  assert.deepEqual(
    await readAccessChange(
      Readable.from([Buffer.from('{"subject":'), Buffer.from('"owner"}')])
    ),
    { subject: 'owner' }
  );
  for (const body of ['null', '[]', '"subject"', 'true', '42']) {
    await assert.rejects(
      readAccessChange(Readable.from([body])),
      { message: 'Invalid account' },
      body
    );
  }
  for (const body of ['', '{']) {
    await assert.rejects(readAccessChange(Readable.from([body])), SyntaxError);
  }
  const unavailable = new Error('Synthetic stream failure');
  await assert.rejects(
    readAccessChange(
      Readable.from(
        (async function* () {
          yield '{';
          throw unavailable;
        })()
      )
    ),
    (error) => error === unavailable
  );
});

test('access changes retain the 4096-character body boundary across chunks', async () => {
  const body = '{"subject":"owner"}'.padEnd(4096, ' ');
  assert.deepEqual(
    await readAccessChange(
      Readable.from([body.slice(0, 2048), body.slice(2048)])
    ),
    { subject: 'owner' }
  );
  await assert.rejects(readAccessChange(Readable.from([body, ' '])), {
    message: 'Body too large'
  });
});

test('access confirmation matches the exact session or subject with session priority', () => {
  assert.equal(
    hasAccessConfirmation({ subject: ' owner ', confirmation: ' owner ' }),
    true
  );
  assert.equal(
    hasAccessConfirmation({ subject: ' owner ', confirmation: 'owner' }),
    false
  );
  assert.equal(
    hasAccessConfirmation({
      sessionId: 'session',
      subject: 'owner',
      confirmation: 'owner'
    }),
    false
  );
  assert.equal(
    hasAccessConfirmation({
      sessionId: 'session',
      subject: 'owner',
      confirmation: 'session'
    }),
    true
  );
  assert.equal(
    hasAccessConfirmation({
      sessionId: null,
      subject: 'owner',
      confirmation: 'owner'
    }),
    true
  );
  for (const target of ['', 0, false, {}, []]) {
    assert.equal(
      hasAccessConfirmation({
        sessionId: target,
        subject: 'owner',
        confirmation: target
      }),
      false
    );
  }
  assert.equal(hasAccessConfirmation({ subject: 'owner' }), false);
  assert.equal(hasAccessConfirmation({}), false);
});

test('account parsing validates role and types, preserves subject and trims only display name', () => {
  const input = {
    subject: ' synthetic-owner ',
    displayName: ' Synthetic Owner ',
    role: 'owner',
    disabled: false,
    confirmation: ' synthetic-owner '
  };
  assert.deepEqual(parseAdminAccountInput(input), {
    subject: ' synthetic-owner ',
    displayName: 'Synthetic Owner',
    role: 'owner',
    disabled: false
  });
  assert.equal(input.displayName, ' Synthetic Owner ');
  for (const role of ['reader', 'operator', 'owner']) {
    assert.equal(parseAdminAccountInput({ ...input, role }).role, role);
  }
  for (const change of [
    { subject: '' },
    { subject: ' ' },
    { subject: 42 },
    { subject: 's'.repeat(256) },
    { displayName: '' },
    { displayName: ' ' },
    { displayName: 42 },
    { displayName: 'd'.repeat(121) },
    { displayName: ` ${'d'.repeat(119)} ` },
    { role: 'Owner' },
    { role: 'unknown' },
    { role: 42 },
    { disabled: 'false' },
    { disabled: 0 },
    { disabled: undefined }
  ]) {
    assert.throws(() => parseAdminAccountInput({ ...input, ...change }), {
      message: 'Invalid account'
    });
  }
  assert.deepEqual(
    parseAdminAccountInput({
      subject: 's'.repeat(255),
      displayName: 'd'.repeat(120),
      role: 'reader',
      disabled: true
    }),
    {
      subject: 's'.repeat(255),
      displayName: 'd'.repeat(120),
      role: 'reader',
      disabled: true
    }
  );
});
