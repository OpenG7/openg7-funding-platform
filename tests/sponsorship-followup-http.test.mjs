import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createSponsorshipFollowupHttpHandler } from '../dist/apps/funding-api/src/sponsorship-followup.http.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';
import {
  normalizeRecoveryEmail,
  SponsorshipAccessError
} from '../dist/apps/funding-api/src/sponsorship-access.service.js';
import {
  isSponsorshipEmail,
  isSponsorshipHttpsUrl
} from '../dist/packages/funding-core/src/index.js';

const origin = 'https://funding.example.test';
const token = 'synthetic_followup_token_1234567890abcd';
const ttlDays = 45;
const draftRevision = 17;
const id = '11111111-1111-4111-8111-111111111111';
const details = {
  token,
  draftRevision,
  companyName: ' Synthetic company ',
  contactName: ' Synthetic contact ',
  contactEmail: ' synthetic@example.test ',
  websiteUrl: ' https://example.test/website ',
  logoUrl: ' https://example.test/logo.png ',
  message: ' Synthetic sponsor message '
};
const normalizedDetails = {
  companyName: 'Synthetic company',
  contactName: 'Synthetic contact',
  contactEmail: 'synthetic@example.test',
  websiteUrl: 'https://example.test/website',
  logoUrl: 'https://example.test/logo.png',
  message: 'Synthetic sponsor message'
};
const lookup = {
  contributionId: id,
  stripeSessionId: 'cs_synthetic_internal',
  stripePaymentIntentId: 'pi_synthetic_internal',
  paymentStatus: 'paid',
  publicReference: 'SYNTHETIC-REFERENCE',
  reviewStatus: 'pending_review',
  amount: 250,
  currency: 'CAD',
  paidAt: '2026-10-03T12:00:00Z',
  sponsorshipTier: 'synthetic-tier',
  sponsorshipBenefits: { syntheticBenefit: true },
  detailsSubmitted: false,
  companyName: 'Synthetic saved company',
  contactName: 'Synthetic saved contact',
  contactEmail: 'synthetic-saved@example.test',
  websiteUrl: 'https://example.test/saved',
  logoUrl: null,
  message: 'Synthetic saved message',
  reviewedAt: null,
  tokenHash: 'synthetic-private-token-hash',
  extraPrivateField: 'synthetic-private-extra'
};
const draft = {
  revision: draftRevision,
  data: normalizedDetails,
  updatedAt: '2026-10-03T12:00:00Z'
};

const fixture = ({
  database = true,
  hasDatabase = true,
  stripeEnabled = true,
  fresh = lookup,
  failures = {},
  saveResult = draft,
  recorded = true
} = {}) => {
  const calls = [];
  const record = (name, value) => {
    calls.push({ name, value });
    if (failures[name]) throw failures[name];
  };
  const handler = createSponsorshipFollowupHttpHandler({
    publicBaseOrigin: origin,
    databaseAvailable: () => {
      record('database');
      return database;
    },
    hasDatabase,
    sponsorshipFollowupTokenTtlDays: ttlDays,
    SPONSOR_TEXT_MAX_LENGTH: 200,
    SPONSOR_MESSAGE_MAX_LENGTH: 1000,
    followupEditablePaymentStatuses: new Set(['paid', 'refunded', 'disputed']),
    readBody: async (request, limit) => {
      record('body', limit);
      return readBody(request, limit);
    },
    writeJson: (_request, response, status, payload) => {
      record('json', status);
      Object.assign(response, { status, payload });
    },
    isValidFollowupToken: (value) =>
      typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value),
    hasOnlyKeys: (value, keys) =>
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).every((key) => keys.includes(key)),
    isNonEmptySponsorText: (value, limit) =>
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.trim().length <= limit,
    isValidSponsorEmail: (value) => isSponsorshipEmail(value, 200),
    isValidOptionalHttpsUrl: (value) =>
      value === undefined ||
      value === null ||
      value === '' ||
      (typeof value === 'string' &&
        value.length <= 2048 &&
        isSponsorshipHttpsUrl(value)),
    truncateStripeMetadataValue: (value) => {
      record('truncate', value);
      return value.slice(0, 480);
    },
    normalizeRecoveryEmail,
    SponsorshipAccessError,
    getFreshSponsorshipFollowupByToken: async (input) => {
      record('fresh', input);
      return fresh;
    },
    recoverSponsorshipAccess: async (email, options) =>
      record('recover', { email, options }),
    getSponsorshipDraft: async (input, ttl) => {
      record('getDraft', { token: input, ttlDays: ttl });
      return draft;
    },
    saveSponsorshipDraft: async (input, ttl, revision, data) => {
      record('saveDraft', { token: input, ttlDays: ttl, revision, data });
      return saveResult;
    },
    submitSponsorshipDraft: async (input, ttl, revision, data) => {
      record('submit', { token: input, ttlDays: ttl, revision, data });
      return recorded;
    },
    updateStripePaymentIntentMetadata: stripeEnabled
      ? async (paymentIntentId, input) =>
          record('stripe', { paymentIntentId, input })
      : undefined,
    reportFailure: (...args) => record('report', args)
  });
  return {
    names: () => calls.map(({ name }) => name),
    values: (name) =>
      calls.filter((call) => call.name === name).map(({ value }) => value),
    async run(url, { method = 'GET', body = '' } = {}) {
      const request = Object.assign(Readable.from([Buffer.from(body)]), {
        method,
        url,
        headers: {}
      });
      const response = {};
      return { handled: await handler(request, response), ...response };
    }
  };
};

const aliases = ['/sponsorship-followup', '/api/sponsorship-followup'];
const postDetails = (f, body = details, prefix = aliases[0]) =>
  f.run(`${prefix}/details`, { method: 'POST', body: JSON.stringify(body) });

test('admin access, legacy details, media and non-owned methods fall through without effects', async (t) => {
  for (const [url, method] of [
    ['/admin/sponsorships/followup-access', 'GET'],
    ['/api/admin/sponsorships/followup-access', 'POST'],
    ['/sponsorship-details', 'POST'],
    ['/api/sponsorship-details', 'POST'],
    ['/sponsorship-followup/media', 'GET'],
    ['/api/sponsorship-followup/media', 'POST'],
    ['/sponsorship-followup', 'POST'],
    ['/sponsorship-followup/recover', 'GET'],
    ['/sponsorship-followup/details', 'GET'],
    ['/sponsorship-followup/draft', 'DELETE'],
    ['/sponsorship-followup/other', 'GET']
  ]) {
    await t.test(`${method} ${url}`, async () => {
      const f = fixture();
      assert.equal(
        (await f.run(url, { method, body: '{invalid' })).handled,
        false
      );
      assert.deepEqual(f.names(), []);
    });
  }
});

test('recovery and draft gate the database pool before reading bodies or tokens', async (t) => {
  for (const prefix of aliases) {
    for (const [suffix, method, message] of [
      ['/recover', 'POST', 'Recovery is unavailable.'],
      ['/draft', 'GET', 'Draft storage is unavailable.'],
      ['/draft', 'POST', 'Draft storage is unavailable.']
    ]) {
      await t.test(`${method} ${prefix}${suffix}`, async () => {
        const f = fixture({ database: false });
        const result = await f.run(`${prefix}${suffix}?token=invalid`, {
          method,
          body: '{invalid'
        });
        assert.equal(result.handled, true);
        assert.equal(result.status, 503);
        assert.deepEqual(result.payload, { error: message });
        assert.deepEqual(f.names(), ['database', 'json']);
      });
    }
  }
});

test('follow-up lookup and submission retain the configured database gate independently from pool availability', async (t) => {
  for (const prefix of aliases) {
    for (const [suffix, method] of [
      ['', 'GET'],
      ['/details', 'POST']
    ]) {
      await t.test(`${method} ${prefix}${suffix}`, async () => {
        const f = fixture({ hasDatabase: false });
        const result = await f.run(`${prefix}${suffix}?token=invalid`, {
          method,
          body: '{invalid'
        });
        assert.equal(result.status, 503);
        assert.deepEqual(result.payload, {
          error: 'Sponsorship follow-up requires DATABASE_URL.'
        });
        assert.deepEqual(f.names(), ['json']);
      });
    }
  }
  const f = fixture({ database: false, hasDatabase: true });
  assert.equal((await f.run(`${aliases[0]}?token=${token}`)).status, 200);
  assert.deepEqual(f.values('database'), []);
});

test('recovery normalizes email and locale and preserves a non-enumerating 202 through both aliases', async (t) => {
  for (const prefix of aliases) {
    for (const [locale, expectedLocale] of [
      [undefined, 'fr-CA'],
      ['fr-CA', 'fr-CA'],
      ['en', 'en']
    ]) {
      await t.test(`${prefix} ${locale}`, async () => {
        const f = fixture();
        const result = await f.run(`${prefix}/recover`, {
          method: 'POST',
          body: JSON.stringify({ email: ' SYNTHETIC@Example.Test ', locale })
        });
        assert.equal(result.status, 202);
        assert.deepEqual(result.payload, { accepted: true });
        assert.deepEqual(f.values('body'), [8 * 1024]);
        assert.deepEqual(f.values('recover'), [
          {
            email: 'synthetic@example.test',
            options: { baseUrl: origin, ttlDays, locale: expectedLocale }
          }
        ]);
        assert.deepEqual(f.names(), ['database', 'body', 'recover', 'json']);
      });
    }
  }
  for (const error of [
    new Error('synthetic private queue diagnostics'),
    new SponsorshipAccessError(503)
  ]) {
    const f = fixture({ failures: { recover: error } });
    const result = await f.run(`${aliases[0]}/recover`, {
      method: 'POST',
      body: JSON.stringify({ email: 'synthetic@example.test' })
    });
    assert.equal(result.status, 202);
    assert.deepEqual(result.payload, { accepted: true });
    assert.equal(f.values('recover').length, 1);
    assert.deepEqual(f.values('report'), [
      ['Sponsorship access recovery could not be queued.']
    ]);
  }
});

test('recovery rejects malformed, oversized and unapproved fields before access or email services', async (t) => {
  for (const body of [
    '{invalid',
    'null',
    '[]',
    ' '.repeat(8 * 1024 + 1),
    JSON.stringify({ email: 'invalid' }),
    JSON.stringify({ email: 'synthetic@example.test', locale: 'other' }),
    JSON.stringify({ email: 'synthetic@example.test', contributionId: id })
  ]) {
    await t.test(body.slice(0, 80), async () => {
      const f = fixture();
      const result = await f.run(`${aliases[0]}/recover`, {
        method: 'POST',
        body
      });
      assert.equal(result.status, 400);
      assert.deepEqual(result.payload, { error: 'A valid email is required.' });
      assert.deepEqual(f.names(), ['database', 'body', 'json']);
    });
  }
});

test('private drafts preserve token, TTL, revision and values for reads, saves and discards', async (t) => {
  for (const prefix of aliases) {
    const read = fixture();
    const readResult = await read.run(`${prefix}/draft?token=${token}`);
    assert.equal(readResult.status, 200);
    assert.deepEqual(readResult.payload, draft);
    assert.deepEqual(read.values('getDraft'), [{ token, ttlDays }]);
    assert.deepEqual(read.names(), ['database', 'getDraft', 'json']);
    for (const data of [normalizedDetails, null]) {
      await t.test(
        `${prefix} ${data === null ? 'discard' : 'save'}`,
        async () => {
          const f = fixture();
          const result = await f.run(`${prefix}/draft`, {
            method: 'POST',
            body: JSON.stringify({
              token,
              expectedRevision: draftRevision,
              data
            })
          });
          assert.equal(result.status, 200);
          assert.deepEqual(result.payload, draft);
          assert.deepEqual(f.values('body'), [16 * 1024]);
          assert.deepEqual(f.values('saveDraft'), [
            { token, ttlDays, revision: draftRevision, data }
          ]);
          assert.deepEqual(f.values('fresh'), []);
          assert.deepEqual(f.values('stripe'), []);
        }
      );
    }
  }
});

test('draft access and whitelist failures are distinct from malformed JSON and service unavailability', async (t) => {
  for (const [name, method, suffix, body, status, code] of [
    ['missing GET token', 'GET', '', '', 404, 'access'],
    ['invalid GET token', 'GET', '?token=invalid', '', 404, 'access'],
    [
      'invalid POST token',
      'POST',
      '',
      JSON.stringify({ token: 'invalid' }),
      404,
      'access'
    ],
    [
      'extra POST field',
      'POST',
      '',
      JSON.stringify({ token, expectedRevision: 0, data: null, public: true }),
      400,
      'validation'
    ],
    ['null POST input', 'POST', '', 'null', 400, 'validation'],
    ['malformed JSON', 'POST', '', '{invalid', 400, 'unavailable'],
    [
      'oversized body',
      'POST',
      '',
      ' '.repeat(16 * 1024 + 1),
      503,
      'unavailable'
    ]
  ]) {
    await t.test(name, async () => {
      const f = fixture();
      const result = await f.run(`${aliases[0]}/draft${suffix}`, {
        method,
        body
      });
      assert.equal(result.status, status);
      assert.deepEqual(result.payload, {
        error: 'Draft operation failed.',
        code
      });
      assert.deepEqual(f.values('getDraft'), []);
      assert.deepEqual(f.values('saveDraft'), []);
    });
  }
  for (const [port, method] of [
    ['getDraft', 'GET'],
    ['saveDraft', 'POST']
  ]) {
    for (const [status, code, error] of [
      [404, 'access', new SponsorshipAccessError(404, 'access')],
      [
        409,
        'draft_conflict',
        new SponsorshipAccessError(409, 'draft_conflict')
      ],
      [400, 'validation', new SponsorshipAccessError(400, 'validation')],
      [503, 'unavailable', new Error('synthetic private diagnostics')]
    ]) {
      await t.test(`${port} ${status} ${code}`, async () => {
        const f = fixture({ failures: { [port]: error } });
        const result = await f.run(`${aliases[0]}/draft?token=${token}`, {
          method,
          body: JSON.stringify({
            token,
            expectedRevision: draftRevision,
            data: normalizedDetails
          })
        });
        assert.equal(result.status, status);
        assert.deepEqual(result.payload, {
          error: 'Draft operation failed.',
          code
        });
        assert.equal(f.values(port).length, 1);
        assert.deepEqual(f.values('json'), [status]);
        assert.deepEqual(f.values('report'), []);
      });
    }
  }
});

test('GET follow-up requires a valid token and projects only the permitted DTO from the fresh lookup', async (t) => {
  for (const prefix of aliases) {
    await t.test(prefix, async () => {
      const f = fixture();
      const result = await f.run(`${prefix}?token=${token}`);
      assert.equal(result.handled, true);
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, {
        found: true,
        paymentStatus: lookup.paymentStatus,
        publicReference: lookup.publicReference,
        reviewStatus: lookup.reviewStatus,
        amount: lookup.amount,
        currency: lookup.currency,
        paidAt: lookup.paidAt,
        sponsorshipTier: lookup.sponsorshipTier,
        sponsorshipBenefits: lookup.sponsorshipBenefits,
        detailsSubmitted: lookup.detailsSubmitted,
        companyName: lookup.companyName,
        contactName: lookup.contactName,
        contactEmail: lookup.contactEmail,
        websiteUrl: lookup.websiteUrl,
        logoUrl: lookup.logoUrl,
        message: lookup.message,
        reviewedAt: lookup.reviewedAt
      });
      for (const key of [
        'contributionId',
        'stripeSessionId',
        'stripePaymentIntentId',
        'tokenHash',
        'extraPrivateField'
      ])
        assert.equal(Object.hasOwn(result.payload, key), false);
      assert.deepEqual(f.values('fresh'), [token]);
      assert.deepEqual(f.names(), ['fresh', 'json']);
    });
  }
});

test('GET follow-up distinguishes invalid, missing and unavailable access without leaking diagnostics', async (t) => {
  for (const [name, options, suffix, status, message] of [
    ['missing token', {}, '', 400, 'Invalid sponsorship follow-up token.'],
    [
      'invalid token',
      {},
      '?token=invalid',
      400,
      'Invalid sponsorship follow-up token.'
    ],
    [
      'absent lookup',
      { fresh: null },
      `?token=${token}`,
      404,
      'Sponsorship follow-up was not found.'
    ],
    [
      'lookup unavailable',
      {
        failures: { fresh: new Error('synthetic private lookup diagnostics') }
      },
      `?token=${token}`,
      502,
      'Sponsorship follow-up could not be loaded.'
    ]
  ]) {
    await t.test(name, async () => {
      const f = fixture(options);
      const result = await f.run(`${aliases[0]}${suffix}`);
      assert.equal(result.status, status);
      assert.deepEqual(result.payload, { error: message });
      if (status === 400) assert.deepEqual(f.values('fresh'), []);
      assert.deepEqual(f.values('submit'), []);
    });
  }
});

test('details submission preserves normalized data and draft revision before best-effort Stripe metadata', async (t) => {
  for (const prefix of aliases) {
    await t.test(prefix, async () => {
      const f = fixture();
      const result = await postDetails(f, details, prefix);
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, { received: true, recorded: true });
      assert.deepEqual(f.values('body'), [16 * 1024]);
      assert.deepEqual(f.values('fresh'), [token]);
      assert.deepEqual(f.values('submit'), [
        { token, ttlDays, revision: draftRevision, data: normalizedDetails }
      ]);
      assert.deepEqual(f.values('stripe'), [
        {
          paymentIntentId: lookup.stripePaymentIntentId,
          input: {
            metadata: {
              sponsorCompanyName: normalizedDetails.companyName,
              sponsorContactName: normalizedDetails.contactName,
              sponsorContactEmail: normalizedDetails.contactEmail,
              sponsorWebsiteUrl: normalizedDetails.websiteUrl,
              sponsorLogoUrl: normalizedDetails.logoUrl,
              sponsorMessage: normalizedDetails.message
            }
          }
        }
      ]);
      assert.ok(f.names().indexOf('submit') < f.names().indexOf('stripe'));
      assert.deepEqual(f.values('json'), [200]);
    });
  }
});

test('details optional values clear to empty draft fields while omitted Stripe metadata stays omitted', async () => {
  const f = fixture();
  const result = await postDetails(f, {
    ...details,
    draftRevision: undefined,
    websiteUrl: '',
    logoUrl: '',
    message: ''
  });
  assert.equal(result.status, 200);
  assert.deepEqual(f.values('submit'), [
    {
      token,
      ttlDays,
      revision: undefined,
      data: { ...normalizedDetails, websiteUrl: '', logoUrl: '', message: '' }
    }
  ]);
  assert.deepEqual(f.values('stripe')[0].input.metadata, {
    sponsorCompanyName: normalizedDetails.companyName,
    sponsorContactName: normalizedDetails.contactName,
    sponsorContactEmail: normalizedDetails.contactEmail
  });
});

test('details submission accepts only known fields, a valid token and validated sponsor text before lookup', async (t) => {
  for (const [name, input, message] of [
    ['null', null, 'Invalid sponsorship follow-up token.'],
    [
      'unknown field',
      { ...details, publicDisplayConsent: true },
      'Invalid sponsorship follow-up token.'
    ],
    [
      'invalid token',
      { ...details, token: 'invalid' },
      'Invalid sponsorship follow-up token.'
    ],
    [
      'company missing',
      { ...details, companyName: '' },
      'Company name is required.'
    ],
    [
      'company controls',
      { ...details, companyName: 'unsafe\0company' },
      'Company name is required.'
    ],
    [
      'company length',
      { ...details, companyName: 'x'.repeat(201) },
      'Company name is required.'
    ],
    [
      'contact missing',
      { ...details, contactName: '' },
      'Contact name is required.'
    ],
    [
      'contact length',
      { ...details, contactName: 'x'.repeat(201) },
      'Contact name is required.'
    ],
    [
      'contact email',
      { ...details, contactEmail: 'invalid' },
      'A valid contact email is required.'
    ],
    [
      'website URL',
      { ...details, websiteUrl: 'http://example.test' },
      'Website URL must be a valid https link.'
    ],
    [
      'logo URL',
      { ...details, logoUrl: 'https://user:password@example.test/logo.png' },
      'Logo URL must be a valid https link.'
    ],
    [
      'message length',
      { ...details, message: 'x'.repeat(1001) },
      'Message is too long.'
    ],
    [
      'message controls',
      { ...details, message: 'unsafe\0message' },
      'Message is too long.'
    ]
  ]) {
    await t.test(name, async () => {
      const f = fixture();
      const result = await postDetails(f, input);
      assert.equal(result.status, 400);
      assert.deepEqual(result.payload, { error: message });
      assert.deepEqual(f.names(), ['body', 'json']);
    });
  }
  for (const body of ['{invalid', ' '.repeat(16 * 1024 + 1)]) {
    const f = fixture();
    const result = await f.run(`${aliases[0]}/details`, {
      method: 'POST',
      body
    });
    assert.equal(result.status, 400);
    assert.deepEqual(result.payload, {
      error: 'Invalid sponsorship follow-up request body.'
    });
  }
});

test('fresh payment state controls submission without changing the editable-status policy', async (t) => {
  for (const paymentStatus of [
    'pending',
    'failed',
    'expired',
    'paid',
    'refunded',
    'disputed'
  ]) {
    await t.test(paymentStatus, async () => {
      const f = fixture({ fresh: { ...lookup, paymentStatus } });
      const result = await postDetails(f);
      const editable = ['paid', 'refunded', 'disputed'].includes(paymentStatus);
      assert.equal(result.status, editable ? 200 : 409);
      assert.equal(f.values('submit').length, editable ? 1 : 0);
      if (!editable) {
        assert.deepEqual(result.payload, {
          error: 'Payment for this sponsorship is not confirmed yet.'
        });
        assert.deepEqual(f.values('stripe'), []);
      }
      assert.deepEqual(f.values('fresh'), [token]);
    });
  }
  const f = fixture({ fresh: null });
  const result = await postDetails(f);
  assert.equal(result.status, 404);
  assert.deepEqual(result.payload, {
    error: 'Sponsorship follow-up was not found.'
  });
  assert.deepEqual(f.values('submit'), []);
  assert.deepEqual(f.values('stripe'), []);
});

test('draft submission service errors preserve status/code and stop Stripe writes without automatic retry', async (t) => {
  for (const [error, status, code] of [
    [new SponsorshipAccessError(409, 'draft_conflict'), 409, 'draft_conflict'],
    [new SponsorshipAccessError(409, 'not_editable'), 409, 'not_editable'],
    [new SponsorshipAccessError(404, 'access'), 404, 'access'],
    [new SponsorshipAccessError(503), 503, 'unavailable'],
    [new Error('synthetic private submission diagnostics'), 502, 'unavailable']
  ]) {
    await t.test(`${status} ${code}`, async () => {
      const f = fixture({ failures: { submit: error } });
      const result = await postDetails(f);
      assert.equal(result.status, status);
      assert.deepEqual(result.payload, {
        error: 'Sponsorship follow-up details could not be recorded.',
        code
      });
      assert.equal(f.values('submit').length, 1);
      assert.deepEqual(f.values('stripe'), []);
      assert.deepEqual(f.values('report'), [
        ['Failed to record sponsorship follow-up details.']
      ]);
      assert.deepEqual(f.values('json'), [status]);
    });
  }
  const f = fixture({
    failures: { fresh: new Error('synthetic private lookup failure') }
  });
  assert.equal((await postDetails(f)).status, 502);
  assert.deepEqual(f.values('submit'), []);
  assert.deepEqual(f.values('stripe'), []);
});

test('Stripe metadata is optional, bounded and best effort after local submission', async (t) => {
  for (const [name, options] of [
    ['Stripe absent', { stripeEnabled: false }],
    [
      'PaymentIntent absent',
      { fresh: { ...lookup, stripePaymentIntentId: null } }
    ]
  ]) {
    await t.test(name, async () => {
      const f = fixture(options);
      const result = await postDetails(f);
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, { received: true, recorded: true });
      assert.equal(f.values('submit').length, 1);
      assert.deepEqual(f.values('stripe'), []);
      assert.deepEqual(f.values('truncate'), []);
    });
  }
  const error = new Error('synthetic Stripe metadata diagnostics');
  const f = fixture({ failures: { stripe: error } });
  const result = await postDetails(f, { ...details, message: 'm'.repeat(900) });
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload, { received: true, recorded: true });
  assert.equal(f.values('submit').length, 1);
  assert.equal(f.values('stripe').length, 1);
  assert.equal(f.values('stripe')[0].input.metadata.sponsorMessage.length, 480);
  assert.deepEqual(f.values('report'), [
    ['Failed to update Stripe metadata with follow-up details.', error]
  ]);
  assert.deepEqual(f.values('json'), [200]);
  const unrecorded = fixture({ recorded: false });
  assert.deepEqual((await postDetails(unrecorded)).payload, {
    received: true,
    recorded: false
  });
});
