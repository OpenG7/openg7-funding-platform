import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicFundingHttpHandler } from '../dist/apps/funding-api/src/public-funding.http.js';
import { listPublicSponsorships } from '../dist/apps/funding-api/src/fund-contributions.repository.js';
import {
  getPublicTransparencySummary,
  listPublicBuilders
} from '../dist/apps/funding-api/src/fund-transparency.repository.js';
import { getPublicSponsorshipBatchAvailability } from '../dist/apps/funding-api/src/fund-admin.repository.js';

const generatedAt = '2026-10-03T12:00:00.000Z';
const summaries = {
  sponsorships: {
    data_source: 'database',
    sponsorships: [],
    last_updated_at: generatedAt,
    pagination: { page: 1, page_size: 50, total_count: 0, published_count: 0 }
  },
  builders: {
    data_source: 'database',
    builders: [],
    last_updated_at: generatedAt,
    pagination: { page: 1, page_size: 24, total_count: 0 }
  },
  availability: {
    data_source: 'database',
    availability: [{ channel: 'linkedin', nextAvailableAt: null }],
    slots: []
  },
  config: {
    business_sponsorship_enabled: false,
    allowed_contribution_amounts: [5, 25, 50],
    last_updated_at: generatedAt
  },
  transparency: {
    data_source: 'database',
    total_received: 0,
    total_fees: 0,
    total_net: 0,
    total_refunded: 0,
    total_payouts: 0,
    current_available_estimate: 0,
    contributions_count: 0,
    pending_fee_count: 0,
    currency: 'CAD',
    monthly_summary: [],
    latest_public_allocations: [],
    public_builders: [],
    last_updated_at: generatedAt,
    generated_at: generatedAt
  }
};
const routes = [
  ['sponsorships', 'sponsorships', 'Public sponsorships could not be loaded.'],
  ['builders', 'builders', 'Public builders could not be loaded.'],
  [
    'sponsorship-batches/availability',
    'availability',
    'Sponsorship batch availability could not be loaded.'
  ],
  ['funding-config', 'config'],
  [
    'fund-transparency',
    'transparency',
    'Public fund transparency summary could not be loaded.'
  ]
];

const fixture = ({ failing, overrides = {} } = {}) => {
  const calls = [];
  const failure = new Error('Synthetic private provider diagnostic');
  const port = (name) => async (input) => {
    calls.push({ name, input });
    if (failing === name) throw failure;
    return summaries[name];
  };
  const handler = createPublicFundingHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    writeJson: (_request, response, status, payload) => {
      calls.push({ name: 'response', status });
      Object.assign(response, { status, payload });
    },
    listPublicSponsorships: port('sponsorships'),
    listPublicBuilders: port('builders'),
    getPublicSponsorshipBatchAvailability: port('availability'),
    getPublicFundingRuntimeConfig: () => {
      calls.push({ name: 'config' });
      return summaries.config;
    },
    getPublicTransparencySummary: port('transparency'),
    reportFailure: (message, error) =>
      calls.push({ name: 'report', message, error }),
    ...overrides
  });
  return {
    calls,
    failure,
    async run(url, method = 'GET') {
      const request = { method, url, headers: {} };
      const response = {};
      const handled = await handler(request, response);
      return { handled, ...response };
    }
  };
};

test('public funding reads retain both aliases and dispatch only their public reader', async (t) => {
  for (const prefix of ['/public/', '/api/public/']) {
    for (const [path, name] of routes) {
      await t.test(prefix + path, async () => {
        const f = fixture();
        const result = await f.run(prefix + path);
        assert.equal(result.handled, true);
        assert.equal(result.status, 200);
        assert.deepEqual(result.payload, summaries[name]);
        assert.deepEqual(
          f.calls.map((call) => call.name),
          [name, 'response']
        );
      });
    }
  }
  const f = fixture();
  assert.equal(
    (
      await f.run(
        'https://funding.example.test/api/public/funding-config?unused=1'
      )
    ).status,
    200
  );
});

test('directories preserve their distinct defaults and strict bounded pagination', async (t) => {
  for (const [path, pageSize] of [
    ['sponsorships', 50],
    ['builders', 24]
  ]) {
    for (const prefix of ['/public/', '/api/public/']) {
      const f = fixture();
      await f.run(prefix + path);
      assert.deepEqual(f.calls[0].input, { page: 1, pageSize });
      for (const query of ['page=3&pageSize=7', 'page=100000&pageSize=50']) {
        const selected = fixture();
        assert.equal(
          (await selected.run(prefix + path + '?' + query)).status,
          200
        );
        const params = new URLSearchParams(query);
        assert.deepEqual(selected.calls[0].input, {
          page: Number(params.get('page')),
          pageSize: Number(params.get('pageSize'))
        });
      }
    }
    for (const query of [
      'page=0',
      'page=-1',
      'page=1.5',
      'page=1abc',
      'page=100001',
      'page=Infinity',
      'page=',
      'page=1&page=2',
      'pageSize=0',
      'pageSize=51',
      'pageSize=1.5',
      'pageSize=12&pageSize=12'
    ]) {
      await t.test(path + '?' + query, async () => {
        const f = fixture();
        const result = await f.run('/api/public/' + path + '?' + query);
        assert.equal(result.handled, true);
        assert.equal(result.status, 400);
        assert.deepEqual(result.payload, {
          error:
            path === 'sponsorships'
              ? 'Invalid public sponsorship pagination.'
              : 'Invalid public directory pagination.'
        });
        assert.deepEqual(
          f.calls.map((call) => call.name),
          ['response']
        );
      });
    }
  }
});

test('reader failures return stable errors without private diagnostics or false empty success', async (t) => {
  for (const [path, name, error] of routes.filter(
    ([, name]) => name !== 'config'
  )) {
    await t.test(path, async () => {
      const f = fixture({ failing: name });
      const result = await f.run('/api/public/' + path);
      assert.equal(result.handled, true);
      assert.equal(result.status, 502);
      assert.deepEqual(result.payload, { error });
      assert.equal(
        JSON.stringify(result.payload).includes(f.failure.message),
        false
      );
      assert.deepEqual(
        f.calls.map((call) => call.name),
        [name, 'report', 'response']
      );
      assert.equal(
        f.calls[1].error,
        name === 'builders' ? undefined : f.failure
      );
    });
  }
});

test('transparency retains the composed source, confirmed zeroes and projection dates', async () => {
  for (const source of ['database', 'stripe_direct', 'empty']) {
    const summary = { ...summaries.transparency, data_source: source };
    const f = fixture({
      overrides: { getPublicTransparencySummary: async () => summary }
    });
    const result = await f.run('/public/fund-transparency');
    assert.equal(result.status, 200);
    assert.deepEqual(result.payload, summary);
    assert.equal(result.payload.pending_fee_count, 0);
    assert.equal(result.payload.generated_at, generatedAt);
  }
});

const queuedPool = (...rows) => {
  const remaining = [...rows];
  return {
    async query() {
      assert.ok(remaining.length > 0, 'Unexpected projection query');
      return { rows: remaining.shift() };
    },
    assertComplete() {
      assert.equal(remaining.length, 0);
    }
  };
};

test('public directory and availability readers omit private source fields at the HTTP boundary', async () => {
  const privateFields = {
    email_private: 'synthetic-private@example.invalid',
    sponsor_contact_email: 'synthetic-contact@example.invalid',
    sponsorship_followup_token_hash: 'synthetic-private-token',
    sponsor_feed_notes: 'synthetic-private-note',
    stripe_session_id: 'cs_synthetic_private',
    original_storage_key: 'synthetic-private-storage'
  };
  const contributionId = '11111111-1111-4111-8111-111111111111';
  const sponsorPool = queuedPool(
    [
      {
        has_fund_contributions: true,
        has_sponsor_review_status: true,
        has_sponsor_publication_columns: true,
        has_sponsor_media_assets: true
      }
    ],
    [
      {
        ...privateFields,
        contribution_id: contributionId,
        public_slug: 'synthetic-company',
        company_name: 'Synthetic company',
        website_url: null,
        logo_url: null,
        public_summary: 'Approved public summary',
        message: 'synthetic-private-message',
        amount: null,
        currency: 'cad',
        paid_at: generatedAt,
        feed_target: 'openg7',
        feed_channels: ['linkedin'],
        feed_status: 'not_planned',
        feed_public_url: 'https://example.invalid/private-draft',
        visibility_updated_at: generatedAt,
        total_count: '1',
        published_count: '0',
        last_updated_at: generatedAt
      }
    ],
    [{ exists: true }],
    [
      {
        ...privateFields,
        contribution_id: contributionId,
        id: 'synthetic-media',
        kind: 'supporting_image',
        public_url: '/api/public/sponsor-media/synthetic-media',
        width: 960,
        height: 640,
        alt_text: 'Approved image',
        sort_order: 0
      }
    ]
  );
  const builderPool = queuedPool(
    [{ has_fund_contributions: true, has_sponsor_review_status: true }],
    [
      {
        ...privateFields,
        contribution_id: contributionId,
        display_name: 'Synthetic builder',
        contribution_type: 'personal_support',
        amount: null,
        currency: 'cad',
        paid_at: generatedAt,
        total_count: '1',
        last_updated_at: generatedAt
      }
    ]
  );
  const availabilityPool = queuedPool(
    [{ has_publication_batches: true, has_publication_slots: true }],
    [
      {
        ...privateFields,
        feed_target: 'openg7',
        channel: 'linkedin',
        starts_at: generatedAt,
        timezone: 'America/Toronto',
        capacity: 50,
        draft_body: 'synthetic-private-editorial-content'
      }
    ]
  );
  const f = fixture({
    overrides: {
      listPublicSponsorships: (pagination) =>
        listPublicSponsorships(sponsorPool, pagination),
      listPublicBuilders: (pagination) =>
        listPublicBuilders(builderPool, pagination),
      getPublicSponsorshipBatchAvailability: () =>
        getPublicSponsorshipBatchAvailability(availabilityPool)
    }
  });
  for (const path of [
    'sponsorships',
    'builders',
    'sponsorship-batches/availability'
  ]) {
    const result = await f.run('/api/public/' + path);
    assert.equal(result.status, 200);
    const encoded = JSON.stringify(result.payload);
    for (const value of [
      ...Object.values(privateFields),
      contributionId,
      'synthetic-private-message',
      'https://example.invalid/private-draft',
      'synthetic-private-editorial-content'
    ])
      assert.equal(encoded.includes(value), false, path + ': ' + value);
  }
  sponsorPool.assertComplete();
  builderPool.assertComplete();
  availabilityPool.assertComplete();
});

test('unconfigured readers preserve the explicit empty public projections', async () => {
  const f = fixture({
    overrides: {
      listPublicSponsorships: (pagination) =>
        listPublicSponsorships(null, pagination),
      listPublicBuilders: (pagination) => listPublicBuilders(null, pagination),
      getPublicSponsorshipBatchAvailability: () =>
        getPublicSponsorshipBatchAvailability(null),
      getPublicTransparencySummary: () => getPublicTransparencySummary(null)
    }
  });
  for (const [path, name] of routes.filter(([, name]) => name !== 'config')) {
    const result = await f.run('/public/' + path);
    assert.equal(result.status, 200);
    assert.equal(result.payload.data_source, 'empty');
    if (name === 'sponsorships')
      assert.deepEqual(result.payload.sponsorships, []);
    if (name === 'builders') assert.deepEqual(result.payload.builders, []);
    if (name === 'availability') assert.deepEqual(result.payload.slots, []);
  }
});

test('other methods and adjacent private, media, health or unknown routes fall through untouched', async () => {
  for (const [url, method] of [
    ...routes.flatMap(([path]) =>
      ['POST', 'HEAD', 'DELETE', 'OPTIONS'].map((method) => [
        '/api/public/' + path,
        method
      ])
    ),
    ['/api/public/sponsorships/update', 'GET'],
    ['/api/public/sponsor-media/synthetic-media', 'GET'],
    ['/api/admin/fund-transparency', 'GET'],
    ['/health', 'GET'],
    ['/unknown', 'GET'],
    [undefined, 'GET']
  ]) {
    const f = fixture();
    assert.deepEqual(await f.run(url, method), { handled: false });
    assert.deepEqual(f.calls, []);
  }
});
