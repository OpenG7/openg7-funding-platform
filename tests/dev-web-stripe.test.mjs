import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { startDevWebStripe } from '../scripts/lib/dev-web-stripe.mjs';

const listenerUrl = new URL(
  '../scripts/lib/stripe-listener.mjs',
  import.meta.url
);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const nativeWriter = `
  console.log('fixture-native:' + process.pid);
  process.stdout.write('\\u001b[36m> Ready!\\u001b[0m whsec_synthetic123\\n');
  process.stderr.write('sk_test_private');
  setTimeout(() => console.error('canary'), 10);
  setInterval(() => {}, 1000);
`;

function fixture(
  t,
  {
    writer = nativeWriter,
    signingSecret = 'whsec_synthetic123',
    ipcSendFails = false
  } = {}
) {
  const root = mkdtempSync(join(tmpdir(), 'og7-dev-web-stripe-'));
  const scripts = join(root, 'scripts');
  mkdirSync(join(scripts, 'lib'), { recursive: true });
  copyFileSync(
    new URL('../scripts/stripe-webhook-listen.mjs', import.meta.url),
    join(scripts, 'stripe-webhook-listen.mjs')
  );
  writeFileSync(
    join(scripts, 'lib/load-dotenv.mjs'),
    `export function loadDotEnv() { ${ipcSendFails ? "process.send = (_message, callback) => setImmediate(() => { process.emit('SIGTERM'); process.emit('disconnect'); callback(new Error('synthetic closed IPC')); });" : ''} }`
  );
  // The real wrapper and native-process supervisor run unchanged. Only provider
  // discovery/signing-secret/TLS checks use synthetic dependencies, never Stripe.
  writeFileSync(
    join(scripts, 'lib/stripe-listener.mjs'),
    `import * as actual from ${JSON.stringify(listenerUrl.href)};
     import { writeFileSync } from 'node:fs';
     export const stripeListenerEnvironment = actual.stripeListenerEnvironment;
     export const stripeSnapshotListenerArgs = actual.stripeSnapshotListenerArgs;
     export const verifyStripeSigningSecret = actual.verifyStripeSigningSecret;
     export async function verifyLocalStripeTls() {}
     export async function runStripeListener(args, options) {
       if (args[1] === '--help') return '  --all-snapshot';
       if (args[1] === '--print-secret') return ${JSON.stringify(signingSecret)};
       try {
         return await actual.runStripeListener(['-e', ${JSON.stringify(writer)}], {
           ...options, executable: process.execPath, readyTimeoutMs: 2000, stopTimeoutMs: 100
         });
       } finally { writeFileSync(${JSON.stringify(join(root, 'native-supervision-ended'))}, 'ended'); }
     }`
  );
  let relay;
  let child;
  const output = [];
  t.after(async () => {
    try {
      await relay?.stop();
    } finally {
      assert.equal(dirname(resolve(root)), resolve(tmpdir()));
      assert.ok(basename(root).startsWith('og7-dev-web-stripe-'));
      rmSync(root, { recursive: true, force: true });
    }
  });
  return {
    root,
    output,
    get child() {
      return child;
    },
    start(options = {}) {
      relay = startDevWebStripe({
        root,
        env: {
          ...process.env,
          STRIPE_SECRET_KEY: 'sk_test_synthetic123',
          STRIPE_WEBHOOK_SECRET: 'whsec_synthetic123',
          STRIPE_API_HOST: ''
        },
        readyTimeoutMs: 5000,
        stopTimeoutMs: 1000,
        write: (line) => output.push(line),
        spawnProcess(executable, args, spawnOptions) {
          assert.deepEqual(spawnOptions.stdio, [
            'ignore',
            'pipe',
            'pipe',
            'ipc'
          ]);
          assert.equal(spawnOptions.windowsHide, true);
          assert.doesNotMatch(args.join(' '), /sk_test_|whsec_/);
          child = spawn(executable, args, spawnOptions);
          return child;
        },
        ...options
      });
      return relay;
    }
  };
}

async function until(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    assert.ok(
      Date.now() < deadline,
      'Synthetic process did not settle in time.'
    );
    await setTimeout(10);
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};

test('real managed wrapper reports ANSI Ready over IPC, masks streamed secrets and stops its owned process tree', async (t) => {
  const f = fixture(t);
  const relay = f.start();
  await relay.ready;
  await until(() =>
    f.output.some(
      (line) =>
        line.includes('privatecanary') || line.includes('[secret masque]')
    )
  );
  await setTimeout(30);
  const nativePid = Number(
    f.output.find((line) => line.startsWith('fixture-native:'))?.split(':')[1]
  );
  assert.ok(Number.isSafeInteger(nativePid) && nativePid > 0);
  assert.ok(alive(nativePid));
  const output = f.output.join('\n');
  assert.match(output, /> Ready! \[secret masque\]/);
  assert.doesNotMatch(output, /synthetic123|privatecanary|\u001b/);
  const stopped = relay.stop();
  assert.equal(relay.stop(), stopped);
  await stopped;
  await relay.closed;
  await until(() => !alive(nativePid));
  assert.equal(alive(f.child.pid), false);
});

test('IPC disconnection stops the native listener when the gateway disappears', async (t) => {
  const f = fixture(t);
  const relay = f.start();
  await relay.ready;
  await until(() =>
    f.output.some((line) => line.startsWith('fixture-native:'))
  );
  const nativePid = Number(
    f.output.find((line) => line.startsWith('fixture-native:')).split(':')[1]
  );
  f.child.disconnect();
  const result = await relay.closed;
  assert.equal(result.code, 130);
  await until(() => !alive(nativePid));
});

test('a connected wrapper exits on configuration failure instead of waiting for its IPC parent', async (t) => {
  const f = fixture(t, { signingSecret: 'whsec_differentcanary' });
  const relay = f.start();
  await assert.rejects(relay.ready, /termine avant/);
  assert.equal((await relay.closed).code, 1);
  assert.doesNotMatch(f.output.join('\n'), /differentcanary|synthetic123/);
});

test('native exit before Ready rejects preparation, including a successful early exit', async (t) => {
  const f = fixture(t, { writer: "console.log('Not ready');" });
  const relay = f.start();
  await assert.rejects(relay.ready, /termine avant/);
  assert.equal((await relay.closed).code, 1);
});

test('native exit after Ready closes the connected wrapper without hanging', async (t) => {
  const f = fixture(t, {
    writer: "console.log('> Ready!'); console.error('Ready!');"
  });
  const relay = f.start();
  let readyMessages = 0;
  f.child.on('message', (message) => {
    if (message.type === 'stripe-ready') readyMessages++;
  });
  await relay.ready;
  assert.equal((await relay.closed).code, 0);
  assert.equal(readyMessages, 1);
});

test('a failed IPC readiness send cleans up the native listener', async (t) => {
  const f = fixture(t, { ipcSendFails: true });
  const relay = f.start();
  await assert.rejects(relay.ready, /termine avant/);
  assert.equal((await relay.closed).code, 130);
  const nativePid = Number(
    f.output.find((line) => line.startsWith('fixture-native:'))?.split(':')[1]
  );
  assert.ok(Number.isSafeInteger(nativePid));
  await until(() => !alive(nativePid));
  assert.equal(existsSync(join(f.root, 'native-supervision-ended')), true);
});

test('stdout Ready text and unrelated IPC cannot announce managed readiness', async (t) => {
  const f = fixture(t);
  const scriptPath = join(f.root, 'stdout-only.mjs');
  writeFileSync(
    scriptPath,
    "console.log('> Ready!'); process.send({type:'unrelated'});"
  );
  const relay = f.start({ scriptPath });
  await assert.rejects(relay.ready, /termine avant/);
  assert.equal((await relay.closed).code, 0);
});

test('a readiness timeout stops the owned listener and settles closed', async (t) => {
  const f = fixture(t, { writer: 'setInterval(() => {}, 1000);' });
  const relay = f.start({ readyTimeoutMs: 150 });
  await assert.rejects(relay.ready, /delai/);
  await relay.closed;
  assert.equal(alive(f.child.pid), false);
});

test('a missing executable rejects ready and settles closed without an unhandled rejection', async (t) => {
  const f = fixture(t);
  const relay = f.start({
    executable: join(repositoryRoot, 'absent-stripe-fixture.exe')
  });
  await assert.rejects(relay.ready, /Impossible de lancer/);
  assert.deepEqual(await relay.closed, { code: null, signal: null });
  await relay.stop();
});

test('stopping one relay leaves a separately owned relay running', async (t) => {
  const first = fixture(t),
    second = fixture(t);
  const a = first.start(),
    b = second.start();
  await Promise.all([a.ready, b.ready]);
  await a.stop();
  assert.equal(alive(first.child.pid), false);
  assert.equal(alive(second.child.pid), true);
});

test('listener readiness has its own deadline and escalates a native process that ignores termination', () => {
  const writer =
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
      import { runStripeListener } from ${JSON.stringify(listenerUrl.href)};
      let signaled = false;
      try {
        await runStripeListener(['-e', ${JSON.stringify(writer)}], {
          env: process.env, executable: process.execPath,
          onReady: () => { signaled = true; }, readyTimeoutMs: 100, stopTimeoutMs: 100
        });
        process.exitCode = 1;
      } catch (error) {
        if (signaled || !error.message.includes('disponibilite')) process.exitCode = 1;
      }
    `
    ],
    { encoding: 'utf8', timeout: 5000 }
  );
  assert.equal(result.status, 0, result.stderr);
});
