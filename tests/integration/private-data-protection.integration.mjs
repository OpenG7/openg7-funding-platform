import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { insertEmailQueueMessage } from '../../dist/apps/funding-api/src/email-queue.repository.js';
import { getAdminEmailQueueMessageById } from '../../dist/apps/funding-api/src/email-queue-read.repository.js';
import { processQueuedEmailMessages } from '../../dist/apps/funding-api/src/services/email/email-queue.service.js';
import { createDurableCheckoutService } from '../../dist/apps/funding-api/src/checkout-operations.service.js';
import { insertStripeEventRecord } from '../../dist/apps/funding-api/src/stripe-event-records.repository.js';
import { protectHistoricalPrivateData } from '../../dist/apps/funding-api/src/private-data-backfill.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'private data stays encrypted in PostgreSQL through email delivery, Checkout recovery and bounded history protection',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const keyName = 'FUNDING_PRIVATE_DATA_ENCRYPTION_KEY';
    const previous = process.env[keyName];
    process.env[keyName] = Buffer.alloc(32, 39).toString('base64');
    t.after(() => {
      if (previous === undefined) delete process.env[keyName];
      else process.env[keyName] = previous;
    });
    const link =
      'https://example.test/followup?token=synthetic_sensitive_access_link';
    const emailInput = {
      templateKey: 'synthetic_private',
      to: 'recipient@example.test',
      fromEmail: 'notify@example.test',
      replyToEmail: 'contact@example.test',
      subject: 'Synthetic private subject',
      text: link,
      html: `<p>${link}</p>`,
      metadata: { invoiceId: 'synthetic-invoice', link },
      maxAttempts: 5,
      idempotencyKey: 'synthetic-protected:' + randomUUID()
    };
    const queued = await insertEmailQueueMessage(db.pool, emailInput);
    const stored = (
      await db.pool.query('SELECT * FROM email_messages WHERE id=$1', [
        queued.messageId
      ])
    ).rows[0];
    assert.ok(!JSON.stringify(stored).includes('sensitive_access'));
    assert.match(stored.subject, /^og7enc:v1:/);
    assert.equal(stored.metadata.invoiceId, emailInput.metadata.invoiceId);
    const read = await getAdminEmailQueueMessageById(db.pool, queued.messageId);
    assert.equal(read.subject, emailInput.subject);
    assert.equal(read.metadata.link, link);
    let submitted = 0;
    const delivered = await processQueuedEmailMessages(db.pool, {
      emailDependencies: {
        env: {
          SMTP_ENABLED: 'true',
          SMTP_HOST: 'smtp.example.test',
          SMTP_PORT: '465',
          SMTP_SECURE: 'true',
          SMTP_USER: 'notify@example.test',
          SMTP_PASSWORD: 'synthetic-only',
          MAIL_FROM_ADDRESS: 'notify@example.test'
        },
        logger: { info() {}, error() {} },
        createTransport: () => ({
          sendMail: async (message) => {
            submitted++;
            assert.equal(message.subject, emailInput.subject);
            assert.equal(message.text, link);
            assert.equal(message.html, emailInput.html);
            return {
              accepted: [message.to],
              rejected: [],
              messageId: message.messageId
            };
          }
        })
      }
    });
    assert.equal(delivered.sent, 1);
    assert.equal(submitted, 1);
    assert.equal((await processQueuedEmailMessages(db.pool)).attempted, 0);

    let providerCalls = 0;
    const cache = new Map();
    const provider = {
      checkout: {
        sessions: {
          create: async (params, options) => {
            providerCalls++;
            assert.equal(params.success_url, link);
            const existing = cache.get(options.idempotencyKey);
            if (existing) {
              assert.deepEqual(params, existing.params);
              return existing.result;
            }
            const result = {
              id: 'cs_test_' + randomUUID().replaceAll('-', ''),
              url: 'https://checkout.example.test/private/' + randomUUID(),
              payment_intent: 'pi_test_synthetic'
            };
            cache.set(options.idempotencyKey, {
              params: structuredClone(params),
              result
            });
            throw new Error('Synthetic response lost after provider accepted');
          }
        }
      }
    };
    const input = {
      key: 'synthetic-checkout:' + randomUUID(),
      requestHash: 'synthetic-hash',
      prepare: () => ({
        params: {
          mode: 'payment',
          success_url: link,
          cancel_url: 'https://example.test/cancel'
        },
        record: {
          publicReference: 'OG7-SYNTHETIC',
          contributionType: 'sponsorship_interest',
          amountCents: 2500,
          currency: 'cad',
          metadata: {
            project: 'openg7',
            sponsorshipFollowupToken: 'synthetic_raw_legacy_token'
          },
          publicDisplayConsent: false,
          publicName: null,
          displayAmountConsent: false,
          nonCharityAcknowledged: true,
          sponsorshipFollowupTokenHash: 'synthetic-hash'
        }
      })
    };
    const checkout = createDurableCheckoutService(db.pool, provider);
    await assert.rejects(checkout(input), /CHECKOUT_PROVIDER_UNAVAILABLE/);
    const uncertain = (await db.pool.query('SELECT * FROM checkout_operations'))
      .rows[0];
    assert.equal(uncertain.state, 'uncertain');
    assert.ok(!JSON.stringify(uncertain).includes('sensitive_access'));
    const completed = await checkout(input);
    assert.deepEqual(await checkout(input), completed);
    assert.equal(providerCalls, 2);
    const persisted = (
      await db.pool.query('SELECT * FROM checkout_operations WHERE id=$1', [
        uncertain.id
      ])
    ).rows[0];
    assert.equal(persisted.state, 'completed');
    assert.ok(!JSON.stringify(persisted).includes(completed.redirectUrl));
    const session = (
      await db.pool.query(
        'SELECT metadata FROM stripe_checkout_sessions WHERE stripe_session_id=$1',
        [completed.checkoutId]
      )
    ).rows[0];
    assert.deepEqual(session.metadata, { project: 'openg7' });

    const event = {
      id: 'evt_test_synthetic',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_test_synthetic',
          payment_intent: 'pi_test_synthetic',
          amount_refunded: 500,
          currency: 'cad',
          billing_details: { email: 'private@example.test' },
          refunds: {
            data: [
              {
                id: 're_synthetic',
                amount: 500,
                currency: 'cad',
                status: 'succeeded'
              }
            ]
          }
        }
      }
    };
    await insertStripeEventRecord(db.pool, {
      stripeEventId: event.id,
      eventType: event.type,
      payload: event
    });
    const eventRow = (
      await db.pool.query(
        'SELECT payload FROM stripe_events WHERE stripe_event_id=$1',
        [event.id]
      )
    ).rows[0];
    assert.ok(!JSON.stringify(eventRow).includes('private@example'));
    const refundFacts = (
      await db.pool.query(
        `SELECT payload->'data'->'object'->>'amount_refunded' AS amount,
    payload->'data'->'object'->>'payment_intent' AS pi,
    payload->'data'->'object'->'refunds'->'data'->0->>'status' AS refund_status FROM stripe_events WHERE stripe_event_id=$1`,
        [event.id]
      )
    ).rows[0];
    assert.deepEqual(refundFacts, {
      amount: '500',
      pi: 'pi_test_synthetic',
      refund_status: 'succeeded'
    });

    const legacy = (
      await db.pool.query(
        `INSERT INTO email_messages(template_key,recipient_email,from_email,subject,text_body,html_body,metadata)
    VALUES('synthetic_legacy','legacy@example.test','notify@example.test','Legacy',$1,$1,'{"invoiceId":"legacy-invoice"}'::jsonb) RETURNING id`,
        [link]
      )
    ).rows[0];
    const options = {
      kind: 'email',
      before: new Date(Date.now() + 60000).toISOString(),
      limit: 500,
      apply: false
    };
    assert.equal(
      (await protectHistoricalPrivateData(db.pool, options)).changed,
      1
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT text_body FROM email_messages WHERE id=$1',
          [legacy.id]
        )
      ).rows[0].text_body,
      link
    );
    const requestId = randomUUID();
    assert.equal(
      (
        await protectHistoricalPrivateData(db.pool, {
          ...options,
          apply: true,
          actor: 'operator:synthetic',
          requestId
        })
      ).changed,
      1
    );
    assert.equal(
      (await protectHistoricalPrivateData(db.pool, options)).changed,
      0
    );
    const audited = (
      await db.pool.query(
        "SELECT actor,entity_id,metadata FROM admin_audit_log WHERE action='private_data.protected'"
      )
    ).rows[0];
    assert.equal(audited.actor, 'operator:synthetic');
    assert.equal(audited.entity_id, requestId);
    assert.equal(audited.metadata.result, 'applied');
    assert.equal(
      (await getAdminEmailQueueMessageById(db.pool, legacy.id)).subject,
      'Legacy'
    );

    const anotherLegacy = (
      await db.pool.query(
        `INSERT INTO email_messages(template_key,recipient_email,from_email,subject,text_body,html_body)
    VALUES('synthetic_rollback','legacy@example.test','notify@example.test','Rollback',$1,$1) RETURNING id`,
        [link]
      )
    ).rows[0];
    const failingAuditPool = {
      connect: async () => {
        const client = await db.pool.connect();
        return {
          release: () => client.release(),
          query: (sql, parameters) => {
            if (sql.includes('INSERT INTO admin_audit_log'))
              throw new Error('Synthetic audit unavailable');
            return client.query(sql, parameters);
          }
        };
      }
    };
    await assert.rejects(
      protectHistoricalPrivateData(failingAuditPool, {
        ...options,
        apply: true,
        actor: 'operator:synthetic',
        requestId: randomUUID()
      }),
      /BACKFILL_FAILED/
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT text_body FROM email_messages WHERE id=$1',
          [anotherLegacy.id]
        )
      ).rows[0].text_body,
      link
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM admin_audit_log WHERE action='private_data.protected'"
        )
      ).rows[0].count,
      1
    );

    await db.pool.query(
      'UPDATE stripe_events SET payload=$2::jsonb WHERE stripe_event_id=$1',
      [event.id, JSON.stringify(event)]
    );
    const eventScope = { ...options, kind: 'stripe' };
    assert.equal(
      (await protectHistoricalPrivateData(db.pool, eventScope)).changed,
      1
    );
    await protectHistoricalPrivateData(db.pool, {
      ...eventScope,
      apply: true,
      actor: 'operator:synthetic',
      requestId: randomUUID()
    });
    assert.equal(
      (await protectHistoricalPrivateData(db.pool, eventScope)).changed,
      0
    );

    // An invalid key rejects ciphertext reads and maintenance before any legacy rewrite.
    process.env[keyName] = Buffer.alloc(32, 19).toString('base64');
    await assert.rejects(
      getAdminEmailQueueMessageById(db.pool, queued.messageId),
      /DECRYPTION_FAILED/
    );
    await assert.rejects(
      protectHistoricalPrivateData(db.pool, {
        ...options,
        apply: true,
        actor: 'operator:synthetic',
        requestId: randomUUID()
      }),
      /BACKFILL_FAILED/
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM admin_audit_log WHERE action='private_data.protected'"
        )
      ).rows[0].count,
      2
    );
  }
);
