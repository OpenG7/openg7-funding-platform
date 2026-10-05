import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { createAdminTokenSessionService } from '../dist/apps/funding-api/src/admin-token-session.js';

const prefix = 'openg7-admin-session.';
const now = Date.UTC(2026, 9, 2, 12);
const config = Object.freeze({
  adminToken: 'synthetic-root-admin-token-32-characters',
  sessionSecret: 'synthetic-admin-session-secret-32-characters',
  sessionTtlMinutes: 15,
  isProduction: false,
  projectId: 'synthetic-project'
});
const payload = Object.freeze({
  actor: 'funding-admin-session',
  exp: now + config.sessionTtlMinutes * 60 * 1000,
  iat: now,
  nonce: 's'.repeat(22),
  v: 1
});
const signEncoded = (encoded, secret = config.sessionSecret) =>
  `${prefix}${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
const signedToken = (value, secret) =>
  signEncoded(Buffer.from(JSON.stringify(value)).toString('base64url'), secret);

test('token sessions retain the existing prefix, HMAC payload and public expiry response', () => {
  const service = createAdminTokenSessionService(config);
  const response = service.createAdminSession(now);
  assert.equal(response.actor, 'funding-admin-session');
  assert.equal(response.expiresAt, new Date(payload.exp).toISOString());
  assert.equal(response.ttlSeconds, 15 * 60);
  assert.ok(response.sessionToken.startsWith(prefix));

  const [encoded, signature] = response.sessionToken
    .slice(prefix.length)
    .split('.');
  const decoded = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8')
  );
  assert.deepEqual(decoded, { ...payload, nonce: decoded.nonce });
  assert.equal(
    signature,
    createHmac('sha256', config.sessionSecret)
      .update(encoded)
      .digest('base64url')
  );
  assert.deepEqual(
    service.verifyAdminSession(response.sessionToken, now),
    decoded
  );
  assert.deepEqual(
    service.verifyAdminSession(signedToken(payload), now),
    payload
  );
  assert.doesNotMatch(
    JSON.stringify(response),
    /synthetic-root-admin-token|synthetic-admin-session-secret/
  );
});

test('sessions issued at the same instant have separate random 16-byte nonces', () => {
  const service = createAdminTokenSessionService(config);
  const first = service.createAdminSession(now);
  const second = service.createAdminSession(now);
  const firstPayload = service.verifyAdminSession(first.sessionToken, now);
  const secondPayload = service.verifyAdminSession(second.sessionToken, now);
  for (const value of [firstPayload, secondPayload]) {
    assert.match(value.nonce, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(Buffer.from(value.nonce, 'base64url').length, 16);
    assert.equal(value.iat, now);
    assert.equal(value.exp, payload.exp);
  }
  assert.notEqual(firstPayload.nonce, secondPayload.nonce);
  assert.notEqual(first.sessionToken, second.sessionToken);
});

test('token sessions expire at the expiry instant and never renew during verification', () => {
  const service = createAdminTokenSessionService(config);
  const candidate = signedToken(payload);
  assert.deepEqual(
    service.verifyAdminSession(candidate, payload.exp - 1),
    payload
  );
  assert.equal(service.verifyAdminSession(candidate, payload.exp), null);
  assert.equal(service.verifyAdminSession(candidate, payload.exp + 1), null);
});

test('token session verification refuses tampering, wrong secrets and malformed tokens', () => {
  const service = createAdminTokenSessionService(config);
  const valid = signedToken(payload);
  const [encoded, signature] = valid.slice(prefix.length).split('.');
  const changedEncoded = Buffer.from(
    JSON.stringify({ ...payload, exp: payload.exp + 60000 })
  ).toString('base64url');
  const changedSignature =
    (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  for (const candidate of [
    '',
    config.adminToken,
    `wrong-prefix.${encoded}.${signature}`,
    prefix,
    `${prefix}.${signature}`,
    `${prefix}${encoded}.`,
    `${prefix}${encoded}.short`,
    `${valid}.extra`,
    `${prefix}${encoded}.${changedSignature}`,
    `${prefix}${changedEncoded}.${signature}`,
    signedToken(payload, 'synthetic-other-secret'),
    signedToken(payload, config.adminToken),
    signEncoded(Buffer.from('{invalid-json').toString('base64url'))
  ]) {
    assert.equal(service.verifyAdminSession(candidate, now), null);
  }
  assert.equal(
    createAdminTokenSessionService({
      ...config,
      sessionSecret: 'synthetic-other-secret-32-characters'
    }).verifyAdminSession(valid, now),
    null
  );
});

test('signed sessions still require the expected actor, version and integer timestamps', () => {
  const service = createAdminTokenSessionService(config);
  for (const invalid of [
    { actor: 'other-actor' },
    { actor: undefined },
    { v: 2 },
    { v: '1' },
    { v: undefined },
    { iat: String(now) },
    { iat: now + 0.5 },
    { iat: null },
    { iat: undefined },
    { exp: String(payload.exp) },
    { exp: payload.exp + 0.5 },
    { exp: null },
    { exp: undefined },
    { exp: now - 1 },
    { exp: now },
    { iat: now + 1 },
    { exp: payload.exp + 1 },
    { nonce: undefined },
    { nonce: 'short' },
    { nonce: '!'.repeat(22) }
  ]) {
    assert.equal(
      service.verifyAdminSession(signedToken({ ...payload, ...invalid }), now),
      null
    );
  }
});

test('absent credentials and production never fall back to the root token or public project ID', () => {
  for (const overrides of [
    { adminToken: '', sessionSecret: '' },
    { adminToken: '', sessionSecret: '', projectId: 'known-public-project' },
    { isProduction: true }
  ]) {
    const service = createAdminTokenSessionService({ ...config, ...overrides });
    assert.equal(service.createAdminSession(now), null);
    assert.equal(service.verifyAdminSession(signedToken(payload), now), null);
    assert.equal(service.adminTokenMatches(''), false);
  }
});

test('token sessions reject weak, missing or shared signing credentials and unbounded durations', () => {
  for (const overrides of [
    { adminToken: 'short' },
    { sessionSecret: 'short' },
    { adminToken: '' },
    { sessionSecret: '' },
    { sessionSecret: config.adminToken },
    { sessionTtlMinutes: 0 },
    { sessionTtlMinutes: 61 },
    { sessionTtlMinutes: 1.5 }
  ])
    assert.throws(
      () => createAdminTokenSessionService({ ...config, ...overrides }),
      /FUNDING_ADMIN_/
    );
  for (const value of [null, [], 'value'])
    assert.equal(
      createAdminTokenSessionService(config).verifyAdminSession(
        signedToken(value),
        now
      ),
      null
    );
});

test('OIDC disables legacy token credentials without validating or falling back to them', () => {
  const service = createAdminTokenSessionService({
    ...config,
    enabled: false,
    adminToken: 'unused-short-root',
    sessionSecret: 'unused-short-secret',
    sessionTtlMinutes: 120
  });
  assert.equal(service.adminTokenMatches('unused-short-root'), false);
  assert.equal(service.createAdminSession(now), null);
  assert.equal(service.verifyAdminSession(signedToken(payload), now), null);
});

test('static admin tokens require the exact configured value and refuse absent configuration', () => {
  const service = createAdminTokenSessionService(config);
  assert.equal(service.adminTokenMatches(config.adminToken), true);
  for (const candidate of [
    '',
    config.adminToken.slice(1),
    config.adminToken + 'x',
    'x' + config.adminToken.slice(1),
    ' ' + config.adminToken,
    signedToken(payload)
  ]) {
    assert.equal(service.adminTokenMatches(candidate), false);
  }
  const unconfigured = createAdminTokenSessionService({
    ...config,
    adminToken: '',
    sessionSecret: ''
  });
  assert.equal(unconfigured.adminTokenMatches(''), false);
  assert.equal(unconfigured.adminTokenMatches(config.adminToken), false);
});

test('the session service keeps a snapshot of the configuration supplied at startup', () => {
  const mutableConfig = { ...config };
  const service = createAdminTokenSessionService(mutableConfig);
  mutableConfig.adminToken = 'synthetic-replacement-token';
  mutableConfig.sessionSecret = 'synthetic-replacement-secret';
  mutableConfig.sessionTtlMinutes = 1;
  assert.equal(service.adminTokenMatches(config.adminToken), true);
  assert.equal(service.createAdminSession(now).ttlSeconds, 15 * 60);
  assert.deepEqual(
    service.verifyAdminSession(signedToken(payload), now),
    payload
  );
});
