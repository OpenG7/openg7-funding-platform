import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../dist/apps/production-launch-agent/src/config.js';

test('SSH command timeout defaults separately from connection readiness and accepts bounded server values', () => {
  const env = { PLA_SSH_HOST: 'synthetic.invalid' };
  const config = loadConfig(env);
  assert.equal(config.ssh.readyTimeoutMs, 20000);
  assert.equal(config.ssh.commandTimeoutMs, 1800000);
  for (const value of ['1', '600000', '86400000']) {
    const selected = loadConfig({
      ...env,
      PLA_SSH_TIMEOUT_MS: '500',
      PLA_SSH_COMMAND_TIMEOUT_MS: value
    });
    assert.equal(selected.ssh.commandTimeoutMs, Number(value));
    assert.equal(selected.ssh.readyTimeoutMs, 500);
  }
});

test('invalid execution deadlines prevent startup and do not disclose the rejected value', () => {
  for (const value of [
    '',
    '0',
    '-1',
    '1.5',
    '1e3',
    'Infinity',
    'NaN',
    '86400001',
    '99999999999999999999',
    'syntheticPrivateCanary'
  ]) {
    assert.throws(
      () =>
        loadConfig({
          PLA_SSH_HOST: 'synthetic.invalid',
          PLA_SSH_COMMAND_TIMEOUT_MS: value
        }),
      (error) => {
        assert.match(
          error.message,
          /PLA_SSH_COMMAND_TIMEOUT_MS must be an integer/
        );
        assert.doesNotMatch(error.message, /PrivateCanary/);
        return true;
      }
    );
  }
});
