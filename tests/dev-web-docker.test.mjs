import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { localDevWebConfiguration } from '../scripts/lib/dev-web-docker.mjs';
import { localTraefikConfiguration } from '../scripts/lib/local-identity.mjs';

const source = localTraefikConfiguration(
  readFileSync(new URL('../traefik/dynamic.yml', import.meta.url), 'utf8')
);

test('help and recovery remain available without Stripe credentials, CLI or Docker', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'og7-web-gateway-cli-'));
  mkdirSync(join(directory, 'scripts/lib'), { recursive: true });
  const files = [
    'dev-web-docker.mjs',
    'lib/dev-web-docker.mjs',
    'lib/dev-web-stripe.mjs',
    'lib/dev-web-gateway-control.mjs',
    'lib/docker-environment.mjs',
    'lib/local-identity.mjs',
    'lib/keycloak-config.mjs',
    'lib/local-password-policy.mjs',
    'lib/stripe-cli.mjs'
  ];
  t.after(() => {
    for (const file of files) {
      const path = join(directory, 'scripts', file);
      if (existsSync(path)) unlinkSync(path);
    }
    rmdirSync(join(directory, 'scripts/lib'));
    rmdirSync(join(directory, 'scripts'));
    rmdirSync(directory);
  });
  for (const file of files)
    copyFileSync(
      new URL(`../scripts/${file}`, import.meta.url),
      join(directory, 'scripts', file)
    );
  for (const [args, status, message] of [
    [['--help'], 0, /managed Stripe test relay/],
    [['--stop'], 0, /already stopped/],
    [['--restore'], 0, /^$/],
    [['--stop', '--no-stripe-webhook'], 1, /Usage:/],
    [['--live'], 1, /Usage:/]
  ]) {
    const result = spawnSync(
      process.execPath,
      [join(directory, 'scripts/dev-web-docker.mjs'), ...args],
      {
        cwd: directory,
        env: {
          ...process.env,
          PATH: directory,
          STRIPE_SECRET_KEY: 'sk_live_privatecanary',
          STRIPE_WEBHOOK_SECRET: ''
        },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000
      }
    );
    assert.equal(result.status, status, result.stderr);
    assert.match(result.stdout + result.stderr, message);
    assert.doesNotMatch(result.stdout + result.stderr, /privatecanary/);
    assert.equal(existsSync(join(directory, 'traefik')), false);
  }
});

const block = (configuration, section, name) => {
  const sectionStart = configuration.indexOf(`\n  ${section}:\n`);
  assert.notEqual(sectionStart, -1);
  const following = configuration.slice(sectionStart + 1);
  const sectionEnd = following.search(/\n  [a-zA-Z][\w-]*:/);
  const content = sectionEnd < 0 ? following : following.slice(0, sectionEnd);
  const entry = content.match(
    new RegExp(`^    ${name}:\\n(?: {6}[^\\n]*\\n|\\n)*`, 'm')
  );
  assert.ok(entry, `Missing ${section}.${name}`);
  return entry[0];
};

test('gateway preserves all existing TLS, API, Web and middleware configuration', () => {
  const configured = localDevWebConfiguration(source);
  const router = block(configured, 'routers', 'openg7-angular-dev');
  const service = block(configured, 'services', 'openg7-angular-dev');

  assert.equal(configured.replace(router, '').replace(service, ''), source);
  for (const name of [
    'openg7-api-local',
    'openg7-stripe-webhook-local',
    'openg7-checkout-local',
    'openg7-sponsor-media-upload-local',
    'openg7-sponsor-logo-upload-local',
    'openg7-web-local'
  ])
    assert.equal(
      block(configured, 'routers', name),
      block(source, 'routers', name)
    );
});

test('only localhost Web traffic uses Angular, preserving HTTPS and API priority', () => {
  const configured = localDevWebConfiguration(source);
  const router = block(configured, 'routers', 'openg7-angular-dev');
  const service = block(configured, 'services', 'openg7-angular-dev');

  assert.match(router, /rule: 'Host\(`localhost`\) && !PathPrefix\(`\/api`\)'/);
  assert.match(router, /entryPoints:\n        - websecure\n/);
  assert.match(router, /service: openg7-angular-dev\n/);
  assert.match(router, /tls: \{\}\n/);
  assert.match(
    router,
    /middlewares:\n        - secure-headers\n        - web-in-flight\n        - compress\n/
  );
  assert.doesNotMatch(router, /web-rate-limit|headers:|origin|websecure:/);

  const priority = Number(router.match(/priority: (\d+)/)[1]);
  assert.ok(
    priority >
      Number(
        block(source, 'routers', 'openg7-web-local').match(/priority: (\d+)/)[1]
      )
  );
  assert.ok(
    priority <
      Number(
        block(source, 'routers', 'openg7-api-local').match(/priority: (\d+)/)[1]
      )
  );
  assert.match(service, /passHostHeader: true\n/);
  assert.match(service, /url: 'http:\/\/host\.docker\.internal:4200'\n/);
  assert.doesNotMatch(service, /insecureSkipVerify|0\.0\.0\.0|https:\/\//);
});

test('Windows line endings survive insertion without mixed newlines', () => {
  const windows = source.replaceAll('\n', '\r\n');
  const configured = localDevWebConfiguration(windows);
  assert.equal(
    configured.replaceAll('\r\n', '\n'),
    localDevWebConfiguration(source)
  );
  assert.doesNotMatch(configured.replaceAll('\r\n', ''), /\n|\r/);
});

test('missing, duplicate or out-of-scope HTTP anchors fail without generating a gateway', () => {
  for (const invalid of [
    '',
    source.replace(/^http:/m, 'tcp:'),
    source.replace(/^  routers:/m, '  missingRouters:'),
    source.replace(/^  services:/m, '  missingServices:'),
    source + '\nhttp:\n',
    source + '\n  routers:\n',
    source + '\n  services:\n',
    source.replace(/^  services:/m, 'tcp:\n  services:'),
    'http:\n  services:\n    existing: {}\n  routers:\n    existing: {}\n'
  ])
    assert.throws(
      () => localDevWebConfiguration(invalid),
      /Missing or ambiguous local Traefik HTTP routing sections/
    );
});

test('existing gateway or reserved name is refused instead of duplicated', () => {
  for (const existing of [
    localDevWebConfiguration(source),
    source + '\n# openg7-angular-dev already managed elsewhere\n',
    null,
    undefined
  ])
    assert.throws(
      () => localDevWebConfiguration(existing),
      /Invalid or already configured local Angular gateway/
    );
});
