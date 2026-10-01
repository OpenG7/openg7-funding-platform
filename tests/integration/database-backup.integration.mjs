import assert from 'node:assert/strict';
import { randomUUID, createHash, createHmac } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import {
  backupStatus,
  requestBackup,
  scheduleDailyBackup
} from '../../dist/apps/funding-api/src/database-backup/service.js';
import {
  claimBackup,
  executeBackup,
  reconcileBackup
} from '../../dist/apps/funding-api/src/database-backup/worker.js';

test(
  'backup requests, daily schedule, worker transitions and audit survive concurrency and uncertain transfers',
  { timeout: 90000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const directory = await mkdtemp(join(tmpdir(), 'og7-backup-worker-'));
    t.after(async () => {
      assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
      await rm(directory, { recursive: true, force: true });
    });
    const config = {
      directory,
      endpoint: 'https://storage.example.test',
      bucket: 'fixture',
      namespace: 'fixture',
      recipient: 'synthetic'
    };
    assert.equal((await backupStatus(db.pool)).workerState, 'not_configured');
    await assert.rejects(requestBackup(db.pool, randomUUID(), 'owner'), {
      code: 'BACKUP_UNAVAILABLE'
    });
    await db.pool.query(
      'INSERT INTO database_backup_worker VALUES(TRUE,TRUE,NOW())'
    );
    const id = randomUUID();
    await db.pool
      .query(`CREATE FUNCTION fail_backup_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='database_backup.queued' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_backup_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION fail_backup_audit()`);
    await assert.rejects(requestBackup(db.pool, id, 'owner'));
    assert.equal(
      (await db.pool.query('SELECT * FROM database_backup_jobs')).rowCount,
      0
    );
    await db.pool.query(
      'DROP TRIGGER fail_backup_audit ON admin_audit_log; DROP FUNCTION fail_backup_audit()'
    );
    const pair = await Promise.all([
      requestBackup(db.pool, id, 'owner'),
      requestBackup(db.pool, id.toUpperCase(), 'owner')
    ]);
    assert.deepEqual(pair[0], pair[1]);
    assert.equal(
      (await db.pool.query('SELECT * FROM admin_audit_log')).rowCount,
      1
    );
    await assert.rejects(requestBackup(db.pool, id, 'another-owner'), {
      code: 'BACKUP_REQUEST_CONFLICT'
    });
    await assert.rejects(requestBackup(db.pool, randomUUID(), 'owner'), {
      code: 'BACKUP_ACTIVE'
    });
    assert.equal(await claimBackup(db.pool), id);
    assert.equal(await claimBackup(db.pool), null);
    let captures = 0,
      uploads = 0;
    const bytes = Buffer.from('encrypted fixture only');
    const capture = async (_, jobId) => {
      captures++;
      await mkdir(join(directory, jobId));
      const file = join(directory, jobId, 'database.sql.age');
      await writeFile(file, bytes);
      return {
        file,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      };
    };
    let remoteProof;
    const storage = {
      async check() {},
      async upload(_, file, proof) {
        uploads++;
        remoteProof = proof;
        throw new Error('response lost');
      },
      async verify(_, proof) {
        assert.equal(proof.sha256, remoteProof.sha256);
      }
    };
    await executeBackup(
      db.pool,
      config,
      id,
      storage,
      AbortSignal.timeout(1000),
      capture
    );
    assert.equal((await backupStatus(db.pool, id)).request.status, 'unknown');
    assert.equal(await claimBackup(db.pool), null);
    await assert.rejects(requestBackup(db.pool, randomUUID(), 'owner'), {
      code: 'BACKUP_ACTIVE'
    });
    await assert.rejects(
      reconcileBackup(
        db.pool,
        { ...config, bucket: 'different' },
        id,
        storage,
        AbortSignal.timeout(1000)
      )
    );
    await reconcileBackup(
      db.pool,
      config,
      id,
      storage,
      AbortSignal.timeout(1000)
    );
    assert.equal((await backupStatus(db.pool, id)).request.status, 'succeeded');
    await assert.rejects(access(join(directory, id, 'database.sql.age')));
    assert.equal(captures, 1);
    assert.equal(uploads, 1);
    await assert.rejects(requestBackup(db.pool, randomUUID(), 'owner'), {
      code: 'BACKUP_RATE_LIMIT'
    });
    await db.pool.query(
      "UPDATE database_backup_jobs SET created_at=NOW()-INTERVAL '16 minutes'"
    );
    const daily = await scheduleDailyBackup(db.pool);
    assert.equal(daily.source, 'daily');
    assert.equal(await scheduleDailyBackup(db.pool), null);
    assert.equal(await claimBackup(db.pool), daily.requestId);
    await executeBackup(
      db.pool,
      config,
      daily.requestId,
      storage,
      AbortSignal.timeout(1000),
      async () => {
        throw new Error('dump failed');
      }
    );
    assert.equal(
      (await backupStatus(db.pool, daily.requestId)).request.status,
      'failed'
    );
    assert.equal(uploads, 1);
    assert.equal(await scheduleDailyBackup(db.pool), null);
    await db.pool.query(
      "UPDATE database_backup_worker SET checked_at=NOW()-INTERVAL '2 minutes'"
    );
    assert.equal((await backupStatus(db.pool)).workerState, 'unavailable');
    assert.equal((await backupStatus(db.pool, randomUUID())).request, null);
    const publicState = JSON.stringify(await backupStatus(db.pool));
    for (const secret of [directory, config.bucket, 'owner', 'response lost'])
      assert.ok(!publicState.includes(secret));
    const actions = (
      await db.pool.query(
        'SELECT action FROM admin_audit_log ORDER BY created_at'
      )
    ).rows.map((row) => row.action);
    assert.deepEqual(actions, [
      'database_backup.queued',
      'database_backup.running',
      'database_backup.unknown',
      'database_backup.succeeded',
      'database_backup.queued',
      'database_backup.running',
      'database_backup.failed'
    ]);
  }
);

test(
  'backup HTTP requires a signed session, confirmation, trusted origin and bounded input',
  { timeout: 60000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const options = db.pool.options;
    const token = randomUUID();
    const sessionSecret = randomUUID();
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
    import http from 'node:http';
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(_port, callback) {
      return listen.call(this, 0, '127.0.0.1', () => { console.log('TEST_PORT=' + this.address().port); callback?.(); });
    };
    await import('./dist/apps/funding-api/src/main.js');
  `
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          NODE_ENV: 'test',
          FUNDING_PLATFORM_ENV: 'development',
          FUNDING_ADMIN_TOKEN: token,
          FUNDING_ADMIN_SESSION_SECRET: sessionSecret,
          FUNDING_EMAIL_WORKER_ENABLED: 'false',
          FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'false',
          SMTP_ENABLED: 'false',
          DATABASE_URL: `postgres://${options.user}:${options.password}@127.0.0.1:${options.port}/${options.database}`,
          FUNDING_PUBLIC_BASE_URL: 'http://localhost',
          FUNDING_ALLOWED_ORIGINS: 'http://localhost'
        }
      }
    );
    t.after(async () => {
      if (child.exitCode !== null) return;
      const closed = once(child, 'exit');
      child.kill();
      await closed;
    });
    child.stderr.resume();
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Synthetic API startup timed out')),
        10000
      );
      let output = '';
      child.once('error', reject);
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Synthetic API startup failed'));
      });
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/TEST_PORT=(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    const base = `http://127.0.0.1:${port}/api/admin`;
    assert.equal((await fetch(base + '/backups')).status, 401);
    assert.equal(
      (
        await fetch(base + '/backups', {
          headers: { authorization: 'Bearer expired-session' }
        })
      ).status,
      401
    );
    assert.equal(
      (
        await fetch(base + '/backups', {
          headers: { authorization: 'Bearer ' + token }
        })
      ).status,
      401
    );
    const expiredPayload = Buffer.from(
      JSON.stringify({
        v: 1,
        actor: 'funding-admin-session',
        iat: Date.now() - 60000,
        exp: Date.now() - 1000,
        nonce: 'synthetic'
      })
    ).toString('base64url');
    const expiredSignature = createHmac('sha256', sessionSecret)
      .update(expiredPayload)
      .digest('base64url');
    assert.equal(
      (
        await fetch(base + '/backups', {
          headers: {
            authorization:
              'Bearer openg7-admin-session.' +
              expiredPayload +
              '.' +
              expiredSignature
          }
        })
      ).status,
      401
    );
    const session = await (
      await fetch(base + '/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token })
      })
    ).json();
    const headers = {
      authorization: 'Bearer ' + session.sessionToken,
      'content-type': 'application/json',
      origin: 'http://localhost'
    };
    const post = (body, patch = {}) =>
      fetch(base + '/backups', {
        method: 'POST',
        headers: { ...headers, ...patch },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      });
    assert.equal((await fetch(base + '/backups', { headers })).status, 200);
    const id = randomUUID();
    assert.equal((await post({ requestId: id })).status, 400);
    for (const body of [
      'null',
      '[]',
      '{',
      { requestId: id, confirmation: 'wrong' },
      { requestId: id, confirmation: 'BACKUP_DATABASE', command: 'forbidden' },
      'x'.repeat(2049)
    ]) {
      assert.equal((await post(body)).status, 400);
    }
    const input = { requestId: id, confirmation: 'BACKUP_DATABASE' };
    assert.equal(
      (await post(input, { origin: 'https://untrusted.example.test' })).status,
      403
    );
    assert.equal(
      (await post(input, { 'content-type': 'text/plain' })).status,
      415
    );
    assert.equal((await post(input)).status, 503);
    await db.pool.query(
      'INSERT INTO database_backup_worker VALUES(TRUE,TRUE,NOW())'
    );
    const first = await post(input);
    assert.equal(first.status, 202);
    assert.match(first.headers.get('cache-control'), /no-store/);
    assert.equal((await first.json()).status, 'queued');
    assert.equal((await post(input)).status, 202);
    assert.equal(
      (await db.pool.query('SELECT * FROM database_backup_jobs')).rowCount,
      1
    );
    assert.equal(
      (await fetch(base + '/backups?requestId=invalid', { headers })).status,
      400
    );
    assert.equal(
      (await fetch(base + '/backups', { method: 'DELETE', headers })).status,
      405
    );
    const read = await (
      await fetch(base + '/backups?requestId=' + id, { headers })
    ).json();
    assert.equal(read.request.requestId, id);
  }
);
