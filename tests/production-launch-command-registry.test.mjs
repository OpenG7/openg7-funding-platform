import assert from 'node:assert/strict';
import test from 'node:test';

import { CommandRegistry } from '../dist/apps/production-launch-agent/src/commands/command-registry.js';

const appDir = '/opt/synthetic-funding-platform';
const domain = 'funding.example.test';

test('deployment and rollback use the canonical runners with a full selected revision', () => {
  const registry = new CommandRegistry(appDir, domain, '/health');
  const sha = 'a'.repeat(40);
  for (const [key, script] of [
    ['deploy_run', 'deploy'],
    ['rollback_run', 'rollback']
  ]) {
    assert.equal(
      registry.create({ key, params: { sha } }).command,
      `cd ${appDir} && bash scripts/${script}.sh --revision ${sha}`
    );
    for (const invalid of [
      undefined,
      '',
      'abcdef0',
      'a'.repeat(41),
      'a'.repeat(39) + ';',
      '$(printf synthetic)',
      'A'.repeat(40)
    ]) {
      assert.throws(
        () => registry.create({ key, params: { sha: invalid } }),
        /full Git commit SHA/
      );
    }
  }
});

test('health commands preserve safe absolute paths without executing them', () => {
  for (const healthPath of [
    '/',
    '/health',
    '/api/health',
    '/health/',
    '/api/v1/health-check_2.json'
  ]) {
    const registry = new CommandRegistry(appDir, domain, healthPath);
    assert.deepEqual(registry.create({ key: 'check_health' }), {
      command: `curl -fsS --max-time 15 https://${domain}${healthPath}`,
      description: 'Check public health endpoint.'
    });
  }
});

test('registry rejects relative, URL and shell syntax in a configured health path', () => {
  for (const healthPath of [
    '',
    'health',
    'https://other.example.test/health',
    '/health?check=ready',
    '/health#ready',
    '/health%20ready',
    '/health;printf synthetic',
    '/health&printf synthetic',
    '/health&&printf synthetic',
    '/health|printf synthetic',
    '/health||printf synthetic',
    '/health$(printf synthetic)',
    '/health`printf synthetic`',
    '/health${SYNTHETIC_VALUE}',
    '/health>synthetic',
    '/health<synthetic',
    '/health"synthetic"',
    "/health'synthetic'",
    '/health\\synthetic',
    '/health*',
    '/health[synthetic]',
    '/health{synthetic}',
    '/health synthetic',
    ' /health',
    '/health ',
    '/health\t',
    '/health\n',
    '/health\r',
    '/health\r\n',
    '/health\n/ready',
    '/health\u2028',
    '/health\u2029',
    '/health\u00a0',
    '/health\0'
  ]) {
    assert.throws(() => new CommandRegistry(appDir, domain, healthPath), {
      message: 'Unsafe health path.'
    });
  }
});
