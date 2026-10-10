import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  chownSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { inspectProductionAcmeWithDocker } from '../scripts/lib/production-identity.mjs';

const canary = 'synthetic-acme-private-state';
const image = 'registry.example.org/traefik:fixture';
const composeArgs = [
  'compose',
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.identity.yml',
  '--profile',
  'database'
];
const environment = Object.freeze({ SYNTHETIC_PRIVATE_VALUE: canary });
const options = () => ({
  root: resolve('synthetic-acme-root'),
  storage: {
    directory: resolve('synthetic-acme-root/traefik/acme'),
    device: 31,
    inode: 47
  },
  composeArgs,
  env: environment
});
const success = (stdout = '') => ({ status: 0, stdout, stderr: '' });
const assertSafeFailure = (error) => {
  assert.ok(!error.message.includes(canary));
  assert.ok(!error.message.includes(image));
  return true;
};

test('protected ACME inspection uses the effective Compose image and a constrained metadata-only helper', () => {
  const input = options();
  const calls = [];
  const result = inspectProductionAcmeWithDocker({
    ...input,
    runDocker: (command, args, spawnOptions) => {
      calls.push({ command, args, spawnOptions });
      return success(calls.length === 1 ? `${image}\n` : '');
    }
  });
  assert.equal(result, undefined);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, [
    ...composeArgs,
    'config',
    '--images',
    'traefik'
  ]);
  for (const call of calls) {
    assert.equal(call.command, 'docker');
    assert.equal(call.spawnOptions.cwd, input.root);
    assert.equal(call.spawnOptions.env, environment);
    assert.equal(call.spawnOptions.encoding, 'utf8');
    assert.equal(call.spawnOptions.stdio, 'pipe');
    assert.equal(call.spawnOptions.windowsHide, true);
    assert.ok(call.spawnOptions.timeout > 0);
    assert.ok(call.spawnOptions.timeout <= 60_000);
    assert.ok(!JSON.stringify(call.args).includes(canary));
  }
  assert.ok(calls[0].spawnOptions.timeout <= 15_000);
  const helper = calls[1].args;
  const scriptIndex = helper.indexOf('-ec') + 1;
  assert.ok(scriptIndex > 0);
  assert.deepEqual(helper.slice(0, scriptIndex), [
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--user',
    '0:0',
    '--pids-limit',
    '32',
    '--mount',
    `type=bind,source=${input.storage.directory},target=/acme,readonly,bind-recursive=disabled`,
    '--entrypoint',
    '/bin/sh',
    image,
    '-ec'
  ]);
  assert.deepEqual(helper.slice(scriptIndex + 1), [
    'og7-acme-check',
    '/acme',
    '31:47'
  ]);
});

test('protected ACME inspection fails closed for image resolution and helper failures without reporting private output', () => {
  for (const resolution of [
    { status: 1, stdout: image, stderr: canary },
    { status: null, error: new Error(canary), stdout: '' },
    success(''),
    success(`${image}\nsecond-image:fixture\n`),
    success(`image with ${canary}`)
  ]) {
    let calls = 0;
    assert.throws(
      () =>
        inspectProductionAcmeWithDocker({
          ...options(),
          runDocker: () => {
            calls++;
            return resolution;
          }
        }),
      assertSafeFailure
    );
    assert.equal(calls, 1);
  }
  for (const failure of [
    { status: 1, stdout: canary, stderr: canary },
    { status: null, error: new Error(canary), stderr: canary }
  ]) {
    let calls = 0;
    assert.throws(
      () =>
        inspectProductionAcmeWithDocker({
          ...options(),
          runDocker: () => (++calls === 1 ? success(image) : failure)
        }),
      assertSafeFailure
    );
    assert.equal(calls, 2);
  }
  assert.throws(
    () =>
      inspectProductionAcmeWithDocker({
        ...options(),
        runDocker: () => {
          throw new Error(canary);
        }
      }),
    assertSafeFailure
  );
});

const rootOnly =
  process.platform === 'win32' ||
  typeof process.getuid !== 'function' ||
  process.getuid() !== 0;
const fixture = (t, kind = 'valid') => {
  const root = mkdtempSync(join(tmpdir(), 'og7-acme-nonroot-'));
  t.after(() => {
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('og7-acme-nonroot-'));
    rmSync(target, { recursive: true, force: true });
  });
  chmodSync(root, 0o755);
  mkdirSync(join(root, 'traefik'), { mode: 0o755 });
  chmodSync(join(root, 'traefik'), 0o755);
  const directory = join(root, 'traefik/acme');
  const file = join(directory, 'acme.json');
  mkdirSync(directory, { mode: 0o700 });
  chmodSync(directory, 0o700);
  const untouched = join(root, 'untouched');
  writeFileSync(untouched, canary, { mode: 0o600 });
  if (kind === 'symlink') symlinkSync(untouched, file);
  else if (kind === 'nonregular') mkdirSync(file, { mode: 0o600 });
  else if (kind === 'fifo') {
    assert.equal(
      spawnSync('mkfifo', [file], { stdio: 'ignore', timeout: 1_000 }).status,
      0
    );
    chmodSync(file, 0o600);
  } else if (kind !== 'absent') {
    writeFileSync(file, canary, { mode: 0o600 });
    chmodSync(file, kind === 'file-mode' ? 0o640 : 0o600);
    utimesSync(file, 1, lstatSync(file).mtime);
    if (kind === 'file-owner') chownSync(file, 65534, 65534);
  }
  if (kind === 'directory-mode') chmodSync(directory, 0o750);
  if (kind === 'directory-owner') chownSync(directory, 65534, 65534);
  const metadata = lstatSync(directory);
  return {
    root,
    file,
    untouched,
    storage: { directory, device: metadata.dev, inode: metadata.ino }
  };
};
const metadata = (path, trackAccess = false) => {
  try {
    const stat = lstatSync(path);
    return {
      device: stat.dev,
      inode: stat.ino,
      mode: stat.mode,
      uid: stat.uid,
      gid: stat.gid,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
      ...(trackAccess ? { atime: stat.atimeMs } : {})
    };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};
const snapshot = ({ storage, file, untouched }) => ({
  directory: metadata(storage.directory),
  file: metadata(file, true),
  untouched: metadata(untouched),
  content: readFileSync(untouched, 'utf8')
});

// Run the exact helper script as the privileged fixture owner, replacing only
// its bind-mount path. No Docker daemon or certificate content is involved.
const localMetadataDocker = (calls) => (command, args) => {
  assert.equal(command, 'docker');
  calls.push(args);
  if (args[0] === 'compose') return success(image);
  const scriptIndex = args.indexOf('-ec') + 1;
  const mount = args[args.indexOf('--mount') + 1];
  const directory = mount
    .slice('type=bind,source='.length)
    .split(',target=')[0];
  return spawnSync(
    '/bin/sh',
    [
      '-ec',
      args[scriptIndex],
      args[scriptIndex + 1],
      directory,
      args[scriptIndex + 3]
    ],
    { encoding: 'utf8', timeout: 2_000 }
  );
};

test(
  'the real ACME metadata helper rejects unsafe type, mode, owner and identity without mutation',
  { skip: rootOnly },
  (t) => {
    for (const kind of [
      'valid',
      'symlink',
      'absent',
      'nonregular',
      'fifo',
      'file-mode',
      'file-owner',
      'directory-mode',
      'directory-owner',
      'identity-mismatch'
    ]) {
      const state = fixture(t, kind);
      const before = snapshot(state);
      const calls = [];
      const inspect = () =>
        inspectProductionAcmeWithDocker({
          root: state.root,
          storage: {
            ...state.storage,
            inode: state.storage.inode + (kind === 'identity-mismatch' ? 1 : 0)
          },
          composeArgs,
          env: environment,
          runDocker: localMetadataDocker(calls)
        });
      if (['valid', 'file-owner'].includes(kind))
        assert.equal(inspect(), undefined);
      else assert.throws(inspect, assertSafeFailure);
      assert.equal(calls.length, 2, kind);
      assert.deepEqual(snapshot(state), before, kind);
      if (['valid', 'file-owner'].includes(kind))
        assert.equal(readFileSync(state.file, 'utf8'), canary);
    }
  }
);

const nonrootProbe = String.raw`
  import { closeSync, lstatSync, openSync } from 'node:fs';
  import { once } from 'node:events';
  import { pathToFileURL } from 'node:url';
  const root = process.argv[1];
  const { prepareProductionAcme } = await import(pathToFileURL(root + '/production-identity.mjs'));
  let accessError;
  try { lstatSync(root + '/traefik/acme/acme.json'); }
  catch (error) { accessError = error.code; }
  let readAccessError;
  try { closeSync(openSync(root + '/traefik/acme/acme.json', 'r')); }
  catch (error) { readAccessError = error.code; }
  let withoutHookError;
  let withoutHookPath;
  try { withoutHookPath = await prepareProductionAcme(root); }
  catch (error) { withoutHookError = error.message; }
  let hookCalls = 0;
  const inspectProtectedStorage = async (storage) => {
    hookCalls++;
    const reply = once(process, 'message');
    process.send({ type: 'inspect', storage });
    const [result] = await reply;
    if (!result.ok) throw new Error('Protected metadata inspection failed.');
  };
  let result;
  try {
    const path = await prepareProductionAcme(root, { inspectProtectedStorage });
    await prepareProductionAcme(root, { inspectProtectedStorage });
    result = { ok: true, path };
  } catch (error) { result = { ok: false, message: error.message }; }
  process.send({ type: 'result', accessError, readAccessError, withoutHookError, withoutHookPath, hookCalls, ...result });
  process.disconnect();
`;
const probeAsNonroot = async (
  t,
  state,
  { mismatch = false, fastpath = false } = {}
) => {
  // Keep the executable modules readable even when the repository is under a
  // private home directory. The only private path is the ACME fixture itself.
  for (const name of [
    'production-identity.mjs',
    'services-check-context.mjs'
  ]) {
    copyFileSync(
      fileURLToPath(new URL(`../scripts/lib/${name}`, import.meta.url)),
      join(state.root, name)
    );
    chmodSync(join(state.root, name), 0o644);
  }
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', nonrootProbe, state.root],
    {
      cwd: state.root,
      uid: 65534,
      gid: 65534,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    }
  );
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  const exited = once(child, 'exit');
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  const calls = [];
  const inspections = [];
  let result;
  child.on('message', (message) => {
    if (message.type === 'result') result = message;
    if (message.type !== 'inspect') return;
    inspections.push(message.storage);
    let ok = false;
    try {
      inspectProductionAcmeWithDocker({
        root: state.root,
        storage: {
          ...message.storage,
          inode: message.storage.inode + (mismatch ? 1 : 0)
        },
        composeArgs,
        env: environment,
        runDocker: localMetadataDocker(calls)
      });
      ok = true;
    } catch {}
    child.send({ ok });
  });
  const [code] = await exited;
  assert.ok(!output.includes(canary));
  assert.equal(code, 0, output);
  assert.ok(result, 'Non-root probe must return an outcome');
  if (fastpath) {
    assert.equal(result.accessError, undefined);
    assert.match(result.readAccessError, /^(EACCES|EPERM)$/);
    assert.equal(result.withoutHookPath, state.file);
    assert.equal(result.withoutHookError, undefined);
  } else {
    assert.match(result.accessError, /^(EACCES|EPERM)$/);
    assert.match(result.withoutHookError, /protected traefik\/acme\/acme.json/);
  }
  for (const storage of inspections) assert.deepEqual(storage, state.storage);
  return { result, calls };
};

test(
  'a non-root operator validates existing root-owned ACME state through async metadata inspection and preserves it on repeat',
  { skip: rootOnly, timeout: 10_000 },
  async (t) => {
    const state = fixture(t);
    const before = snapshot(state);
    const { result, calls } = await probeAsNonroot(t, state);
    assert.equal(result.ok, true);
    assert.equal(result.path, state.file);
    assert.equal(result.hookCalls, 2);
    assert.equal(calls.length, 4);
    assert.deepEqual(snapshot(state), before);
    assert.equal(readFileSync(state.file, 'utf8'), canary);
  }
);

test(
  'a non-root operator accepts metadata for a root-owned protected file without opening or changing it',
  { skip: rootOnly, timeout: 10_000 },
  async (t) => {
    const state = fixture(t, 'directory-owner');
    const before = snapshot(state);
    const { result, calls } = await probeAsNonroot(t, state, {
      fastpath: true
    });
    assert.equal(result.ok, true);
    assert.equal(result.path, state.file);
    assert.equal(result.hookCalls, 0);
    assert.equal(calls.length, 0);
    assert.deepEqual(snapshot(state), before);
    assert.equal(readFileSync(state.file, 'utf8'), canary);
  }
);

test(
  'a non-root operator fails closed for unsafe or unverifiable protected ACME state',
  { skip: rootOnly, timeout: 20_000 },
  async (t) => {
    for (const kind of [
      'symlink',
      'absent',
      'nonregular',
      'fifo',
      'file-mode',
      'identity-mismatch'
    ]) {
      const state = fixture(t, kind);
      const before = snapshot(state);
      const { result, calls } = await probeAsNonroot(t, state, {
        mismatch: kind === 'identity-mismatch'
      });
      assert.equal(result.ok, false, kind);
      assert.match(result.message, /protected traefik\/acme\/acme.json/, kind);
      assert.equal(result.hookCalls, 1, kind);
      assert.equal(calls.length, 2, kind);
      assert.deepEqual(snapshot(state), before, kind);
    }
  }
);
