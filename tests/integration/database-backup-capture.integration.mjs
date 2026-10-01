import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
test(
  'the isolated backup image streams a real PostgreSQL dump through age and restores exact synthetic data',
  { timeout: 300000 },
  async (t) => {
    const docker = async (args) =>
      (
        await exec('docker', args, {
          windowsHide: true,
          timeout: 180000,
          maxBuffer: 8 * 1024 * 1024
        })
      ).stdout.trim();
    const context = await docker(['context', 'show']);
    const endpoint = await docker([
      'context',
      'inspect',
      context,
      '--format',
      '{{.Endpoints.docker.Host}}'
    ]);
    if (!endpoint.startsWith('npipe://') && !endpoint.startsWith('unix://'))
      throw new Error('A local Docker daemon is required.');
    const apiImage = 'openg7-backup-api-fixture:local';
    const image = 'openg7-backup-capture-fixture:local';
    // No .env is read. These images and the tmpfs container contain only synthetic data.
    await docker([
      'build',
      '-f',
      'apps/funding-api/Dockerfile',
      '-t',
      apiImage,
      '.'
    ]);
    await docker([
      'build',
      '-f',
      'apps/funding-api/Dockerfile.backup',
      '--build-arg',
      'API_IMAGE=' + apiImage,
      '-t',
      image,
      '.'
    ]);
    const id = await docker([
      'run',
      '-d',
      '--network',
      'none',
      '--name',
      'og7-backup-capture-' + randomUUID(),
      '--label',
      'org.openg7.disposable-test=true',
      '--tmpfs',
      '/var/lib/postgresql/data:uid=999,gid=999,mode=0700',
      '--env',
      'POSTGRES_PASSWORD=synthetic-fixture-only',
      '--entrypoint',
      'docker-entrypoint.sh',
      image,
      'postgres'
    ]);
    t.after(() => docker(['rm', '--force', id]));
    const migration = await readFile(
      new URL(
        '../../apps/funding-api/migrations/030_create_database_backups.sql',
        import.meta.url
      ),
      'utf8'
    );
    const script = `
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { readFile, writeFile, mkdir } from 'node:fs/promises';
    import { createHash, randomUUID } from 'node:crypto';
    import pg from 'pg';
    import { captureDatabase } from './dist/apps/funding-api/src/database-backup/capture.js';
    import { runBackupWorker } from './dist/apps/funding-api/src/database-backup/worker.js';
    import { BackupStorage } from './dist/apps/funding-api/src/database-backup/storage.js';
    const pool = new pg.Pool({ host: '127.0.0.1', user: 'postgres', password: 'synthetic-fixture-only', database: 'postgres', connectionTimeoutMillis: 1000 });
    try {
      for (let n=0;;n++) { try { await pool.query('SELECT 1'); break; } catch { if(n>50) throw new Error('Fixture unavailable'); await new Promise(r=>setTimeout(r,200)); } }
      await pool.query('CREATE TABLE backup_fixture(id BIGSERIAL PRIMARY KEY, amount BIGINT NOT NULL, consent BOOLEAN NOT NULL); INSERT INTO backup_fixture(amount,consent) VALUES(9007199254740993,true),(500,false)');
      execFileSync('age-keygen', ['-o','/tmp/fixture-key'], { stdio: 'ignore' });
      const recipient = execFileSync('age-keygen', ['-y','/tmp/fixture-key'], { encoding: 'utf8' }).trim();
      await mkdir('/tmp/capture');
      const config = { databaseUrl: 'postgres://postgres:synthetic-fixture-only@127.0.0.1/postgres?sslmode=disable', recipient, directory: '/tmp/capture' };
      const requestId = randomUUID();
      const captured = await captureDatabase(config, requestId, AbortSignal.timeout(30000));
      const encrypted = await readFile(captured.file);
      assert.equal(captured.bytes, encrypted.length);
      assert.equal(captured.sha256, createHash('sha256').update(encrypted).digest('hex'));
      assert.ok(!encrypted.includes(Buffer.from('backup_fixture')));
      const plaintext = execFileSync('age', ['--decrypt','--identity','/tmp/fixture-key',captured.file], { maxBuffer: 5*1024*1024 });
      await pool.query('CREATE DATABASE recovered_fixture');
      execFileSync('psql', ['--dbname','recovered_fixture','--set','ON_ERROR_STOP=1'], { input: plaintext, stdio: ['pipe','ignore','ignore'] });
      const restored = new pg.Pool({ host: '127.0.0.1', user: 'postgres', password: 'synthetic-fixture-only', database: 'recovered_fixture' });
      try { assert.deepEqual((await restored.query('SELECT amount::text,consent FROM backup_fixture ORDER BY id')).rows, [{amount:'9007199254740993',consent:true},{amount:'500',consent:false}]); } finally { await restored.end(); }
      await assert.rejects(captureDatabase(config, requestId, AbortSignal.timeout(30000)));
      const corrupt = Buffer.from(encrypted); corrupt[corrupt.length-5] ^= 1;
      await writeFile('/tmp/corrupt.age', corrupt);
      assert.throws(() => execFileSync('age', ['--decrypt','--identity','/tmp/fixture-key','/tmp/corrupt.age'], { stdio: 'ignore' }));
      const cancelled = new AbortController(); cancelled.abort();
      await assert.rejects(captureDatabase(config, randomUUID(), cancelled.signal));
      await pool.query('CREATE TABLE admin_audit_log(actor TEXT,action TEXT,entity_type TEXT,entity_id TEXT,summary TEXT,metadata JSONB)');
      await pool.query(${JSON.stringify(migration)});
      let uploads=0;
      BackupStorage.prototype.check = async () => {};
      BackupStorage.prototype.upload = async function(id, file, proof) {
        uploads++;
        assert.equal((await readFile(file)).length,proof.bytes);
        assert.equal(proof.retainUntil.slice(-5),'.000Z');
      };
      const worker = runBackupWorker({ ...config, endpoint:'https://storage.example.test', region:'fixture', bucket:'fixture', accessKeyId:'fixture', secretAccessKey:'fixture', namespace:'test' }).then(()=>false,()=>true);
      for(let n=0;;n++) {
        const result = await pool.query("SELECT status FROM database_backup_jobs WHERE source='daily'");
        if(result.rows[0]?.status==='succeeded') break;
        if(n>150) throw new Error('Worker did not complete a synthetic daily backup');
        await new Promise(r=>setTimeout(r,100));
      }
      assert.equal(uploads,1);
      // Kill only this worker's DB sessions on this network-isolated synthetic server.
      await pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='openg7-database-backup'");
      assert.equal(await worker,true,'Loss of the control connection must produce failure so Docker restarts the worker');
      console.log('Encrypted capture, isolated restore, exact integers, corruption and interruption verified.');
    } finally { await pool.end(); }
  `;
    const output = await docker([
      'exec',
      id,
      'node',
      '--input-type=module',
      '-e',
      script
    ]);
    assert.match(output, /Encrypted capture, isolated restore/);
  }
);
