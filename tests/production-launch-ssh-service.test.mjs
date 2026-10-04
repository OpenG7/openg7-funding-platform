import assert from 'node:assert/strict';
import test from 'node:test';

import { SshService } from '../dist/apps/production-launch-agent/src/ssh/ssh-service.js';

const config = Object.freeze({
  host: 'ssh.example.invalid',
  username: 'synthetic-user',
  port: 22,
  readyTimeoutMs: 500,
  retries: 2
});
const command = 'printf synthetic-command';
const successfulResponse = Object.freeze({
  code: 0,
  signal: null,
  stdout: 'synthetic output',
  stderr: ''
});

const harness = (attempts, overrides = {}) => {
  const clients = [];
  const calls = [];
  const service = new SshService({ ...config, ...overrides }, () => {
    const index = clients.length;
    const attempt = attempts[index];
    assert.ok(attempt, 'must not create an unexpected SSH client');
    const client = {
      async connect(options) {
        calls.push({ operation: 'connect', index, options });
        if ('connectionFailure' in attempt) throw attempt.connectionFailure;
        return client;
      },
      async execCommand(value, options) {
        calls.push({ operation: 'execute', index, command: value, options });
        if ('executionFailure' in attempt) throw attempt.executionFailure;
        return attempt.response ?? successfulResponse;
      },
      dispose() {
        calls.push({ operation: 'dispose', index });
      }
    };
    clients.push(client);
    return client;
  });
  return { service, calls, clients };
};

const operations = (calls) =>
  calls.map(({ operation, index }) => `${index}:${operation}`);

test('SSH retries connection failures and executes once after connecting', async () => {
  const { service, calls } = harness([
    { connectionFailure: new Error('synthetic connection failure') },
    {},
    {}
  ]);
  assert.deepEqual(await service.run(command), {
    command,
    code: 0,
    stderr: '',
    stdout: 'synthetic output'
  });
  assert.deepEqual(operations(calls), [
    '0:connect',
    '0:dispose',
    '1:connect',
    '1:execute',
    '1:dispose'
  ]);
  assert.deepEqual(calls[2].options, {
    host: config.host,
    username: config.username,
    privateKey: undefined,
    privateKeyPath: undefined,
    port: config.port,
    readyTimeout: config.readyTimeoutMs
  });
  assert.deepEqual(calls[3], {
    operation: 'execute',
    index: 1,
    command,
    options: { execOptions: { timeout: config.readyTimeoutMs } }
  });
});

test('SSH connection retry exhaustion reports failure and disposes every client without executing', async () => {
  const { service, calls, clients } = harness(
    ['first', 'second', 'last'].map((name) => ({
      connectionFailure: new Error(`synthetic ${name} connection failure`)
    }))
  );
  assert.deepEqual(await service.run(command), {
    command,
    code: 255,
    stderr: 'synthetic last connection failure',
    stdout: ''
  });
  assert.equal(clients.length, 3);
  assert.deepEqual(operations(calls), [
    '0:connect',
    '0:dispose',
    '1:connect',
    '1:dispose',
    '2:connect',
    '2:dispose'
  ]);
});

test('SSH connection failure with no retries preserves a safe fallback for non-Error failures', async () => {
  const { service, calls } = harness([{ connectionFailure: null }], {
    retries: 0
  });
  assert.deepEqual(await service.run(command), {
    command,
    code: 255,
    stderr: 'Unknown SSH error',
    stdout: ''
  });
  assert.deepEqual(operations(calls), ['0:connect', '0:dispose']);
});

test('SSH preserves explicit remote success or failure without retrying the command', async (t) => {
  for (const code of [0, 17]) {
    await t.test(`exit code ${code}`, async () => {
      const response = {
        code,
        signal: null,
        stdout: 'synthetic remote output',
        stderr: 'synthetic remote diagnostic'
      };
      const { service, calls, clients } = harness([{ response }]);
      assert.deepEqual(await service.run(command), {
        command,
        code,
        stdout: response.stdout,
        stderr: response.stderr
      });
      assert.equal(clients.length, 1);
      assert.deepEqual(operations(calls), [
        '0:connect',
        '0:execute',
        '0:dispose'
      ]);
    });
  }
});

test('SSH missing exit status and termination signals never count as remote success', async (t) => {
  for (const outcome of [
    { name: 'null exit code', code: null, signal: null },
    { name: 'absent exit code', signal: null },
    { name: 'signal without exit code', code: null, signal: 'TERM' },
    { name: 'signal with zero exit code', code: 0, signal: 'TERM' }
  ]) {
    await t.test(outcome.name, async () => {
      const { name: _name, ...status } = outcome;
      const response = {
        ...status,
        stdout: 'synthetic partial output',
        stderr: 'synthetic termination diagnostic'
      };
      const { service, calls, clients } = harness([{ response }]);
      assert.deepEqual(await service.run(command), {
        command,
        code: 255,
        stdout: response.stdout,
        stderr: response.stderr
      });
      assert.equal(clients.length, 1);
      assert.deepEqual(operations(calls), [
        '0:connect',
        '0:execute',
        '0:dispose'
      ]);
    });
  }
});

test('SSH rejection after invoking the command requires reconciliation and never replays it', async (t) => {
  for (const executionFailure of [
    new Error('synthetic diagnostic that must not be copied'),
    null
  ]) {
    await t.test(
      executionFailure ? 'Error rejection' : 'non-Error rejection',
      async () => {
        const { service, calls, clients } = harness([{ executionFailure }]);
        const output = await service.run(command);
        assert.deepEqual(output, {
          command,
          code: 255,
          stderr:
            'SSH command result is uncertain; reconcile the remote result before retrying.',
          stdout: ''
        });
        assert.equal(
          output.stderr.includes(
            'synthetic diagnostic that must not be copied'
          ),
          false
        );
        assert.equal(clients.length, 1);
        assert.deepEqual(operations(calls), [
          '0:connect',
          '0:execute',
          '0:dispose'
        ]);
      }
    );
  }
});
