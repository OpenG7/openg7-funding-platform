import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { resolveStripeExecutable } from '../scripts/lib/stripe-cli.mjs';

const fixture = (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'og7-stripe-cli-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('og7-stripe-cli-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const file = (relative, content = '') => {
    const path = join(directory, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return path;
  };
  return { directory, file };
};

test('POSIX uses PATH without a Windows resolver', () => {
  assert.equal(
    resolveStripeExecutable(
      {},
      {
        platform: 'linux',
        findExecutables: () =>
          assert.fail('must not resolve a Windows launcher')
      }
    ),
    'stripe'
  );
});

test('Windows prefers an existing native executable over npm launchers', (t) => {
  const f = fixture(t);
  const native = f.file('stripe.exe');
  const env = { PATH: 'synthetic PATH' };
  assert.equal(
    resolveStripeExecutable(env, {
      platform: 'win32',
      findExecutables: (name, passedEnv) => {
        assert.equal(name, 'stripe.exe');
        assert.equal(passedEnv, env);
        return [join(f.directory, 'absent.exe'), native];
      }
    }),
    native
  );
});

for (const installation of ['architecture-package', 'vendor']) {
  test(`Windows resolves npm's ${installation} native binary without running the shim`, (t) => {
    const f = fixture(t);
    const launcher = f.file('stripe.cmd');
    f.file('node_modules/@stripe/cli/package.json', '{"name":"@stripe/cli"}');
    const native =
      installation === 'vendor'
        ? f.file('node_modules/@stripe/cli/vendor/bin/stripe.exe')
        : f.file('node_modules/@stripe/cli-win32-x64/bin/stripe.exe');
    if (installation !== 'vendor')
      f.file(
        'node_modules/@stripe/cli-win32-x64/package.json',
        '{"name":"@stripe/cli-win32-x64"}'
      );
    assert.equal(
      resolveStripeExecutable(
        {},
        {
          platform: 'win32',
          arch: 'x64',
          findExecutables: (name) => (name === 'stripe.cmd' ? [launcher] : [])
        }
      ),
      native
    );
    assert.notEqual(native, launcher);
  });
}

test('Windows fails explicitly when npm has no native binary', (t) => {
  const f = fixture(t);
  const launcher = f.file('stripe.cmd');
  assert.throws(
    () =>
      resolveStripeExecutable(
        {},
        {
          platform: 'win32',
          findExecutables: (name) => (name === 'stripe.cmd' ? [launcher] : [])
        }
      ),
    /Stripe CLI introuvable/
  );
});
