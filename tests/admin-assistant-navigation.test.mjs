import assert from 'node:assert/strict';
import test from 'node:test';

import '@angular/compiler';
import { DefaultUrlSerializer } from '@angular/router';

import {
  assistantDossierQuery,
  assistantDossierReturn
} from '../dist/apps/funding-web/src/app/features/funding/models/admin-assistant-navigation.js';

const sponsorshipId = 'synthetic-sponsor';
const dossierPath = '/admin/fundraiser/sponsors';
const serializer = new DefaultUrlSerializer();
const router = {
  parseUrl: (value) => serializer.parse(value),
  serializeUrl: (tree) => serializer.serialize(tree)
};
const path = (tab, fragment) =>
  `${dossierPath}?sponsorshipId=${sponsorshipId}${tab ? '&tab=' + tab : ''}${fragment ? '#' + fragment : ''}`;
const returned = (value, id = sponsorshipId) =>
  assistantDossierReturn(router, value, id);

test('an origin without a tab returns the same dossier overview', () => {
  assert.equal(router.serializeUrl(returned(path())), path('overview'));
});

test('the five canonical dossier tabs retain their own recognized fragment', () => {
  for (const tab of [
    'overview',
    'identity',
    'publication',
    'billing',
    'audit'
  ]) {
    const fragment = tab === 'overview' ? 'dossier-review' : 'dossier-' + tab;
    const origin = path(tab, fragment);
    assert.equal(router.serializeUrl(returned(origin)), origin, tab);
  }
});

test('media and refund aliases retain fragments from the same visible workspace', () => {
  for (const [tab, fragment] of [
    ['media', 'dossier-media-gallery'],
    ['media', 'dossier-identity'],
    ['identity', 'dossier-media-gallery'],
    ['refund', 'dossier-refund'],
    ['refund', 'dossier-billing'],
    ['billing', 'dossier-refund']
  ]) {
    const origin = path(tab, fragment);
    assert.equal(router.serializeUrl(returned(origin)), origin, origin);
  }
});

test('external and protocol-relative origins are rejected', () => {
  for (const origin of [
    'https://external.example.test' + path('identity'),
    '//external.example.test' + path('identity'),
    'javascript:alert(1)'
  ])
    assert.equal(returned(origin), null, origin);
});

test('the return path rejects other routes, matrix parameters and outlets', () => {
  for (const origin of [
    path('identity').replace('/sponsors?', '/sponsors/quality?'),
    path('identity').replace('/sponsors?', '/sponsors;view=compact?'),
    path('identity').replace('/sponsors?', '/sponsors(aux:attention)?')
  ])
    assert.equal(returned(origin), null, origin);
});

test('a return origin must identify the exact current dossier', () => {
  assert.equal(returned(path('identity'), 'synthetic-other'), null);
  assert.equal(returned(dossierPath), null);
});

test('duplicate dossier identifiers are rejected even when their values match', () => {
  for (const id of [sponsorshipId, 'synthetic-other'])
    assert.equal(returned(path('identity') + '&sponsorshipId=' + id), null, id);
});

test('duplicate tabs are rejected even when their values match', () => {
  for (const tab of ['identity', 'publication'])
    assert.equal(returned(path('identity') + '&tab=' + tab), null, tab);
});

test('an unknown or empty tab does not become a valid return origin', () => {
  assert.equal(returned(path('unknown')), null);
  assert.equal(returned(path() + '&tab='), null);
});

test('unknown fragments and sections from another workspace are removed', () => {
  for (const fragment of ['unknown', 'dossier-unknown', 'dossier-refund'])
    assert.equal(
      router.serializeUrl(returned(path('publication', fragment))),
      path('publication'),
      fragment
    );
});

test('private filters and nested return values are stripped from the rebuilt URL', () => {
  const origin =
    path('publication') +
    '&search=PRIVATE-SEARCH&email=private%40example.invalid&returnTo=%2Fadmin%2Ffundraiser%2Fassistant%3Fselected%3Dprivate#dossier-agreement';
  const result = returned(origin);
  assert.deepEqual(result.queryParams, {
    sponsorshipId,
    tab: 'publication'
  });
  assert.equal(
    router.serializeUrl(result),
    path('publication', 'dossier-agreement')
  );
});

test('missing, oversized and unparseable origins fail closed', () => {
  assert.equal(returned(null), null);
  assert.equal(returned(undefined), null);
  assert.equal(returned(path('identity'), null), null);
  assert.equal(
    returned(path('identity') + '&padding=' + 'x'.repeat(2048)),
    null
  );
  assert.equal(
    assistantDossierReturn(
      {
        parseUrl: () => {
          throw new Error('Synthetic malformed URL');
        }
      },
      path('identity'),
      sponsorshipId
    ),
    null
  );
});

test('Assistant query parameters carry only the exact ID and sanitized return origin', () => {
  assert.deepEqual(
    assistantDossierQuery(
      router,
      path('identity') + '&search=PRIVATE-SEARCH#dossier-media-gallery',
      sponsorshipId
    ),
    {
      sponsorshipId,
      returnTo: path('identity', 'dossier-media-gallery')
    }
  );
});

test('Assistant query parameters omit an unknown origin and never invent an ID', () => {
  assert.deepEqual(assistantDossierQuery(router, path('identity'), null), {});
  for (const origin of [
    '/admin/fundraiser',
    path('identity').replace(sponsorshipId, 'synthetic-other')
  ])
    assert.deepEqual(assistantDossierQuery(router, origin, sponsorshipId), {
      sponsorshipId
    });
});
