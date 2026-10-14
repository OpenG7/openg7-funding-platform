import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { test, expect, type BrowserContext } from '@playwright/test';

import {
  claimBackup,
  executeBackup
} from '../../apps/funding-api/src/database-backup/worker.js';
import { BackupStorage } from '../../apps/funding-api/src/database-backup/storage.js';
import { createAgeFixture } from '../integration/support/age-fixture.mjs';

import { startIdentityStack } from './stack.mjs';
import { openAdminIdentity } from './support/admin-browser.js';
import { startBackupObjectStore } from './support/backup-object-store.mjs';

test('admin backup request: OIDC confirmation, lost response, one real encrypted dump and verified local object, roles and revocation', async ({
  playwright
}) => {
  test.setTimeout(180000);
  const stack = await startIdentityStack();
  let temporaryDirectory: string | undefined;
  let stopObjectStore: (() => Promise<void>) | undefined;
  const contexts: BrowserContext[] = [];
  let storage: BackupStorage | undefined;
  try {
    const directory = await mkdtemp(join(tmpdir(), 'og7-backup-journey-'));
    temporaryDirectory = directory;
    const objectStore = await startBackupObjectStore(
      join(directory, 'objects')
    );
    stopObjectStore = () => objectStore.stop();
    const age = createAgeFixture(directory);
    const config = {
      databaseUrl: 'disposable://identity-fixture',
      directory,
      recipient: age.recipient,
      endpoint: objectStore.origin,
      region: 'us-east-1',
      bucket: 'backup-journey',
      namespace: 'synthetic',
      accessKeyId: 'fixture',
      secretAccessKey: 'synthetic-only'
    };
    storage = new BackupStorage(config);
    await storage.check(AbortSignal.timeout(10000));
    await stack.pool.query(
      'INSERT INTO database_backup_worker VALUES(TRUE,TRUE,NOW())'
    );
    await stack.pool.query(
      'CREATE TABLE backup_journey_fact(amount BIGINT NOT NULL); INSERT INTO backup_journey_fact VALUES(9007199254740993)'
    );
    const owner = await openAdminIdentity(
      playwright.chromium,
      stack.origin,
      '/admin/fundraiser/setup?section=backups'
    );
    contexts.push(owner.context);
    const page = owner.page;
    const headers = { Origin: stack.origin };
    const panel = page.locator('[data-og7="setup-backups"]');
    const request = panel.locator('[data-og7="backup-request"]');
    const jobs = async () =>
      (
        await stack.pool.query(
          'SELECT request_id,status,bytes::text,sha256,retain_until FROM database_backup_jobs'
        )
      ).rows;
    await expect(request).toBeEnabled();
    await request.click();
    await page.keyboard.press('Escape');
    expect(await jobs()).toEqual([]);
    const requests: { requestId: string; confirmation: string }[] = [];
    page.on('request', (r) => {
      if (
        new URL(r.url()).pathname === '/api/admin/backups' &&
        r.method() === 'POST'
      )
        requests.push(r.postDataJSON());
    });
    let finishDrop!: () => void;
    const responseDropped = new Promise<void>((resolve) => {
      finishDrop = resolve;
    });
    await page.route('**/api/admin/backups', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const answer = await route.fetch({ maxRetries: 0 });
      expect(answer.status()).toBe(202);
      await route.abort('failed');
      finishDrop();
    });
    await request.click();
    await page.locator('[data-og7="confirm-action"]').click();
    await responseDropped;
    await expect(panel.locator('[data-og7="backup-uncertain"]')).toBeVisible();
    await page.unroute('**/api/admin/backups');
    expect(requests).toHaveLength(1);
    const requestId = requests[0]!.requestId;
    expect(requests[0]!.confirmation).toBe('BACKUP_DATABASE');
    expect(await jobs()).toMatchObject([
      { request_id: requestId, status: 'queued' }
    ]);
    await page.reload();
    await expect(panel.locator('[data-og7="backup-receipt"]')).toHaveAttribute(
      'data-state',
      'queued'
    );
    expect(requests).toHaveLength(1);
    expect(await claimBackup(stack.pool)).toBe(requestId);
    expect(await claimBackup(stack.pool)).toBeNull();
    let captures = 0;
    // Real PostgreSQL 16 dump from this stack's disposable Docker database and
    // real age encryption. The production captureDatabase subprocess adapter has
    // its own image-level recipe; this adapter keeps the browser recipe portable.
    await executeBackup(
      stack.pool,
      config,
      requestId,
      storage,
      AbortSignal.timeout(30000),
      async (_config, id, signal) => {
        captures++;
        signal.throwIfAborted();
        const sql = await stack.dumpDatabase();
        const encrypted = age.encrypt(Buffer.from(sql));
        const target = join(directory, id);
        await mkdir(target, { mode: 0o700 });
        const file = join(target, 'database.sql.age');
        await writeFile(file, encrypted, { mode: 0o600, flag: 'wx' });
        return {
          file,
          bytes: encrypted.length,
          sha256: createHash('sha256').update(encrypted).digest('hex')
        };
      }
    );
    expect(captures).toBe(1);
    const [completed] = await jobs();
    expect(completed).toMatchObject({
      request_id: requestId,
      status: 'succeeded'
    });
    expect(Number(completed!.bytes)).toBeGreaterThan(0);
    const receipt = JSON.parse(
      await readFile(join(directory, requestId, 'receipt.json'), 'utf8')
    );
    expect(receipt.sha256).toBe(completed!.sha256);
    await storage.verify(requestId, receipt, AbortSignal.timeout(10000));
    expect(objectStore.uploads()).toBe(1);
    expect(age.decrypt(objectStore.file(requestId)).toString('utf8')).toContain(
      '9007199254740993'
    );
    expect(
      (await readFile(objectStore.file(requestId))).includes(
        Buffer.from('backup_journey_fact')
      )
    ).toBe(false);
    expect(Date.parse(receipt.retainUntil)).toBeGreaterThan(
      Date.now() + 29 * 86400000
    );
    await expect(
      storage.upload(
        requestId,
        objectStore.file(requestId),
        receipt,
        AbortSignal.timeout(10000)
      )
    ).rejects.toThrow();
    expect(objectStore.uploads()).toBe(1);
    expect(await claimBackup(stack.pool)).toBeNull();
    await page.reload();
    await expect(
      panel
        .locator('[data-og7="backup-history-row"]')
        .first()
        .locator('[data-state="succeeded"]')
        .last()
    ).toBeVisible();
    expect(requests).toHaveLength(1);
    const audits = (
      await stack.pool.query(
        'SELECT actor,action,metadata FROM admin_audit_log WHERE entity_id=$1 ORDER BY created_at',
        [requestId]
      )
    ).rows;
    expect(audits.map((a) => a.action)).toEqual([
      'database_backup.queued',
      'database_backup.running',
      'database_backup.succeeded'
    ]);
    expect(audits[0]!.actor).toMatch(/^admin:/);
    for (const secret of [directory, 'synthetic-only', 'backup_journey_fact'])
      expect(JSON.stringify(audits)).not.toContain(secret);
    for (const role of ['operator', 'reader']) {
      expect(
        (
          await page.request.post('/api/admin/access', {
            headers,
            data: {
              subject: 'fixture-' + role,
              confirmation: 'fixture-' + role,
              displayName: role,
              role,
              disabled: false
            }
          })
        ).status()
      ).toBe(200);
      const other = await openAdminIdentity(
        playwright.chromium,
        stack.origin,
        '/admin/fundraiser/setup?section=backups',
        role
      );
      contexts.push(other.context);
      await expect(
        other.page.locator('[data-og7="backup-request"]')
      ).toHaveCount(0);
      expect(
        (
          await other.page.request.post('/api/admin/backups', {
            headers,
            data: { requestId: randomUUID(), confirmation: 'BACKUP_DATABASE' }
          })
        ).status()
      ).toBe(403);
    }
    expect(
      (
        await page.request.post('/api/admin/access', {
          headers,
          data: {
            subject: 'fixture-operator',
            confirmation: 'fixture-operator',
            displayName: 'Second owner',
            role: 'owner',
            disabled: false
          }
        })
      ).status()
    ).toBe(200);
    const secondOwner = await openAdminIdentity(
      playwright.chromium,
      stack.origin,
      '/admin/fundraiser/setup?section=backups',
      'operator'
    );
    contexts.push(secondOwner.context);
    await stack.pool.query(
      'UPDATE database_backup_worker SET checked_at=NOW()'
    );
    await page.reload();
    await request.click();
    expect(
      (
        await secondOwner.page.request.post('/api/admin/access', {
          headers,
          data: {
            subject: 'fixture-owner',
            confirmation: 'fixture-owner',
            displayName: 'Former owner',
            role: 'reader',
            disabled: false
          }
        })
      ).status()
    ).toBe(200);
    const revoked = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/admin/backups' &&
        r.request().method() === 'POST'
    );
    await page.locator('[data-og7="confirm-action"]').click();
    expect((await revoked).status()).toBe(401);
    await expect(panel).toContainText('Votre session a expiré');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(panel.locator('[data-og7="backup-history-row"]')).toHaveCount(
      0
    );
    await expect(panel.locator('[data-og7="backup-receipt"]')).toHaveCount(0);
    await expect(request).toBeDisabled();
    await expect(page.locator('body')).not.toContainText(completed!.sha256);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem('openg7-admin-session-token')
      )
    ).toBeNull();
    expect(await jobs()).toHaveLength(1);
    expect(captures).toBe(1);
  } finally {
    storage?.client.destroy();
    await Promise.all(contexts.map((c) => c.close()));
    await stack.stop();
    await stopObjectStore?.();
    if (
      temporaryDirectory &&
      !resolve(temporaryDirectory).startsWith(resolve(tmpdir()) + sep)
    )
      throw new Error(
        'Backup fixture cleanup must stay in its temporary directory'
      );
    if (temporaryDirectory)
      await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
