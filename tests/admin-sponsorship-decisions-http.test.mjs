import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminSponsorshipDecisionsHttpHandler } from '../dist/apps/funding-api/src/admin-sponsorship-decisions.http.js';
import {
  allowedSponsorFeedChannels,
  allowedSponsorFeedStatuses,
  allowedSponsorshipReviewStatuses
} from '../dist/apps/funding-api/src/fund-contributions.repository.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';
import { isSponsorshipWebsiteVisibilityRequest } from '../dist/apps/funding-api/src/sponsorship-website.service.js';
import {
  isSponsorshipEmail,
  isSponsorshipHttpsUrl
} from '../dist/packages/funding-core/src/index.js';

const contributionId = '11111111-1111-4111-8111-111111111111';
const actor = 'synthetic-decision-operator';
const expectedVersion = 'synthetic-previous-version';
const nextVersion = 'synthetic-next-version';
const recipient = 'synthetic-sponsor@example.test';
const review = { contributionId, expectedVersion, reviewStatus: 'approved' };
const rejection = {
  ...review,
  reviewStatus: 'rejected',
  reviewNote: ' Synthetic review reason ',
  notificationEmail: ` ${recipient} `,
  sponsorMessage: ' Synthetic sponsor message '
};
const visibility = {
  contributionId,
  expectedVersion,
  visible: true,
  confirmed: true
};
const publication = {
  contributionId,
  expectedVersion,
  publicSlug: ' synthetic-sponsor ',
  publicSummary: ' Synthetic public summary ',
  feedTarget: 'openg7',
  feedChannels: ['facebook', 'linkedin', 'facebook'],
  feedStatus: 'planned',
  feedPublicUrl: ' https://example.test/synthetic-publication ',
  feedNotes: ' Synthetic editorial notes '
};
const sponsor = {
  public_reference: 'SYNTHETIC-REFERENCE',
  sponsor_company_name: 'Synthetic company',
  public_name: 'Synthetic public name',
  amount: 250,
  currency: 'CAD'
};
const notification = {
  queued: true,
  attempted: false,
  sent: false,
  messageId: contributionId,
  error: null
};
const routes = [
  ['review', review],
  ['website-visibility', visibility],
  ['publication', publication]
];

const fixture = ({
  denied,
  role = 'owner',
  database = true,
  mutationStatus = 'updated',
  visibilityOutcome = 'updated',
  failing,
  sponsorRecord = sponsor,
  emailResult = notification,
  resolvedChannels = ['linkedin'],
  auditResult = true
} = {}) => {
  const calls = [];
  const failure = new Error('synthetic private persistence diagnostics');
  const record = (name, value) => {
    calls.push({ name, value });
    if (failing === name) throw failure;
  };
  const writeJson = (_request, response, status, payload) => {
    record('json', status);
    Object.assign(response, { status, payload });
  };
  const mutation = {
    updated: mutationStatus === 'updated',
    status: mutationStatus,
    currentVersion: nextVersion,
    paymentStatus: 'paid'
  };
  const handler = createAdminSponsorshipDecisionsHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    databaseAvailable: () => {
      record('database');
      return database;
    },
    ensureAdminAccess: (request, response) => {
      record('access');
      const path = new URL(request.url, 'https://funding.example.test')
        .pathname;
      const status =
        denied ?? (adminRoleAllows(role, request.method, path) ? null : 403);
      if (!status) return true;
      writeJson(request, response, status, { error: 'Access rejected.' });
      return false;
    },
    getAdminAuditActor: () => {
      record('actor');
      return actor;
    },
    readBody: async (request, limit) => {
      record('body', limit);
      return readBody(request, limit);
    },
    writeJson,
    writeSponsorshipMutationFailure: (request, response, status, details) => {
      record('mutationFailure', { status, details });
      writeJson(request, response, status === 'not_found' ? 404 : 409, {
        status,
        details
      });
    },
    adminReviewNoteMaxLength: 1000,
    sponsorMessageMaxLength: 1000,
    isValidOptionalBoundedText: (value, maxLength) =>
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length <= maxLength),
    isValidSponsorEmail: (value) => isSponsorshipEmail(value, 200),
    isValidAdminExpectedVersion: (value) =>
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.trim().length <= 128,
    isValidOptionalHttpsUrl: (value) =>
      value === undefined ||
      value === null ||
      value === '' ||
      (typeof value === 'string' &&
        value.length <= 2048 &&
        isSponsorshipHttpsUrl(value)),
    isAllowedSponsorFeedTarget: (value) =>
      value === undefined ||
      value === null ||
      value === '' ||
      ['openg7', 'openg20'].includes(value),
    allowedSponsorshipReviewStatuses,
    allowedSponsorFeedStatuses,
    allowedSponsorFeedChannels,
    isSponsorshipWebsiteVisibilityRequest,
    updateSponsorshipReview: async (input) => {
      record('review', input);
      return mutation;
    },
    updateSponsorshipRefundWorkflowStatus: async (input) => {
      record('workflow', input);
      return true;
    },
    getAdminSponsorshipById: async (id) => {
      record('sponsor', id);
      return sponsorRecord;
    },
    queueSponsorshipRejectionEmail: async (input) => {
      record('email', input);
      return emailResult;
    },
    setSponsorshipWebsiteVisibility: async (input, authenticatedActor) => {
      record('visibility', { input, actor: authenticatedActor });
      return visibilityOutcome;
    },
    updateSponsorshipPublication: async (input) => {
      record('publication', input);
      return { ...mutation, feedChannels: resolvedChannels };
    },
    insertAdminAuditLog: async (input) => {
      record('audit', input);
      return auditResult;
    },
    reportFailure: (...args) => record('report', args)
  });
  return {
    names: () => calls.map(({ name }) => name),
    values: (name) =>
      calls.filter((call) => call.name === name).map(({ value }) => value),
    async run(
      route,
      {
        prefix = '/admin/',
        method = 'POST',
        body = JSON.stringify(routes.find(([name]) => name === route)?.[1]),
        contentType = 'application/json'
      } = {}
    ) {
      const request = Object.assign(Readable.from([Buffer.from(body ?? '')]), {
        method,
        url: `${prefix}sponsorships/${route}`,
        headers: contentType ? { 'content-type': contentType } : {}
      });
      const response = {};
      return { handled: await handler(request, response), ...response };
    }
  };
};

test('all decision aliases authorize before parsing for absent, expired, forbidden and unavailable access', async (t) => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    for (const [route] of routes) {
      for (const denied of [401, 403, 503]) {
        await t.test(`${denied} ${prefix}${route}`, async () => {
          const f = fixture({ denied });
          const result = await f.run(route, {
            prefix,
            body: '{invalid',
            contentType: 'text/plain'
          });
          assert.equal(result.handled, true);
          assert.equal(result.status, denied);
          assert.deepEqual(f.names(), ['access', 'json']);
        });
      }
    }
  }
});

test('readers cannot mutate while operators and owners retain existing decision permissions', async (t) => {
  for (const role of ['reader', 'operator', 'owner']) {
    for (const prefix of ['/admin/', '/api/admin/']) {
      for (const [route] of routes) {
        await t.test(`${role} ${prefix}${route}`, async () => {
          const f = fixture({ role });
          const result = await f.run(route, { prefix });
          assert.equal(result.status, role === 'reader' ? 403 : 200);
          if (role === 'reader')
            assert.deepEqual(f.names(), ['access', 'json']);
        });
      }
    }
  }
});

test('unowned paths and non-POST methods fall through without effects, including refund', async (t) => {
  for (const [route, method] of [
    ['refund', 'POST'],
    ['details', 'POST'],
    ['review-extra', 'POST'],
    ['review', 'GET'],
    ['website-visibility', 'GET'],
    ['publication', 'PUT']
  ]) {
    await t.test(`${method} ${route}`, async () => {
      const f = fixture();
      assert.equal(
        (await f.run(route, { method, body: '{invalid' })).handled,
        false
      );
      assert.deepEqual(f.names(), []);
    });
  }
});

test('approval and pending review preserve version, trim notes and require no rejection notification', async (t) => {
  for (const reviewStatus of ['approved', 'pending_review']) {
    await t.test(reviewStatus, async () => {
      const f = fixture();
      const input = {
        ...review,
        reviewStatus,
        reviewNote: ' Synthetic note ',
        notifySponsor: true
      };
      const result = await f.run('review', {
        body: JSON.stringify(input),
        contentType: null
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, { updated: true, reviewStatus });
      assert.deepEqual(f.values('review'), [
        {
          contributionId,
          expectedVersion,
          reviewStatus,
          reviewNote: 'Synthetic note'
        }
      ]);
      assert.deepEqual(f.names(), [
        'access',
        'body',
        'review',
        'actor',
        'audit',
        'json'
      ]);
      assert.deepEqual(f.values('body'), [undefined]);
      assert.deepEqual(f.values('audit')[0].metadata, {
        reviewStatus,
        hasReviewNote: true
      });
      assert.equal(f.values('audit')[0].actor, actor);
    });
  }
});

test('rejection records manual workflow choices and a default notification tied to the returned version', async (t) => {
  for (const [refundHandling, refundWorkflowStatus] of [
    ['none', undefined],
    ['manual_required', 'requested'],
    ['manual_completed', 'completed']
  ]) {
    await t.test(refundHandling, async () => {
      const f = fixture();
      const input = {
        ...rejection,
        refundHandling,
        refundNote: ' Synthetic refund note '
      };
      const result = await f.run('review', { body: JSON.stringify(input) });
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, {
        updated: true,
        reviewStatus: 'rejected',
        refundHandling,
        ...(refundWorkflowStatus ? { refundWorkflowStatus } : {}),
        notification
      });
      assert.deepEqual(
        f.values('workflow'),
        refundWorkflowStatus
          ? [
              {
                contributionId,
                refundStatus: refundWorkflowStatus,
                refundNote: 'Synthetic refund note'
              }
            ]
          : []
      );
      assert.deepEqual(f.values('email'), [
        {
          to: recipient,
          contributionId,
          publicReference: sponsor.public_reference,
          sponsorName: sponsor.sponsor_company_name,
          amount: 250,
          currency: 'CAD',
          reviewReason: 'Synthetic review reason',
          sponsorMessage: 'Synthetic sponsor message',
          refundHandling,
          refundNote: 'Synthetic refund note',
          idempotencyKey: `sponsorship-rejection:${contributionId}:${nextVersion}`
        }
      ]);
      assert.deepEqual(f.names(), [
        'access',
        'body',
        'review',
        ...(refundWorkflowStatus ? ['workflow'] : []),
        'sponsor',
        'email',
        'actor',
        'audit',
        'json'
      ]);
      assert.deepEqual(f.values('audit')[0].metadata, {
        reviewStatus: 'rejected',
        hasReviewNote: true,
        notifySponsor: true,
        notificationEmail: recipient,
        notificationMessageId: contributionId,
        notificationSent: false,
        notificationError: null,
        refundHandling,
        refundWorkflowStatus: refundWorkflowStatus ?? null,
        hasRefundNote: true
      });
    });
  }
});

test('rejection notification can be declined or absent without inventing an email result', async (t) => {
  for (const [name, options, input] of [
    [
      'declined',
      {},
      {
        ...rejection,
        notifySponsor: false,
        notificationEmail: undefined,
        sponsorMessage: undefined
      }
    ],
    ['missing dossier', { sponsorRecord: null }, rejection]
  ]) {
    await t.test(name, async () => {
      const f = fixture(options);
      const result = await f.run('review', { body: JSON.stringify(input) });
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, {
        updated: true,
        reviewStatus: 'rejected',
        refundHandling: 'none'
      });
      assert.deepEqual(f.values('email'), []);
      assert.equal(f.values('audit')[0].metadata.notificationMessageId, null);
    });
  }
});

test('manual rejection workflows are recorded when the sponsor notification is declined', async (t) => {
  for (const [refundHandling, refundWorkflowStatus] of [
    ['manual_required', 'requested'],
    ['manual_completed', 'completed']
  ]) {
    await t.test(refundHandling, async () => {
      const f = fixture();
      const result = await f.run('review', {
        body: JSON.stringify({
          ...rejection,
          refundHandling,
          notifySponsor: false,
          notificationEmail: undefined,
          sponsorMessage: undefined
        })
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, {
        updated: true,
        reviewStatus: 'rejected',
        refundHandling,
        refundWorkflowStatus
      });
      assert.deepEqual(f.values('workflow'), [
        {
          contributionId,
          refundStatus: refundWorkflowStatus,
          refundNote: null
        }
      ]);
      assert.deepEqual(f.values('email'), []);
      assert.equal(f.values('audit')[0].metadata.notifySponsor, false);
      assert.equal(
        f.values('audit')[0].metadata.refundWorkflowStatus,
        refundWorkflowStatus
      );
    });
  }
});

test('rejection email failure results remain observable and sponsor-name fallbacks remain stable', async (t) => {
  for (const [record, name] of [
    [{ ...sponsor, sponsor_company_name: null }, sponsor.public_name],
    [
      { ...sponsor, sponsor_company_name: null, public_name: null },
      'commanditaire'
    ]
  ]) {
    await t.test(name, async () => {
      const failedEmail = {
        ...notification,
        queued: false,
        attempted: true,
        error: 'synthetic queue unavailable'
      };
      const f = fixture({ sponsorRecord: record, emailResult: failedEmail });
      const result = await f.run('review', { body: JSON.stringify(rejection) });
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload.notification, failedEmail);
      assert.equal(f.values('email')[0].sponsorName, name);
      assert.equal(
        f.values('audit')[0].metadata.notificationError,
        failedEmail.error
      );
    });
  }
});

test('review validation rejects invalid identifiers, states, notes and rejection prerequisites before mutation', async (t) => {
  for (const [name, input, message] of [
    [
      'identifier',
      { ...review, contributionId: 'invalid' },
      'Invalid contribution id.'
    ],
    [
      'state',
      { ...review, reviewStatus: 'refused' },
      'Invalid sponsorship review status.'
    ],
    [
      'note length',
      { ...review, reviewNote: 'x'.repeat(1001) },
      'Review note is too long.'
    ],
    [
      'reason',
      { ...rejection, reviewNote: '  ' },
      'A rejection reason is required.'
    ],
    [
      'message length',
      { ...rejection, sponsorMessage: 'x'.repeat(1001) },
      'Sponsor notification message is too long.'
    ],
    [
      'refund note length',
      { ...rejection, refundNote: 'x'.repeat(1001) },
      'Refund note is too long.'
    ],
    [
      'refund handling',
      { ...rejection, refundHandling: 'stripe' },
      'Invalid rejection refund handling.'
    ],
    [
      'recipient',
      { ...rejection, notificationEmail: 'invalid' },
      'A valid sponsor notification email is required.'
    ],
    [
      'sponsor message',
      { ...rejection, sponsorMessage: '' },
      'A sponsor-facing rejection message is required.'
    ],
    [
      'version',
      { ...review, expectedVersion: '' },
      'Sponsorship version is required.'
    ]
  ]) {
    await t.test(name, async () => {
      const f = fixture();
      const result = await f.run('review', { body: JSON.stringify(input) });
      assert.equal(result.status, 400);
      assert.deepEqual(result.payload, { error: message });
      assert.deepEqual(f.names(), ['access', 'body', 'json']);
    });
  }
});

test('review and publication preserve the shared mutation failure and its version/payment details', async (t) => {
  for (const route of ['review', 'publication']) {
    for (const mutationStatus of [
      'not_found',
      'conflict',
      'payment_not_eligible',
      'media_required'
    ]) {
      await t.test(`${route} ${mutationStatus}`, async () => {
        const f = fixture({ mutationStatus });
        const result = await f.run(route);
        assert.equal(result.status, mutationStatus === 'not_found' ? 404 : 409);
        assert.deepEqual(f.values('mutationFailure'), [
          {
            status: mutationStatus,
            details: { currentVersion: nextVersion, paymentStatus: 'paid' }
          }
        ]);
        assert.deepEqual(f.values('audit'), []);
        assert.deepEqual(f.values('workflow'), []);
        assert.deepEqual(f.values('email'), []);
      });
    }
  }
});

test('review persistence, workflow, dossier, notification and audit failures return one 502 without repeating effects', async (t) => {
  for (const failing of ['review', 'workflow', 'sponsor', 'email', 'audit']) {
    await t.test(failing, async () => {
      const f = fixture({ failing });
      const result = await f.run('review', {
        body: JSON.stringify({
          ...rejection,
          refundHandling: 'manual_required'
        })
      });
      assert.equal(result.status, 502);
      assert.deepEqual(result.payload, {
        error: 'Sponsorship review could not be updated.'
      });
      assert.equal(f.values('review').length, 1);
      const stages = ['review', 'workflow', 'sponsor', 'email', 'audit'];
      for (const stage of stages) {
        assert.equal(
          f.values(stage).length,
          stages.indexOf(stage) <= stages.indexOf(failing) ? 1 : 0
        );
      }
      assert.deepEqual(f.values('json'), [502]);
      assert.equal(
        f.values('report')[0][0],
        'Failed to update sponsorship review.'
      );
    });
  }
});

test('website visibility retains storage/content-type gates and confirmation validation', async (t) => {
  const f = fixture({ database: false });
  const unavailable = await f.run('website-visibility', {
    body: '{invalid',
    contentType: null
  });
  assert.equal(unavailable.handled, true);
  assert.equal(unavailable.status, undefined);
  assert.deepEqual(f.names(), ['access', 'database']);
  for (const contentType of [null, 'text/plain', 'application/jsonp']) {
    await t.test(`content type ${contentType}`, async () => {
      const f = fixture();
      const result = await f.run('website-visibility', { contentType });
      assert.equal(result.status, 415);
      assert.equal(result.payload.code, 'WEBSITE_VISIBILITY_CONTENT_TYPE');
      assert.deepEqual(f.names(), ['access', 'database', 'json']);
    });
  }
  for (const [name, input] of [
    ['unconfirmed', { ...visibility, confirmed: false }],
    ['missing version', { ...visibility, expectedVersion: '' }],
    ['unknown field', { ...visibility, extra: true }],
    ['invalid visible', { ...visibility, visible: 'true' }],
    ['invalid identifier', { ...visibility, contributionId: 'invalid' }],
    ['null', null]
  ]) {
    await t.test(name, async () => {
      const f = fixture();
      const result = await f.run('website-visibility', {
        body: JSON.stringify(input)
      });
      assert.equal(result.status, 400);
      assert.equal(result.payload.code, 'WEBSITE_VISIBILITY_INVALID');
      assert.deepEqual(f.names(), ['access', 'database', 'body', 'json']);
    });
  }
});

test('website decisions pass exact version/visibility/actor and preserve every service outcome', async (t) => {
  for (const visible of [true, false]) {
    for (const [visibilityOutcome, status] of [
      ['updated', 200],
      ['unchanged', 200],
      ['not_found', 404],
      ['conflict', 409],
      ['blocked', 409]
    ]) {
      await t.test(`${visible} ${visibilityOutcome}`, async () => {
        const f = fixture({ visibilityOutcome });
        const input = { ...visibility, visible };
        const result = await f.run('website-visibility', {
          body: JSON.stringify(input),
          contentType: 'APPLICATION/JSON; charset=utf-8'
        });
        assert.equal(result.status, status);
        assert.deepEqual(result.payload, {
          outcome: visibilityOutcome,
          code: `WEBSITE_VISIBILITY_${visibilityOutcome.toUpperCase()}`
        });
        assert.deepEqual(f.values('visibility'), [{ input, actor }]);
        assert.deepEqual(f.values('audit'), []);
      });
    }
  }
  const f = fixture({ failing: 'visibility' });
  const result = await f.run('website-visibility');
  assert.equal(result.status, 503);
  assert.deepEqual(result.payload, {
    error: 'Website visibility could not be updated.',
    code: 'WEBSITE_VISIBILITY_UNAVAILABLE'
  });
  assert.deepEqual(f.values('json'), [503]);
  assert.equal(f.values('visibility').length, 1);
  assert.deepEqual(f.values('report'), []);
});

test('publication metadata normalizes optional text and distinct channels, then audits authoritative channels', async () => {
  const f = fixture();
  const result = await f.run('publication', { contentType: 'text/plain' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload, { updated: true, feedStatus: 'planned' });
  assert.deepEqual(f.values('publication'), [
    {
      contributionId,
      expectedVersion,
      publicSlug: 'synthetic-sponsor',
      publicSummary: 'Synthetic public summary',
      feedTarget: 'openg7',
      feedChannels: ['facebook', 'linkedin'],
      feedStatus: 'planned',
      feedPublicUrl: 'https://example.test/synthetic-publication',
      feedNotes: 'Synthetic editorial notes'
    }
  ]);
  assert.deepEqual(f.names(), [
    'access',
    'body',
    'publication',
    'actor',
    'audit',
    'json'
  ]);
  assert.deepEqual(f.values('audit')[0].metadata, {
    feedTarget: 'openg7',
    feedChannels: ['linkedin'],
    feedStatus: 'planned',
    hasPublicUrl: true
  });
  assert.equal(f.values('audit')[0].action, 'sponsorship_publication.update');
  assert.equal(f.values('audit')[0].actor, actor);
});

test('publication empty optional fields and channels retain existing clearing semantics', async (t) => {
  for (const feedStatus of allowedSponsorFeedStatuses) {
    await t.test(feedStatus, async () => {
      const f = fixture();
      const input = {
        ...publication,
        feedStatus,
        publicSlug: '',
        publicSummary: null,
        feedTarget: null,
        feedChannels: [],
        feedPublicUrl: null,
        feedNotes: ''
      };
      const result = await f.run('publication', {
        body: JSON.stringify(input)
      });
      assert.equal(result.status, 200);
      assert.deepEqual(f.values('publication'), [
        {
          contributionId,
          expectedVersion,
          feedStatus,
          publicSlug: undefined,
          publicSummary: undefined,
          feedTarget: null,
          feedChannels: [],
          feedPublicUrl: undefined,
          feedNotes: undefined
        }
      ]);
      assert.equal(f.values('audit')[0].metadata.hasPublicUrl, false);
    });
  }
});

test('publication validation rejects slug, summary, destination, channels, status, URL, notes and version before updates', async (t) => {
  for (const [name, change, message] of [
    ['identifier', { contributionId: 'invalid' }, 'Invalid contribution id.'],
    [
      'slug syntax',
      { publicSlug: 'Invalid_Slug' },
      'Public slug must use lowercase letters, numbers, and hyphens.'
    ],
    [
      'slug length',
      { publicSlug: 'x'.repeat(121) },
      'Public slug must use lowercase letters, numbers, and hyphens.'
    ],
    [
      'summary',
      { publicSummary: 'x'.repeat(501) },
      'Public summary is too long.'
    ],
    [
      'destination',
      { feedTarget: 'other' },
      'Invalid sponsorship feed target.'
    ],
    [
      'channels absent',
      { feedChannels: null },
      'Invalid sponsorship feed channels.'
    ],
    [
      'channels invalid',
      { feedChannels: ['instagram'] },
      'Invalid sponsorship feed channels.'
    ],
    ['state', { feedStatus: 'hidden' }, 'Invalid sponsorship feed status.'],
    [
      'URL',
      { feedPublicUrl: 'http://example.test' },
      'Feed public URL must be a valid https link.'
    ],
    ['notes', { feedNotes: 'x'.repeat(1001) }, 'Feed notes are too long.'],
    ['version', { expectedVersion: '' }, 'Sponsorship version is required.']
  ]) {
    await t.test(name, async () => {
      const f = fixture();
      const result = await f.run('publication', {
        body: JSON.stringify({ ...publication, ...change })
      });
      assert.equal(result.status, 400);
      assert.deepEqual(result.payload, { error: message });
      assert.deepEqual(f.names(), ['access', 'body', 'json']);
    });
  }
});

test('publication update and audit exceptions do not return success or repeat updates', async (t) => {
  for (const failing of ['publication', 'audit']) {
    await t.test(failing, async () => {
      const f = fixture({ failing });
      const result = await f.run('publication');
      assert.equal(result.status, 502);
      assert.deepEqual(result.payload, {
        error: 'Sponsorship publication could not be updated.'
      });
      assert.equal(f.values('publication').length, 1);
      assert.deepEqual(f.values('json'), [502]);
      assert.equal(
        f.values('report')[0][0],
        'Failed to update sponsorship publication.'
      );
    });
  }
});

test('malformed JSON and transport read failures remain safe request errors', async (t) => {
  for (const [route] of routes) {
    for (const [name, options, body] of [
      ['malformed', {}, '{invalid'],
      ['null', {}, 'null'],
      ['array', {}, '[]'],
      ['boolean', {}, 'true'],
      ['number', {}, '42'],
      ['string', {}, '"synthetic-request"'],
      ['read failure', { failing: 'body' }, '{}']
    ]) {
      await t.test(`${route} ${name}`, async () => {
        const f = fixture(options);
        const result = await f.run(route, { body });
        assert.equal(result.status, 400);
        assert.deepEqual(f.values('json'), [400]);
        assert.deepEqual(f.names(), [
          'access',
          ...(route === 'website-visibility' ? ['database'] : []),
          'body',
          'json'
        ]);
      });
    }
  }
});

test('null review/publication bodies return safe validation errors before any mutation', async () => {
  for (const route of ['review', 'publication']) {
    const f = fixture();
    assert.equal((await f.run(route, { body: 'null' })).status, 400);
    assert.deepEqual(f.names(), ['access', 'body', 'json']);
  }
});
