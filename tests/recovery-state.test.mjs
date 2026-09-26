import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';

test('recovery evidence refuses overwrite and premature success, and preserves the last uncertain stage without private archive names', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'og7-recovery-report-'));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    assert.ok(directory.split(sep).pop().startsWith('og7-recovery-report-'));
    await rm(directory, { recursive: true, force: true });
  });
  const report = join(directory, 'recovery-report.json');
  const archive = join(directory, 'backup.tar.gz');
  await writeFile(
    archive + '.manifest.json',
    JSON.stringify({
      mediaDriver: 'local',
      artifacts: Object.fromEntries(
        ['config', 'database', 'media'].map((role) => [
          role,
          { name: 'private-fixture-name', bytes: 1, sha256: 'a'.repeat(64) }
        ])
      )
    })
  );
  const run = (...args) =>
    execFileSync(
      process.execPath,
      ['scripts/recovery-state.mjs', 'report', report, ...args],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );
  run('start', 'og7-report-fixture', archive);
  const initial = await readFile(report, 'utf8');
  assert.doesNotMatch(initial, /private-fixture-name/);
  assert.throws(() => run('start', 'og7-report-fixture', archive));
  assert.equal(await readFile(report, 'utf8'), initial);
  assert.throws(() => run('complete'));
  assert.equal(await readFile(report, 'utf8'), initial);
  run('database-importing');
  run('failed');
  const failed = JSON.parse(await readFile(report, 'utf8'));
  assert.equal(failed.state, 'failed');
  assert.equal(failed.database, 'importing');
  assert.equal(failed.media, 'pending');
  assert.equal(failed.applicationChecks, 'pending');
  assert.equal(failed.id, JSON.parse(initial).id);
  assert.equal(failed.completedAt, undefined);
});
