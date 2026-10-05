import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const realm = JSON.parse(
  await readFile(
    new URL('../docker/keycloak/openg7-realm.json', import.meta.url),
    'utf8'
  )
);

test('Keycloak imports no accounts or secrets and restricts the confidential client to the exact API callback', () => {
  assert.equal(realm.realm, 'openg7');
  assert.equal(realm.sslRequired, 'all');
  assert.equal(realm.registrationAllowed, false);
  assert.equal(realm.users, undefined);
  assert.equal(realm.identityProviders, undefined);
  assert.equal(realm.clients.length, 1);
  const [client] = realm.clients;
  assert.equal(client.clientId, '${FUNDING_ADMIN_OIDC_CLIENT_ID}');
  assert.equal(client.secret, '${FUNDING_ADMIN_OIDC_CLIENT_SECRET}');
  assert.equal(client.publicClient, false);
  assert.equal(client.clientAuthenticatorType, 'client-secret');
  assert.deepEqual(client.redirectUris, [
    '${FUNDING_PUBLIC_BASE_URL}/api/admin/auth/callback'
  ]);
  assert.deepEqual(client.webOrigins, []);
  assert.equal(client.standardFlowEnabled, true);
  assert.equal(client.implicitFlowEnabled, false);
  assert.equal(client.directAccessGrantsEnabled, false);
  assert.equal(client.serviceAccountsEnabled, false);
  assert.equal(client.attributes['pkce.code.challenge.method'], 'S256');
});

test('Keycloak can attest MFA only through a successful required OTP execution after password verification', () => {
  const flow = realm.authenticationFlows.find(
    (candidate) => candidate.alias === realm.browserFlow
  );
  assert.ok(flow);
  assert.equal(flow.providerId, 'basic-flow');
  assert.equal(flow.topLevel, true);
  const executions = [...flow.authenticationExecutions].sort(
    (a, b) => a.priority - b.priority
  );
  assert.deepEqual(
    executions.map((execution) => execution.authenticator),
    ['auth-username-password-form', 'auth-otp-form']
  );
  assert.ok(
    executions.every(
      (execution) =>
        execution.requirement === 'REQUIRED' && !execution.authenticatorFlow
    )
  );
  const references = executions.map(
    (execution) =>
      realm.authenticatorConfig.find(
        (config) => config.alias === execution.authenticatorConfig
      )?.config
  );
  assert.deepEqual(
    references.map((config) => config['default.reference.value']),
    ['pwd', 'mfa']
  );
  assert.ok(
    references.every((config) => Number(config['default.reference.maxAge']) > 0)
  );
  assert.deepEqual(
    realm.clients[0].protocolMappers.map((mapper) => mapper.protocolMapper),
    ['oidc-amr-mapper']
  );
  assert.equal(
    realm.clients[0].protocolMappers[0].config['id.token.claim'],
    'true'
  );
  assert.equal(realm.clients[0].attributes['acr.loa.map'], undefined);
});
