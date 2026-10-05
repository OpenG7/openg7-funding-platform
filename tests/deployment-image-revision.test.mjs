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

const bash =
  process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const revisionA = 'a'.repeat(40);
const revisionB = 'b'.repeat(40);
const imageA = 'sha256:' + '1'.repeat(64);
const imageB = 'sha256:' + '2'.repeat(64);
const fixture = (t, operations = false) => {
  const root = mkdtempSync(path.join(tmpdir(), 'og7-image-revision-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'));
  mkdirSync(path.join(root, 'backups'));
  for (const name of [
    'deploy.sh',
    'rollback.sh',
    'deployment-compose.sh',
    'deployment-image-revision.sh',
    'load-env.sh'
  ]) {
    writeFileSync(
      path.join(root, 'scripts', name),
      readFileSync('scripts/' + name, 'utf8').replaceAll('\r\n', '\n')
    );
  }
  writeFileSync(path.join(root, 'scripts/check.sh'), 'echo health >> calls\n');
  writeFileSync(
    path.join(root, 'scripts/db-migrate.sh'),
    'echo migrate >> calls\n'
  );
  const write = (name, content) =>
    writeFileSync(path.join(root, name), content);
  const read = (name) => readFileSync(path.join(root, name), 'utf8');
  const wrapper = `git() { case "$1" in rev-parse) echo "$TEST_REVISION" ;; status) ;; *) return 90 ;; esac; }
docker() {
  echo "$*" >> calls
  if [[ "$1 $2" == 'image inspect' ]]; then
    if [[ "$3" == --format ]]; then
      case "$5" in
        openg7-funding-web:rollback) cat rollback-web ;;
        openg7-funding-api:rollback) cat rollback-api ;;
        openg7-funding-operations:rollback) cat rollback-operations ;;
        sha256:*) printf '%s\\n' "$5" ;;
        *) return 91 ;;
      esac
    fi
  elif [[ "$1" == tag ]]; then
    case "$3" in *web:rollback) printf '%s\\n' "$2" > rollback-web ;; *api:rollback) printf '%s\\n' "$2" > rollback-api ;; *operations:rollback) printf '%s\\n' "$2" > rollback-operations ;; esac
  elif [[ "$*" == *'images -q web' ]]; then cat running-web
  elif [[ "$*" == *'images -q api' ]]; then cat running-api
  elif [[ "$*" == *'images -q operations' ]]; then cat running-operations
  elif [[ "$*" == *'ps --services --filter status=running' ]]; then
    if [[ "$TEST_OPERATIONS" == true ]]; then echo operations; fi
  elif [[ "$*" == *'up -d --no-build'* ]]; then
    if [[ "$WEB_IMAGE" == sha256:* ]]; then printf '%s\\n' "$WEB_IMAGE" > running-web; printf '%s\\n' "$API_IMAGE" > running-api
    else printf '%s\\n' "$TEST_IMAGE" > running-web; printf '%s\\n' "$TEST_IMAGE" > running-api; fi
    if [[ "$TEST_OPERATIONS" == true ]]; then
      if [[ "$OPERATIONS_IMAGE" == sha256:* ]]; then printf '%s\\n' "$OPERATIONS_IMAGE" > running-operations
      else printf '%s\\n' "$TEST_IMAGE" > running-operations; fi
    fi
  fi
}
export -f git docker
bash scripts/"$1" "\${@:2}"`;
  const run = (script, revision, image = imageB) => {
    write(
      '.env',
      `WEB_IMAGE=example/web:${revision}\nAPI_IMAGE=example/api:${revision}\nDATABASE_URL=synthetic\nFUNDING_OPERATIONS_WATCHER_ENABLED=${operations}\nFUNDING_OPERATIONS_WEBHOOK_URL=https://receiver.example.test/hook\nFUNDING_OPERATIONS_WEBHOOK_SECRET=synthetic-signature-at-least-32-characters\n`
    );
    return spawnSync(
      bash,
      [
        '-c',
        wrapper,
        'synthetic',
        script,
        ...(script === 'deploy.sh' ? ['--no-build'] : []),
        '--revision',
        revision
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          TEST_REVISION: revision,
          TEST_IMAGE: image,
          TEST_OPERATIONS: String(operations)
        },
        encoding: 'utf8',
        windowsHide: true
      }
    );
  };
  write('running-web', imageA + '\n');
  write('running-api', imageA + '\n');
  if (operations) write('running-operations', imageA + '\n');
  write(
    'backups/deployment-current.revision',
    `${revisionA} ${imageA} ${imageA} ${operations ? imageA : 'none'}\n`
  );
  return { run, read, write };
};

test('revision-qualified delivery and rollback preserve the watcher image and reject a changed worker snapshot', (t) => {
  const f = fixture(t, true);
  const deployed = f.run('deploy.sh', revisionB);
  assert.equal(deployed.status, 0, deployed.stderr);
  assert.equal(
    f.read('backups/deployment-rollback.revision'),
    `${revisionA} ${imageA} ${imageA} ${imageA}\n`
  );
  assert.equal(f.read('running-operations').trim(), imageB);
  f.write('rollback-operations', imageB + '\n');
  f.write('calls', '');
  assert.notEqual(f.run('rollback.sh', revisionA).status, 0);
  assert.doesNotMatch(f.read('calls'), /stop operations|up -d/);
  f.write('rollback-operations', imageA + '\n');
  const restored = f.run('rollback.sh', revisionA);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(f.read('running-operations').trim(), imageA);
  assert.equal(
    f.read('backups/deployment-current.revision'),
    `${revisionA} ${imageA} ${imageA} ${imageA}\n`
  );
});

test('canonical deployment snapshots exact images, migrates before up and verifies revision-bound rollback', (t) => {
  const f = fixture(t);
  const deployed = f.run('deploy.sh', revisionB);
  assert.equal(deployed.status, 0, deployed.stderr);
  assert.equal(
    f.read('backups/deployment-rollback.revision'),
    `${revisionA} ${imageA} ${imageA} none\n`
  );
  assert.equal(
    f.read('backups/deployment-current.revision'),
    `${revisionB} ${imageB} ${imageB} none\n`
  );
  const calls = f.read('calls');
  assert.ok(calls.indexOf('migrate') < calls.indexOf('up -d --no-build'));
  const restored = f.run('rollback.sh', revisionA);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(f.read('running-web').trim(), imageA);
  assert.equal(
    f.read('backups/deployment-current.revision'),
    `${revisionA} ${imageA} ${imageA} none\n`
  );
});

test('rollback refuses an older stable SHA when available copies belong to an unqualified newer deployment', (t) => {
  const f = fixture(t);
  assert.equal(f.run('deploy.sh', revisionB).status, 0);
  assert.equal(
    f.run('deploy.sh', 'c'.repeat(40), 'sha256:' + '3'.repeat(64)).status,
    0
  );
  f.write('calls', '');
  const result = f.run('rollback.sh', revisionA);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /do not match the requested stable revision/);
  assert.doesNotMatch(f.read('calls'), /stop operations|up -d/);
});

test('rollback refuses changed image tags or absent receipts before changing services', (t) => {
  const f = fixture(t);
  assert.equal(f.run('deploy.sh', revisionB).status, 0);
  for (const mutate of [
    () => f.write('rollback-web', imageB + '\n'),
    () => {
      f.write('rollback-web', imageA + '\n');
      f.write('backups/deployment-rollback.revision', 'unknown\n');
    }
  ]) {
    mutate();
    f.write('calls', '');
    const result = f.run('rollback.sh', revisionA);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no verified revision association/);
    assert.doesNotMatch(f.read('calls'), /stop operations|up -d/);
  }
});

test('a stale current receipt cannot qualify the next rollback snapshot', (t) => {
  const f = fixture(t);
  f.write('running-web', imageB + '\n');
  assert.equal(f.run('deploy.sh', 'c'.repeat(40)).status, 0);
  assert.equal(f.read('backups/deployment-rollback.revision'), 'unknown\n');
});
