import assert from 'node:assert/strict';
import test from 'node:test';

import '@angular/compiler';
import { DefaultUrlSerializer } from '@angular/router';

import {
  dossierReturn,
  dossierReturnQuery,
  dossierWorkspaceFocus,
  DossierWorkspaceNavigation
} from '../dist/apps/funding-web/src/app/features/funding/models/admin-dossier-return.js';
import {
  assistantDossierReturn,
  assistantDossierQuery
} from '../dist/apps/funding-web/src/app/features/funding/models/admin-assistant-navigation.js';

const serializer = new DefaultUrlSerializer();
const router = {
  parseUrl: (value) => serializer.parse(value),
  serializeUrl: (value) => serializer.serialize(value)
};
const id = 'synthetic-dossier';
const origin = `/admin/fundraiser/sponsors?sponsorshipId=${id}&tab=publication#dossier-agreement`;

test('Assistant retains the same strict dossier return contract after sharing it', () => {
  assert.equal(assistantDossierReturn, dossierReturn);
  assert.equal(assistantDossierQuery, dossierReturnQuery);
});

test('workspace origins preserve the dossier section and strip private and nested queries', () => {
  const requested = origin.replace(
    '#',
    '&recipient=PRIVATE&returnTo=https%3A%2F%2Fexternal.example.invalid#'
  );
  assert.deepEqual(dossierReturnQuery(router, requested, id), {
    sponsorshipId: id,
    returnTo: origin
  });
  for (const invalid of [
    origin.replace(id, 'other-dossier'),
    'https://external.example.invalid' + origin
  ])
    assert.equal(dossierReturn(router, invalid, id), null);
  assert.deepEqual(dossierReturnQuery(router, origin, null), {});
});

test('focus rejects persisted shapes, another dossier and unknown trigger names', () => {
  const intent = new DossierWorkspaceNavigation(
    id,
    'commitments-evidence',
    'synthetic-evidence'
  );
  assert.equal(dossierWorkspaceFocus(intent, id), intent);
  assert.equal(dossierWorkspaceFocus({ ...intent }, id), undefined);
  assert.equal(dossierWorkspaceFocus(intent, 'other-dossier'), undefined);
  assert.equal(
    dossierWorkspaceFocus(
      new DossierWorkspaceNavigation(id, 'unknown-hook'),
      id
    ),
    undefined
  );
});
