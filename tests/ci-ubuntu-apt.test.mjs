import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  aptDownloadLimits,
  prepareUbuntuApt,
  rewriteAptSource
} from '../scripts/prepare-ubuntu-apt.mjs';

const azure = 'http://azure.archive.ubuntu.com/ubuntu/';
const official = 'https://archive.ubuntu.com/ubuntu/';

function fixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openg7-ci-apt-'));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(root.includes('openg7-ci-apt-'));
    rmSync(root, { recursive: true, force: true });
  });
  const contents = {
    'etc/os-release': 'ID=ubuntu\nVERSION_ID="24.04"\n',
    'etc/apt/sources.list': `deb ${azure} noble main universe\n`,
    ...files
  };
  mkdirSync(join(root, 'etc/apt/apt.conf.d'), { recursive: true });
  for (const [path, value] of Object.entries(contents)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  return {
    root,
    prepare: (apply = false) =>
      prepareUbuntuApt({ root, platform: 'linux', apply }),
    read: (path) => readFileSync(join(root, path), 'utf8')
  };
}

test('deb822 updates only Ubuntu archive URI tokens and preserves signing keys, options and third-party sources', () => {
  const original = [
    '# Preserve this source comment: ' + azure,
    'Types: deb deb-src',
    'URIs: ' + azure,
    ' https://security.ubuntu.com/ubuntu/',
    'Suites: noble noble-updates noble-security noble-backports',
    'Components: main restricted universe multiverse',
    'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg',
    'Architectures: amd64 i386',
    '',
    'Types: deb',
    'URIs: https://packages.example.test/ubuntu',
    'Suites: stable',
    'Signed-By:',
    ' -----BEGIN PGP PUBLIC KEY BLOCK-----',
    ' synthetic-key',
    ' -----END PGP PUBLIC KEY BLOCK-----',
    'Enabled: no',
    ''
  ].join('\r\n');
  const expected = original.replace('URIs: ' + azure, 'URIs: ' + official);
  assert.equal(rewriteAptSource(original, 'sources').contents, expected);
  assert.equal(rewriteAptSource(expected, 'sources').contents, expected);
});

test('one-line sources retain options, components and comments without changing unrelated hosts or paths', () => {
  const original = [
    `deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu.gpg] ${azure} noble main # ${azure}`,
    `deb-src https://azure.archive.ubuntu.com/ubuntu noble-updates universe`,
    '# deb ' + azure + ' noble main',
    'deb https://azure.archive.ubuntu.com.example.test/ubuntu noble main',
    'deb https://packages.example.test/custom/ubuntu stable main',
    ''
  ].join('\n');
  const expected = original
    .replace('] ' + azure, '] ' + official)
    .replace(
      'deb-src https://azure.archive.ubuntu.com',
      'deb-src https://archive.ubuntu.com'
    );
  assert.equal(rewriteAptSource(original, 'list').contents, expected);
  assert.equal(rewriteAptSource(expected, 'list').contents, expected);
});

test('GitHub mirror+file priorities retain official fallbacks and metadata while avoiding Azure', (t) => {
  const mirrorPath = 'etc/apt/apt-mirrors.txt';
  const mirrorContents = [
    azure + '\tpriority:1',
    official + '\tpriority:2',
    'https://security.ubuntu.com/ubuntu/\tpriority:3',
    '# ' + azure,
    ''
  ].join('\n');
  const f = fixture(t, {
    'etc/apt/sources.list': '',
    'etc/apt/sources.list.d/ubuntu.sources':
      'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n',
    [mirrorPath]: mirrorContents
  });
  const originalSource = f.read('etc/apt/sources.list.d/ubuntu.sources');
  assert.equal(f.prepare().length, 2);
  assert.equal(f.read(mirrorPath), mirrorContents, 'Dry run never writes.');
  assert.equal(f.prepare(true).length, 2);
  assert.equal(f.read(mirrorPath), mirrorContents.replace(azure, official));
  assert.equal(f.read('etc/apt/sources.list.d/ubuntu.sources'), originalSource);
  assert.equal(
    f.read('etc/apt/apt.conf.d/99-openg7-ci-downloads'),
    aptDownloadLimits
  );
  assert.deepEqual(f.prepare(true), []);
  assert.equal(
    readdirSync(join(f.root, 'etc/apt')).some((name) =>
      name.includes('.openg7-')
    ),
    false
  );
});

test('a referenced local mirror list is discovered from one-line sources too', (t) => {
  const f = fixture(t, {
    'etc/apt/sources.list':
      'deb mirror+file:/etc/apt/custom-mirrors.txt noble main\n',
    'etc/apt/custom-mirrors.txt': azure + '\tpriority:1\n'
  });
  f.prepare(true);
  assert.equal(
    f.read('etc/apt/custom-mirrors.txt'),
    official + '\tpriority:1\n'
  );
  assert.deepEqual(f.prepare(true), []);
});

test('unexpected platforms and Ubuntu versions are refused without source changes', (t) => {
  const f = fixture(t, { 'etc/os-release': 'ID=ubuntu\nVERSION_ID="22.04"\n' });
  assert.throws(() => f.prepare(true), /Ubuntu 24\.04/);
  assert.throws(
    () => prepareUbuntuApt({ root: f.root, platform: 'win32', apply: true }),
    /Linux/
  );
  writeFileSync(
    join(f.root, 'etc/os-release'),
    'ID=debian\nVERSION_ID="24.04"\n'
  );
  assert.throws(() => f.prepare(true), /Ubuntu 24\.04/);
  assert.equal(
    f.read('etc/apt/sources.list'),
    `deb ${azure} noble main universe\n`
  );
  assert.equal(
    existsSync(join(f.root, 'etc/apt/apt.conf.d/99-openg7-ci-downloads')),
    false
  );
});

test('unsafe, missing or unsupported mirror lists fail before any planned source rewrite is applied', (t) => {
  for (const uri of [
    'mirror+file:/tmp/outside.txt',
    'mirror+file:/etc/apt/%2e%2e%2foutside.list',
    'mirror+file://remote.example.test/etc/apt/mirrors.txt',
    'mirror+file:/etc/apt/missing.txt',
    'mirror+file:/etc/apt/compressed.txt.gz'
  ]) {
    const f = fixture(t, {
      'etc/apt/sources.list.d/ubuntu.sources': `Types: deb\nURIs: ${uri}\nSuites: noble\n`
    });
    assert.throws(() => f.prepare(true));
    assert.equal(
      f.read('etc/apt/sources.list'),
      `deb ${azure} noble main universe\n`
    );
    assert.equal(
      existsSync(join(f.root, 'etc/apt/apt.conf.d/99-openg7-ci-downloads')),
      false
    );
  }
});

test('unrecognized source formats and archive paths are refused before any writes', (t) => {
  for (const [name, contents] of [
    ['invalid.list', 'Types: deb\nURIs: ' + azure + '\n'],
    ['invalid.sources', 'URIs ' + azure + '\n'],
    ['invalid.list', 'deb http://azure.archive.ubuntu.com/custom noble main\n']
  ]) {
    const f = fixture(t, { ['etc/apt/sources.list.d/' + name]: contents });
    assert.throws(() => f.prepare(true), /Unsupported/);
    assert.equal(
      f.read('etc/apt/sources.list'),
      `deb ${azure} noble main universe\n`
    );
  }
  assert.throws(
    () => rewriteAptSource('mirror+file:/etc/apt/other.txt\n', 'mirrors'),
    /Nested/
  );
});

test('a missing configuration directory fails before sources are changed', (t) => {
  const f = fixture(t);
  rmdirSync(join(f.root, 'etc/apt/apt.conf.d'));
  assert.throws(() => f.prepare(true));
  assert.equal(
    f.read('etc/apt/sources.list'),
    `deb ${azure} noble main universe\n`
  );
});

test('every APT or Playwright dependency installation is prepared once and has a failing duration bound', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/admin-acceptance.yml', import.meta.url),
    'utf8'
  );
  const jobs = workflow.split(/^  (?=[a-zA-Z_][a-zA-Z0-9_]*:)/m).slice(1);
  let preparedJobs = 0;
  for (const job of jobs) {
    const steps = job.split(/^      - /m).slice(1);
    const installations = steps.filter((step) =>
      /apt-get|playwright install --with-deps/.test(step)
    );
    if (!installations.length) continue;
    ++preparedJobs;
    const preparations = steps.filter((step) =>
      step.includes('uses: ./.github/actions/prepare-ubuntu-apt')
    );
    assert.equal(preparations.length, 1, job.split('\n')[0]);
    for (const step of installations) {
      assert.ok(steps.indexOf(preparations[0]) < steps.indexOf(step));
      assert.match(step, /timeout-minutes: (10|15)\b/);
      assert.doesNotMatch(step, /continue-on-error|\|\|\s*(?:true|echo)/);
    }
  }
  assert.equal(preparedJobs, 10);
  const action = readFileSync(
    new URL(
      '../.github/actions/prepare-ubuntu-apt/action.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(action, /set -euo pipefail/);
  assert.match(action, /--apply/);
  assert.doesNotMatch(
    action + aptDownloadLimits,
    /AllowInsecure|Verify-Peer|Verify-Host|trusted=yes|continue-on-error|\|\|\s*true/
  );
});
