import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { createRecoveryFixture, token } from './fixture.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (url) =>
  fetch(url, {
    headers: { Connection: 'close' },
    signal: AbortSignal.timeout(15000)
  });
const snapshot = async (pool) => {
  const tables = (
    await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
    )
  ).rows.map((r) => r.tablename);
  const result = {};
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error('Unexpected table.');
    const rows = (
      await pool.query(
        `SELECT to_jsonb(t)::text AS value FROM "${table}" t ORDER BY to_jsonb(t)::text`
      )
    ).rows;
    result[table] = {
      count: rows.length,
      sha256: digest(JSON.stringify(rows))
    };
  }
  return result;
};

test('backup scripts restore an isolated application with exact finances, documents, media and pending work; failed recovery stays stopped', async ({
  playwright
}, info) => {
  const fixture = await createRecoveryFixture();
  const { source, docker } = fixture;
  const pages = [];
  const id = Object.fromEntries(
    [
      'sponsor',
      'private',
      'invoice',
      'credit',
      'media',
      'privateMedia',
      'batch',
      'draft'
    ].map((key) => [key, randomUUID()])
  );
  const image = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#003c58' }
  })
    .webp()
    .toBuffer();
  const login = async (target, english = false) => {
    console.log('Recovery journey: opening administrator browser.');
    const context = await playwright.chromium.launchPersistentContext(
      await mkdtemp(join(tmpdir(), 'og7-recovery-browser-')),
      {
        viewport: english
          ? { width: 390, height: 844 }
          : { width: 1280, height: 900 }
      }
    );
    if (english)
      await context.addInitScript(() =>
        localStorage.setItem('openg7.language', 'en')
      );
    const page = context.pages()[0];
    pages.push(page);
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);
    await page.goto(target.origin + '/admin/login');
    await page.locator('input[type=password]').fill(token);
    await page.locator('button[type=submit]').click();
    await expect(page).toHaveURL(/\/admin\/fundraiser/);
    const session = await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-session-token')
    );
    return { page, headers: { Authorization: 'Bearer ' + session } };
  };
  let files, before, sourceDocuments, sourceTransparency, journeyError;
  try {
    await test.step('prepare a quiesced synthetic business snapshot and record application evidence', async () => {
      await source.pool.query(
        `INSERT INTO fund_contributions
        (id,contribution_type,amount_cents,currency,status,paid_at,public_display_consent,display_amount_consent,sponsor_company_name,sponsor_review_status,email_private,public_reference,stripe_session_id,payment_notification_recorded_at,sponsorship_followup_token_hash)
        VALUES($1,'sponsorship_interest',50000,'cad','paid','2026-09-01',true,true,'Atelier restauration','approved','private-recovery@example.test','OG7-RESTORE-500','cs_restore',now(),$3),
        ($2,'personal_support',5000,'cad','paid','2026-09-01',false,false,NULL,'pending_review','hidden-recovery@example.test','OG7-RESTORE-PRIVATE','cs_restore_private',now(),NULL)`,
        [
          id.sponsor,
          id.private,
          digest('synthetic-recovery-followup-token-00000000')
        ]
      );
      await source.pool.query(
        `UPDATE fund_contributions SET stripe_payment_intent_id=CASE WHEN id=$1 THEN 'pi_restore' ELSE 'pi_restore_private' END`,
        [id.sponsor]
      );
      await source.pool.query(
        'UPDATE fund_contributions SET non_charity_acknowledged=true'
      );
      await source.pool.query(
        'UPDATE fund_contributions SET sponsorship_followup_token_created_at=now() WHERE id=$1',
        [id.sponsor]
      );
      await source.pool
        .query(`INSERT INTO fund_transactions(stripe_event_id,stripe_object_id,stripe_balance_transaction_id,type,amount,fee,net,currency,status,created_at,public_category)
        VALUES('evt_restore_payment','pi_restore','txn_restore','payment_intent.succeeded',50000,1500,48500,'cad','succeeded','2026-09-01','contribution'),
        ('evt_restore_private','pi_restore_private','txn_restore_private','payment_intent.succeeded',5000,175,4825,'cad','succeeded','2026-09-01','contribution'),
        ('evt_restore_refund','re_restore',NULL,'charge.refunded',10000,0,-10000,'cad','succeeded','2026-09-02','refund')`);
      await source.pool.query(
        `INSERT INTO stripe_events(stripe_event_id,event_type,payload,processing_status,processed_at) VALUES('evt_restore_payment','payment_intent.succeeded','{"synthetic":true}','processed',now())`
      );
      await source.pool.query(
        `INSERT INTO sponsorship_invoices(id,contribution_id,invoice_number,stripe_session_id,currency,subtotal_cents,total_cents,issuer_name,sponsor_name,issued_at)
        VALUES($1,$2,'FAC-RESTORE-500','cs_restore','cad',50000,50000,'OpenG7 simulation','Atelier restauration','2026-09-01')`,
        [id.invoice, id.sponsor]
      );
      await source.pool.query(
        `INSERT INTO sponsorship_credit_notes(id,contribution_id,invoice_id,credit_note_number,invoice_number,stripe_refund_id,currency,subtotal_cents,total_cents,issuer_name,sponsor_name,issued_at)
        VALUES($1,$2,$3,'AV-RESTORE-100','FAC-RESTORE-500','re_restore','cad',10000,10000,'OpenG7 simulation','Atelier restauration','2026-09-02')`,
        [id.credit, id.sponsor, id.invoice]
      );
      await source.pool.query(
        `INSERT INTO sponsorship_followup_drafts(contribution_id,revision,data) VALUES($1,3,'{"companyName":"Saisie à reprendre"}')`,
        [id.sponsor]
      );
      await source.pool
        .query(`INSERT INTO email_messages(idempotency_key,template_key,recipient_email,from_email,subject,text_body,html_body,status,attempts)
        VALUES('restore:queued','fixture','recipient@example.test','sender@example.test','En attente','Private synthetic text','<p>Fixture</p>','queued',0),
        ('restore:sent','fixture','recipient@example.test','sender@example.test','Déjà envoyé','Private synthetic text','<p>Fixture</p>','sent',1),
        ('restore:failed','fixture','recipient@example.test','sender@example.test','Échoué','Private synthetic text','<p>Fixture</p>','failed',2)`);
      await source.pool.query(
        `INSERT INTO sponsor_publication_batches(id,channel,capacity,status) VALUES($1,'facebook',5,'open')`,
        [id.batch]
      );
      await source.pool.query(
        `INSERT INTO sponsor_publication_drafts(id,contribution_id,batch_id,feed_target,channel,title,body,disclosure_text) VALUES($1,$2,$3,'openg7','facebook','Publication à examiner','Private editorial fixture','Commandite')`,
        [id.draft, id.sponsor, id.batch]
      );
      await source.pool.query(
        `INSERT INTO social_publication_jobs(batch_id,channel,provider,mode,idempotency_key,title,body,disclosure_text) VALUES($1,'facebook','facebook','mock','restore:job','Publication en attente','Fixture','Commandite')`,
        [id.batch]
      );
      await source.pool.query(
        `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata) VALUES('fixture-owner','fixture.restoration','contribution',$1,'Synthetic audit retained','{"synthetic":true}')`,
        [id.sponsor]
      );
      for (const approved of [true, false]) {
        const mediaId = approved ? id.media : id.privateMedia;
        await source.pool.query(
          `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_storage_key,public_url,checksum_sha256,width,height)
          VALUES($1,$2,'supporting_image',$3,'fixture.webp','image/webp',$4,$5,$4,$6,$7,$8,$9,8,8)`,
          [
            mediaId,
            id.sponsor,
            approved ? 'approved' : 'pending_review',
            image.length,
            mediaId + '-original.webp',
            mediaId + '.webp',
            approved ? mediaId + '.webp' : null,
            approved ? '/api/public/sponsor-media/' + mediaId : null,
            digest(image)
          ]
        );
      }
      const imageFile = join(source.directory, 'image.webp');
      await writeFile(imageFile, image);
      await docker([
        'run',
        '--rm',
        '--entrypoint',
        'sh',
        '--mount',
        `type=volume,src=${source.project}-sponsor-logos,dst=/volume`,
        '--mount',
        `type=bind,src=${imageFile},dst=/image.webp,readonly`,
        'postgres:16-alpine',
        '-c',
        'mkdir -p /volume/media-assets/private /volume/media-assets/public; for id in "$1" "$2"; do cp /image.webp "/volume/media-assets/private/$id.webp"; cp /image.webp "/volume/media-assets/private/$id-original.webp"; done; cp /image.webp "/volume/media-assets/public/$1.webp"; chown -R 1000:1000 /volume',
        'sh',
        id.media,
        id.privateMedia
      ]);
      const admin = await login(source);
      console.log('Recovery journey: source documents.');
      const documentPaths = [
        `/api/admin/sponsorship-invoices/pdf?invoiceId=${id.invoice}`,
        `/api/admin/sponsorship-credit-notes/pdf?creditNoteId=${id.credit}`
      ];
      sourceDocuments = [];
      for (const path of documentPaths) {
        const response = await admin.page.request.get(source.origin + path, {
          headers: admin.headers
        });
        expect(response.status()).toBe(200);
        sourceDocuments.push({ path, sha256: digest(await response.body()) });
      }
      expect(
        (
          await admin.page.request.get(
            source.origin + '/api/public/sponsor-media/' + id.media
          )
        ).status()
      ).toBe(200);
      expect(
        (
          await admin.page.request.get(
            source.origin + '/api/public/sponsor-media/' + id.privateMedia
          )
        ).status()
      ).toBe(404);
      sourceTransparency = await (
        await read(source.origin + '/api/public/fund-transparency')
      ).json();
      delete sourceTransparency.generated_at;
      expect(sourceTransparency).toMatchObject({
        total_received: 550,
        total_fees: 16.75,
        total_refunded: 100,
        total_net: 533.25,
        current_available_estimate: 433.25,
        pending_fee_count: 0
      });
      await admin.page.context().close();
      await source.compose(['stop', 'api']); // Freeze writers before backing up DB and media.
      before = await snapshot(source.pool);
      const backup = await source.script('backup.sh');
      console.log('Recovery journey: backup finished.');
      expect(backup.output).toContain('Backup set complete');
      expect(backup.code).toBe(0);
      const directory = join(source.directory, 'backups');
      const names = await readdir(directory);
      files = {
        config: join(
          directory,
          names.find((n) => /^openg7-backup-.*\.tar\.gz$/.test(n))
        ),
        database: join(
          directory,
          names.find((n) => n.endsWith('.sql'))
        ),
        media: join(
          directory,
          names.find(
            (n) =>
              n.startsWith('openg7-sponsor-logos-') && n.endsWith('.tar.gz')
          )
        )
      };
      const manifest = JSON.parse(
        await readFile(files.config + '.manifest.json', 'utf8')
      );
      expect(Object.keys(manifest.artifacts).sort()).toEqual([
        'config',
        'database',
        'media'
      ]);
      expect(manifest.database).toBe('recovery');
      expect(JSON.stringify(manifest)).not.toContain(token);
    });
    await test.step('an interrupted backup never receives a completion manifest', async () => {
      await source.pool.end();
      source.pool = null;
      await source.compose(['stop', 'postgres']);
      const failedBackup = await source.script('backup.sh', [], {
        env: { ...fixture.env, BACKUP_DIR: './incomplete-backup' }
      });
      expect(failedBackup.code).not.toBe(0);
      expect(failedBackup.output).toContain('postgres service is not running');
      expect(
        (await readdir(join(source.directory, 'incomplete-backup'))).some(
          (name) => name.endsWith('.manifest.json')
        )
      ).toBe(false);
      await source.compose(['up', '-d', '--no-deps', 'postgres']);
      await source.connect();
      expect(await snapshot(source.pool)).toEqual(before);
    });
    const restoreArgs = (target, selected = files) => [
      '--target-project',
      target.project,
      '--config-backup',
      selected.config,
      '--database-dump',
      selected.database,
      '--sponsor-logos-backup',
      selected.media
    ];
    await test.step('reject incomplete, corrupt, cancelled and already-used recovery targets without modifying the source', async () => {
      const guard = await fixture.makeTarget('guard');
      const corrupt = join(guard.directory, 'corrupt.sql');
      await writeFile(
        corrupt,
        (await readFile(files.database)) + '\n-- corrupted\n'
      );
      const result = await guard.script('restore-from-backup.sh', [
        ...restoreArgs(guard, { ...files, database: corrupt }),
        '--force'
      ]);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('checksum mismatch');
      expect(
        (
          await guard.script('restore-from-backup.sh', [
            ...restoreArgs(guard, {
              ...files,
              media: join(guard.directory, 'missing.tar.gz')
            }),
            '--force'
          ])
        ).code
      ).not.toBe(0);
      const cancelled = await guard.script(
        'restore-from-backup.sh',
        restoreArgs(guard),
        { input: 'CANCEL\n' }
      );
      expect(cancelled.code).not.toBe(0);
      expect(cancelled.output).toContain('Restore cancelled');
      await expect(access(join(guard.directory, '.env'))).rejects.toThrow();
      const used = await guard.script('restore-from-backup.sh', [
        ...restoreArgs({ ...guard, project: source.project }),
        '--force'
      ]);
      expect(used.output).toContain('already has containers');
      const reservedVolume = guard.project + '-postgres-data';
      await docker(['volume', 'create', reservedVolume]);
      const createdAt = await docker([
        'volume',
        'inspect',
        '--format',
        '{{.CreatedAt}}',
        reservedVolume
      ]);
      const occupied = await guard.script('restore-from-backup.sh', [
        ...restoreArgs(guard),
        '--force'
      ]);
      expect(occupied.code).not.toBe(0);
      expect(occupied.output).toContain('Target volume already exists');
      expect(
        await docker([
          'volume',
          'inspect',
          '--format',
          '{{.CreatedAt}}',
          reservedVolume
        ])
      ).toBe(createdAt);
      expect(await snapshot(source.pool)).toEqual(before);
      expect(
        await docker([
          'ps',
          '-aq',
          '--filter',
          'label=com.docker.compose.project=' + guard.project
        ])
      ).toBe('');
    });
    await test.step('roll back a logically invalid SQL import and keep every application process stopped', async () => {
      const failed = await fixture.makeTarget('failed');
      const config = join(failed.directory, 'backup.tar.gz'),
        database = join(failed.directory, 'broken.sql');
      await writeFile(config, await readFile(files.config));
      const sql = Buffer.concat([
        await readFile(files.database),
        Buffer.from('\nSELECT nonexistent_recovery_function();\n')
      ]);
      await writeFile(database, sql);
      const manifest = JSON.parse(
        await readFile(files.config + '.manifest.json', 'utf8')
      );
      manifest.artifacts.database.sha256 = digest(sql);
      manifest.artifacts.database.bytes = sql.length;
      await writeFile(config + '.manifest.json', JSON.stringify(manifest));
      const result = await failed.script('restore-from-backup.sh', [
        ...restoreArgs(failed, { ...files, config, database }),
        '--force'
      ]);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('Database import failed');
      const db = await failed.connect();
      expect(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'"
          )
        ).rows[0].n
      ).toBe(0);
      expect(
        (
          await failed.compose([
            'ps',
            '--services',
            '--filter',
            'status=running'
          ])
        ).trim()
      ).toBe('postgres');
    });
    await test.step('restore the complete backup set and compare every table before activating the application', async () => {
      const target = await fixture.makeTarget('target');
      const result = await target.script('restore-from-backup.sh', [
        ...restoreArgs(target),
        '--force'
      ]);
      expect(result.output).toContain('Restore completed');
      expect(result.code).toBe(0);
      const pool = await target.connect();
      expect(await snapshot(pool)).toEqual(before);
      expect(
        (
          await target.compose([
            'ps',
            '--services',
            '--filter',
            'status=running'
          ])
        ).trim()
      ).toBe('postgres');
      const second = await target.script('restore-from-backup.sh', [
        ...restoreArgs(target),
        '--force'
      ]);
      expect(second.code).not.toBe(0);
      expect(second.output).toContain('already has .env');
      expect(await snapshot(pool)).toEqual(before);
      await target.startWeb();
      await target.startApi();
      const admin = await login(target);
      for (const document of sourceDocuments) {
        const response = await admin.page.request.get(
          target.origin + document.path,
          { headers: admin.headers }
        );
        expect(response.status()).toBe(200);
        expect(digest(await response.body())).toBe(document.sha256);
        expect((await read(target.origin + document.path)).status).toBe(401);
      }
      const privateMediaUrl =
        target.origin +
        '/api/admin/sponsorships/media/content/' +
        id.privateMedia;
      const privateMedia = await admin.page.request.get(privateMediaUrl, {
        headers: admin.headers
      });
      expect(privateMedia.status()).toBe(200);
      expect(digest(await privateMedia.body())).toBe(digest(image));
      expect(privateMedia.headers()['cache-control']).toBe('private, no-store');
      expect((await read(privateMediaUrl)).status).toBe(401);
      const publicImage = await read(
        target.origin + '/api/public/sponsor-media/' + id.media
      );
      expect(publicImage.status).toBe(200);
      expect(digest(Buffer.from(await publicImage.arrayBuffer()))).toBe(
        digest(image)
      );
      expect(
        (
          await read(
            target.origin + '/api/public/sponsor-media/' + id.privateMedia
          )
        ).status
      ).toBe(404);
      const transparency = await (
        await read(target.origin + '/api/public/fund-transparency')
      ).json();
      delete transparency.generated_at;
      expect(transparency).toEqual(sourceTransparency);
      expect(JSON.stringify(transparency)).not.toMatch(
        /private-recovery|hidden-recovery|synthetic-recovery-followup/
      );
      const draft = await read(
        target.origin +
          '/api/sponsorship-followup/draft?token=synthetic-recovery-followup-token-00000000'
      );
      expect(draft.status).toBe(200);
      expect(await draft.json()).toMatchObject({
        revision: 3,
        data: { companyName: 'Saisie à reprendre' }
      });
      await admin.page.goto(target.origin + '/admin/fundraiser/contributions');
      await expect(admin.page.locator('main')).toContainText(
        'Atelier restauration'
      );
      await admin.page.goto(target.origin + '/admin/fundraiser/invoices');
      await expect(admin.page.locator('main')).toContainText('FAC-RESTORE-500');
      await admin.page.goto(target.origin + '/admin/fundraiser/email-queue');
      await expect(admin.page.locator('main')).toContainText('En attente');
      const mobile = admin;
      await mobile.page.setViewportSize({ width: 390, height: 844 });
      await mobile.page.evaluate(() =>
        localStorage.setItem('openg7.language', 'en')
      );
      const publicPage = await mobile.page.goto(
        target.origin + '/en/fonds-des-batisseurs/transparence'
      );
      expect(publicPage.status()).toBe(200);
      await expect(mobile.page.locator('main')).toContainText('550');
      expect(
        await mobile.page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
      await info.attach('restored-mobile', {
        body: await mobile.page.screenshot(),
        contentType: 'image/png'
      });
      // Uniqueness constraints and sequences survive restore; the rolled-back probe creates no financial fact.
      const probe = await pool.connect();
      await probe.query('BEGIN');
      try {
        expect(
          (
            await probe.query(
              "INSERT INTO stripe_events(stripe_event_id,event_type,payload) VALUES('evt_restore_payment','payment_intent.succeeded','{}') ON CONFLICT DO NOTHING RETURNING id"
            )
          ).rowCount
        ).toBe(0);
        const last = Number(
          (await probe.query('SELECT max(id) AS id FROM fund_transactions'))
            .rows[0].id
        );
        const next = (
          await probe.query(
            "INSERT INTO fund_transactions(stripe_event_id,stripe_object_id,type,amount,fee,net,currency,status,created_at,public_category) VALUES('evt_sequence_probe','pi_probe','payment',100,0,100,'cad','succeeded',now(),'personal_support') RETURNING id"
          )
        ).rows[0].id;
        expect(Number(next)).toBeGreaterThan(last);
      } finally {
        await probe.query('ROLLBACK');
        probe.release();
      }
      expect(await snapshot(pool)).toEqual(before);
      expect(await snapshot(source.pool)).toEqual(before);
      await info.attach('restored-table-evidence', {
        body: Buffer.from(JSON.stringify(before, null, 2)),
        contentType: 'application/json'
      });
      // Explicit isolated resumption: absence of the switch retains the previous default.
      // SMTP stays disabled, so this proves claims resume without sending external mail.
      await admin.page.context().close();
      const configurationPath = join(target.directory, 'docker-compose.yml');
      const configuration = JSON.parse(
        await readFile(configurationPath, 'utf8')
      );
      delete configuration.services.api.environment
        .FUNDING_EMAIL_WORKER_ENABLED;
      await writeFile(configurationPath, JSON.stringify(configuration));
      await target.startApi();
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT attempts FROM email_messages WHERE idempotency_key='restore:queued'"
              )
            ).rows[0].attempts
        )
        .toBe(1);
      expect(
        (
          await pool.query(
            "SELECT status,attempts FROM email_messages WHERE idempotency_key='restore:sent'"
          )
        ).rows[0]
      ).toEqual({ status: 'sent', attempts: 1 });
      expect(await snapshot(source.pool)).toEqual(before);
    });
  } catch (error) {
    journeyError = error;
    throw error;
  } finally {
    for (const page of pages)
      await page
        .context()
        .close()
        .catch(() => {});
    try {
      await fixture.stop();
    } catch (error) {
      if (!journeyError) throw error;
      console.warn('Recovery fixture cleanup failed:', error.code || 'unknown');
    }
  }
});
