import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  privateDataEncryptionKey,
  protectPrivateText,
  revealPrivateText,
  protectPrivateJson,
  revealPrivateJson,
  protectEmailMetadata,
  revealEmailMetadata
} from '../dist/apps/funding-api/src/private-data-protection.js';
import {
  projectStoredStripeEvent,
  projectStoredCheckoutMetadata
} from '../dist/apps/funding-api/src/stripe-event-projection.js';
import {
  insertEmailQueueMessage,
  claimQueuedEmailMessages
} from '../dist/apps/funding-api/src/email-queue.repository.js';
import { createDurableCheckoutService } from '../dist/apps/funding-api/src/checkout-operations.service.js';
import { protectHistoricalPrivateData } from '../dist/apps/funding-api/src/private-data-backfill.js';

const env = {
  FUNDING_PRIVATE_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 73).toString('base64')
};
const privateUrl =
  'https://example.test/followup?token=synthetic_private_followup_token';
const withKey = async (fn) => {
  const previous = process.env.FUNDING_PRIVATE_DATA_ENCRYPTION_KEY;
  process.env.FUNDING_PRIVATE_DATA_ENCRYPTION_KEY =
    env.FUNDING_PRIVATE_DATA_ENCRYPTION_KEY;
  try {
    return await fn();
  } finally {
    if (previous === undefined)
      delete process.env.FUNDING_PRIVATE_DATA_ENCRYPTION_KEY;
    else process.env.FUNDING_PRIVATE_DATA_ENCRYPTION_KEY = previous;
  }
};

test('production requires a canonical 32-byte server key without revealing invalid input', () => {
  assert.equal(privateDataEncryptionKey({ NODE_ENV: 'test' }), null);
  assert.throws(
    () => privateDataEncryptionKey({ NODE_ENV: 'production' }),
    /KEY_REQUIRED/
  );
  assert.throws(
    () =>
      privateDataEncryptionKey({
        FUNDING_PRIVATE_DATA_ENCRYPTION_KEY: 'synthetic-secret'
      }),
    /^Error: PRIVATE_DATA_ENCRYPTION_KEY_INVALID$/
  );
  assert.throws(
    () =>
      privateDataEncryptionKey({
        FUNDING_PRIVATE_DATA_ENCRYPTION_KEY: Buffer.alloc(31).toString('base64')
      }),
    /KEY_INVALID/
  );
  assert.equal(privateDataEncryptionKey(env).length, 32);
});

test('authenticated ciphertext hides contents and rejects tampering, a wrong key and another row', () => {
  const value = 'Données privées ' + privateUrl;
  const first = protectPrivateText(value, 'email:row1:text', env);
  const second = protectPrivateText(value, 'email:row1:text', env);
  assert.notEqual(first, second);
  assert.ok(!first.includes('token'));
  assert.equal(revealPrivateText(first, 'email:row1:text', env), value);
  assert.throws(
    () => revealPrivateText(first, 'email:row2:text', env),
    /DECRYPTION_FAILED/
  );
  assert.throws(
    () =>
      revealPrivateText(first, 'email:row1:text', {
        FUNDING_PRIVATE_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString(
          'base64'
        )
      }),
    /DECRYPTION_FAILED/
  );
  const bytes = Buffer.from(first.slice('og7enc:v1:'.length), 'base64url');
  bytes[bytes.length - 1] ^= 1;
  assert.throws(
    () =>
      revealPrivateText(
        'og7enc:v1:' + bytes.toString('base64url'),
        'email:row1:text',
        env
      ),
    /DECRYPTION_FAILED/
  );
  assert.throws(
    () => revealPrivateText(first, 'email:row1:text', {}),
    /DECRYPTION_FAILED/
  );
  assert.equal(
    revealPrivateText('Legacy content', 'email:row1:text', env),
    'Legacy content'
  );
});

test('JSON and email metadata preserve correlation joins while private links remain encrypted', () => {
  const original = {
    success_url: privateUrl,
    nested: { customer: 'synthetic private customer' }
  };
  const stored = protectPrivateJson(original, 'checkout:id:params', env);
  assert.ok(!JSON.stringify(stored).includes('private_followup'));
  assert.deepEqual(
    revealPrivateJson(stored, 'checkout:id:params', env),
    original
  );
  const metadata = {
    actor: 'admin:synthetic',
    invoiceId: 'synthetic-invoice',
    publicReference: 'OG7-SYNTHETIC',
    followupUrl: privateUrl,
    amount: 5000
  };
  const protectedMetadata = protectEmailMetadata(metadata, 'id', env);
  assert.equal(protectedMetadata.invoiceId, metadata.invoiceId);
  assert.equal(protectedMetadata.actor, metadata.actor);
  assert.ok(!JSON.stringify(protectedMetadata).includes('private_followup'));
  assert.deepEqual(revealEmailMetadata(protectedMetadata, 'id', env), metadata);
  assert.throws(
    () => revealEmailMetadata(protectedMetadata, 'other-id', env),
    /DECRYPTION_FAILED/
  );
  const unexpected = protectEmailMetadata(
    { publicReference: privateUrl },
    'id',
    env
  );
  assert.ok(!JSON.stringify(unexpected).includes('private_followup'));
});

test('Stripe projection removes customer/card/secrets while retaining all SQL refund facts', () => {
  const event = {
    id: 'evt_synthetic',
    type: 'charge.refunded',
    created: 123,
    livemode: false,
    data: {
      object: {
        id: 'ch_synthetic',
        object: 'charge',
        amount_refunded: 5000,
        currency: 'cad',
        payment_intent: {
          id: 'pi_synthetic',
          client_secret: 'synthetic-client-secret',
          customer: 'cus_synthetic'
        },
        billing_details: { email: 'private@example.test' },
        payment_method_details: { card: { last4: '1234' } },
        metadata: { sponsorshipFollowupToken: 'synthetic-private-token' },
        success_url: privateUrl,
        refunds: {
          data: [
            {
              id: 're_synthetic',
              amount: 5000,
              currency: 'cad',
              status: 'succeeded',
              metadata: { privateNote: 'private' }
            }
          ],
          has_more: false
        }
      }
    },
    request: { idempotency_key: 'synthetic-private-key' }
  };
  const projected = projectStoredStripeEvent(event);
  assert.deepEqual(projected.data.object.refunds.data, [
    { id: 're_synthetic', currency: 'cad', status: 'succeeded', amount: 5000 }
  ]);
  assert.deepEqual(projected.data.object.payment_intent, {
    id: 'pi_synthetic'
  });
  assert.equal(projected.data.object.amount_refunded, 5000);
  for (const forbidden of [
    'private@example',
    '1234',
    'client_secret',
    'private-token',
    'success_url',
    'idempotency_key'
  ])
    assert.ok(!JSON.stringify(projected).includes(forbidden), forbidden);
  assert.deepEqual(
    projectStoredCheckoutMetadata({
      project: 'openg7',
      openg7CheckoutOperationId: 'synthetic-checkout-operation',
      sponsorshipFollowupToken: 'private',
      sponsorshipFollowupTokenHash: 'synthetic-hash',
      unknown: privateUrl
    }),
    {
      project: 'openg7',
      sponsorshipFollowupTokenHash: 'synthetic-hash',
      openg7CheckoutOperationId: 'synthetic-checkout-operation'
    }
  );
});

test('queue writes ciphertext and delivery claims recover the original message', async () =>
  withKey(async () => {
    let stored;
    const pool = {
      async query(sql, params) {
        if (sql.includes('INSERT INTO email_messages')) {
          stored = {
            id: params[10],
            subject: params[5],
            text_body: params[6],
            html_body: params[7],
            metadata: JSON.parse(params[8]),
            recipient_email: params[2],
            from_email: params[3],
            reply_to_email: params[4],
            attempts: 1,
            max_attempts: params[9],
            delivery_attempt_id: 'synthetic-attempt'
          };
          return { rows: [{ id: stored.id }], rowCount: 1 };
        }
        assert.match(sql, /WITH selected/);
        return { rows: [stored], rowCount: 1 };
      }
    };
    await insertEmailQueueMessage(pool, {
      templateKey: 'synthetic',
      to: 'private@example.test',
      fromEmail: 'notify@example.test',
      replyToEmail: 'contact@example.test',
      subject: 'Private subject',
      text: privateUrl,
      html: '<a>' + privateUrl + '</a>',
      metadata: { invoiceId: 'synthetic-invoice', privateUrl },
      maxAttempts: 5
    });
    assert.match(stored.id, /^[a-f0-9-]{36}$/);
    assert.ok(!JSON.stringify(stored).includes('private_followup'));
    assert.equal(stored.metadata.invoiceId, 'synthetic-invoice');
    const claimed = await claimQueuedEmailMessages(pool, { limit: 1 });
    assert.equal(claimed[0].text, privateUrl);
    assert.equal(claimed[0].subject, 'Private subject');
    stored.text_body = stored.html_body;
    await assert.rejects(
      claimQueuedEmailMessages(pool, { limit: 1 }),
      /DECRYPTION_FAILED/
    );
  }));

test('encrypted Checkout snapshots preserve exact parameters and idempotent replay', async () =>
  withKey(async () => {
    let operation;
    let creates = 0;
    let recorded = 0;
    const client = new EventEmitter();
    client.release = () => {};
    client.query = async (sql, params) => {
      if (sql.includes('pg_try_advisory_lock'))
        return { rows: [{ locked: true }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [{}] };
      if (sql.includes('FROM checkout_operations WHERE'))
        return { rows: operation ? [structuredClone(operation)] : [] };
      if (sql.includes('INSERT INTO checkout_operations')) {
        operation = {
          id: params[0],
          request_hash: params[2],
          state: 'prepared',
          params: JSON.parse(params[3]),
          contribution_input: JSON.parse(params[4]),
          provider_result: null,
          retry_allowed: true
        };
        return { rows: [structuredClone(operation)] };
      }
      if (sql.includes("state='created'")) {
        operation.state = 'created';
        operation.provider_result = JSON.parse(params[1]);
      } else if (sql.includes("state='completed'"))
        operation.state = 'completed';
      return { rows: [], rowCount: 1 };
    };
    const params = {
      mode: 'payment',
      success_url: privateUrl,
      cancel_url: 'https://example.test/cancel'
    };
    const service = createDurableCheckoutService(
      { connect: async () => client },
      {
        checkout: {
          sessions: {
            create: async (received) => {
              creates++;
              assert.deepEqual(received, params);
              assert.ok(
                !JSON.stringify(operation).includes('private_followup')
              );
              return {
                id: 'cs_synthetic',
                url: 'https://checkout.stripe.com/c/pay/synthetic',
                payment_intent: 'pi_synthetic'
              };
            }
          }
        }
      },
      async () => {
        recorded++;
      }
    );
    const input = {
      key: 'synthetic-idempotency',
      requestHash: 'synthetic-request',
      prepare: () => ({
        params,
        record: {
          metadata: { project: 'openg7' },
          publicReference: 'OG7-SYNTHETIC'
        }
      })
    };
    const first = await service(input);
    assert.ok(!JSON.stringify(operation).includes('private_followup'));
    assert.ok(!JSON.stringify(operation).includes('checkout.stripe.com'));
    assert.deepEqual(await service(input), first);
    assert.equal(creates, 1);
    assert.equal(recorded, 1);
  }));

test('historical maintenance is bounded, dry-run only by default, audited and repeatable', async () =>
  withKey(async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    let row = {
      id,
      subject: 'Subject',
      text_body: privateUrl,
      html_body: privateUrl,
      metadata: { invoiceId: 'synthetic-invoice' }
    };
    const queries = [];
    const pool = {
      connect: async () => ({
        release() {},
        async query(sql, params) {
          queries.push({ sql, params });
          if (sql.startsWith('SELECT *'))
            return { rows: [structuredClone(row)] };
          if (sql.startsWith('UPDATE email_messages'))
            row = {
              ...row,
              subject: params[1],
              text_body: params[2],
              html_body: params[3],
              metadata: JSON.parse(params[4])
            };
          return { rows: [], rowCount: 1 };
        }
      })
    };
    const options = {
      kind: 'email',
      before: '2026-10-04T00:00:00Z',
      limit: 1,
      apply: false
    };
    const preview = await protectHistoricalPrivateData(pool, options);
    assert.deepEqual(preview, {
      scanned: 1,
      changed: 1,
      nextCursor: id,
      applied: false
    });
    assert.equal(row.text_body, privateUrl);
    assert.ok(!queries.some(({ sql }) => /UPDATE|INSERT/.test(sql)));
    assert.deepEqual(
      queries.find(({ sql }) => sql.startsWith('SELECT *')).params,
      [options.before, null, 1]
    );
    queries.length = 0;
    await protectHistoricalPrivateData(pool, {
      ...options,
      apply: true,
      actor: 'operator:synthetic',
      requestId: '22222222-2222-4222-8222-222222222222'
    });
    assert.ok(
      queries.some(({ sql }) => sql.includes('INSERT INTO admin_audit_log'))
    );
    assert.ok(!JSON.stringify(row).includes('private_followup'));
    assert.equal(
      (await protectHistoricalPrivateData(pool, options)).changed,
      0
    );
    await assert.rejects(
      protectHistoricalPrivateData(pool, { ...options, limit: 501 }),
      /SCOPE_INVALID/
    );
    await assert.rejects(
      protectHistoricalPrivateData(pool, { ...options, apply: true }),
      /SCOPE_INVALID/
    );
  }));
