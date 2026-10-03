import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminSponsorshipRecordsHttpHandler } from '../dist/apps/funding-api/src/admin-sponsorship-records.http.js';
import {
  parseAdminSponsorshipDetails,
  SponsorshipDetailsError
} from '../dist/apps/funding-api/src/admin-sponsorship-details.service.js';
import { InformationRequestError } from '../dist/apps/funding-api/src/sponsorship-information.service.js';
import {
  parseSponsorshipIntervention,
  SponsorshipInterventionError
} from '../dist/apps/funding-api/src/sponsorship-interventions.service.js';
import {
  allowedSponsorshipReviewStatuses,
  allowedSponsorFeedStatuses
} from '../dist/apps/funding-api/src/fund-contributions.repository.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const id = '11111111-1111-4111-8111-111111111111';
const actor = 'synthetic-record-operator';
const information = {
  contributionId: id,
  contextVersion: 'a'.repeat(64),
  recipient: 'synthetic@example.test',
  subject: 'Synthetic information request',
  body: 'Please complete the synthetic dossier.',
  confirmed: true
};
const details = {
  contributionId: id,
  requestId: id,
  expectedVersion: 'synthetic-version',
  confirmed: true,
  reason: 'contact_update',
  companyName: 'Synthetic company',
  publicName: 'Synthetic public name',
  contactName: 'Synthetic contact',
  contactEmail: 'synthetic@example.test',
  websiteUrl: 'https://example.test'
};
const intervention = {
  contributionId: id,
  requestId: id,
  kind: 'internal',
  note: 'Synthetic internal note',
  nextReviewOn: null
};
const routes = [
  ['/sponsorships', 'GET', '', 'list', 'access'],
  ['/sponsorships/progress', 'GET', '', 'progress', 'authorization'],
  [
    '/sponsorships/details',
    'POST',
    JSON.stringify(details),
    'details',
    'access'
  ],
  ['/sponsorships/interventions', 'GET', '', 'interventions', 'access'],
  [
    '/sponsorships/interventions',
    'POST',
    JSON.stringify(intervention),
    'record',
    'access'
  ],
  [
    '/sponsorships/request-information',
    'POST',
    JSON.stringify(information),
    'information',
    'access'
  ]
];

const fixture = ({
  denied,
  accessDenied,
  role = 'owner',
  failing,
  informationStatus = 'queued'
} = {}) => {
  const calls = [];
  const failure = new Error('synthetic private persistence diagnostics');
  const results = {
    list: {
      items: [{ contribution_id: id }],
      pagination: { page: 1, pageSize: 6 },
      lastUpdatedAt: '2026-10-03T00:00:00Z'
    },
    progress: { status: 'unavailable', progress: null },
    details: { updated: true, version: 'synthetic-next-version' },
    interventions: { items: [] },
    record: { id, ...intervention },
    information: { status: informationStatus, messageId: id }
  };
  const writeJson = (_request, response, status, payload, headers = {}) => {
    Object.assign(response, { status, payload });
    Object.assign(response.headers, headers);
    calls.push({ name: 'respond' });
  };
  const authorize = (name) => (request, response) => {
    calls.push({ name });
    const status =
      denied ??
      (name === 'access' ? accessDenied : undefined) ??
      (adminRoleAllows(
        role,
        request.method,
        new URL(request.url, 'http://localhost').pathname
      )
        ? undefined
        : 403);
    if (!status) return true;
    writeJson(request, response, status, { error: 'Access rejected.' });
    return false;
  };
  const port =
    (name, validate) =>
    async (...args) => {
      calls.push({ name, args });
      if (failing === name) throw failure;
      if (failing && typeof failing === 'object' && failing.name === name)
        throw failing.error;
      if (validate) validate(args[0]);
      return results[name];
    };
  const handler = createAdminSponsorshipRecordsHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    ensureAdminAuthorization: authorize('authorization'),
    ensureAdminAccess: authorize('access'),
    getAdminAuditActor: () => actor,
    readBody: async (request, maxBytes) => {
      calls.push({ name: 'body', maxBytes });
      return readBody(request, maxBytes);
    },
    writeJson,
    isValidUuid: (value) =>
      typeof value === 'string' &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value),
    allowedSponsorshipReviewStatuses,
    allowedSponsorFeedStatuses,
    listAdminSponsorships: port('list'),
    getSponsorshipProgress: port('progress'),
    requestSponsorshipInformation: port('information'),
    updateAdminSponsorshipDetails: port(
      'details',
      parseAdminSponsorshipDetails
    ),
    getSponsorshipInterventions: port('interventions'),
    recordSponsorshipIntervention: port('record', parseSponsorshipIntervention),
    reportFailure: (message, error) =>
      calls.push({ name: 'report', message, error })
  });
  return {
    calls,
    results,
    async run(
      url,
      {
        method = 'GET',
        body = '',
        contentType = 'application/json; charset=utf-8'
      } = {}
    ) {
      const request = Object.assign(Readable.from([Buffer.from(body)]), {
        method,
        url,
        headers: contentType ? { 'content-type': contentType } : {}
      });
      const response = {
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        }
      };
      return { handled: await handler(request, response), ...response };
    }
  };
};

test('record routes preserve aliases, authoritative service inputs and private response headers', async (t) => {
  for (const prefix of ['/admin', '/api/admin']) {
    for (const [path, method, body, name, guard] of routes) {
      await t.test(prefix + path + ' ' + method, async () => {
        const f = fixture();
        const result = await f.run(prefix + path, { method, body });
        assert.equal(result.handled, true);
        assert.equal(result.status, 200);
        assert.equal(f.calls[0].name, guard);
        assert.deepEqual(
          f.calls
            .filter((call) => Object.hasOwn(f.results, call.name))
            .map((call) => call.name),
          [name]
        );
        if (name === 'list')
          assert.deepEqual(result.payload, {
            data_source: 'database',
            items: f.results.list.items,
            sponsorships: f.results.list.items,
            pagination: f.results.list.pagination,
            last_updated_at: f.results.list.lastUpdatedAt
          });
        else assert.deepEqual(result.payload, f.results[name]);
        if (name !== 'list')
          assert.equal(result.headers['Cache-Control'], 'private, no-store');
        if (method === 'POST') {
          assert.deepEqual(f.calls.find((call) => call.name === name).args, [
            JSON.parse(body),
            actor
          ]);
          assert.equal(
            f.calls.find((call) => call.name === 'body').maxBytes,
            name === 'information' ? 32 * 1024 : 16 * 1024
          );
        }
      });
    }
  }
});

test('access refusals stop before body parsing and private service calls', async (t) => {
  for (const denied of [401, 403, 503]) {
    for (const [path, method, _body, _name, guard] of routes) {
      await t.test(`${denied} ${method} ${path}`, async () => {
        const f = fixture({ denied });
        const result = await f.run('/api/admin' + path, { method, body: '{' });
        assert.equal(result.status, denied);
        assert.deepEqual(
          f.calls.map((call) => call.name),
          [guard, 'respond']
        );
      });
    }
  }
  const f = fixture({ accessDenied: 503 });
  assert.equal((await f.run('/admin/sponsorships/progress')).status, 200);
  assert.equal((await f.run('/admin/sponsorships')).status, 503);
});

test('reader role retains dossier consultation and cannot change records or queue information', async () => {
  for (const [path, method, body] of routes) {
    const f = fixture({ role: 'reader' });
    assert.equal(
      (await f.run('/admin' + path, { method, body })).status,
      method === 'GET' ? 200 : 403
    );
    if (method === 'POST')
      assert.equal(
        f.calls.some((call) => call.name === 'body'),
        false
      );
  }
});

test('list filters preserve pending alias, pagination fallback, trimming and legacy defaults', async () => {
  const f = fixture();
  await f.run(
    '/admin/sponsorships?page=2&pageSize=25&search=+Atelier+&reviewStatus=pending&feedStatus=planned&paymentStatus=paid&sort=company&direction=asc'
  );
  assert.deepEqual(f.calls.find((call) => call.name === 'list').args[0], {
    page: 2,
    pageSize: 25,
    search: 'Atelier',
    reviewStatus: 'pending_review',
    feedStatus: 'planned',
    paymentStatus: 'paid',
    sort: 'company',
    direction: 'asc'
  });
  for (const query of [
    '',
    '?page=-3&pageSize=12&reviewStatus=unknown&feedStatus=unknown&paymentStatus=unknown&sort=unknown&direction=unknown&search=++',
    '?page=x&pageSize=x'
  ]) {
    const defaults = fixture();
    await defaults.run('/api/admin/sponsorships' + query);
    assert.deepEqual(
      defaults.calls.find((call) => call.name === 'list').args[0],
      {
        page: 1,
        pageSize: 6,
        search: undefined,
        reviewStatus: undefined,
        feedStatus: undefined,
        paymentStatus: undefined,
        sort: 'priority',
        direction: 'desc'
      }
    );
  }
});

test('progress selection and intervention cursors reach only their owning service', async () => {
  const invalid = fixture();
  assert.equal(
    (await invalid.run('/admin/sponsorships/progress?sponsorshipId=invalid'))
      .status,
    400
  );
  assert.equal(
    invalid.calls.some((call) => call.name === 'progress'),
    false
  );
  const selected = fixture();
  await selected.run('/admin/sponsorships/progress?sponsorshipId=' + id);
  assert.deepEqual(
    selected.calls.find((call) => call.name === 'progress').args,
    [id]
  );
  const cursor = fixture();
  await cursor.run(
    '/api/admin/sponsorships/interventions?sponsorshipId=' +
      id +
      '&before=synthetic-cursor'
  );
  assert.deepEqual(
    cursor.calls.find((call) => call.name === 'interventions').args,
    [id, 'synthetic-cursor']
  );
});

test('dossier writes preserve content type, method, malformed JSON and byte limits', async () => {
  for (const path of ['/sponsorships/details', '/sponsorships/interventions']) {
    const wrongMethod = fixture();
    const methodResult = await wrongMethod.run('/admin' + path, {
      method: 'DELETE'
    });
    assert.equal(methodResult.status, 405);
    assert.equal(
      methodResult.headers.Allow,
      path.endsWith('details') ? 'POST' : 'GET, POST'
    );
    assert.equal(
      wrongMethod.calls.some((call) => call.name === 'body'),
      false
    );
    for (const contentType of ['text/plain', '']) {
      const f = fixture();
      assert.equal(
        (
          await f.run('/admin' + path, {
            method: 'POST',
            body: '{}',
            contentType
          })
        ).status,
        415
      );
      assert.equal(
        f.calls.some((call) => call.name === 'body'),
        false
      );
    }
  }
  for (const [path, _method, _body, name] of routes.filter(
    (route) => route[1] === 'POST'
  )) {
    for (const body of ['{', 'x'.repeat(33 * 1024)]) {
      const f = fixture();
      assert.equal(
        (await f.run('/admin' + path, { method: 'POST', body })).status,
        400
      );
      assert.equal(
        f.calls.some((call) => call.name === name),
        false
      );
    }
  }
});

test('confirmation, version and recipient remain mandatory and retries retain their logical result', async () => {
  for (const payload of [
    { ...information, confirmed: false },
    { ...information, contextVersion: '' },
    { ...information, recipient: 'invalid' }
  ]) {
    const f = fixture();
    assert.equal(
      (
        await f.run('/admin/sponsorships/request-information', {
          method: 'POST',
          body: JSON.stringify(payload)
        })
      ).status,
      400
    );
    assert.equal(
      f.calls.some((call) => call.name === 'information'),
      false
    );
  }
  for (const payload of [
    { ...details, confirmed: false },
    { ...details, expectedVersion: '' }
  ]) {
    const f = fixture();
    assert.equal(
      (
        await f.run('/admin/sponsorships/details', {
          method: 'POST',
          body: JSON.stringify(payload)
        })
      ).status,
      400
    );
  }
  for (const informationStatus of [
    'queued',
    'already_queued',
    'already_sent',
    'delivery_failed'
  ]) {
    const f = fixture({ informationStatus });
    const result = await f.run('/api/admin/sponsorships/request-information', {
      method: 'POST',
      body: JSON.stringify(information)
    });
    assert.equal(result.status, 200);
    assert.equal(result.payload.status, informationStatus);
  }
});

test('domain errors retain status while unexpected failures never disclose private diagnostics', async (t) => {
  for (const [path, method, body, name] of routes) {
    await t.test(name, async () => {
      const f = fixture({ failing: name });
      const result = await f.run('/api/admin' + path, { method, body });
      assert.equal(result.status, name === 'list' ? 502 : 503);
      assert.doesNotMatch(
        JSON.stringify(result.payload),
        /private persistence|diagnostics/
      );
    });
  }
  for (const [name, path, ErrorType, body] of [
    [
      'information',
      '/sponsorships/request-information',
      InformationRequestError,
      information
    ],
    ['details', '/sponsorships/details', SponsorshipDetailsError, details],
    [
      'record',
      '/sponsorships/interventions',
      SponsorshipInterventionError,
      intervention
    ]
  ]) {
    for (const status of [400, 404, 409, 503]) {
      const f = fixture({ failing: { name, error: new ErrorType(status) } });
      assert.equal(
        (
          await f.run('/admin' + path, {
            method: 'POST',
            body: JSON.stringify(body)
          })
        ).status,
        status
      );
    }
  }
});

test('adjacent routes and unsupported methods leave dispatch to other adapters', async () => {
  for (const [url, method] of [
    ['/admin/sponsorships/review', 'POST'],
    ['/admin/sponsorships/refund', 'POST'],
    ['/admin/sponsorships/website-visibility', 'POST'],
    ['/admin/sponsorships/details/extra', 'POST'],
    ['/admin/sponsorships/progress', 'POST'],
    ['/admin/sponsorships/request-information', 'GET'],
    ['/admin/sponsorships', 'POST'],
    ['https://[', 'GET']
  ]) {
    const f = fixture();
    const result = await f.run(url, { method });
    assert.equal(result.handled, false);
    assert.deepEqual(f.calls, []);
  }
});
