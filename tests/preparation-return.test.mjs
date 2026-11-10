import assert from 'node:assert/strict';
import test from 'node:test';

import { preparationReturnOrigin } from '../dist/apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-navigation.js';

const contributionId = '10000000-0000-4000-8000-000000000811';
const runId = '10000000-0000-4000-8000-000000000812';
const issueId = 'check:accepted_offer';

test('a dossier return keeps its selector and control without private search or fragments', () => {
  const origin = preparationReturnOrigin(
    '/admin/fundraiser/sponsors?search=private-example&tab=identity#private-detail',
    { contributionId },
    issueId
  );
  assert.deepEqual(origin, {
    url: `/admin/fundraiser/sponsors?sponsorshipId=${contributionId}&tab=publication`,
    contributionId,
    issueId,
    kind: 'dossier',
    runId: null,
    position: null
  });
});

test('a guide return keeps its exact frozen run position independently of progress', () => {
  const origin = preparationReturnOrigin(
    '/admin/fundraiser/attention?search=private-example#private-detail',
    { contributionId, runId, position: 7 },
    issueId
  );
  assert.deepEqual(origin, {
    url: '/admin/fundraiser/attention',
    contributionId,
    issueId,
    kind: 'guide',
    runId,
    position: 7
  });
});

test('a dossier return preserves its Preflight publication owner without unrelated query or fragments', () => {
  const origin = preparationReturnOrigin(
    `/admin/fundraiser/preflight?view=publication&workshopSponsorshipId=${contributionId}&publicationReturn=${contributionId}&search=private-example#private-detail`,
    { contributionId },
    issueId
  );
  assert.deepEqual(origin, {
    url: `/admin/fundraiser/preflight?view=publication&workshopSponsorshipId=${contributionId}&publicationReturn=${contributionId}`,
    contributionId,
    issueId,
    kind: 'dossier',
    runId: null,
    position: null
  });
});

test('a dossier return rejects other Preflight views and mismatched publication selectors', () => {
  for (const query of [
    '',
    `view=proposals&workshopSponsorshipId=${contributionId}&publicationReturn=${contributionId}`,
    `view=publication&workshopSponsorshipId=${runId}&publicationReturn=${contributionId}`,
    `view=publication&workshopSponsorshipId=${contributionId}&publicationReturn=${runId}`,
    `view=publication&workshopSponsorshipId=${contributionId}`,
    `view=publication&publicationReturn=${contributionId}`,
    'view=publication&workshopSponsorshipId=private-example&publicationReturn=private-example'
  ])
    assert.equal(
      preparationReturnOrigin(
        '/admin/fundraiser/preflight?' + query,
        { contributionId },
        issueId
      ),
      null,
      query
    );
});

test('a guide over another dossier preserves only its declared dossier selector and tab', () => {
  const origin = preparationReturnOrigin(
    `/admin/fundraiser/sponsors?sponsorshipId=${runId}&tab=overview&search=private-example`,
    { contributionId, runId, position: 2 },
    issueId
  );
  assert.equal(
    origin.url,
    `/admin/fundraiser/sponsors?sponsorshipId=${runId}&tab=overview`
  );
});

test('return bookmarks reject outside routes and malformed identifiers or positions', () => {
  for (const url of [
    'https://example.invalid/admin/fundraiser/sponsors',
    '//example.invalid/admin/fundraiser/sponsors',
    '/admin/../fundraiser/sponsors',
    '/admin/undeclared',
    '/admin/fundraiser/sponsors%5cprivate',
    `https://example.invalid/admin/fundraiser/preflight?view=publication&workshopSponsorshipId=${contributionId}&publicationReturn=${contributionId}`,
    `/admin/fundraiser/preflight/../preflight?view=publication&workshopSponsorshipId=${contributionId}&publicationReturn=${contributionId}`,
    `/admin/fundraiser/preflight?view=publication&workshopSponsorshipId=${contributionId}&publicationReturn=${contributionId}&extra=\\private`,
    `/admin/fundraiser/preflight?view=publication&workshopSponsorshipId=${contributionId}&publicationReturn=${contributionId}&extra=\tprivate`
  ])
    assert.equal(
      preparationReturnOrigin(url, { contributionId }, issueId),
      null
    );
  for (const receipt of [
    { contributionId: 'private-example' },
    { contributionId, runId: 'private-example', position: 1 },
    { contributionId, runId, position: 0 },
    { contributionId, runId, position: 1.5 }
  ])
    assert.equal(
      preparationReturnOrigin('/admin/fundraiser/sponsors', receipt, issueId),
      null
    );
  assert.equal(
    preparationReturnOrigin(
      '/admin/fundraiser/sponsors',
      { contributionId },
      'arbitrary:private'
    ),
    null
  );
});
