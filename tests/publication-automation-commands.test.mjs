import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { command } from '../dist/apps/funding-api/src/publication-automation/commands.js';
import { digest } from '../dist/apps/funding-api/src/publication-automation/policy.js';

const id = '11111111-1111-4111-8111-111111111111';
const batchId = '22222222-2222-4222-8222-222222222222';
const sponsorId = '33333333-3333-4333-8333-333333333333';
const feedId = 'openg20:facebook';
const env = {
  SOCIAL_PUBLICATION_MODE: 'live',
  SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCOUNT_ID: '20',
  SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCESS_TOKEN: 'synthetic-fixture'
};

const delivery = (overrides = {}) => ({
  id,
  feed_id: feedId,
  kind: 'news',
  batch_id: null,
  message: 'Exact approved synthetic message',
  scheduled_at: new Date('2099-01-01T14:00:00Z'),
  media_id: null,
  media_snapshot: null,
  source_snapshot: [],
  account_id: '20',
  mode: 'live',
  auto_managed: false,
  version: 4,
  status: 'draft',
  attempts: 0,
  next_attempt_at: null,
  external_post_id: null,
  external_post_url: null,
  provider_media_id: null,
  error_code: null,
  approved_at: null,
  published_at: null,
  ...overrides
});

const fixture = ({
  row = delivery(),
  query = () => undefined,
  feed = {},
  worker = { enabled: false, version: 1 },
  auditFailure,
  completeFailure
} = {}) => {
  const calls = [];
  const audits = [];
  const completions = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ kind: 'query', sql, parameters });
      if (sql.startsWith('INSERT INTO admin_audit_log')) {
        if (auditFailure) throw auditFailure;
        audits.push(parameters);
        return { rows: [], rowCount: 1 };
      }
      const response = await query(sql, parameters);
      if (response !== undefined) return response;
      if (sql.startsWith('SELECT * FROM publication_deliveries'))
        return { rows: [row], rowCount: 1 };
      if (sql.startsWith('INSERT INTO publication_deliveries'))
        return { rows: [{ id }], rowCount: 1 };
      if (sql.startsWith('UPDATE publication_worker_settings')) {
        worker.enabled = parameters[0];
        worker.version++;
        return { rows: [], rowCount: 1 };
      }
      if (
        ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) ||
        sql.startsWith('UPDATE')
      )
        return { rows: [], rowCount: 0 };
      assert.fail(`Unexpected fixture query: ${sql}`);
    },
    release() {
      calls.push({ kind: 'release' });
    }
  };
  const pool = {
    async connect() {
      calls.push({ kind: 'connect' });
      return client;
    }
  };
  const context = {
    pool,
    env,
    storage: {
      async readPrivateObject() {
        assert.fail('No image should be read by this fixture');
      }
    },
    async feeds(db) {
      calls.push({ kind: 'feeds', db });
      return [
        {
          id: feedId,
          accountId: '20',
          mode: 'live',
          configured: true,
          connection: 'ready',
          ...feed
        }
      ];
    },
    async workerSettings(db, lock) {
      calls.push({ kind: 'workerSettings', db, lock });
      return { ...worker };
    },
    async prepare(...args) {
      calls.push({ kind: 'prepare', args });
    },
    async complete(...args) {
      calls.push({ kind: 'complete' });
      completions.push(args);
      if (completeFailure) throw completeFailure;
    }
  };
  const queries = () => calls.filter((call) => call.kind === 'query');
  const lifecycle = () =>
    calls.flatMap((call) =>
      call.kind === 'connect' || call.kind === 'release'
        ? [call.kind]
        : call.kind === 'query' &&
            ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(call.sql)
          ? [call.sql]
          : []
    );
  return { context, client, calls, audits, completions, queries, lifecycle };
};

const composition = {
  action: 'compose',
  feedId,
  kind: 'news',
  message: 'Exact synthetic editorial content',
  scheduledAt: '2099-01-01T14:00:00Z'
};

test('composition keeps exact content and automatic ownership in its supplied or owned transaction', async (t) => {
  for (const supplied of [false, true]) {
    await t.test(supplied ? 'supplied client' : 'owned client', async () => {
      const f = fixture();
      assert.deepEqual(
        await command(
          f.context,
          composition,
          'fixture-reviewer',
          true,
          supplied ? f.client : undefined
        ),
        { id }
      );
      assert.deepEqual(
        f.lifecycle(),
        supplied ? [] : ['connect', 'BEGIN', 'COMMIT', 'release']
      );
      const inserted = f
        .queries()
        .find((call) =>
          call.sql.startsWith('INSERT INTO publication_deliveries')
        );
      assert.deepEqual(inserted.parameters, [
        feedId,
        'news',
        null,
        composition.message,
        composition.scheduledAt,
        '[]',
        null,
        null,
        '20',
        'live',
        true
      ]);
      assert.equal(f.audits.length, 1);
      assert.equal(f.audits[0][0], 'fixture-reviewer');
      assert.equal(f.audits[0][1], 'publication_automation.compose');
      assert.equal(f.audits[0][2], id);
    });
  }
});

test('failed composition audit rejects and rolls back only an owned transaction', async (t) => {
  for (const supplied of [false, true]) {
    await t.test(
      supplied ? 'caller must roll back' : 'command rolls back',
      async () => {
        const failure = new Error('Synthetic audit failure');
        const f = fixture({ auditFailure: failure });
        await assert.rejects(
          command(
            f.context,
            composition,
            'fixture-reviewer',
            false,
            supplied ? f.client : undefined
          ),
          (error) => error === failure
        );
        assert.deepEqual(
          f.lifecycle(),
          supplied ? [] : ['connect', 'BEGIN', 'ROLLBACK', 'release']
        );
        assert.ok(
          f
            .queries()
            .some((call) =>
              call.sql.startsWith('INSERT INTO publication_deliveries')
            )
        );
        assert.equal(f.audits.length, 0);
      }
    );
  }
});

test('composition returns an existing batch delivery without creating another draft or audit', async () => {
  const f = fixture({
    query(sql) {
      if (sql.startsWith('SELECT id FROM sponsor_publication_batches'))
        return { rows: [{ id: batchId }], rowCount: 1 };
      if (sql.startsWith('SELECT id,mode,status,feed_id'))
        return {
          rows: [{ id, mode: 'live', status: 'draft', feed_id: feedId }],
          rowCount: 1
        };
    }
  });
  const input = { ...composition, kind: 'sponsorship', batchId };
  assert.deepEqual(await command(f.context, input, 'fixture-reviewer'), { id });
  assert.deepEqual(await command(f.context, input, 'fixture-reviewer'), { id });
  assert.equal(f.audits.length, 0);
  assert.ok(!f.queries().some((call) => /^(INSERT|UPDATE)/.test(call.sql)));
  assert.equal(
    f.queries().filter((call) => call.sql.includes('FOR UPDATE')).length,
    2
  );
});

test('worker switch validates confirmation, locks the supplied client and gives an immediate replay no new audit', async () => {
  const f = fixture();
  const input = {
    action: 'worker',
    enabled: true,
    version: 1,
    confirmation: 'enable-worker'
  };
  await assert.rejects(
    command(
      f.context,
      { ...input, confirmation: 'disable-worker' },
      'fixture-owner'
    ),
    {
      code: 'CONFIRMATION_REQUIRED',
      status: 400
    }
  );
  assert.deepEqual(f.calls, []);
  await command(f.context, input, 'fixture-owner', false, f.client);
  await command(f.context, input, 'fixture-owner', false, f.client);
  assert.deepEqual(f.lifecycle(), []);
  assert.equal(
    f
      .queries()
      .filter((call) =>
        call.sql.startsWith('UPDATE publication_worker_settings')
      ).length,
    1
  );
  assert.equal(f.audits.length, 1);
  assert.deepEqual(JSON.parse(f.audits[0][3]), {
    previousEnabled: false,
    enabled: true,
    previousVersion: 1,
    version: 2
  });
  assert.ok(
    f.calls
      .filter((call) => call.kind === 'workerSettings')
      .every((call) => call.db === f.client && call.lock === 'FOR UPDATE')
  );
  await assert.rejects(
    command(
      f.context,
      { ...input, enabled: false, confirmation: 'disable-worker' },
      'fixture-owner'
    ),
    {
      code: 'WORKER_VERSION_CONFLICT'
    }
  );
  assert.deepEqual(f.lifecycle(), ['connect', 'BEGIN', 'ROLLBACK', 'release']);
  assert.equal(f.audits.length, 1);
});

test('delivery decisions reject stale versions, missing confirmation and locked deliveries before mutation', async (t) => {
  for (const [action, overrides, inputOverrides, code] of [
    ['approve', {}, { version: 3 }, 'VERSION_CONFLICT'],
    ['reject', {}, { confirmation: 'wrong-target' }, 'CONFIRMATION_REQUIRED'],
    ['cancel', { status: 'publishing' }, {}, 'DELIVERY_LOCKED'],
    [
      'approve',
      { scheduled_at: new Date('2000-01-01T14:00:00Z') },
      {},
      'APPROVAL_UNAVAILABLE'
    ]
  ]) {
    await t.test(code, async () => {
      const f = fixture({ row: delivery(overrides) });
      await assert.rejects(
        command(
          f.context,
          { action, id, version: 4, confirmation: id, ...inputOverrides },
          'fixture-reviewer'
        ),
        { code }
      );
      assert.equal(f.queries().length, 3);
      assert.equal(f.audits.length, 0);
      assert.deepEqual(f.lifecycle(), [
        'connect',
        'BEGIN',
        'ROLLBACK',
        'release'
      ]);
    });
  }
});

test('rejection and cancellation revoke sending authorization without changing the sponsor dossier', async (t) => {
  for (const [action, status] of [
    ['reject', 'rejected'],
    ['cancel', 'cancelled']
  ]) {
    await t.test(action, async () => {
      const f = fixture({
        row: delivery({ status: 'approved', batch_id: batchId })
      });
      assert.deepEqual(
        await command(
          f.context,
          { action, id, version: 4, confirmation: id },
          'fixture-reviewer'
        ),
        { id }
      );
      const updates = f
        .queries()
        .filter((call) => call.sql.startsWith('UPDATE'));
      assert.equal(updates.length, 1);
      assert.match(
        updates[0].sql,
        /^UPDATE publication_deliveries SET status=\$2,auto_managed=FALSE,approved_at=NULL,approved_by=NULL/
      );
      assert.deepEqual(updates[0].parameters, [id, status]);
      assert.equal(f.audits[0][1], `publication_automation.${action}`);
      assert.deepEqual(f.lifecycle(), [
        'connect',
        'BEGIN',
        'COMMIT',
        'release'
      ]);
    });
  }
});

test('approval uses the caller client for preflight and sending authorization without provider publication', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    assert.fail('Approval must not send')
  );
  const f = fixture();
  assert.deepEqual(
    await command(
      f.context,
      { action: 'approve', id, version: 4, confirmation: id },
      'fixture-reviewer',
      false,
      f.client
    ),
    { id }
  );
  assert.equal(f.calls.find((call) => call.kind === 'feeds').db, f.client);
  const update = f
    .queries()
    .find((call) => call.sql.startsWith('UPDATE publication_deliveries'));
  assert.match(
    update.sql,
    /status='approved',approved_at=NOW\(\),approved_by=\$2,version=version\+1/
  );
  assert.deepEqual(update.parameters, [id, 'fixture-reviewer']);
  assert.deepEqual(f.lifecycle(), []);
  assert.equal(f.audits[0][1], 'publication_automation.approve');
  assert.deepEqual(JSON.parse(f.audits[0][3]), {
    version: 4,
    feedId,
    mode: 'live'
  });
});

const source = {
  id: '44444444-4444-4444-8444-444444444444',
  contribution_id: sponsorId,
  title: 'Synthetic sponsor',
  body: 'Approved public synthetic summary',
  disclosure_text: 'Commandite rémunérée.',
  feed_target: 'openg20',
  channel: 'facebook'
};
const sponsorVersion = '2098-01-01 14:00:00.123456+00';
const sponsorQuery = (sql) => {
  if (sql.startsWith('SELECT * FROM sponsor_publication_batches'))
    return { rows: [{ status: 'open', capacity: 5 }], rowCount: 1 };
  if (sql.startsWith('SELECT 1 FROM social_publication_jobs'))
    return { rows: [], rowCount: 0 };
  if (sql.startsWith('SELECT d.id,d.contribution_id'))
    return {
      rows: [
        {
          ...source,
          status: 'draft',
          sponsor_feed_status: 'not_planned',
          public_display_consent: true,
          sponsor_review_status: 'pending_review',
          payment_status: 'paid',
          destination_eligible: true
        }
      ],
      rowCount: 1
    };
  if (sql.startsWith('SELECT c.id,c.updated_at::text'))
    return {
      rows: [
        { id: sponsorId, version: sponsorVersion, presentation_approved: true }
      ],
      rowCount: 1
    };
};

const image = {
  id: '55555555-5555-4555-8555-555555555555',
  url: '/api/public/sponsor-media/55555555-5555-4555-8555-555555555555',
  alt: 'Approved synthetic presentation',
  key: 'private/synthetic-presentation',
  version: sponsorVersion
};
const secondImageId = '66666666-6666-4666-8666-666666666666';
const foreignImageId = '77777777-7777-4777-8777-777777777777';
const secondSource = {
  ...source,
  id: '88888888-8888-4888-8888-888888888888',
  contribution_id: '99999999-9999-4999-8999-999999999999'
};

test('composition and edit restrict sponsorship images to either source of a collective batch before bytes or writes', async (t) => {
  for (const action of ['compose', 'edit']) {
    for (const mediaId of [image.id, secondImageId, foreignImageId]) {
      await t.test(`${action}: ${mediaId}`, async () => {
        const foreign = mediaId === foreignImageId;
        const f = fixture({
          row: delivery({
            kind: 'sponsorship',
            batch_id: batchId,
            source_snapshot: [source, secondSource]
          }),
          query(sql, parameters) {
            if (sql.startsWith('SELECT id FROM sponsor_publication_batches'))
              return { rows: [{ id: batchId }], rowCount: 1 };
            if (sql.startsWith('SELECT id,mode,status,feed_id'))
              return { rows: [], rowCount: 0 };
            if (sql.startsWith('SELECT d.id,d.contribution_id'))
              return {
                rows: [source, secondSource].map((source) => ({
                  ...source,
                  status: 'draft',
                  sponsor_feed_status: 'planned',
                  public_display_consent: true,
                  sponsor_review_status: 'approved',
                  payment_status: 'paid',
                  destination_eligible: true
                })),
                rowCount: 2
              };
            if (sql.startsWith('SELECT m.id,m.public_url')) {
              assert.deepEqual(parameters, [mediaId, batchId]);
              assert.match(
                sql,
                /s\.batch_id=\$2::uuid AND s\.contribution_id=m\.contribution_id/
              );
              return {
                rows: foreign
                  ? []
                  : [
                      {
                        ...image,
                        id: mediaId,
                        url: '/api/public/sponsor-media/' + mediaId
                      }
                    ],
                rowCount: foreign ? 0 : 1
              };
            }
            return sponsorQuery(sql);
          }
        });
        let reads = 0;
        f.context.storage.readPrivateObject = async () => {
          reads++;
          return Buffer.from('Synthetic image bytes');
        };
        const input =
          action === 'compose'
            ? { ...composition, kind: 'sponsorship', batchId, mediaId }
            : {
                action,
                id,
                version: 4,
                message: composition.message,
                scheduledAt: composition.scheduledAt,
                mediaId
              };
        if (foreign) {
          await assert.rejects(command(f.context, input, 'reviewer'), {
            code: 'MEDIA_NOT_APPROVED'
          });
          assert.equal(reads, 0);
          assert.equal(
            f.queries().some((call) => /^(INSERT|UPDATE)/.test(call.sql)),
            false
          );
          assert.deepEqual(f.lifecycle(), [
            'connect',
            'BEGIN',
            'ROLLBACK',
            'release'
          ]);
        } else {
          assert.deepEqual(await command(f.context, input, 'reviewer'), {
            id
          });
          assert.equal(reads, 1);
          assert.equal(
            f.queries().filter((call) => /^(INSERT|UPDATE)/.test(call.sql))
              .length,
            2
          );
        }
      });
    }
  }
});

test('editorial composition and edit keep shared images without a batch scope', async () => {
  for (const action of ['compose', 'edit']) {
    const f = fixture({
      query(sql, parameters) {
        if (!sql.startsWith('SELECT m.id,m.public_url')) return;
        assert.deepEqual(parameters, [foreignImageId, null]);
        return {
          rows: [
            {
              ...image,
              id: foreignImageId,
              url: '/api/public/sponsor-media/' + foreignImageId
            }
          ],
          rowCount: 1
        };
      }
    });
    let reads = 0;
    f.context.storage.readPrivateObject = async () => {
      reads++;
      return Buffer.from('Shared editorial image');
    };
    const input =
      action === 'compose'
        ? { ...composition, mediaId: foreignImageId }
        : {
            action,
            id,
            version: 4,
            message: composition.message,
            scheduledAt: composition.scheduledAt,
            mediaId: foreignImageId
          };
    assert.deepEqual(await command(f.context, input, 'reviewer'), { id });
    assert.equal(reads, 1);
  }
});

test('combined approval refuses foreign media before sponsor decisions, image reads or persistence', async () => {
  const f = fixture({
    row: delivery({
      kind: 'sponsorship',
      batch_id: batchId,
      source_snapshot: [source],
      media_id: foreignImageId
    }),
    query(sql, parameters) {
      if (sql.startsWith('SELECT m.id FROM sponsor_media_assets')) {
        assert.deepEqual(parameters, [foreignImageId, batchId]);
        return { rows: [], rowCount: 0 };
      }
      return sponsorQuery(sql);
    }
  });
  await assert.rejects(
    command(
      f.context,
      {
        action: 'approve',
        id,
        version: 4,
        confirmation: id,
        approveSponsors: [{ id: sponsorId, version: sponsorVersion }]
      },
      'reviewer'
    ),
    { code: 'MEDIA_NOT_APPROVED' }
  );
  assert.equal(
    f.queries().some((call) => /^(INSERT|UPDATE)/.test(call.sql)),
    false
  );
  assert.deepEqual(f.audits, []);
  assert.deepEqual(f.lifecycle(), ['connect', 'BEGIN', 'ROLLBACK', 'release']);
});

test('combined approval checks media ownership before approving its pending sponsor and resolves it after approval', async () => {
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#345678' }
  })
    .png()
    .toBuffer();
  let approved = false;
  const f = fixture({
    row: delivery({
      kind: 'sponsorship',
      batch_id: batchId,
      source_snapshot: [source],
      media_id: image.id,
      media_snapshot: { ...image, hash: digest(bytes) }
    }),
    query(sql, parameters) {
      if (sql.startsWith('SELECT m.id FROM sponsor_media_assets')) {
        assert.equal(approved, false);
        assert.deepEqual(parameters, [image.id, batchId]);
        return { rows: [{ id: image.id }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE fund_contributions')) {
        approved = true;
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('SELECT m.id,m.public_url')) {
        assert.equal(approved, true);
        assert.deepEqual(parameters, [image.id, batchId]);
        return { rows: [image], rowCount: 1 };
      }
      const result = sponsorQuery(sql);
      if (approved && sql.startsWith('SELECT d.id,d.contribution_id'))
        result.rows[0].sponsor_review_status = 'approved';
      return result;
    }
  });
  let reads = 0;
  f.context.storage.readPrivateObject = async () => {
    assert.equal(approved, true);
    reads++;
    return bytes;
  };
  assert.deepEqual(
    await command(
      f.context,
      {
        action: 'approve',
        id,
        version: 4,
        confirmation: id,
        approveSponsors: [{ id: sponsorId, version: sponsorVersion }]
      },
      'reviewer'
    ),
    { id }
  );
  assert.equal(reads, 2);
  assert.deepEqual(f.lifecycle(), ['connect', 'BEGIN', 'COMMIT', 'release']);
});

test('combined approval retains microsecond dossier versions and requests rollback after failed preflight', async (t) => {
  for (const version of ['2098-01-01 14:00:00.123000+00', sponsorVersion]) {
    await t.test(
      version === sponsorVersion
        ? 'preflight rollback'
        : 'stale dossier version',
      async () => {
        const f = fixture({
          row: delivery({ batch_id: batchId, source_snapshot: [source] }),
          query: sponsorQuery,
          feed: { connection: 'error' }
        });
        await assert.rejects(
          command(
            f.context,
            {
              action: 'approve',
              id,
              version: 4,
              confirmation: id,
              approveSponsors: [{ id: sponsorId, version }]
            },
            'fixture-reviewer'
          ),
          {
            code:
              version === sponsorVersion
                ? 'CONNECTION_REQUIRED'
                : 'VERSION_CONFLICT'
          }
        );
        const sponsorWrites = f
          .queries()
          .filter((call) => call.sql.startsWith('UPDATE fund_contributions'));
        assert.equal(sponsorWrites.length, version === sponsorVersion ? 1 : 0);
        if (sponsorWrites.length) {
          assert.match(
            sponsorWrites[0].sql,
            /sponsor_site_visibility_held=TRUE/
          );
          assert.equal(
            f.audits[0][1],
            'publication_automation.approve_sponsor'
          );
          assert.equal(
            JSON.parse(f.audits[0][3]).siteVisibility,
            'unchanged_private'
          );
        }
        assert.ok(
          !f
            .queries()
            .some((call) =>
              call.sql.startsWith('UPDATE publication_deliveries')
            )
        );
        assert.deepEqual(f.lifecycle(), [
          'connect',
          'BEGIN',
          'ROLLBACK',
          'release'
        ]);
      }
    );
  }
});

test('editing exact approved content revokes authorization and automatic ownership in the same transaction', async () => {
  const f = fixture({
    row: delivery({
      status: 'approved',
      approved_at: new Date('2098-01-01T14:00:00Z')
    })
  });
  const input = {
    action: 'edit',
    id,
    version: 4,
    message: 'Revised synthetic message',
    scheduledAt: '2099-01-02T14:00:00Z',
    mediaId: null
  };
  assert.deepEqual(await command(f.context, input, 'fixture-reviewer'), { id });
  const update = f
    .queries()
    .find((call) => call.sql.startsWith('UPDATE publication_deliveries'));
  assert.match(
    update.sql,
    /status='draft',auto_managed=FALSE,approved_at=NULL,approved_by=NULL/
  );
  assert.match(
    update.sql,
    /next_attempt_at=NULL,provider_media_id=NULL,version=version\+1/
  );
  assert.deepEqual(update.parameters, [
    id,
    input.message,
    input.scheduledAt,
    null,
    null,
    '[]',
    '20',
    'live'
  ]);
  assert.equal(f.audits[0][1], 'publication_automation.edit');
  assert.deepEqual(f.lifecycle(), ['connect', 'BEGIN', 'COMMIT', 'release']);
});

test('an absence attestation requires uncertainty and a reason, clears approval and audits both decisions', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    assert.fail('An attestation must not send')
  );
  for (const [status, reason, code] of [
    ['uncertain', 'Too short', 'ABSENCE_REVIEW_REQUIRED'],
    [
      'approved',
      'Provider history was checked; no matching post exists.',
      'ABSENCE_REVIEW_REQUIRED'
    ],
    [
      'uncertain',
      'Provider history was checked; no matching post exists.',
      null
    ]
  ]) {
    await t.test(`${status}: ${code ?? 'accepted'}`, async () => {
      const f = fixture({ row: delivery({ status }) });
      const pending = command(
        f.context,
        { action: 'confirm-absent', id, version: 4, confirmation: id, reason },
        'fixture-reviewer'
      );
      if (code) {
        await assert.rejects(pending, { code, status: 400 });
        assert.equal(f.audits.length, 0);
        assert.equal(
          f.queries().filter((call) => call.sql.startsWith('UPDATE')).length,
          0
        );
      } else {
        assert.deepEqual(await pending, { id });
        assert.match(
          f.queries().find((call) => call.sql.startsWith('UPDATE')).sql,
          /status='blocked',approved_at=NULL,approved_by=NULL,error_code='ABSENCE_CONFIRMED'/
        );
        assert.deepEqual(
          f.audits.map((entry) => entry[1]),
          [
            'publication_automation.absence_review',
            'publication_automation.confirm-absent'
          ]
        );
        assert.deepEqual(JSON.parse(f.audits[0][3]), { reason });
        assert.equal(f.completions.length, 0);
      }
    });
  }
});

test('reconciliation lookup failure preserves uncertainty and never treats inaccessible remote posts as absent', async (t) => {
  for (const response of [404, 503, 'timeout']) {
    await t.test(String(response), async (t) => {
      const f = fixture({ row: delivery({ status: 'uncertain' }) });
      let lookups = 0;
      t.mock.method(globalThis, 'fetch', async (_url, init) => {
        lookups++;
        assert.equal(init.method ?? 'GET', 'GET');
        if (response === 'timeout')
          throw new Error('Synthetic connection failure');
        return new Response('{}', { status: response });
      });
      await assert.rejects(
        command(
          f.context,
          {
            action: 'reconcile',
            id,
            version: 4,
            confirmation: id,
            externalPostId: '20_99'
          },
          'fixture-reviewer'
        ),
        {
          code: 'REMOTE_POST_UNVERIFIED',
          status: 503
        }
      );
      assert.equal(lookups, 1);
      assert.equal(f.completions.length, 0);
      assert.equal(f.audits.length, 0);
      assert.ok(!f.queries().some((call) => call.sql.startsWith('UPDATE')));
      assert.deepEqual(f.lifecycle(), [
        'connect',
        'BEGIN',
        'ROLLBACK',
        'release'
      ]);
    });
  }
});

test('reconciliation refuses changed mode or destination, images and wrong content', async (t) => {
  for (const [overrides, response, code] of [
    [{ mode: 'mock' }, null, 'MODE_CHANGED'],
    [{ account_id: '7' }, null, 'DESTINATION_CHANGED'],
    [{ media_id: sponsorId }, null, 'MEDIA_RECONCILIATION_REQUIRED'],
    [
      {},
      { from: { id: '20' }, message: 'Different content', is_published: true },
      'POST_MISMATCH'
    ]
  ]) {
    await t.test(code, async (t) => {
      const f = fixture({
        row: delivery({ status: 'uncertain', ...overrides })
      });
      let lookups = 0;
      t.mock.method(globalThis, 'fetch', async () => {
        lookups++;
        assert.ok(
          response,
          'Invalid local preconditions must prevent provider lookup'
        );
        return Response.json(response);
      });
      await assert.rejects(
        command(
          f.context,
          {
            action: 'reconcile',
            id,
            version: 4,
            confirmation: id,
            externalPostId: '20_99'
          },
          'fixture-reviewer'
        ),
        { code }
      );
      assert.equal(lookups, response ? 1 : 0);
      assert.equal(f.completions.length, 0);
      assert.equal(f.audits.length, 0);
      assert.deepEqual(f.lifecycle(), [
        'connect',
        'BEGIN',
        'ROLLBACK',
        'release'
      ]);
    });
  }
});

test('verified reconciliation completes with the caller client, and completion failure prevents success audit', async (t) => {
  for (const failure of [
    undefined,
    new Error('Synthetic completion failure')
  ]) {
    await t.test(
      failure ? 'completion fails' : 'verified completion',
      async (t) => {
        const row = delivery({ status: 'uncertain' });
        const f = fixture({ row, completeFailure: failure });
        t.mock.method(globalThis, 'fetch', async (_url, init) => {
          assert.equal(init.method ?? 'GET', 'GET');
          return Response.json({
            from: { id: '20' },
            message: row.message,
            is_published: true
          });
        });
        const result = command(
          f.context,
          {
            action: 'reconcile',
            id,
            version: 4,
            confirmation: id,
            externalPostId: '20_99'
          },
          'fixture-reviewer',
          false,
          f.client
        );
        if (failure) await assert.rejects(result, (error) => error === failure);
        else assert.deepEqual(await result, { id });
        assert.deepEqual(f.completions[0], [
          f.client,
          row,
          '20_99',
          'https://www.facebook.com/20_99',
          'fixture-reviewer'
        ]);
        assert.deepEqual(f.lifecycle(), []);
        assert.equal(f.audits.length, failure ? 0 : 1);
      }
    );
  }
});

test('connection check contacts the provider before opening its write transaction and records failure safely', async (t) => {
  for (const status of [200, 403]) {
    await t.test(String(status), async (t) => {
      const f = fixture();
      t.mock.method(globalThis, 'fetch', async () => {
        assert.deepEqual(f.lifecycle(), []);
        f.calls.push({ kind: 'providerLookup' });
        return Response.json(
          status === 200
            ? { id: '20' }
            : { error: { message: 'Synthetic private error' } },
          { status }
        );
      });
      assert.deepEqual(
        await command(
          f.context,
          { action: 'check', feedId },
          'fixture-reviewer'
        ),
        {}
      );
      const update = f
        .queries()
        .find((call) => call.sql.startsWith('UPDATE publication_feeds'));
      assert.equal(update.parameters[1], status === 200 ? 'ready' : 'error');
      assert.equal(f.audits[0][1], 'publication_automation.connection_check');
      assert.deepEqual(JSON.parse(f.audits[0][3]), {
        connection: status === 200 ? 'ready' : 'error'
      });
      assert.deepEqual(f.lifecycle(), [
        'connect',
        'BEGIN',
        'COMMIT',
        'release'
      ]);
    });
  }
});

test('private preparation delegates unchanged without acquiring a command transaction', async () => {
  const f = fixture();
  assert.deepEqual(
    await command(
      f.context,
      { action: 'prepare', feedId },
      'fixture-reviewer',
      false,
      f.client
    ),
    {}
  );
  assert.deepEqual(f.calls, [
    { kind: 'prepare', args: [feedId, 'fixture-reviewer'] }
  ]);
});

test('settings and pause-all preserve the caller transaction and audit actor', async (t) => {
  for (const input of [
    {
      action: 'settings',
      settings: {
        id: feedId,
        paused: true,
        autoPrepare: false,
        timezone: 'America/Toronto',
        weekdays: [1, 3],
        localTime: '10:00',
        capacity: 5,
        horizonDays: 14
      }
    },
    { action: 'pause-all' }
  ]) {
    await t.test(input.action, async () => {
      const f = fixture();
      assert.deepEqual(
        await command(f.context, input, 'fixture-reviewer', false, f.client),
        {}
      );
      assert.deepEqual(f.lifecycle(), []);
      assert.equal(
        f
          .queries()
          .filter((call) => call.sql.startsWith('UPDATE publication_feeds'))
          .length,
        1
      );
      assert.equal(f.audits[0][0], 'fixture-reviewer');
      assert.equal(
        f.audits[0][1],
        `publication_automation.${input.action === 'settings' ? 'settings' : 'pause_all'}`
      );
    });
  }
});
