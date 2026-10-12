import assert from 'node:assert/strict';
import test from 'node:test';

import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import {
  claimNextDelivery,
  expireClaims,
  abandonClaim,
  lockClaim,
  assertDispatchClaim
} from '../../dist/apps/funding-api/src/publication-automation/claims.js';
import {
  finishAccountClaim,
  LIVE_ACCOUNT_INTERVAL_MS
} from '../../dist/apps/funding-api/src/publication-automation/account-reservations.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';
import { fixtureModerationDecision } from './support/moderation-fixture.mjs';
import { recordModerationDecision } from '../../dist/apps/funding-api/src/moderation/repository.js';
import { handleDeliveryFailure } from '../../dist/apps/funding-api/src/publication-automation/delivery-outcomes.js';

test(
  'provider-account reservations use real PostgreSQL locks and clock',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const pool = database.pool;
    const unknownRequests = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
      const path = String(url);
      if (path === 'https://account-reservation.test/facebook/me?fields=id')
        return Response.json({ id: '20' });
      if (
        path ===
        'https://account-reservation.test/linkedin/organizationAcls?q=roleAssignee&state=APPROVED'
      )
        return Response.json({
          elements: [
            { organization: 'urn:li:organization:20', role: 'ADMINISTRATOR' }
          ]
        });
      unknownRequests.push(path);
      throw new Error('Unexpected synthetic provider request');
    });
    t.after(() => assert.deepEqual(unknownRequests, []));
    const env = {
      SOCIAL_PUBLICATION_MODE: 'live',
      SOCIAL_PUBLICATION_WORKER_ENABLED: 'true',
      SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL:
        'https://account-reservation.test/facebook',
      SOCIAL_PUBLICATION_LINKEDIN_API_BASE_URL:
        'https://account-reservation.test/linkedin',
      SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCOUNT_ID: '20',
      SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCESS_TOKEN: 'synthetic',
      SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCOUNT_ID: '20',
      SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCESS_TOKEN: 'synthetic',
      SOCIAL_PUBLICATION_OPENG7_LINKEDIN_ACCOUNT_ID: 'urn:li:organization:20',
      SOCIAL_PUBLICATION_OPENG7_LINKEDIN_ACCESS_TOKEN: 'synthetic',
      SOCIAL_PUBLICATION_OPENG20_LINKEDIN_ACCOUNT_ID: '20',
      SOCIAL_PUBLICATION_OPENG20_LINKEDIN_ACCESS_TOKEN: 'synthetic'
    };
    const service = new PublicationAutomationService(pool, {}, env);
    const context = {
      pool,
      workerSettings: async (db = pool, lock = '') =>
        (
          await db.query(
            `SELECT enabled,version FROM publication_worker_settings WHERE id=TRUE ${lock}`
          )
        ).rows[0]
    };
    async function reset() {
      await pool.query(
        'TRUNCATE publication_deliveries,admin_audit_log CASCADE'
      );
      await pool.query(
        'UPDATE publication_worker_settings SET enabled=TRUE,version=1'
      );
      for (const feed of [
        'openg7:facebook',
        'openg20:facebook',
        'openg7:linkedin',
        'openg20:linkedin'
      ])
        await activate(feed);
    }
    async function activate(feedId, activeService = service) {
      await activeService.command(
        { action: 'check', feedId },
        'reservation-tester'
      );
      const settings = (await activeService.state()).feeds.find(
        (item) => item.id === feedId
      );
      assert.equal(settings.connection, 'ready');
      await activeService.command(
        { action: 'settings', settings: { ...settings, paused: false } },
        'reservation-tester'
      );
    }
    const row = async (id) =>
      (
        await pool.query('SELECT * FROM publication_deliveries WHERE id=$1', [
          id
        ])
      ).rows[0];
    const future = (offset = 120000) =>
      new Date(Date.now() + offset).toISOString();
    async function compose(feedId, scheduledAt, activeService = service) {
      const { id } = await activeService.command(
        {
          action: 'compose',
          kind: 'news',
          feedId,
          scheduledAt,
          message: 'Synthetic approved account reservation'
        },
        'reservation-tester'
      );
      await approveFixtureSubject(pool, { type: 'publication_delivery', id });
      return id;
    }
    async function approve(id, activeService = service) {
      const delivery = await row(id);
      return activeService.command(
        { action: 'approve', id, version: delivery.version, confirmation: id },
        'reservation-tester'
      );
    }
    for (const feed of [
      'openg7:facebook',
      'openg20:facebook',
      'openg7:linkedin',
      'openg20:linkedin'
    ])
      await activate(feed);

    await t.test(
      'simultaneous approvals across two feeds reserve a shared account once',
      async () => {
        await reset();
        const at = future();
        const ids = await Promise.all([
          compose('openg7:facebook', at),
          compose('openg20:facebook', at)
        ]);
        const outcomes = await Promise.allSettled(ids.map((id) => approve(id)));
        assert.equal(
          outcomes.filter((result) => result.status === 'fulfilled').length,
          1
        );
        assert.equal(
          outcomes.find((result) => result.status === 'rejected').reason.code,
          'ACCOUNT_SLOT_RESERVED'
        );
        const states = await Promise.all(ids.map(row));
        assert.deepEqual(states.map((item) => item.status).sort(), [
          'approved',
          'draft'
        ]);
        assert.equal(
          (
            await pool.query(
              "SELECT * FROM publication_account_reservations WHERE status='reserved'"
            )
          ).rowCount,
          1
        );
        assert.equal(
          (
            await pool.query(
              "SELECT * FROM admin_audit_log WHERE action='publication_automation.approve'"
            )
          ).rowCount,
          1
        );
      }
    );

    await t.test(
      'LinkedIn organization aliases share one reservation while providers and modes differ',
      async () => {
        await reset();
        const at = future();
        const first = await compose('openg7:linkedin', at);
        const alias = await compose('openg20:linkedin', at);
        await approve(first);
        await assert.rejects(approve(alias), { code: 'ACCOUNT_SLOT_RESERVED' });
        const facebook = await compose('openg7:facebook', at);
        await approve(facebook);
        const mockEnv = {
          ...env,
          SOCIAL_PUBLICATION_MODE: 'mock'
        };
        const mockService = new PublicationAutomationService(pool, {}, mockEnv);
        await activate('openg20:facebook', mockService);
        const mock = await compose('openg20:facebook', at, mockService);
        // Model a simulation of the same provider account, without changing a live destination.
        await pool.query(
          "UPDATE publication_deliveries SET account_id='20' WHERE id=$1",
          [mock]
        );
        // The public command correctly rejects a different configured mock destination;
        // the reservation module is exercised explicitly inside its own transaction.
        const { reserveAccountSchedule } =
          await import('../../dist/apps/funding-api/src/publication-automation/account-reservations.js');
        await withPostgresTransaction(pool, (db) =>
          reserveAccountSchedule(db, {
            ...statesForMock(mock),
            scheduled_at: new Date(at)
          })
        );
        const accounts = (
          await pool.query(
            'SELECT provider,account_id,mode FROM publication_account_reservations ORDER BY provider,mode'
          )
        ).rows;
        assert.deepEqual(accounts, [
          { provider: 'facebook', account_id: '20', mode: 'live' },
          { provider: 'facebook', account_id: '20', mode: 'mock' },
          { provider: 'linkedin', account_id: '20', mode: 'live' }
        ]);
        function statesForMock(id) {
          return {
            id,
            feed_id: 'openg20:facebook',
            account_id: '20',
            mode: 'mock',
            version: 1
          };
        }
      }
    );

    await t.test(
      'database time after a blocking account lock rejects an elapsed approval',
      async () => {
        await reset();
        const scheduledAt = future(1000);
        const id = await compose('openg7:facebook', scheduledAt);
        await pool.query(
          "INSERT INTO publication_account_leases(provider,account_id,mode) VALUES('facebook','20','live')"
        );
        const blocker = await pool.connect();
        await blocker.query('BEGIN');
        try {
          await blocker.query(
            "SELECT 1 FROM publication_account_leases WHERE provider='facebook' AND account_id='20' AND mode='live' FOR UPDATE"
          );
          const deciding = approve(id);
          void deciding.catch(() => {});
          await pool.query(
            'SELECT pg_sleep(GREATEST(0,extract(epoch FROM $1::timestamptz-clock_timestamp()))+0.05)',
            [scheduledAt]
          );
          await blocker.query('COMMIT');
          await assert.rejects(deciding, { code: 'APPROVAL_UNAVAILABLE' });
          assert.equal((await row(id)).status, 'draft');
          assert.equal(
            (await pool.query('SELECT * FROM publication_account_reservations'))
              .rowCount,
            0
          );
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
        }
      }
    );

    await t.test(
      'concurrent claims serialize a shared account and leave other providers advancing',
      async () => {
        await reset();
        const first = await compose('openg7:facebook', future());
        const second = await compose('openg20:facebook', future(240000));
        const other = await compose('openg7:linkedin', future(360000));
        for (const id of [first, second, other]) await approve(id);
        const due = new Date(Date.now() + 600000);
        const claims = await Promise.all([
          claimNextDelivery(context, due),
          claimNextDelivery(context, due)
        ]);
        assert.equal(claims.filter(Boolean).length, 2);
        assert.deepEqual(
          claims.map((item) => item.feed_id.split(':')[1]).sort(),
          ['facebook', 'linkedin']
        );
        const activeFacebook = claims.find((item) =>
          item.feed_id.endsWith(':facebook')
        );
        assert.ok([first, second].includes(activeFacebook.id));
        // SKIP LOCKED does not promise global FIFO while another claim holds a row.
        // Exactly one shared-account delivery advances; the other must remain untouched.
        const waitingFacebook = activeFacebook.id === first ? second : first;
        assert.equal((await row(waitingFacebook)).attempts, 0);
        assert.equal((await row(activeFacebook.id)).attempts, 1);
        assert.equal(await claimNextDelivery(context, due), null);
        await withPostgresTransaction(pool, async (db) => {
          await db.query(
            "UPDATE publication_deliveries SET status='published',version=version+1 WHERE id=$1",
            [activeFacebook.id]
          );
          await finishAccountClaim(db, activeFacebook, 'published');
        });
        // A far-future injected recipe time cannot bypass real per-account spacing.
        assert.equal(await claimNextDelivery(context, due), null);
        const spacing = (
          await pool.query(
            "SELECT extract(epoch FROM next_dispatch_at-clock_timestamp())*1000 AS remaining FROM publication_account_leases WHERE provider='facebook'"
          )
        ).rows[0].remaining;
        assert.ok(Number(spacing) > LIVE_ACCOUNT_INTERVAL_MS - 5000);
        await pool.query(
          "UPDATE publication_account_leases SET next_dispatch_at=clock_timestamp()-INTERVAL '1 second' WHERE provider='facebook'"
        );
        const later = await claimNextDelivery(context, due);
        assert.equal(later.id, waitingFacebook);
        assert.ok(
          later.accountClaimVersion > activeFacebook.accountClaimVersion
        );
        await assert.rejects(
          withPostgresTransaction(pool, (db) => lockClaim(db, activeFacebook)),
          /PUBLICATION_CLAIM_LOST/
        );
      }
    );

    await t.test(
      'a fenced restriction before actual HTTP releases the account without creating a false cooldown',
      async () => {
        await reset();
        const first = await compose('openg7:facebook', future());
        const next = await compose('openg20:facebook', future(240000));
        await approve(first);
        await approve(next);
        const due = new Date(Date.now() + 300000);
        const claimed = await claimNextDelivery(context, due);
        assert.equal(claimed.id, first);
        assert.ok(claimed.accountClaimVersion > 0);
        const subject = { type: 'publication_delivery', id: first };
        const decision = await fixtureModerationDecision(pool, subject, 'N2');
        await withPostgresTransaction(pool, (db) =>
          recordModerationDecision(db, {
            subject,
            decision,
            actor: 'admin:00000000-0000-4000-8000-000000000004'
          })
        );
        let denied;
        try {
          await assertDispatchClaim(context, claimed);
        } catch (error) {
          denied = error;
        }
        assert.equal(denied?.code, 'MODERATION_RESTRICTED');
        const before = (
          await pool.query(
            "SELECT dispatched_at FROM publication_account_leases WHERE provider='facebook' AND delivery_id=$1",
            [first]
          )
        ).rows[0];
        assert.equal(before.dispatched_at, null);
        // executeDelivery has entered sending=true, but its assertActive failed
        // before markAccountDispatch and before any provider request.
        await handleDeliveryFailure(context, claimed, denied, true, null);
        assert.equal((await row(first)).status, 'blocked');
        assert.equal((await row(first)).approved_at, null);
        const released = (
          await pool.query(
            "SELECT delivery_id,uncertain,next_dispatch_at<=clock_timestamp() AS ready FROM publication_account_leases WHERE provider='facebook'"
          )
        ).rows[0];
        assert.deepEqual(released, {
          delivery_id: null,
          uncertain: false,
          ready: true
        });
        assert.equal((await claimNextDelivery(context, due)).id, next);
        assert.deepEqual(unknownRequests, []);
      }
    );

    await t.test(
      'lease expiry quarantines the account until an explicit absence review',
      async () => {
        await reset();
        const first = await compose('openg7:facebook', future());
        const second = await compose('openg20:facebook', future(240000));
        await approve(first);
        await approve(second);
        const due = new Date(Date.now() + 300000);
        const claim = await claimNextDelivery(context, due);
        await pool.query(
          "UPDATE publication_deliveries SET lease_until=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
          [first]
        );
        await expireClaims(context, due);
        assert.equal((await row(first)).status, 'uncertain');
        assert.equal(
          (
            await pool.query(
              "SELECT uncertain FROM publication_account_leases WHERE provider='facebook'"
            )
          ).rows[0].uncertain,
          true
        );
        assert.equal(await claimNextDelivery(context, due), null);
        const uncertain = await row(first);
        await service.command(
          {
            action: 'confirm-absent',
            id: first,
            version: uncertain.version,
            confirmation: first,
            reason:
              'Synthetic operator verified provider history and confirmed no publication.'
          },
          'reservation-tester'
        );
        await pool.query(
          "UPDATE publication_account_leases SET next_dispatch_at=clock_timestamp()-INTERVAL '1 second' WHERE provider='facebook'"
        );
        const newer = await claimNextDelivery(context, due);
        assert.equal(newer.id, second);
        const before = (
          await pool.query('SELECT * FROM publication_account_leases')
        ).rows;
        await withPostgresTransaction(pool, (db) =>
          finishAccountClaim(db, claim, 'uncertain')
        );
        assert.deepEqual(
          (await pool.query('SELECT * FROM publication_account_leases')).rows,
          before
        );
      }
    );

    await t.test(
      'a newer moderation restriction keeps its state while the old account outcome is reviewed',
      async () => {
        await reset();
        const id = await compose('openg7:facebook', future());
        await approve(id);
        const claim = await claimNextDelivery(
          context,
          new Date(Date.now() + 300000)
        );
        await pool.query(
          "UPDATE publication_deliveries SET status='blocked',version=version+1,approved_at=NULL,approved_by=NULL,error_code='MODERATION_RESTRICTED' WHERE id=$1",
          [id]
        );
        const restricted = await row(id);
        await abandonClaim(context, claim, null);
        assert.deepEqual(await row(id), restricted);
        const before = (await service.state()).deliveries.find(
          (item) => item.id === id
        );
        assert.equal(before.accountRecoveryRequired, true);
        assert.equal(before.errorCode, 'MODERATION_RESTRICTED');
        await assert.rejects(
          service.command(
            {
              action: 'confirm-absent',
              id,
              version: restricted.version,
              confirmation: id,
              reason: 'Too short'
            },
            'reservation-tester'
          ),
          { code: 'ABSENCE_REVIEW_REQUIRED' }
        );
        await service.command(
          {
            action: 'confirm-absent',
            id,
            version: restricted.version,
            confirmation: id,
            reason:
              'Synthetic account history reviewed independently; no external publication occurred.'
          },
          'reservation-tester'
        );
        const reviewed = (await service.state()).deliveries.find(
          (item) => item.id === id
        );
        assert.equal(reviewed.accountRecoveryRequired, false);
        assert.equal(reviewed.status, 'blocked');
        assert.equal(reviewed.errorCode, 'MODERATION_RESTRICTED');
        assert.equal(reviewed.approvedAt, null);
        assert.equal(reviewed.attempts, restricted.attempts);
        await assert.rejects(approve(id), { code: 'APPROVAL_UNAVAILABLE' });
      }
    );

    await t.test(
      'cancel releases a future reservation without admitting historical published deliveries',
      async () => {
        await reset();
        const at = future();
        const first = await compose('openg7:facebook', at);
        const second = await compose('openg20:facebook', at);
        await approve(first);
        const active = await row(first);
        await service.command(
          {
            action: 'cancel',
            id: first,
            version: active.version,
            confirmation: first
          },
          'reservation-tester'
        );
        await approve(second);
        assert.equal(
          (
            await pool.query(
              'SELECT status FROM publication_account_reservations WHERE delivery_id=$1',
              [first]
            )
          ).rows[0].status,
          'released'
        );
        await pool.query(
          "UPDATE publication_deliveries SET status='published',published_at=NOW() WHERE id=$1",
          [first]
        );
        const historical = await row(first);
        const claimed = await claimNextDelivery(
          context,
          new Date(Date.now() + 300000)
        );
        assert.equal(claimed.id, second);
        assert.deepEqual(await row(first), historical);
      }
    );
  }
);
