import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';

import { assertExistingMkcertCa } from './keycloak-local-https-stack.mjs';

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
