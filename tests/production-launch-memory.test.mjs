import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { SqliteMemoryStore } from '../dist/apps/production-launch-agent/src/memory/sqlite-memory.js';

test('SQLite history rejects invalid new revisions and skips malformed legacy rows when selecting another stable deployment', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'openg7-synthetic-deployment-memory-')
  );
  const filename = path.join(directory, 'memory.sqlite');
  const memory = new SqliteMemoryStore(filename);
  t.after(async () => {
    memory.close();
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
  const previous = 'a'.repeat(40);
  const current = 'b'.repeat(40);
  assert.equal(memory.lastStableDeployment(), null);
  memory.recordDeployment({ status: 'stable', version: previous });
  memory.recordDeployment({ status: 'stable', version: current });
  memory.recordDeployment({ status: 'candidate', version: 'c'.repeat(40) });
  assert.equal(memory.lastStableDeployment(), current);
  assert.equal(memory.lastStableDeployment(current), previous);
  for (const version of [
    '',
    'abcdef0',
    'A'.repeat(40),
    'a'.repeat(39) + ';',
    'a'.repeat(40) + '\n',
    '$(printf synthetic)'
  ]) {
    assert.throws(
      () => memory.recordDeployment({ status: 'stable', version }),
      /full Git commit SHA/
    );
  }
  const legacy = new DatabaseSync(filename);
  try {
    const insert = legacy.prepare(
      'INSERT INTO deployments(version, status) VALUES (?, ?)'
    );
    for (const version of [
      'dry-run-placeholder',
      'a'.repeat(39) + ';',
      'A'.repeat(40)
    ])
      insert.run(version, 'stable');
  } finally {
    legacy.close();
  }
  assert.equal(memory.lastStableDeployment(), current);
  assert.equal(memory.lastStableDeployment(current), previous);
});
