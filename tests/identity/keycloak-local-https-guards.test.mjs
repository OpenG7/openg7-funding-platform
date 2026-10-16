import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  assertExistingMkcertCa,
  localKeycloakFailureKind,
  localKeycloakProfileStage
} from './keycloak-local-https-stack.mjs';

const fixture = async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'og7-keycloak-ca-guard-'));
  t.after(async () => {
    const target = resolve(root);
    assert.ok(
      target.startsWith(resolve(tmpdir()) + sep + 'og7-keycloak-ca-guard-')
    );
    await rm(target, { recursive: true, force: true });
  });
  return root;
};

test('HTTPS rehearsal diagnostics classify failures without forwarding private errors', () => {
  const privateValue = 'SYNTHETIC_PRIVATE_CREDENTIAL_AND_HASH';
  for (const [error, expected] of [
    [
      Object.assign(new Error(privateValue), { code: 'ERR_ASSERTION' }),
      'assertion'
    ],
    [
      Object.assign(new Error(privateValue), { name: 'TimeoutError' }),
      'browser-timeout'
    ],
    [new SyntaxError(privateValue), 'invalid-json'],
    [new Error(privateValue), 'operation'],
    [
      { code: privateValue, name: privateValue, actual: privateValue },
      'operation'
    ],
    [undefined, 'operation']
  ]) {
    assert.equal(localKeycloakFailureKind(error), expected);
  }
});

test('HTTPS profile stages expose only fixed operations and valid HTTP status', () => {
  const privateInput = {
    url: 'https://private.example.test/realms/private/protocol/openid-connect/token?code=SYNTHETIC_PRIVATE_CODE',
    method: 'POST',
    headers: { Authorization: 'Bearer SYNTHETIC_PRIVATE_TOKEN' },
    body: 'password=SYNTHETIC_PRIVATE_PASSWORD'
  };
  assert.equal(
    localKeycloakProfileStage(privateInput, 401),
    'authenticate profile administrator (HTTP 401)'
  );
  assert.equal(
    localKeycloakProfileStage(
      { ...privateInput, url: 'invalid-private-url' },
      204
    ),
    'write Keycloak profile (HTTP 204)'
  );
  assert.equal(
    localKeycloakProfileStage({ method: 'GET' }, 200),
    'read Keycloak profile (HTTP 200)'
  );
  for (const status of [
    undefined,
    'private-status',
    '200',
    99,
    600,
    NaN,
    200.5
  ])
    assert.equal(
      localKeycloakProfileStage(privateInput, status),
      'authenticate profile administrator'
    );
});

test('the HTTPS rehearsal refuses an absent CA without creating one', async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    assertExistingMkcertCa(join(root, 'missing-ca')),
    /existing mkcert CA/
  );
  assert.deepEqual(await readdir(root), []);
});

test('the HTTPS rehearsal refuses a missing private key without generating it', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'rootCA.pem'), 'SYNTHETIC_CA_METADATA_FIXTURE');
  await assert.rejects(assertExistingMkcertCa(root), /existing mkcert CA/);
  assert.deepEqual(await readdir(root), ['rootCA.pem']);
});

test('the HTTPS rehearsal accepts existing CA files without installing or replacing them', async (t) => {
  const root = await fixture(t);
  // Only file presence is this guard's contract. The preparer separately checks
  // the real public certificate; this helper must not read the private CA key.
  await writeFile(join(root, 'rootCA.pem'), 'SYNTHETIC_CA_METADATA_FIXTURE');
  await writeFile(
    join(root, 'rootCA-key.pem'),
    'SYNTHETIC_PRIVATE_KEY_METADATA_FIXTURE'
  );
  await assertExistingMkcertCa(root);
  assert.deepEqual((await readdir(root)).sort(), [
    'rootCA-key.pem',
    'rootCA.pem'
  ]);
});
