import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const sha = 'a'.repeat(40);
const bash = (
  process.platform === 'win32'
    ? ['C:/Program Files/Git/bin/bash.exe', 'bash']
    : ['bash']
).find(
  (command) =>
    spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true })
      .status === 0
);

test('delivery publishes the full revision consumed by the VPS and serializes deployments', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  assert.equal(
    (workflow.match(/type=sha,prefix=,format=long/g) ?? []).length,
    2
  );
  assert.match(workflow, /--no-build --revision "\$\{\{ github.sha \}\}"/);
  assert.match(workflow, /group: production-delivery/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('deployment executes only the chosen checkout and rejects mismatches before Docker', () => {
  assert.ok(bash, 'Bash is required to validate deployment scripts');
  const root = mkdtempSync(path.join(tmpdir(), 'og7-deploy-test-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    writeFileSync(
      path.join(root, 'scripts/deploy.sh'),
      readFileSync('scripts/deploy.sh', 'utf8').replaceAll('\r\n', '\n')
    );
    writeFileSync(
      path.join(root, 'scripts/load-env.sh'),
      'set -a\nsource "$1"\nset +a\n'
    );
    writeFileSync(path.join(root, 'scripts/check.sh'), 'exit 0\n');
    writeFileSync(
      path.join(root, '.env'),
      `WEB_IMAGE=example/web:${sha}\nAPI_IMAGE=example/api:${sha}\n`
    );
    const wrapper = `git() { if [[ "$1" == rev-parse ]]; then echo "\${TEST_SHA}"; elif [[ "$1" == status ]]; then echo "\${TEST_DIRTY:-}"; else echo unexpected-git >&2; return 90; fi; }
docker() { echo "$*" >> docker-calls; }
export -f git docker
bash scripts/deploy.sh --no-build --revision "$1"`;
    const run = (env = {}, requested = sha) =>
      spawnSync(bash, ['-c', wrapper, 'test', requested], {
        cwd: root,
        env: {
          ...process.env,
          TEST_SHA: sha,
          TEST_DIRTY: '',
          DATABASE_URL: '',
          ...env
        },
        encoding: 'utf8',
        windowsHide: true
      });
    for (const [env, requested] of [
      [{ TEST_SHA: 'b'.repeat(40) }, sha],
      [{ TEST_DIRTY: ' M tracked' }, sha],
      [{}, 'invalid']
    ]) {
      const result = run(env, requested);
      assert.notEqual(result.status, 0);
    }
    assert.throws(() => readFileSync(path.join(root, 'docker-calls')), {
      code: 'ENOENT'
    });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      readFileSync(path.join(root, 'docker-calls'), 'utf8'),
      /compose up -d --no-build/
    );
    rmSync(path.join(root, 'docker-calls'));
    writeFileSync(
      path.join(root, '.env'),
      'WEB_IMAGE=example/web:latest\nAPI_IMAGE=example/api:latest\n'
    );
    assert.notEqual(run().status, 0);
    assert.throws(() => readFileSync(path.join(root, 'docker-calls')), {
      code: 'ENOENT'
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
