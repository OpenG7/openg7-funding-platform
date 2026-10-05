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

test('delivery requires a verified host pin before SSH', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  assert.match(
    workflow,
    /fingerprint: \$\{\{ secrets\.VPS_SSH_FINGERPRINT \}\}/
  );
  const validation = workflow.match(
    /run: \|\n( +\[\[ "\$\{VPS_SSH_FINGERPRINT\}"[\s\S]*?\n +\})/
  )[1];
  for (const fingerprint of ['', 'unverified', 'SHA256:short']) {
    const result = spawnSync(bash, ['-c', validation], {
      env: { ...process.env, VPS_SSH_FINGERPRINT: fingerprint },
      encoding: 'utf8',
      windowsHide: true
    });
    assert.notEqual(result.status, 0);
  }
  const result = spawnSync(bash, ['-c', validation], {
    env: { ...process.env, VPS_SSH_FINGERPRINT: 'SHA256:' + 'a'.repeat(43) },
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
});

test('delivery replaces configuration atomically and preserves it on preparation failure', () => {
  assert.ok(bash, 'Bash is required to validate deployment scripts');
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const preparation = workflow.slice(
    workflow.indexOf('            ENV_STAGE='),
    workflow.indexOf('            echo "${GHCR_TOKEN}"')
  );
  const root = mkdtempSync(path.join(tmpdir(), 'og7-env-delivery-'));
  try {
    const original = 'ORIGINAL=synthetic\n';
    const run = (failure = false) => {
      writeFileSync(path.join(root, '.env'), original);
      return spawnSync(
        bash,
        [
          '-c',
          `set -Eeuo pipefail
umask 077
${failure ? 'awk() { return 42; }' : ''}
mv() {
  [[ "$(cat .env)" == ORIGINAL=synthetic ]] || exit 81
  stat -c '%a' "$2" > staging-mode
  command mv "$@"
}
${preparation}`
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            PRODUCTION_ENV:
              'SYNTHETIC_SECRET=fixture\nWEB_IMAGE=old-web\nAPI_IMAGE=old-api',
            WEB_IMAGE: 'synthetic/web:' + sha,
            API_IMAGE: 'synthetic/api:' + sha
          },
          encoding: 'utf8',
          windowsHide: true
        }
      );
    };
    const success = run();
    assert.equal(success.status, 0, success.stderr);
    assert.equal(
      readFileSync(path.join(root, '.env'), 'utf8'),
      `SYNTHETIC_SECRET=fixture\nWEB_IMAGE=synthetic/web:${sha}\nAPI_IMAGE=synthetic/api:${sha}\n`
    );
    if (process.platform !== 'win32') {
      assert.equal(
        readFileSync(path.join(root, 'staging-mode'), 'utf8').trim(),
        '600'
      );
    }
    assert.notEqual(run(true).status, 0);
    assert.equal(readFileSync(path.join(root, '.env'), 'utf8'), original);
    assert.equal(
      spawnSync(bash, ['-c', 'compgen -G ".env.deploy.*"'], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true
      }).status,
      1
    );
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  }
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
    for (const name of [
      'deployment-compose.sh',
      'deployment-image-revision.sh',
      'rollback.sh'
    ])
      writeFileSync(
        path.join(root, 'scripts', name),
        readFileSync('scripts/' + name, 'utf8').replaceAll('\r\n', '\n')
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
docker() { echo "$*" >> docker-calls; case "$*" in *'images -q web'|*'images -q api') echo synthetic-image ;; 'image inspect --format {{.Id}} synthetic-image') printf 'sha256:%064d\n' 1 ;; esac; }
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
      [{ FUNDING_OPERATIONS_WATCHER_ENABLED: 'invalid' }, sha],
      [
        {
          FUNDING_OPERATIONS_WATCHER_ENABLED: 'true',
          FUNDING_OPERATIONS_WEBHOOK_SECRET: ''
        },
        sha
      ],
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

test('enabled operations follows delivery, uses its own previous image on rollback, and first activation stops on rollback', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'og7-operations-deploy-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    for (const name of [
      'deploy.sh',
      'rollback.sh',
      'deployment-compose.sh',
      'deployment-image-revision.sh',
      'load-env.sh'
    ])
      writeFileSync(
        path.join(root, 'scripts', name),
        readFileSync('scripts/' + name, 'utf8').replaceAll('\r\n', '\n')
      );
    writeFileSync(
      path.join(root, 'scripts/db-migrate.sh'),
      'echo migration >> docker-calls\n'
    );
    writeFileSync(
      path.join(root, 'scripts/check.sh'),
      'if [[ ! -e checked ]]; then touch checked; exit 1; fi\necho rollback-check >> docker-calls\n'
    );
    writeFileSync(
      path.join(root, '.env'),
      `WEB_IMAGE=example/web:${sha}\nAPI_IMAGE=example/api:${sha}\nFUNDING_OPERATIONS_WATCHER_ENABLED=true\nDATABASE_URL=synthetic\nFUNDING_OPERATIONS_WEBHOOK_URL=https://receiver.example.test/hook\nFUNDING_OPERATIONS_WEBHOOK_SECRET=synthetic-signature-at-least-32-characters\n`
    );
    const wrapper = `docker() {
      echo "ops=\${OPERATIONS_IMAGE:-unset} $*" >> docker-calls
      case "$*" in
        *"images -q web") echo previous-web ;;
        *"images -q api") echo previous-api ;;
        *"images -q operations") echo "\${PREVIOUS_WORKER:-}" ;;
        *"ps --services --filter status=running") if [[ -n "\${PREVIOUS_WORKER:-}" ]]; then echo operations; fi ;;
      esac
    }
    export -f docker
    bash scripts/deploy.sh --no-build`;
    const run = (previous) =>
      spawnSync(bash, ['-c', wrapper], {
        cwd: root,
        env: { ...process.env, PREVIOUS_WORKER: previous },
        encoding: 'utf8',
        windowsHide: true
      });
    assert.notEqual(
      run('previous-operations').status,
      0,
      'original deployment must still fail'
    );
    let calls = readFileSync(path.join(root, 'docker-calls'), 'utf8');
    assert.match(
      calls,
      /tag previous-operations openg7-funding-operations:rollback/
    );
    assert.match(
      calls,
      new RegExp(
        `ops=example/api:${sha} compose -f docker-compose.yml -f docker-compose.operations.yml --profile database up -d --no-build`
      )
    );
    assert.match(
      calls,
      /ops=openg7-funding-operations:rollback compose -f docker-compose.yml -f docker-compose.operations.yml --profile database up -d --no-build/
    );
    assert.match(calls, /rollback-check/);
    rmSync(path.join(root, 'checked'));
    rmSync(path.join(root, 'docker-calls'));
    assert.notEqual(run('').status, 0);
    calls = readFileSync(path.join(root, 'docker-calls'), 'utf8');
    assert.match(calls, /stop operations/);
    assert.match(
      calls,
      /ops=openg7-funding-operations:rollback compose --profile database up -d --no-build/
    );
    assert.equal(
      readFileSync(
        path.join(root, 'backups/deployment-rollback.env'),
        'utf8'
      ).trim(),
      'ROLLBACK_OPERATIONS_ENABLED=false'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
