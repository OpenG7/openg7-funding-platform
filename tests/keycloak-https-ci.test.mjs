import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/admin-acceptance.yml', import.meta.url),
  'utf8'
);
const job = (name) => {
  const block = workflow.match(
    new RegExp(
      `^  ${name}:\\r?\\n(?:(?!^  [a-zA-Z_][a-zA-Z0-9_]*:)[\\s\\S])*`,
      'm'
    )
  )?.[0];
  assert.ok(block, `The required ${name} acceptance job must exist.`);
  return block;
};

test('the HTTPS local password and MFA restoration rehearsal runs unconditionally in acceptance CI', () => {
  const https = job('keycloak_https');
  assert.doesNotMatch(https, /^    (?:if|continue-on-error|strategy):/m);
  assert.match(https, /^    runs-on: ubuntu-24\.04$/m);
  const command =
    'node --test tests/identity/keycloak-local-password.integration.mjs';
  const steps = https.split(/^      - /m);
  const selected = steps.filter((step) => step.includes(`run: ${command}`));
  assert.equal(selected.length, 1, `Execute ${command} exactly once.`);
  assert.ok(selected[0].split(/\r?\n/).includes(`        run: ${command}`));
  assert.doesNotMatch(selected[0], /^\s+(?:if|continue-on-error):/m);
  assert.match(selected[0], /NODE_EXTRA_CA_CERTS:/);
  assert.doesNotMatch(
    https,
    /NODE_TLS_REJECT_UNAUTHORIZED|ignoreHTTPSErrors|ignore-certificate-errors|curl\s+-[^\s]*k\b/
  );
});

test('the aggregate acceptance gate requires the HTTPS job to succeed', () => {
  const acceptance = job('acceptance');
  assert.match(
    acceptance,
    /^    needs:\s*\[[\s\S]*?\bkeycloak_https\b[\s\S]*?\]/m
  );
  assert.match(
    acceptance,
    /KEYCLOAK_HTTPS_RESULT: \$\{\{ needs\.keycloak_https\.result \}\}/
  );
  assert.match(acceptance, /test "\$KEYCLOAK_HTTPS_RESULT" = success/);
});

test('HTTPS CI creates its own CA under runner temporary storage and uploads only test evidence', () => {
  const https = job('keycloak_https');
  assert.match(
    https,
    /CAROOT: \$\{\{ runner\.temp \}\}\/openg7-keycloak-ci-ca/
  );
  assert.match(
    https,
    /OPENG7_TEST_TLS_DIRECTORY: \$\{\{ runner\.temp \}\}\/openg7-keycloak-ci-tls/
  );
  assert.match(https, /certutil -N --empty-password/);
  assert.match(https, /^          mkcert -install$/m);
  assert.match(https, /^            mkcert -uninstall$/m);
  const artifacts = https
    .split(/^      - /m)
    .filter((step) => step.includes('actions/upload-artifact@'));
  assert.equal(artifacts.length, 1);
  assert.match(artifacts[0], /^          path: test-results\/$/m);
  assert.doesNotMatch(
    artifacts[0],
    /rootCA|CAROOT|TLS_DIRECTORY|runner\.temp|\.env/
  );
});
