import assert from 'node:assert/strict';
import test from 'node:test';

import {
  prepare,
  repairPreview,
  repair,
  guardEligibility
} from '../dist/apps/funding-api/src/publication-automation/planning.js';
import { sourceMessage } from '../dist/apps/funding-api/src/publication-automation/sources.js';
import { PublicationAutomationError } from '../dist/apps/funding-api/src/publication-automation/policy.js';

const feed = {
  id: 'openg7:facebook',
  paused: true,
  configured: false,
  autoPrepare: true,
  timezone: 'UTC',
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  localTime: '10:00',
  capacity: 3,
  horizonDays: 1
};
const now = new Date('2099-01-01T09:00:00Z');
const source = {
  id: 'draft-retained',
  contribution_id: 'sponsor-retained',
  title: 'Merci à Exemple',
  body: 'Une contribution publique.',
  disclosure_text: 'Commandite rémunérée.',
  feed_target: 'openg7',
  channel: 'facebook'
};
const facts = {
  id: source.contribution_id,
  status: 'paid',
  public_display_consent: true,
  sponsor_review_status: 'approved',
  sponsor_feed_status: 'planned',
  destination_eligible: true,
  review_changed: false
};
const media = {
  id: 'approved-photo',
  url: '/api/public/sponsor-media/approved-photo',
  alt: 'Photo approuvée',
  key: 'private/approved-photo',
  version: '2099-01-01 08:00:00.123456+00'
};
const delivery = {
  id: 'delivery',
  feed_id: feed.id,
  batch_id: 'batch',
  kind: 'sponsorship',
  status: 'draft',
  auto_managed: true,
  version: 4,
  scheduled_at: new Date('2099-01-01T10:00:00Z'),
  message: 'Human text',
  source_snapshot: [],
  media_id: media.id,
  media_snapshot: { ...media, hash: 'approved-hash' },
  approved_at: null,
  approved_by: null,
  account_id: '',
  mode: 'simulate'
};

function database(resolve) {
  const calls = [];
  let active = false;
  let connections = 0;
  let releases = 0;
  const query = async (owner, sql, parameters = []) => {
    calls.push({ owner, sql, parameters });
    if (sql === 'BEGIN') {
      assert.equal(active, false);
      active = true;
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'COMMIT' || sql === 'ROLLBACK') {
      assert.equal(active, true);
      active = false;
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('INSERT INTO admin_audit_log'))
      return { rows: [], rowCount: 1 };
    const rows = await resolve(sql, parameters, owner);
    assert.ok(Array.isArray(rows), `Unexpected query: ${sql}`);
    return { rows, rowCount: rows.length };
  };
  const client = {
    query: (sql, parameters) => query('client', sql, parameters),
    release() {
      assert.equal(active, false);
      releases++;
    }
  };
  const pool = {
    query: (sql, parameters) => query('pool', sql, parameters),
    async connect() {
      connections++;
      return client;
    }
  };
  return {
    pool,
    client,
    calls,
    get active() {
      return active;
    },
    get connections() {
      return connections;
    },
    get releases() {
      return releases;
    },
    audits() {
      return calls
        .filter((c) => c.sql.startsWith('INSERT INTO admin_audit_log'))
        .map(({ owner, parameters: [actor, action, id, metadata] }) => ({
          owner,
          actor,
          action,
          id,
          metadata: JSON.parse(metadata)
        }));
    }
  };
}

function context(db, command = async () => ({})) {
  return {
    pool: db.pool,
    env: {},
    async feeds(client) {
      assert.ok(client === db.client || client === db.pool);
      return [feed];
    },
    command
  };
}

function preparationDb({
  job = null,
  overdue = [],
  members = [],
  candidates = [source]
} = {}) {
  return database((sql) => {
    if (sql.startsWith('SELECT id FROM publication_feeds'))
      return [{ id: feed.id }];
    if (sql.startsWith('INSERT INTO sponsor_publication_drafts')) return [];
    if (sql.includes('scheduled_at<=$2 ORDER BY id')) return overdue;
    if (sql.startsWith('SELECT b.* FROM publication_recurrences'))
      return [{ id: 'batch', status: 'open', capacity: feed.capacity }];
    if (sql.includes("WHERE batch_id=$1 AND status<>'cancelled'"))
      return job ? [job] : [];
    if (sql.startsWith('SELECT * FROM sponsor_publication_batches'))
      return [{ id: 'batch', status: 'open', capacity: feed.capacity }];
    if (sql.startsWith('SELECT * FROM sponsor_publication_drafts'))
      return [...members];
    if (sql.startsWith('SELECT d.* FROM sponsor_publication_drafts'))
      return candidates;
    if (sql.startsWith('SELECT 1 FROM social_publication_jobs')) return [];
    if (sql.startsWith('SELECT d.id,d.contribution_id'))
      return [...members, ...candidates].map((s) => ({
        ...s,
        status: 'draft',
        sponsor_feed_status: 'planned',
        public_display_consent: true,
        sponsor_review_status: 'pending_review',
        payment_status: 'paid',
        destination_eligible: true
      }));
    if (sql.includes('to_regclass')) return [{ table_name: null }];
    if (sql.startsWith('UPDATE ')) return [];
  });
}

test('private preparation accepts pending review on paused unconfigured feeds and composes after commit', async () => {
  const db = preparationDb();
  const commands = [];
  await prepare(
    context(db, async (...args) => {
      assert.equal(db.active, false);
      assert.equal(db.releases, 1);
      commands.push(args);
      return {};
    }),
    feed.id,
    'planner',
    now
  );

  assert.deepEqual(commands, [
    [
      {
        action: 'compose',
        feedId: feed.id,
        kind: 'sponsorship',
        batchId: 'batch'
      },
      'planner',
      true
    ]
  ]);
  assert.deepEqual(db.audits().at(-1), {
    owner: 'client',
    actor: 'planner',
    action: 'publication_automation.prepare',
    id: feed.id,
    metadata: { proposedBatches: 1 }
  });
  const assignment = db.calls.find((c) =>
    c.sql.startsWith('UPDATE sponsor_publication_drafts')
  );
  assert.deepEqual(assignment.parameters, [
    source.id,
    'batch',
    '2099-01-01T10:00:00.000Z'
  ]);
  assert.equal(db.connections, 1);
  assert.equal(
    db.calls.some((c) => c.sql.includes('UPDATE fund_contributions')),
    false
  );
});

test('preparation preserves authorized, rejected, uncertain and human edited deliveries with their photos', async (t) => {
  for (const changes of [
    { status: 'approved', approved_at: now, approved_by: 'reviewer' },
    { status: 'rejected' },
    { status: 'uncertain' },
    { status: 'draft', auto_managed: false }
  ]) {
    await t.test(JSON.stringify(changes), async () => {
      const job = { ...delivery, ...changes };
      const before = structuredClone(job);
      const db = preparationDb({ job });
      await prepare(
        context(db, async () =>
          assert.fail('Protected delivery must not be recomposed')
        ),
        feed.id,
        'planner',
        now
      );
      assert.deepEqual(job, before);
      assert.equal(
        db.calls.some((c) => c.sql.startsWith('UPDATE ')),
        false
      );
      assert.equal(
        db.calls.some((c) =>
          c.sql.startsWith('SELECT d.* FROM sponsor_publication_drafts')
        ),
        false
      );
      assert.deepEqual(db.audits().at(-1).metadata, { proposedBatches: 0 });
    });
  }
});

test('only untouched overdue proposals are released before packing the next recurrence', async () => {
  const old = {
    ...delivery,
    id: 'old-delivery',
    batch_id: 'old-batch',
    scheduled_at: new Date('2098-12-31T10:00:00Z')
  };
  const db = preparationDb({ overdue: [old] });
  const commands = [];
  await prepare(
    context(db, async (input) => {
      commands.push(input);
      return {};
    }),
    feed.id,
    'planner',
    now
  );
  const writes = db.calls.filter((c) => c.sql.startsWith('UPDATE '));
  assert.deepEqual(
    writes.slice(0, 3).map((c) => c.parameters),
    [['old-delivery'], ['old-batch'], ['old-batch']]
  );
  assert.equal(commands.length, 1);
  assert.deepEqual(
    db.audits().map((a) => a.action),
    [
      'publication_automation.reschedule_proposal',
      'publication_automation.prepare'
    ]
  );
});

test('preparation records blocked composition after commit and preserves unexpected failures', async (t) => {
  for (const known of [true, false]) {
    await t.test('known=' + known, async () => {
      const db = preparationDb();
      const error = known
        ? new PublicationAutomationError('SOURCE_NOT_ELIGIBLE')
        : new Error('composition failed');
      const operation = prepare(
        context(db, async () => {
          assert.equal(db.active, false);
          assert.equal(db.releases, 1);
          throw error;
        }),
        feed.id,
        'planner',
        now
      );
      if (known) {
        await operation;
        assert.deepEqual(db.audits().at(-1), {
          owner: 'pool',
          actor: 'planner',
          action: 'publication_automation.preparation_blocked',
          id: 'batch',
          metadata: { code: 'SOURCE_NOT_ELIGIBLE' }
        });
      } else {
        await assert.rejects(operation, (actual) => actual === error);
        assert.equal(
          db.audits().at(-1).action,
          'publication_automation.prepare'
        );
      }
      assert.equal(db.calls.filter((c) => c.sql === 'COMMIT').length, 1);
      assert.equal(
        db.calls.some((c) => c.sql === 'ROLLBACK'),
        false
      );
    });
  }
});

test('automatic refresh keeps the selected approved photo and leaves approval for the human decision', async () => {
  const job = { ...delivery };
  const db = preparationDb({ job });
  await prepare(
    context(db, async () =>
      assert.fail('Existing proposal must not be recomposed')
    ),
    feed.id,
    'planner',
    now
  );
  const refresh = db.calls.find((c) =>
    c.sql.startsWith('UPDATE publication_deliveries SET message=')
  );
  assert.equal(refresh.parameters[1], sourceMessage([source]));
  assert.deepEqual(JSON.parse(refresh.parameters[2]), [source]);
  assert.equal(refresh.sql.includes('media_id='), false);
  assert.equal(refresh.sql.includes('approved_at='), false);
  assert.deepEqual(job.media_snapshot, delivery.media_snapshot);
  assert.deepEqual(
    db.audits().map((a) => a.action),
    [
      'publication_automation.refresh_proposal',
      'publication_automation.prepare'
    ]
  );
});

function repairDb({
  row = { ...delivery, status: 'blocked' },
  legacy = false,
  keepMedia = true
} = {}) {
  const replacement = {
    ...source,
    id: 'draft-replacement',
    contribution_id: 'sponsor-replacement',
    name: 'Replacement'
  };
  const db = database((sql) => {
    if (sql.startsWith('SELECT feed_id FROM publication_deliveries'))
      return [{ feed_id: row.feed_id }];
    if (sql.startsWith('SELECT * FROM publication_deliveries WHERE id='))
      return [row];
    if (sql.startsWith('SELECT id FROM publication_feeds'))
      return [{ id: feed.id }];
    if (sql.startsWith('SELECT id FROM sponsor_publication_batches'))
      return [{ id: row.batch_id }];
    if (sql.startsWith('SELECT c.id FROM fund_contributions')) return [];
    if (sql.startsWith('SELECT 1 FROM social_publication_jobs'))
      return legacy ? [{}] : [];
    if (sql.startsWith('SELECT c.id,c.status'))
      return [{ ...facts, public_display_consent: false }];
    if (sql.startsWith('SELECT capacity FROM sponsor_publication_batches'))
      return [{ capacity: 3 }];
    if (sql.startsWith('SELECT d.id,d.contribution_id')) return [replacement];
    if (sql.includes('to_regclass')) return [{ table_name: null }];
    if (
      sql.startsWith('SELECT contribution_id FROM sponsor_publication_drafts')
    )
      return [{ contribution_id: source.contribution_id }];
    if (sql.startsWith('SELECT 1 FROM sponsor_media_assets'))
      return keepMedia ? [{}] : [];
    if (sql.startsWith('UPDATE ')) return [];
  });
  return { db, row, replacement };
}

test('repair preview defaults to the pool and stays read only with a stable version', async () => {
  const { db, row } = repairDb();
  const ctx = context(db);
  const first = await repairPreview(ctx, row.id);
  const second = await repairPreview(ctx, row.id);
  assert.deepEqual(second, first);
  assert.equal(first.scheduledAt, row.scheduled_at.toISOString());
  assert.equal(db.connections, 0);
  assert.equal(
    db.calls.every((c) => c.owner === 'pool' && c.sql.startsWith('SELECT ')),
    true
  );
});

test('repair preview excludes legacy and externally uncertain deliveries without proposing a resend', async () => {
  for (const options of [
    { row: { ...delivery, status: 'uncertain' } },
    { row: { ...delivery, status: 'published' } },
    { row: { ...delivery, status: 'rejected' } },
    { legacy: true }
  ]) {
    const { db } = repairDb(options);
    assert.equal(
      await repairPreview(context(db), delivery.id, db.client),
      null
    );
    assert.equal(
      db.calls.some((c) => c.sql.startsWith('UPDATE ')),
      false
    );
  }
});

test('repair delegates edit in the original client, retains only approved eligible media and audits the new proposal', async (t) => {
  for (const keepMedia of [true, false]) {
    await t.test(`keepMedia=${keepMedia}`, async () => {
      const { db, row } = repairDb({ keepMedia });
      const edits = [];
      const ctx = context(db, async (...args) => {
        assert.equal(db.active, true);
        assert.equal(args[3], db.client);
        edits.push(args);
        return { id: row.id };
      });
      const proposal = await repairPreview(ctx, row.id, db.client);
      assert.deepEqual(proposal.removed, [source.contribution_id]);
      assert.deepEqual(proposal.added, ['sponsor-replacement']);
      await repair(ctx, row.id, proposal.version, 'reviewer');
      assert.deepEqual(edits[0].slice(0, 3), [
        {
          action: 'edit',
          id: row.id,
          version: row.version,
          message: proposal.message,
          scheduledAt: proposal.scheduledAt,
          mediaId: keepMedia ? row.media_id : null
        },
        'reviewer',
        false
      ]);
      assert.equal(db.connections, 1);
      assert.equal(db.releases, 1);
      assert.equal(db.calls.at(-1).sql, 'COMMIT');
      assert.deepEqual(db.audits().at(-1).metadata, {
        removed: [source.contribution_id],
        added: ['sponsor-replacement'],
        approval: 'required'
      });
    });
  }
});

test('repair rolls back delegated edit failure and stale versions without a repair audit', async (t) => {
  for (const stale of [false, true]) {
    await t.test(`stale=${stale}`, async () => {
      const { db, row } = repairDb();
      const failure = new PublicationAutomationError('EDIT_REJECTED');
      let edits = 0;
      const ctx = context(db, async (_input, _actor, _automatic, client) => {
        assert.equal(client, db.client);
        edits++;
        throw failure;
      });
      const proposal = await repairPreview(ctx, row.id, db.client);
      await assert.rejects(
        repair(
          ctx,
          row.id,
          stale ? 'stale-version' : proposal.version,
          'reviewer'
        ),
        stale ? { code: 'VERSION_CONFLICT' } : (error) => error === failure
      );
      assert.equal(edits, stale ? 0 : 1);
      assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
      assert.equal(db.releases, 1);
      assert.deepEqual(db.audits(), []);
      if (stale)
        assert.equal(
          db.calls.some((c) => c.sql.startsWith('UPDATE ')),
          false
        );
    });
  }
});

test('eligibility invalidates review, combined source and media failures while retaining valid authorizations', async () => {
  const rows = [
    { ...delivery, id: 'review', status: 'approved' },
    { ...delivery, id: 'combined', status: 'approved' },
    { ...delivery, id: 'media-changed', status: 'approved' },
    {
      ...delivery,
      id: 'media-removed',
      status: 'approved',
      media_id: 'removed-photo'
    },
    { ...delivery, id: 'valid', status: 'approved' }
  ];
  const db = database((sql, parameters) => {
    if (sql.startsWith('SELECT * FROM publication_deliveries WHERE status'))
      return rows;
    if (sql.startsWith('SELECT c.id,c.status')) {
      if (parameters[0] === 'review')
        return [{ ...facts, review_changed: true }];
      if (parameters[0] === 'combined')
        return [
          { ...facts, review_changed: true, public_display_consent: false }
        ];
      return [facts];
    }
    if (sql.startsWith('SELECT m.id,m.public_url')) {
      if (parameters[0] === 'removed-photo') return [];
      const current = db.calls
        .filter((c) => c.sql.startsWith('SELECT c.id,c.status'))
        .at(-1).parameters[0];
      return [
        {
          ...media,
          version:
            current === 'media-changed'
              ? '2099-01-01 08:00:00.123457+00'
              : media.version
        }
      ];
    }
    if (sql.startsWith('UPDATE publication_deliveries')) return [];
  });
  await guardEligibility(
    context(db, async () => assert.fail('Eligibility never authorizes'))
  );
  assert.deepEqual(
    db.calls
      .filter((c) => c.sql.startsWith('UPDATE publication_deliveries'))
      .map((c) => c.parameters),
    [
      ['review', 'SPONSOR_REVIEW_REQUIRED'],
      ['combined', 'SOURCE_NOT_ELIGIBLE'],
      ['media-changed', 'MEDIA_CHANGED'],
      ['media-removed', 'MEDIA_NOT_APPROVED']
    ]
  );
  assert.deepEqual(db.audits()[1].metadata, {
    codes: ['CONSENT_WITHDRAWN', 'SPONSOR_REVIEW_REQUIRED'],
    affected: [source.contribution_id]
  });
  assert.equal(
    db.audits().some((a) => a.id === 'valid'),
    false
  );
  assert.equal(db.calls.at(-1).sql, 'COMMIT');
});
