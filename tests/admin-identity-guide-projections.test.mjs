import assert from 'node:assert/strict';
import test from 'node:test';

import { projectIdentityGuideObservations } from '../dist/apps/funding-web/src/app/features/funding/components/admin-identity-setup/identity-setup-projections.js';

const identityFixture = () => ({
  mode: 'oidc',
  issuer: 'https://identity.example.invalid/realms/funding',
  callback_url: 'https://funding.example.invalid/api/admin/auth/callback',
  client_id_configured: true,
  client_secret_configured: true,
  owner_bootstrap_configured: true,
  mfa_policy: 'amr',
  private_data_encryption_configured: true
});

test('public and legacy guides distinguish unobserved identity from manual provider checks', () => {
  for (const status of [undefined, null]) {
    const observations = projectIdentityGuideObservations(status, null, null);
    assert.equal(observations.client, 'unknown');
    assert.equal(observations.environment, 'unknown');
    assert.equal(observations.database, 'unknown');
    for (const step of ['provider', 'mfa', 'deployment', 'verification'])
      assert.equal(observations[step], 'manual');
  }
});

test('token guides cannot infer OIDC readiness even with a reachable database', () => {
  const observations = projectIdentityGuideObservations(
    { ...identityFixture(), mode: 'token' },
    true,
    true
  );
  assert.equal(observations.client, 'manual');
  assert.equal(observations.environment, 'manual');
  assert.equal(observations.database, 'reported');
});

test('local OIDC presence leaves provider, MFA and access checks manual without changing the snapshot', () => {
  for (const mfa_policy of ['amr', 'acr']) {
    const status = {
      ...identityFixture(),
      mfa_policy,
      owner_bootstrap_configured: false
    };
    const before = structuredClone(status);
    Object.freeze(status);
    const observations = projectIdentityGuideObservations(status, true, true);
    assert.equal(observations.client, 'reported');
    assert.equal(observations.environment, 'reported');
    assert.equal(observations.database, 'reported');
    for (const step of ['provider', 'mfa', 'deployment', 'verification'])
      assert.equal(observations[step], 'manual');
    assert.deepEqual(status, before);
  }
});

test('client presence is separate from complete environment and database observations', () => {
  for (const missing of [
    { issuer: null },
    { issuer: ' ' },
    { private_data_encryption_configured: false }
  ]) {
    const observations = projectIdentityGuideObservations(
      { ...identityFixture(), ...missing },
      true,
      true
    );
    assert.equal(observations.client, 'reported');
    assert.equal(observations.environment, 'missing');
    assert.equal(observations.database, 'reported');
  }
  for (const missing of [
    { callback_url: null },
    { client_id_configured: false },
    { client_secret_configured: false }
  ]) {
    const observations = projectIdentityGuideObservations(
      { ...identityFixture(), ...missing },
      true,
      true
    );
    assert.equal(observations.client, 'missing');
    assert.equal(observations.environment, 'missing');
  }
});

test('a database step reports presence only when configuration and reachability are both known and true', () => {
  for (const [configured, reachable, expected] of [
    [null, null, 'unknown'],
    [null, true, 'unknown'],
    [true, null, 'unknown'],
    [null, false, 'unknown'],
    [false, null, 'unknown'],
    [false, false, 'missing'],
    [false, true, 'missing'],
    [true, false, 'missing'],
    [true, true, 'reported']
  ]) {
    const observations = projectIdentityGuideObservations(
      identityFixture(),
      configured,
      reachable
    );
    assert.equal(observations.database, expected);
    assert.equal(observations.environment, 'reported');
  }
});
