import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadSponsorshipGoldenPathOnClient,
  readSponsorshipGoldenPath
} from '../dist/apps/funding-api/src/sponsorship-golden-path.service.js';
import { readEngineRoom } from '../dist/apps/funding-api/src/admin-engine-room.service.js';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-25T14:00:00Z');
const obligation = (key = id) => ({
  id: key,
  benefitId: 'facebook_batch',
  channel: 'facebook',
  target: 'openg7',
  ordinal: 1,
  format: 'collective_text',
  state: 'pending',
  version: 1
});
const balance = () => ({
  contributionId: id,
  reference: 'SYNTHETIC-GP1',
  contributionType: 'sponsorship_interest',
  amountMinor: 1500,
  currency: 'CAD',
  paymentStatus: 'paid',
  version: 'balance-v1',
  status: 'waiting',
  reasons: ['publication_scheduled'],
  expected: 1,
  fulfilled: 0,
  waived: 0,
  outstanding: 1,
  unknown: 0,
  obligations: [obligation()],
  next: {
    reason: 'publication_scheduled',
    responsibility: 'platform',
    adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${id}&tab=publication`
  }
});
function fixture(overrides = {}) {
  const calls = [];
  const db = {};
  const values = {
    balance: balance(),
    journey: { status: 'ok', journey: { contributionId: id, steps: [] } },
    commitment: {
      id: other,
      contributionId: id,
      version: 1,
      state: 'active',
      offerId: id
    },
    campaigns: {
      items: [
        {
          id,
          contributionId: id,
          channel: 'facebook',
          target: 'openg7',
          ordinal: 1,
          preparation: {
            status: 'approved',
            version: 'prep-v1',
            approvedAt: now.toISOString(),
            blockers: []
          },
          workflow: {
            state: 'waiting',
            reason: 'publication_scheduled',
            responsibility: 'platform',
            deliveryId: other
          }
        }
      ],
      pagination: { hasNextPage: false }
    },
    publications: [
      {
        id: 'draft',
        obligationId: id,
        channel: 'facebook',
        target: 'openg7',
        deliveryId: other,
        deliveryStatus: 'published',
        deliveryMode: 'mock',
        scheduledAt: null,
        publishedAt: now.toISOString(),
        privateCanary: 'excluded'
      }
    ],
    ...overrides
  };
  const ports = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      async (client, requested) => {
        assert.equal(client, db);
        assert.equal(
          typeof requested === 'string' ? requested : requested.sponsorshipId,
          id
        );
        calls.push(key);
        return value;
      }
    ])
  );
  return { db, ports, calls, values };
}

test('GP1 correlates one dossier, retains native responsibility, and never turns simulated execution into proof', async () => {
  const f = fixture();
  const result = await loadSponsorshipGoldenPathOnClient(
    f.db,
    id.toUpperCase(),
    now,
    f.ports
  );
  assert.equal(result.status, 'available');
  assert.equal(result.path.contributionId, id);
  assert.equal(result.path.next.responsibility, 'platform');
  assert.equal(result.path.counts.fulfilled, 0);
  assert.equal(result.path.services[0].obligation.evidence, undefined);
  assert.equal(result.path.services[0].executions[0].deliveryMode, 'mock');
  assert.equal(result.path.services[0].executions[0].deliveryId, other);
  assert.ok(
    result.path.sources.every(
      (source) => source.observedAt === now.toISOString()
    )
  );
  assert.equal(JSON.stringify(result).includes('excluded'), false);
  assert.deepEqual(f.calls, [
    'balance',
    'journey',
    'commitment',
    'campaigns',
    'publications'
  ]);
});

test('qualified proof, waiver and the next ordinal remain separate even in one destination', async () => {
  const first = {
    ...obligation(),
    state: 'fulfilled',
    version: 2,
    evidence: {
      id: 'qualified',
      obligationId: id,
      provenance: 'provider_verified'
    }
  };
  const second = { ...obligation(other), ordinal: 2, state: 'adjusted' };
  const third = { ...obligation('third'), ordinal: 3 };
  const f = fixture({
    balance: {
      ...balance(),
      expected: 3,
      fulfilled: 1,
      waived: 1,
      outstanding: 1,
      obligations: [first, second, third]
    }
  });
  const { path } = await loadSponsorshipGoldenPathOnClient(
    f.db,
    id,
    now,
    f.ports
  );
  assert.deepEqual(path.counts, {
    expected: 3,
    fulfilled: 1,
    waived: 1,
    outstanding: 1,
    unknown: 0
  });
  assert.equal(path.services[0].obligation.evidence.id, 'qualified');
  assert.equal(path.services[1].obligation.evidence, undefined);
  assert.equal(path.services[2].executions.length, 0);
  assert.equal(path.partial, true);
});

test('unqualified agreement, missing proof and refunded state retain the owner diagnosis', async () => {
  const f = fixture({
    balance: {
      ...balance(),
      paymentStatus: 'refunded',
      status: 'unknown',
      unknown: 1,
      reasons: ['fulfilment_snapshot_unqualified'],
      obligations: [{ ...obligation(), state: 'fulfilled' }]
    },
    commitment: null
  });
  const { path } = await loadSponsorshipGoldenPathOnClient(
    f.db,
    id,
    now,
    f.ports
  );
  assert.equal(path.paymentStatus, 'refunded');
  assert.equal(path.state, 'unknown');
  assert.equal(path.commitment, null);
  assert.equal(path.services[0].obligation.evidence, undefined);
  assert.deepEqual(path.reasons, ['fulfilment_snapshot_unqualified']);
});

test('preparation pages and unrelated dossier or passage records cannot complete the observation', async () => {
  const f = fixture();
  f.values.campaigns.items[0].contributionId = other;
  f.values.campaigns.pagination.hasNextPage = true;
  f.values.publications[0].obligationId = other;
  const { path } = await loadSponsorshipGoldenPathOnClient(
    f.db,
    id,
    now,
    f.ports
  );
  assert.equal(path.partial, true);
  assert.equal(path.services[0].preparation, null);
  assert.equal(path.services[0].workflow, null);
  assert.deepEqual(path.services[0].executions, []);
});

test('duration waiting and uncertain execution remain native blockers, without inventing a delivery', async () => {
  const f = fixture();
  f.values.balance.obligations[0].timing = {
    durationDays: 30,
    durationState: 'awaiting_review'
  };
  f.values.campaigns.items[0].workflow = {
    state: 'uncertain',
    reason: 'publication_uncertain',
    responsibility: 'admin',
    deliveryId: other
  };
  f.values.publications[0].deliveryStatus = 'uncertain';
  f.values.publications[0].deliveryMode = 'live';
  const { path } = await loadSponsorshipGoldenPathOnClient(
    f.db,
    id,
    now,
    f.ports
  );
  assert.equal(
    path.services[0].obligation.timing.durationState,
    'awaiting_review'
  );
  assert.equal(path.services[0].workflow.state, 'uncertain');
  assert.equal(path.counts.fulfilled, 0);
});

test('personal contributions do not acquire sponsorship missions', async () => {
  const f = fixture({
    balance: { ...balance(), contributionType: 'personal_support' }
  });
  assert.deepEqual(
    await loadSponsorshipGoldenPathOnClient(f.db, id, now, f.ports),
    { status: 'not_sponsorship', path: null }
  );
  assert.deepEqual(f.calls, ['balance']);
});

test('scope mismatch fails closed', async () => {
  const f = fixture({ balance: { ...balance(), contributionId: other } });
  await assert.rejects(
    loadSponsorshipGoldenPathOnClient(f.db, id, now, f.ports),
    /SCOPE_MISMATCH/
  );
});

test('reading owns one read-only transaction and sanitizes rollback errors', async () => {
  const f = fixture();
  const statements = [];
  f.db.query = async (sql) => {
    statements.push(sql);
    return {};
  };
  f.db.release = () => statements.push('release');
  const pool = { connect: async () => f.db };
  assert.equal(
    (await readSponsorshipGoldenPath(pool, id, now, f.ports)).status,
    'available'
  );
  assert.deepEqual(statements, [
    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    'COMMIT',
    'release'
  ]);
  statements.length = 0;
  f.ports.campaigns = async () => {
    throw new Error('private diagnostic');
  };
  assert.deepEqual(await readSponsorshipGoldenPath(pool, id, now, f.ports), {
    status: 'unavailable',
    path: null
  });
  assert.deepEqual(statements, [
    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    'ROLLBACK',
    'release'
  ]);
  assert.deepEqual(await readSponsorshipGoldenPath(null, id), {
    status: 'unavailable',
    path: null
  });
});

test('engine context reads GP1 independently and never chooses a participant for a collective', async () => {
  let reads = 0;
  const ports = {
    publications: async () => {
      throw new Error('unavailable publications');
    },
    connectorEnabled: false,
    localPreparationEnabled: false,
    connector: async () => assert.fail('disabled'),
    goldenPath: async (scope) => {
      assert.equal(scope, id);
      reads++;
      return { status: 'available', path: { contributionId: id } };
    }
  };
  const result = await readEngineRoom(ports, { sponsorshipId: id }, () => now);
  assert.equal(result.publications.available, false);
  assert.equal(result.goldenPath.status, 'available');
  assert.equal(
    (await readEngineRoom(ports, { deliveryId: other }, () => now)).goldenPath,
    null
  );
  assert.equal((await readEngineRoom(ports, {}, () => now)).goldenPath, null);
  assert.equal(reads, 1);
});
