import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { AdminPilotageService } from '../../dist/apps/funding-api/src/admin-pilotage.service.js';

test(
  'pilotage commands and projections on disposable PostgreSQL',
  { timeout: 180000 },
  async (t) => {
    const db = await startDisposablePostgres({ migrate: false });
    t.after(db.stop);
    const pool = db.pool;
    const migrations = new URL(
      '../../apps/funding-api/migrations/',
      import.meta.url
    );
    for (const file of (await readdir(migrations))
      .filter((f) => f.endsWith('.sql') && f < '024')
      .sort())
      await pool.query(await readFile(new URL(file, migrations), 'utf8'));
    await pool.query(
      await readFile(
        new URL('026_create_publication_worker_settings.sql', migrations),
        'utf8'
      )
    );
    const automation = new PublicationAutomationService(
      pool,
      { readPrivateObject: async () => null },
      {
        SOCIAL_PUBLICATION_MODE: 'mock',
        SOCIAL_PUBLICATION_WORKER_ENABLED: 'true'
      }
    );
    const pilot = new AdminPilotageService(pool, automation);
    const actor = 'fixture-operator';
    const command = (action, targetId, version, payload) => ({
      requestId: randomUUID(),
      action,
      targetId,
      version: String(version),
      confirmation: targetId,
      ...(payload ? { payload } : {})
    });
    await automation.command(
      { action: 'check', feedId: 'openg7:facebook' },
      actor
    );
    const { id } = await automation.command(
      {
        action: 'compose',
        feedId: 'openg7:facebook',
        kind: 'news',
        message: 'Exact fixture publication',
        scheduledAt: new Date(Date.now() + 3600000).toISOString()
      },
      actor
    );
    await t.test(
      '024 upgrades an existing 023 database without rewriting its proposal',
      async () => {
        const before = await pilot.state();
        assert.equal(before.writable, false);
        assert.ok(before.missingSources.includes('commands'));
        await pool.query(
          await readFile(
            new URL('024_create_admin_command_receipts.sql', migrations),
            'utf8'
          )
        );
        const after = await pilot.state();
        assert.equal(after.writable, true);
        assert.equal(
          after.decisions.find((d) => d.targetId === id).version,
          '1'
        );
      }
    );
    await t.test(
      'projection and reader state do not invent success',
      async () => {
        const state = await pilot.state();
        assert.equal(state.coverage, 'complete');
        assert.ok(state.decisions.some((d) => d.targetId === id));
        const reader = await pilot.state({}, false);
        assert.ok(
          reader.decisions.every((d) =>
            d.actions.every((a) => a.blocked === 'READ_ONLY')
          )
        );
        await assert.rejects(
          pilot.command(command('publication.approve', id, 1), actor, false),
          { code: 'READ_ONLY' }
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM admin_command_receipts'
            )
          ).rows[0].n,
          0
        );
      }
    );
    await t.test(
      'concurrent duplicate approval changes domain exactly once; receipts are actor-bound',
      async () => {
        const c = command('publication.approve', id, 1);
        const results = await Promise.all([
          pilot.command(c, actor),
          pilot.command(c, actor)
        ]);
        assert.ok(results.some((r) => r.status === 'completed'));
        assert.equal((await pilot.command(c, actor)).status, 'completed');
        assert.equal(
          (await automation.state()).deliveries.find((d) => d.id === id)
            .version,
          2
        );
        assert.equal(
          await pilot.readReceipt(c.requestId, 'another-operator'),
          null
        );
        await assert.rejects(
          pilot.command({ ...c, action: 'publication.reject' }, actor),
          { code: 'REQUEST_CONFLICT' }
        );
        const stale = await pilot.command(
          command('publication.reject', id, 1),
          actor
        );
        assert.equal(stale.status, 'failed');
      }
    );
    await t.test(
      'email preview is opt-in and retries enqueue once with an audit',
      async () => {
        const emailId = randomUUID();
        await pool.query(
          `INSERT INTO email_messages(id,idempotency_key,template_key,recipient_email,from_email,subject,text_body,html_body,status,max_attempts) VALUES($1,$2,'fixture','fixture@example.test','sender@example.test','Fixture subject','Private fixture text','<p>Fixture</p>','failed',3)`,
          [emailId, randomUUID()]
        );
        const state = await pilot.state({ domain: 'email' });
        const card = state.decisions.find((d) => d.targetId === emailId);
        assert.ok(card);
        assert.equal(card.email, undefined);
        const detail = await pilot.state({ id: card.id });
        assert.equal(detail.decisions[0].email.text, 'Private fixture text');
        const c = command('email.retry', emailId, card.version);
        assert.equal((await pilot.command(c, actor)).code, 'EMAIL_QUEUED');
        assert.equal((await pilot.command(c, actor)).status, 'completed');
        const row = (
          await pool.query(
            'SELECT status,sent_at FROM email_messages WHERE id=$1',
            [emailId]
          )
        ).rows[0];
        assert.equal(row.status, 'queued');
        assert.equal(row.sent_at, null);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM admin_audit_log WHERE action='pilotage.email.retry_queued' AND entity_id=$1",
              [emailId]
            )
          ).rows[0].n,
          1
        );
      }
    );
    await t.test(
      'sponsor review stays private, requires photo and compares version',
      async () => {
        const sponsorId = randomUUID();
        await pool.query(
          `INSERT INTO fund_contributions(id,contribution_type,amount_cents,status,public_display_consent,sponsor_review_status,sponsor_company_name) VALUES($1,'sponsorship_interest',10000,'paid',TRUE,'pending_review','Fixture company')`,
          [sponsorId]
        );
        await pool.query(
          "UPDATE fund_contributions SET sponsor_details_submitted_at=NOW(),sponsor_contact_email='contact@example.test' WHERE id=$1",
          [sponsorId]
        );
        await pool.query(
          `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,checksum_sha256,width,height,alt_text) VALUES($1,$2,'supporting_image','pending_review','fixture.png','image/png',1,$3,1,$4,$5,2,2,'Fixture image')`,
          [
            randomUUID(),
            sponsorId,
            randomUUID() + '/original',
            randomUUID() + '/processed',
            '0'.repeat(64)
          ]
        );
        const state = await pilot.state({ domain: 'sponsors' });
        const card = state.decisions.find(
          (d) =>
            d.targetId === sponsorId && d.kind === 'sponsorship_needs_review'
        );
        assert.ok(card);
        assert.equal(card.actions[0].blocked, 'SPONSOR_MEDIA_REQUIRED');
        const failed = await pilot.command(
          command('sponsor.approve', sponsorId, card.version),
          actor
        );
        assert.equal(failed.code, 'SPONSOR_MEDIA_REQUIRED');
        const rejected = await pilot.command(
          command('sponsor.reject', sponsorId, card.version, {
            reason: 'Fixture review declined'
          }),
          actor
        );
        assert.equal(rejected.status, 'completed');
        await pool.query(
          "UPDATE fund_contributions SET sponsor_review_status='pending_review',updated_at=NOW() WHERE id=$1",
          [sponsorId]
        );
        await pool.query(
          "UPDATE sponsor_media_assets SET review_status='approved',public_storage_key='fixture/public',public_url='https://example.test/fixture.webp' WHERE contribution_id=$1",
          [sponsorId]
        );
        const fresh = (
          await pilot.state({ domain: 'sponsors' })
        ).decisions.find(
          (d) =>
            d.targetId === sponsorId && d.kind === 'sponsorship_needs_review'
        );
        assert.equal(
          (
            await pilot.command(
              command('sponsor.approve', sponsorId, fresh.version),
              actor
            )
          ).status,
          'completed'
        );
        assert.equal(
          (
            await pool.query(
              'SELECT sponsor_site_visibility_held FROM fund_contributions WHERE id=$1',
              [sponsorId]
            )
          ).rows[0].sponsor_site_visibility_held,
          true
        );
        assert.equal(
          (
            await pool.query(
              'SELECT status FROM fund_contributions WHERE id=$1',
              [sponsorId]
            )
          ).rows[0].status,
          'paid'
        );
      }
    );
    await t.test(
      'unknown result is never replayed after worker crash',
      async () => {
        const c = command('publication.reject', id, 2);
        const broken = new AdminPilotageService(pool, {
          ...automation,
          command: async () => {
            throw new Error('network failure');
          }
        });
        assert.equal((await broken.command(c, actor)).status, 'uncertain');
        assert.equal((await pilot.command(c, actor)).status, 'uncertain');
        const input = {
          requestId: c.requestId,
          confirmation: c.requestId,
          reason: 'Verified the record and audit; no delivery was attempted.'
        };
        await assert.rejects(pilot.acknowledgeReceipt(input, 'other-actor'), {
          code: 'RECEIPT_NOT_UNCERTAIN'
        });
        const reviewed = await pilot.acknowledgeReceipt(input, actor);
        assert.equal(reviewed.status, 'uncertain');
        assert.ok(reviewed.reviewedAt);
        assert.equal(
          (await pilot.acknowledgeReceipt(input, actor)).reviewedAt,
          reviewed.reviewedAt
        );
        assert.equal((await pilot.command(c, actor)).status, 'uncertain');
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM admin_audit_log WHERE action='pilotage.incident_reviewed' AND metadata->>'requestId'=$1",
              [c.requestId]
            )
          ).rows[0].n,
          1
        );
        assert.equal(
          (await automation.state()).deliveries.find((d) => d.id === id).status,
          'approved'
        );
      }
    );
    await t.test(
      'feed pause has version protection and owner-only project commands cannot be elevated',
      async () => {
        const feed = (await pilot.state()).feeds.find(
          (f) => f.id === 'openg7:facebook'
        );
        const c = command('feed.resume', feed.id, feed.version);
        assert.equal((await pilot.command(c, actor)).status, 'completed');
        assert.equal(
          (
            await pilot.command(
              command('feed.pause', feed.id, feed.version),
              actor
            )
          ).code,
          'VERSION_CONFLICT'
        );
        await assert.rejects(
          pilot.command(
            command('project.publish', '1', 'fixture'),
            actor,
            true,
            false
          ),
          { code: 'READ_ONLY' }
        );
      }
    );
    await t.test(
      'publishing a project preserves its financial amount and requires a fresh version',
      async () => {
        const p = (
          await pool.query(
            "INSERT INTO fund_allocations(project_name,public_description,amount_allocated,currency,status) VALUES('Fixture project','Approved public description',12345,'CAD','draft') RETURNING id::text AS id"
          )
        ).rows[0];
        const card = (await pilot.state({ domain: 'projects' })).decisions.find(
          (d) => d.targetId === p.id
        );
        assert.ok(card);
        assert.equal(
          (
            await pilot.state({ domain: 'projects' }, true, false)
          ).decisions.find((d) => d.targetId === p.id).actions[0].blocked,
          'READ_ONLY'
        );
        const c = command('project.publish', p.id, card.version);
        assert.equal((await pilot.command(c, actor)).status, 'completed');
        assert.equal(
          (
            await pilot.command(
              command('project.publish', p.id, card.version),
              actor
            )
          ).code,
          'VERSION_CONFLICT'
        );
        const row = (
          await pool.query(
            'SELECT amount_allocated::text,status FROM fund_allocations WHERE id=$1',
            [p.id]
          )
        ).rows[0];
        assert.equal(row.amount_allocated, '12345');
        assert.equal(row.status, 'published');
      }
    );
    await t.test(
      'real HTTP routes enforce OIDC roles, origin, receipt ownership and closed catalog',
      async () => {
        await pool.query(
          await readFile(
            new URL(
              '025_create_publication_editorial_profiles.sql',
              migrations
            ),
            'utf8'
          )
        );
        const issuer = 'https://issuer.example.test/',
          origin = 'http://127.0.0.1:4179';
        const cookies = {};
        for (const role of ['reader', 'operator', 'owner']) {
          const token = randomBytes(32).toString('base64url'),
            account = randomUUID();
          cookies[role] = 'og7-admin=' + token;
          await pool.query(
            'INSERT INTO admin_accounts(id,issuer,subject,display_name,role) VALUES($1,$2,$3,$3,$3)',
            [account, issuer, role]
          );
          await pool.query(
            "INSERT INTO admin_identity_sessions(account_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",
            [account, createHash('sha256').update(token).digest('hex')]
          );
        }
        const options = pool.options;
        const child = spawn(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `
     import http from 'node:http';
     const listen=http.Server.prototype.listen;
     http.Server.prototype.listen=function(_port,callback){return listen.call(this,0,'127.0.0.1',()=>{console.log('TEST_PORT='+this.address().port);callback?.();});};
     await import('./dist/apps/funding-api/src/main.js');
   `
          ],
          {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
            env: {
              PATH: process.env.PATH,
              SystemRoot: process.env.SystemRoot,
              FUNDING_API_PORT: '0',
              DATABASE_URL: `postgresql://${encodeURIComponent(options.user)}:${encodeURIComponent(options.password)}@127.0.0.1:${options.port}/${options.database}`,
              FUNDING_ADMIN_AUTH_MODE: 'oidc',
              FUNDING_ADMIN_OIDC_ISSUER: issuer,
              FUNDING_ADMIN_OIDC_CLIENT_ID: 'fixture',
              FUNDING_ADMIN_OIDC_CLIENT_SECRET: randomUUID(),
              FUNDING_PUBLIC_BASE_URL: origin,
              FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'false',
              FUNDING_EMAIL_WORKER_ENABLED: 'false',
              SOCIAL_PUBLICATION_WORKER_ENABLED: 'false',
              SOCIAL_PUBLICATION_MODE: 'mock'
            }
          }
        );
        t.after(async () => {
          if (child.exitCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
          }
        });
        const port = await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Fixture API did not start')),
            15000
          );
          let output = '';
          child.on('error', reject);
          child.on('exit', () => {
            clearTimeout(timer);
            reject(new Error('Fixture API exited'));
          });
          child.stdout.on('data', (chunk) => {
            output += chunk;
            const match = output.match(/TEST_PORT=(\d+)/);
            if (match) {
              clearTimeout(timer);
              resolve(Number(match[1]));
            }
          });
        });
        const base = `http://127.0.0.1:${port}`;
        for (const prefix of ['/admin', '/api/admin']) {
          const automationUrl = base + prefix + '/publication-automation';
          const workerCommand = {
            action: 'worker',
            enabled: false,
            version: 1,
            confirmation: 'disable-worker'
          };
          const changeWorker = (
            role,
            originHeader = true,
            command = workerCommand
          ) =>
            fetch(automationUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(role ? { cookie: cookies[role] } : {}),
                ...(originHeader ? { origin } : {})
              },
              body: JSON.stringify(command)
            });
          assert.equal((await changeWorker(null)).status, 401);
          assert.equal((await changeWorker('reader')).status, 403);
          assert.equal((await changeWorker('operator')).status, 403);
          assert.equal((await changeWorker('owner', false)).status, 403);
          assert.equal(
            (
              await changeWorker('owner', true, {
                ...workerCommand,
                confirmation: ''
              })
            ).status,
            400
          );
          assert.equal((await changeWorker('owner')).status, 200);
          const workerState = await fetch(automationUrl, {
            headers: { cookie: cookies.reader }
          });
          assert.equal(workerState.status, 200);
          assert.equal((await workerState.json()).workerEnabled, false);
          const url = base + prefix + '/pilotage';
          assert.equal((await fetch(url)).status, 401);
          const reader = await fetch(url, {
            headers: { cookie: cookies.reader }
          });
          assert.equal(reader.status, 200);
          assert.equal((await reader.json()).writable, false);
          const post = (role, body, withOrigin = true) =>
            fetch(url + '/command', {
              method: 'POST',
              headers: {
                cookie: cookies[role],
                'Content-Type': 'application/json',
                ...(withOrigin ? { origin } : {})
              },
              body: typeof body === 'string' ? body : JSON.stringify(body)
            });
          const programme = await fetch(url + '/programme', {
            headers: { cookie: cookies.reader }
          });
          assert.equal(programme.status, 200);
          assert.equal((await programme.json()).writable, false);
          assert.match(programme.headers.get('cache-control'), /no-store/);
          assert.equal((await fetch(url + '/programme')).status, 401);
          const preparation = (role, suffix, body, originHeader = true) =>
            fetch(url + suffix, {
              method: 'POST',
              headers: {
                cookie: cookies[role],
                'Content-Type': 'application/json',
                ...(originHeader ? { origin } : {})
              },
              body: JSON.stringify(body)
            });
          assert.equal(
            (
              await preparation('reader', '/programme', {
                feedId: 'openg7:facebook',
                cadence: 2,
                includeApproved: false
              })
            ).status,
            403
          );
          assert.equal(
            (
              await preparation(
                'operator',
                '/programme',
                {
                  feedId: 'openg7:facebook',
                  cadence: 2,
                  includeApproved: false
                },
                false
              )
            ).status,
            403
          );
          assert.equal(
            (
              await preparation('operator', '/programme', {
                feedId: 'openg7:facebook',
                cadence: 2,
                includeApproved: false
              })
            ).status,
            200
          );
          assert.equal(
            (
              await preparation('operator', '/variant', {
                id,
                version: 2,
                instruction: 'execute arbitrary command'
              })
            ).status,
            400
          );
          const c = command('publication.reject', id, 2);
          assert.equal((await post('reader', c)).status, 403);
          assert.equal((await post('operator', c, false)).status, 403);
          assert.equal(
            (await post('operator', { ...c, action: 'refund' })).status,
            400
          );
          assert.equal(
            (await post('operator', command('project.publish', '1', 'fixture')))
              .status,
            403
          );
          assert.equal((await post('operator', '{')).status, 400);
          const result = await post('operator', c);
          assert.equal(result.status, 200);
          assert.match(result.headers.get('cache-control'), /no-store/);
          const r = await result.json();
          assert.equal(r.status, prefix === '/admin' ? 'completed' : 'failed');
          assert.equal(
            (
              await fetch(url + '/receipt?id=' + c.requestId, {
                headers: { cookie: cookies.owner }
              })
            ).status,
            404
          );
          assert.equal(
            (
              await fetch(url + '/receipt?id=' + c.requestId, {
                headers: { cookie: cookies.operator }
              })
            ).status,
            200
          );
        }
      }
    );
    await t.test(
      'calendar lookup identifies the correct page beyond thirty decisions',
      async () => {
        await pool.query(
          "INSERT INTO publication_deliveries(feed_id,kind,message,scheduled_at,account_id,mode) SELECT 'openg7:facebook','news','Fixture page '||i,NOW()+INTERVAL '1 day','fixture','mock' FROM generate_series(1,31) i"
        );
        const second = await pilot.state({ domain: 'publications', page: 2 });
        assert.ok(second.decisions.length);
        const focus = await pilot.state({
          domain: 'publications',
          id: second.decisions[0].id
        });
        assert.equal(focus.focusPage, 2);
        assert.equal(focus.decisions[0].id, second.decisions[0].id);
      }
    );
  }
);
